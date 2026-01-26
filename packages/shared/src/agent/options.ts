import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { join, dirname } from "path";
import { homedir } from "os";
import { existsSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from "fs";
import { debug } from "../utils/debug";

declare const CRAFT_AGENT_CLI_VERSION: string | undefined;

let optionsEnv: Record<string, string> = {};
let customPathToClaudeCodeExecutable: string | null = null;
let customInterceptorPath: string | null = null;
let customExecutable: string | null = null;
let claudeConfigChecked = false;

// UTF-8 BOM character — Windows editors/processes sometimes prepend this to files.
// JSON parsers reject BOM, but the file content after BOM may be valid JSON.
const UTF8_BOM = '\uFEFF';

/**
 * Ensure ~/.claude.json exists and contains valid, BOM-free JSON before
 * the SDK subprocess starts.
 *
 * Background: The SDK's cli.js reads this file on startup. If it's missing
 * (with a .backup file present), empty, BOM-prefixed, or contains invalid JSON,
 * the CLI writes plain-text error/recovery messages to process.stdout.
 * The SDK transport expects only JSON on stdout, so any plain text causes:
 *   "CLI output was not valid JSON"
 *
 * Known causes of corruption (from claude-code GitHub issues):
 *   - UTF-8 BOM encoding on Windows (#14442) — editors/auth writes add BOM prefix
 *   - Empty file from crash during write (#2593) — CLI truncates before writing
 *   - Race condition with concurrent sessions (#18998) — no file locking
 *   - Missing file with stale .backup — CLI writes recovery instructions to stdout
 *
 * This runs once per process lifetime (not on every message), unless
 * resetClaudeConfigCheck() is called to force a re-check after error recovery.
 */
function ensureClaudeConfig(): void {
    if (claudeConfigChecked) return;
    claudeConfigChecked = true;

    const configPath = join(homedir(), '.claude.json');

    // Clean up stale .backup file — if present and .claude.json is missing,
    // the CLI writes "A backup file exists at..." to stdout, crashing the SDK.
    // We remove it so the CLI sees a clean "missing file" state (which it handles silently).
    const backupPath = `${configPath}.backup`;
    if (existsSync(backupPath)) {
        try {
            unlinkSync(backupPath);
            debug('[options] Removed stale ~/.claude.json.backup');
        } catch (err) {
            debug(`[options] Failed to remove ~/.claude.json.backup: ${err}`);
        }
    }

    // Clean up .corrupted.* files — these accumulate on Windows and signal
    // to the CLI that a previous corruption was detected, altering its stdout output.
    try {
        const homeDir = homedir();
        const files = readdirSync(homeDir);
        for (const file of files) {
            if (file.startsWith('.claude.json.corrupted.')) {
                try {
                    unlinkSync(join(homeDir, file));
                    debug(`[options] Removed stale ${file}`);
                } catch { /* best effort */ }
            }
        }
    } catch {
        // If we can't read homedir, we'll still try the main repair below
    }

    // If file doesn't exist, create it with minimal valid JSON.
    // The CLI handles truly missing files (no backup) silently, but creating
    // the file is safer — it prevents any future backup-related stdout pollution.
    if (!existsSync(configPath)) {
        debug('[options] ~/.claude.json missing, creating with {}');
        writeConfigSafe(configPath, '{}');
        return;
    }

    // File exists — read and validate
    try {
        const raw = readFileSync(configPath, 'utf-8');

        // Strip UTF-8 BOM if present (common on Windows — see claude-code#14442).
        // The BOM is valid UTF-8 but invalid as a JSON start character, so the CLI
        // rejects the file and writes an error to stdout.
        const content = raw.startsWith(UTF8_BOM) ? raw.slice(1) : raw;
        const hasBom = raw !== content;

        if (content.trim().length === 0) {
            // Empty file (or BOM-only) — write minimal valid JSON
            debug(`[options] ~/.claude.json is empty${hasBom ? ' (had BOM)' : ''}, resetting to {}`);
            writeConfigSafe(configPath, '{}');
            return;
        }

        // Try to parse the (BOM-stripped) content
        JSON.parse(content);

        if (hasBom) {
            // Valid JSON but had BOM prefix — rewrite without BOM to prevent
            // the CLI from rejecting it. Preserves all existing config data.
            debug('[options] ~/.claude.json had UTF-8 BOM, rewriting without BOM');
            writeConfigSafe(configPath, content);
        }
        // else: valid JSON, no BOM — nothing to do
    } catch {
        // File exists but contains invalid JSON — reset to minimal valid state.
        // This loses user's CLI config but prevents the subprocess crash.
        debug('[options] ~/.claude.json is corrupted, resetting to {}');
        writeConfigSafe(configPath, '{}');
    }
}

/**
 * Write content to a config file with retry logic for Windows.
 * On Windows, files can be temporarily locked by antivirus scanners,
 * Windows Search indexer, or other processes — retry once after a brief delay.
 */
function writeConfigSafe(configPath: string, content: string): void {
    try {
        writeFileSync(configPath, content, 'utf-8');
    } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException)?.code;
        // EBUSY = file in use, EPERM = permission denied (often transient on Windows)
        if (process.platform === 'win32' && (code === 'EBUSY' || code === 'EPERM')) {
            debug(`[options] Write failed with ${code}, retrying after 100ms...`);
            // Synchronous sleep — acceptable here since this runs once at startup
            const start = Date.now();
            while (Date.now() - start < 100) { /* busy wait */ }
            try {
                writeFileSync(configPath, content, 'utf-8');
                debug('[options] Retry succeeded');
            } catch (retryErr) {
                debug(`[options] Retry also failed: ${retryErr}`);
            }
        } else {
            debug(`[options] Failed to write ~/.claude.json: ${err}`);
        }
    }
}

/**
 * Reset the once-per-process guard so ensureClaudeConfig() runs again.
 * Called from the error handler when a config corruption crash is detected
 * at runtime — allows auto-repair before retrying the session.
 */
export function resetClaudeConfigCheck(): void {
    claudeConfigChecked = false;
}

export function setAnthropicOptionsEnv(env: Record<string, string>) {
    optionsEnv = env;
}

/**
 * Override the path to the Claude Code executable (cli.js from the SDK).
 * This is needed when the SDK is bundled (e.g., in Electron) and can't auto-detect the path.
 */
export function setPathToClaudeCodeExecutable(path: string) {
    customPathToClaudeCodeExecutable = path;
}

/**
 * Set the path to the network interceptor for the SDK subprocess.
 * This interceptor captures API errors and adds metadata to MCP tool schemas.
 */
export function setInterceptorPath(path: string) {
    customInterceptorPath = path;
}

/**
 * Set the path to the JavaScript runtime executable (e.g., bun or node).
 * This is needed when bundling a runtime with the app (e.g., in Electron).
 */
export function setExecutable(path: string) {
    customExecutable = path;
}

export function getDefaultOptions(): Partial<Options> {
    // Repair corrupted ~/.claude.json before the SDK subprocess reads it
    ensureClaudeConfig();

    // SECURITY: Disable Bun's automatic .env file loading in the SDK subprocess.
    // Without this, Bun loads .env from the subprocess cwd (user's working directory),
    // which can inject ANTHROPIC_API_KEY and override our OAuth auth — silently charging
    // the user's API key instead of their Max subscription.
    // See: https://github.com/lukilabs/craft-agents-oss/issues/39
    // Use platform-appropriate null device (NUL on Windows, /dev/null on Unix)
    const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';
    const envFileFlag = `--env-file=${nullDevice}`;

    // If custom path is set (e.g., for Electron), use it with minimal options
    if (customPathToClaudeCodeExecutable) {
        const executableArgs = [envFileFlag];
        // Add interceptor preload if path is set (needed for cache TTL patching)
        if (customInterceptorPath) {
            executableArgs.push('--preload', customInterceptorPath);
        }
        return {
            pathToClaudeCodeExecutable: customPathToClaudeCodeExecutable,
            // Use custom executable if set, otherwise default to 'bun'
            executable: (customExecutable || 'bun') as 'bun',
            executableArgs,
            env: {
                ...process.env,
                ... optionsEnv,
                // Propagate debug mode from argv flag OR existing env var
                CRAFT_DEBUG: (process.argv.includes('--debug') || process.env.CRAFT_DEBUG === '1') ? '1' : '0',
            }
        };
    }

    if (typeof CRAFT_AGENT_CLI_VERSION !== 'undefined' && CRAFT_AGENT_CLI_VERSION != null) {
        const baseDir = join(homedir(), '.local', 'share', 'craft', 'versions', CRAFT_AGENT_CLI_VERSION);
        return {
            pathToClaudeCodeExecutable: join(baseDir, 'claude-agent-sdk', 'cli.js'),
            // Use the compiled binary itself as the runtime via BUN_BE_BUN=1
            // This makes the compiled Bun executable act as the full Bun CLI,
            // eliminating the need for external Node or Bun installation
            executable: process.execPath as 'bun',
            // Inject network interceptor into SDK subprocess for API error capture and MCP schema injection
            executableArgs: [envFileFlag, '--preload', join(baseDir, 'network-interceptor.ts')],
            env: {
                ...process.env,
                BUN_BE_BUN: '1',
                ... optionsEnv,
                // Propagate debug mode from argv flag OR existing env var
                CRAFT_DEBUG: (process.argv.includes('--debug') || process.env.CRAFT_DEBUG === '1') ? '1' : '0',
            }
        }
    }
    return {
        executableArgs: [envFileFlag],
        env: {
            ... process.env,
            ... optionsEnv,
            // Propagate debug mode from argv flag OR existing env var
            CRAFT_DEBUG: (process.argv.includes('--debug') || process.env.CRAFT_DEBUG === '1') ? '1' : '0',
        }
    };
}