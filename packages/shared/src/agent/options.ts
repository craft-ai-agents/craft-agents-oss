import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { join, dirname } from "path";
import { homedir } from "os";
import { debug } from "../utils/debug";

declare const CRAFT_AGENT_CLI_VERSION: string | undefined;

let optionsEnv: Record<string, string> = {};
let customPathToClaudeCodeExecutable: string | null = null;
let customInterceptorPath: string | null = null;
let customExecutable: string | null = null;

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