/**
 * PromptHandler - Processes prompt hooks for App events
 *
 * Subscribes to App events and collects prompt hooks to be executed.
 * Prompts are queued and delivered via callback for the caller to execute.
 */

import { createLogger } from '../../utils/debug.ts';
import type { EventBus, BaseEventPayload } from '../event-bus.ts';
import type { HookHandler, PromptHandlerOptions, HooksConfigProvider } from './types.ts';
import type { HookEvent, PromptHookDefinition, PendingPrompt, AppEvent } from '../types.ts';
import { matcherMatches, buildEnvFromPayload, expandEnvVars, parsePromptReferences } from '../utils.ts';

const log = createLogger('prompt-handler');

// App events that support prompt hooks
const APP_EVENTS: AppEvent[] = [
  'LabelAdd', 'LabelRemove', 'LabelConfigChange',
  'PermissionModeChange', 'FlagChange', 'TodoStateChange',
  'SchedulerTick'
];

// ============================================================================
// PromptHandler Implementation
// ============================================================================

export class PromptHandler implements HookHandler {
  private readonly options: PromptHandlerOptions;
  private readonly configProvider: HooksConfigProvider;
  private bus: EventBus | null = null;
  private boundHandler: ((event: HookEvent, payload: BaseEventPayload) => Promise<void>) | null = null;

  constructor(options: PromptHandlerOptions, configProvider: HooksConfigProvider) {
    this.options = options;
    this.configProvider = configProvider;
  }

  /**
   * Subscribe to App events on the bus.
   */
  subscribe(bus: EventBus): void {
    this.bus = bus;
    this.boundHandler = this.handleEvent.bind(this);
    bus.onAny(this.boundHandler);
    log.debug(`[PromptHandler] Subscribed to event bus`);
  }

  /**
   * Handle an event by processing matching prompt hooks.
   */
  private async handleEvent(event: HookEvent, payload: BaseEventPayload): Promise<void> {
    // Only process App events for prompt hooks
    if (!APP_EVENTS.includes(event as AppEvent)) {
      return;
    }

    const matchers = this.configProvider.getMatchersForEvent(event);
    if (matchers.length === 0) return;

    // Find matching prompt hooks
    const promptHooks: Array<{ prompt: PromptHookDefinition; labels?: string[]; permissionMode?: 'safe' | 'ask' | 'allow-all' }> = [];

    for (const matcher of matchers) {
      if (!matcherMatches(matcher, event, payload as unknown as Record<string, unknown>)) continue;

      for (const hook of matcher.hooks) {
        if (hook.type === 'prompt') {
          promptHooks.push({ prompt: hook, labels: matcher.labels, permissionMode: matcher.permissionMode });
        }
      }
    }

    if (promptHooks.length === 0) return;

    log.debug(`[PromptHandler] Processing ${promptHooks.length} prompts for ${event}`);

    // Build environment variables
    const env = buildEnvFromPayload(event, payload);

    // Process prompts
    const pendingPrompts: PendingPrompt[] = [];

    for (const { prompt, labels, permissionMode } of promptHooks) {
      // Expand environment variables in the prompt
      const expandedPrompt = expandEnvVars(prompt.prompt, env);

      // Parse references
      const references = parsePromptReferences(expandedPrompt);

      // Expand labels
      const expandedLabels = labels?.map(label => expandEnvVars(label, env));

      pendingPrompts.push({
        sessionId: this.options.sessionId,
        prompt: expandedPrompt,
        mentions: references.mentions,
        labels: expandedLabels,
        permissionMode,
      });
    }

    // Deliver prompts via callback
    if (pendingPrompts.length > 0 && this.options.onPromptsReady) {
      log.debug(`[PromptHandler] Delivering ${pendingPrompts.length} prompts`);
      this.options.onPromptsReady(pendingPrompts);
    }
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
    log.debug(`[PromptHandler] Disposed`);
  }
}
