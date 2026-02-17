/**
 * CommandHandler - Executes shell commands from hooks
 *
 * Subscribes to all hook events and executes matching command hooks.
 * Uses the existing command-executor for permission checking and execution.
 */

import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '../../utils/debug.ts';
import type { EventBus, BaseEventPayload } from '../event-bus.ts';
import type { HookHandler, CommandHandlerOptions, HooksConfigProvider } from './types.ts';
import type { HookEvent, CommandHookDefinition } from '../types.ts';
import { executeCommand } from '../command-executor.ts';
import type { PermissionsContext } from '../../agent/permissions-config.ts';
import { matcherMatches, buildEnvFromPayload } from '../utils.ts';

const log = createLogger('command-handler');

// ============================================================================
// CommandHandler Implementation
// ============================================================================

export class CommandHandler implements HookHandler {
  private readonly options: CommandHandlerOptions;
  private readonly configProvider: HooksConfigProvider;
  private readonly permissionsContext: PermissionsContext;
  private bus: EventBus | null = null;
  private boundHandler: ((event: HookEvent, payload: BaseEventPayload) => Promise<void>) | null = null;

  constructor(options: CommandHandlerOptions, configProvider: HooksConfigProvider) {
    this.options = options;
    this.configProvider = configProvider;
    this.permissionsContext = {
      workspaceRootPath: options.workspaceRootPath,
      activeSourceSlugs: options.activeSourceSlugs,
    };
  }

  /**
   * Subscribe to all events on the bus.
   */
  subscribe(bus: EventBus): void {
    this.bus = bus;
    this.boundHandler = this.handleEvent.bind(this);
    bus.onAny(this.boundHandler);
    log.debug(`[CommandHandler] Subscribed to event bus`);
  }

  /**
   * Handle an event by executing matching command hooks.
   */
  private async handleEvent(event: HookEvent, payload: BaseEventPayload): Promise<void> {
    const matchers = this.configProvider.getMatchersForEvent(event);
    if (matchers.length === 0) return;

    // Group command hooks by matcher (so we can record per-matcher history)
    const matcherCommands: Array<{
      matcherId: string | undefined;
      commands: Array<{ command: CommandHookDefinition; permissionMode?: 'safe' | 'ask' | 'allow-all' }>;
    }> = [];

    for (const matcher of matchers) {
      if (!matcherMatches(matcher, event, payload as unknown as Record<string, unknown>)) continue;

      const commands: Array<{ command: CommandHookDefinition; permissionMode?: 'safe' | 'ask' | 'allow-all' }> = [];
      for (const hook of matcher.hooks) {
        if (hook.type === 'command') {
          commands.push({ command: hook, permissionMode: matcher.permissionMode });
        }
      }
      if (commands.length > 0) {
        matcherCommands.push({ matcherId: matcher.id, commands });
      }
    }

    if (matcherCommands.length === 0) return;

    const totalCommands = matcherCommands.reduce((s, m) => s + m.commands.length, 0);
    log.debug(`[CommandHandler] Executing ${totalCommands} commands for ${event}`);

    // Build environment variables
    const env = buildEnvFromPayload(event, payload);

    // Execute commands per matcher
    for (const { matcherId, commands } of matcherCommands) {
      let allOk = true;

      await Promise.all(
        commands.map(async ({ command, permissionMode }) => {
          const startTime = Date.now();

          try {
            const result = await executeCommand(command.command, {
              env,
              timeout: command.timeout ?? 60000,
              cwd: this.options.workingDir,
              permissionMode,
              permissionsContext: this.permissionsContext,
            });

            const durationMs = Date.now() - startTime;

            if (result.blocked) {
              log.warn(`[CommandHandler] Blocked: ${command.command} - ${result.stderr}`);
              allOk = false;
            } else if (!result.success) {
              log.warn(`[CommandHandler] Failed: ${command.command}`, result.stderr);
              allOk = false;
            } else {
              log.debug(`[CommandHandler] Success: ${command.command} (${durationMs}ms)`);
            }
          } catch (error) {
            allOk = false;
            const err = error instanceof Error ? error : new Error(String(error));
            log.error(`[CommandHandler] Error executing ${command.command}:`, err);
            this.options.onError?.(event, err);
          }
        })
      );

      this.appendHistory(matcherId, allOk);
    }
  }

  /**
   * Append a single execution record to tasks-history.jsonl.
   * Fire-and-forget — failures are silently ignored.
   */
  private appendHistory(matcherId: string | undefined, ok: boolean): void {
    if (!matcherId) return;
    const line = JSON.stringify({ id: matcherId, ts: Date.now(), ok }) + '\n';
    appendFile(join(this.options.workspaceRootPath, 'tasks-history.jsonl'), line, 'utf-8')
      .catch(() => {}); // fire-and-forget, non-critical
  }

  /**
   * Clean up resources.
   */
  dispose(): void {
    if (this.bus && this.boundHandler) {
      this.bus.offAny(this.boundHandler);
      this.boundHandler = null;
    }
    this.bus = null;
    log.debug(`[CommandHandler] Disposed`);
  }
}
