/**
 * Command Executor for Hooks
 *
 * Handles permission checking and command execution for hook commands.
 * Provides security boundary between user-defined hooks and shell execution.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import {
  permissionsConfigCache,
  type PermissionsContext,
  type MergedPermissionsConfig,
} from '../agent/permissions-config.ts';
import { getBashRejectionReason, formatBashRejectionMessage } from '../agent/mode-manager.ts';

const execAsync = promisify(exec);

// ============================================================================
// Permission State
// ============================================================================

let permissionsContext: PermissionsContext | null = null;
let permissionsConfig: MergedPermissionsConfig | null = null;

/**
 * Set the permissions context for command checking.
 * This loads the merged permissions from the global settings.
 */
export function setPermissionsContext(ctx: PermissionsContext): void {
  permissionsContext = ctx;
  permissionsConfig = permissionsConfigCache.getMergedConfig(ctx);
}

/**
 * Clear permissions context
 */
export function clearPermissionsContext(): void {
  permissionsContext = null;
  permissionsConfig = null;
}

/**
 * Check if a command is allowed using the global permission patterns.
 *
 * Uses the allowlist approach from Settings:
 * - Commands matching allowedBashPatterns are allowed
 * - Commands not matching any pattern are blocked
 */
export function isCommandAllowed(command: string): { allowed: boolean; reason?: string } {
  // If no permissions config, block all (fail-closed)
  if (!permissionsConfig) {
    return { allowed: false, reason: 'Permissions not initialized' };
  }

  // Use the global bash permission checker
  const rejection = getBashRejectionReason(command, permissionsConfig);

  if (!rejection) {
    return { allowed: true };
  }

  // Command not in allowlist - format a helpful error message
  const reason = formatBashRejectionMessage(rejection, permissionsConfig);
  return { allowed: false, reason };
}

/**
 * Get the current permissions config (for debugging/display)
 */
export function getPermissionsConfig(): MergedPermissionsConfig | null {
  return permissionsConfig;
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
    const permission = isCommandAllowed(command);
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
    const { stdout, stderr } = await execAsync(command, {
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
