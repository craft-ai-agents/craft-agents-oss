/**
 * Command Executor for Hooks
 *
 * Handles permission checking and command execution for hook commands.
 * Provides security boundary between user-defined hooks and shell execution.
 */

import { exec, type ExecOptions } from 'node:child_process';
import { createLogger } from '../utils/debug.ts';
import {
  permissionsConfigCache,
  type PermissionsContext,
  type MergedPermissionsConfig,
} from '../agent/permissions-config.ts';
import { getBashRejectionReason, formatBashRejectionMessage } from '../agent/mode-manager.ts';

const log = createLogger('command-executor');

// Grace period before sending SIGKILL after SIGTERM (ms)
const SIGKILL_GRACE_MS = 5000;

/**
 * Execute a command with SIGKILL fallback.
 * Node.js exec sends SIGTERM on timeout, but if the process traps SIGTERM
 * and doesn't exit, the parent hangs forever. This wrapper sends SIGKILL
 * after a grace period to guarantee cleanup.
 */
function execWithKill(
  command: string,
  options: ExecOptions & { timeout?: number; maxBuffer?: number }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = exec(command, options, (error, stdout, stderr) => {
      clearTimeout(killTimer);
      if (error) {
        const err = error as Error & { stdout?: string; stderr?: string };
        err.stdout = stdout as string;
        err.stderr = stderr as string;
        reject(err);
      } else {
        resolve({ stdout: stdout as string, stderr: stderr as string });
      }
    });

    let killTimer: ReturnType<typeof setTimeout>;
    const timeout = options.timeout ?? 0;
    if (timeout > 0) {
      killTimer = setTimeout(() => {
        if (!child.killed) {
          log.warn(`[CommandExecutor] Process did not exit after SIGTERM, sending SIGKILL`);
          child.kill('SIGKILL');
        }
      }, timeout + SIGKILL_GRACE_MS);
    }
  });
}

// ============================================================================
// Permission Checking
// ============================================================================

/**
 * Resolve a PermissionsContext to a MergedPermissionsConfig.
 */
export function resolvePermissionsConfig(ctx: PermissionsContext): MergedPermissionsConfig {
  return permissionsConfigCache.getMergedConfig(ctx);
}

/**
 * Check if a command is allowed using the provided permission config.
 *
 * Uses the allowlist approach from Settings:
 * - Commands matching allowedBashPatterns are allowed
 * - Commands not matching any pattern are blocked
 */
export function isCommandAllowed(command: string, config?: MergedPermissionsConfig | null): { allowed: boolean; reason?: string } {
  // If no permissions config, block all (fail-closed)
  if (!config) {
    return { allowed: false, reason: 'Permissions not initialized' };
  }

  // Use the global bash permission checker
  const rejection = getBashRejectionReason(command, config);

  if (!rejection) {
    return { allowed: true };
  }

  // Command not in allowlist - format a helpful error message
  const reason = formatBashRejectionMessage(rejection, config);
  return { allowed: false, reason };
}

// ============================================================================
// Command Execution
// ============================================================================

export interface CommandExecutionOptions {
  /** Environment variables to pass to the command */
  env: Record<string, string>;
  /** Command timeout in milliseconds (default: 60000) */
  timeout?: number;
  /** Working directory for command execution */
  cwd?: string;
  /** Permission mode for the command ('allow-all' bypasses checks) */
  permissionMode?: 'safe' | 'ask' | 'allow-all';
  /** Permissions context for resolving command allowlists */
  permissionsContext?: PermissionsContext;
}

export interface CommandExecutionResult {
  success: boolean;
  stdout: string;
  stderr: string;
  blocked?: boolean;
}

/**
 * Execute a shell command with permission checking.
 *
 * @param command - The shell command to execute
 * @param options - Execution options including env, timeout, cwd
 * @returns Execution result with stdout, stderr, and success status
 */
export async function executeCommand(
  command: string,
  options: CommandExecutionOptions
): Promise<CommandExecutionResult> {
  // Check permissions unless allow-all mode
  if (options.permissionMode === 'allow-all') {
    console.warn(`[hooks] WARNING: Executing command in allow-all mode (bypasses security checks): ${command}`);
  }
  if (options.permissionMode !== 'allow-all') {
    const config = options.permissionsContext
      ? resolvePermissionsConfig(options.permissionsContext)
      : null;
    const permission = isCommandAllowed(command, config);
    if (!permission.allowed) {
      return {
        success: false,
        stdout: '',
        stderr: permission.reason ?? 'Command blocked by security rules',
        blocked: true,
      };
    }
  }

  try {
    const { stdout, stderr } = await execWithKill(command, {
      env: options.env,
      timeout: options.timeout ?? 60000,
      cwd: options.cwd,
      shell: '/bin/bash',
    });
    return {
      success: true,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
    };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    return {
      success: false,
      stdout: err.stdout?.trim() ?? '',
      stderr: err.stderr?.trim() ?? err.message ?? 'Unknown error',
    };
  }
}
