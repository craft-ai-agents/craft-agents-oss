/**
 * CommandHandler - Executes shell commands from hooks
 *
 * Subscribes to all hook events and executes matching command hooks.
 * Uses the existing command-executor for permission checking and execution.
 */

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

    // Find matching command hooks
    const commandHooks: Array<{ command: CommandHookDefinition; permissionMode?: 'safe' | 'ask' | 'allow-all' }> = [];

    for (const matcher of matchers) {
      if (!matcherMatches(matcher, event, payload as unknown as Record<string, unknown>)) continue;

      for (const hook of matcher.hooks) {
        if (hook.type === 'command') {
          commandHooks.push({ command: hook, permissionMode: matcher.permissionMode });
        }
      }
    }

    if (commandHooks.length === 0) return;

    log.debug(`[CommandHandler] Executing ${commandHooks.length} commands for ${event}`);

    // Build environment variables
    const env = buildEnvFromPayload(event, payload);

    // Execute commands in parallel
    await Promise.all(
      commandHooks.map(async ({ command, permissionMode }) => {
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
          } else if (!result.success) {
            log.warn(`[CommandHandler] Failed: ${command.command}`, result.stderr);
          } else {
            log.debug(`[CommandHandler] Success: ${command.command} (${durationMs}ms)`);
          }
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          log.error(`[CommandHandler] Error executing ${command.command}:`, err);
          this.options.onError?.(event, err);
        }
      })
    );
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
