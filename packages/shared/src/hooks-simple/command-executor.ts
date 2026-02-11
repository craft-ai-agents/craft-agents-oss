/**
 * Command Executor
 *
 * Executes shell commands from hook actions with permission checks,
 * timeout enforcement, and SIGTERM/SIGKILL fallback.
 */

import { spawn } from 'child_process';
import { debug } from '../utils/debug.ts';

const DEFAULT_TIMEOUT_MS = 30_000;
const SIGKILL_DELAY_MS = 5_000;

export interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  killed: boolean;
}

/**
 * Execute a shell command with timeout and cleanup.
 *
 * @param command - Shell command to execute
 * @param options - Execution options
 * @returns Command result
 */
export async function executeCommand(
  command: string,
  options: {
    cwd?: string;
    timeout?: number;
    env?: Record<string, string>;
  } = {},
): Promise<CommandResult> {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;

  return new Promise<CommandResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let killed = false;
    let timeoutId: NodeJS.Timeout | undefined;
    let killTimeoutId: NodeJS.Timeout | undefined;

    const mergedEnv = {
      ...process.env,
      ...options.env,
    };

    const child = spawn('sh', ['-c', command], {
      cwd: options.cwd,
      env: mergedEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
      // Cap stdout at 100KB to prevent memory issues
      if (stdout.length > 100_000) {
        stdout = stdout.substring(0, 100_000) + '\n[truncated]';
        child.stdout?.removeAllListeners('data');
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
      // Cap stderr at 100KB
      if (stderr.length > 100_000) {
        stderr = stderr.substring(0, 100_000) + '\n[truncated]';
        child.stderr?.removeAllListeners('data');
      }
    });

    child.on('close', (exitCode) => {
      if (timeoutId) clearTimeout(timeoutId);
      if (killTimeoutId) clearTimeout(killTimeoutId);

      resolve({
        exitCode,
        stdout,
        stderr,
        timedOut,
        killed,
      });
    });

    child.on('error', (error) => {
      if (timeoutId) clearTimeout(timeoutId);
      if (killTimeoutId) clearTimeout(killTimeoutId);

      resolve({
        exitCode: null,
        stdout,
        stderr: stderr + `\n${error.message}`,
        timedOut,
        killed,
      });
    });

    // Set timeout with SIGTERM -> SIGKILL escalation
    timeoutId = setTimeout(() => {
      timedOut = true;
      debug(`[CommandExecutor] Command timed out after ${timeout}ms, sending SIGTERM: ${command.substring(0, 100)}`);
      child.kill('SIGTERM');

      // If SIGTERM doesn't work, escalate to SIGKILL
      killTimeoutId = setTimeout(() => {
        if (!child.killed) {
          debug(`[CommandExecutor] SIGTERM didn't work, sending SIGKILL: ${command.substring(0, 100)}`);
          killed = true;
          child.kill('SIGKILL');
        }
      }, SIGKILL_DELAY_MS);
    }, timeout);
  });
}
