import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { join } from "path";
import { homedir } from "os";
import { debug } from "../utils/debug";

declare const CRAFT_AGENT_CLI_VERSION: string | undefined;

let optionsEnv: Record<string, string> = {};
let customPathToClaudeCodeExecutable: string | null = null;

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

export function getDefaultOptions(): Partial<Options> {
    // If custom path is set (e.g., for Electron), use it with minimal options
    if (customPathToClaudeCodeExecutable) {
        return {
            pathToClaudeCodeExecutable: customPathToClaudeCodeExecutable,
            env: {
                ...process.env,
                ... optionsEnv,
                CRAFT_DEBUG: process.argv.includes('--debug') ? '1' : '0',
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
            // Inject cache-ttl-interceptor into SDK subprocess to patch fetch for extended TTL
            executableArgs: ['--preload', join(baseDir, 'cache-ttl-interceptor.ts')],
            env: {
                ...process.env,
                BUN_BE_BUN: '1',
                ... optionsEnv,
                CRAFT_DEBUG: process.argv.includes('--debug') ? '1' : '0',
            }
        }
    }
    return {
        env: {
            ... process.env,
            ... optionsEnv,
            CRAFT_DEBUG: process.argv.includes('--debug') ? '1' : '0',
        }
    };
}