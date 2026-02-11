/**
 * Command Handler
 *
 * Executes shell commands in response to hook events.
 * Respects permission mode and applies environment variables.
 */

import { debug } from '../../utils/debug.ts';
import type { HookAction, HookEventType, BaseEventPayload, HookHandler, CommandHookAction } from '../types.ts';
import { executeCommand } from '../command-executor.ts';
import { buildEventEnv } from '../utils.ts';
import { validateCommand } from '../security.ts';

export class CommandHandler implements HookHandler {
  readonly type = 'command' as const;

  private workspaceRootPath: string;

  constructor(workspaceRootPath: string) {
    this.workspaceRootPath = workspaceRootPath;
  }

  async handle(
    action: HookAction,
    event: HookEventType,
    payload: BaseEventPayload,
  ): Promise<void> {
    if (action.type !== 'command') return;

    const commandAction = action as CommandHookAction;
    const { command, timeout, cwd } = commandAction;

    // Validate command
    const validationError = validateCommand(command);
    if (validationError) {
      debug(`[CommandHandler] Validation failed: ${validationError}`);
      return;
    }

    // Build environment variables from event payload
    const env = buildEventEnv(event, payload);

    const workingDir = cwd || this.workspaceRootPath;

    debug(`[CommandHandler] Executing: ${command.substring(0, 100)}... [event=${event}, cwd=${workingDir}]`);

    try {
      const result = await executeCommand(command, {
        cwd: workingDir,
        timeout,
        env,
      });

      if (result.timedOut) {
        debug(`[CommandHandler] Command timed out: ${command.substring(0, 100)}`);
      } else if (result.exitCode !== 0) {
        debug(`[CommandHandler] Command exited with code ${result.exitCode}: ${result.stderr.substring(0, 200)}`);
      } else {
        debug(`[CommandHandler] Command completed successfully: ${command.substring(0, 100)}`);
      }
    } catch (error) {
      debug(`[CommandHandler] Execution error: ${error instanceof Error ? error.message : error}`);
    }
  }
}
