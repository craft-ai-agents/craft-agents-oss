/**
 * PromptHandler - Processes prompt actions for App events
 *
 * Subscribes to App events and collects prompt actions to be executed.
 * Prompts are queued and delivered via callback for the caller to execute.
 */

import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '../../utils/debug.ts';
import { AUTOMATIONS_HISTORY_FILE } from '../constants.ts';
import type { EventBus, BaseEventPayload } from '../event-bus.ts';
import type { AutomationHandler, PromptHandlerOptions, AutomationsConfigProvider } from './types.ts';
import type { AutomationEvent, PromptAction, PendingPrompt, AppEvent } from '../types.ts';
import { matcherMatches, buildEnvFromPayload, expandEnvVars, parsePromptReferences } from '../utils.ts';

const log = createLogger('prompt-handler');

// App events that support prompt actions
const APP_EVENTS: AppEvent[] = [
  'LabelAdd', 'LabelRemove', 'LabelConfigChange',
  'PermissionModeChange', 'FlagChange', 'SessionStatusChange',
  'SchedulerTick'
];

// ============================================================================
// PromptHandler Implementation
// ============================================================================

export class PromptHandler implements AutomationHandler {
  private readonly options: PromptHandlerOptions;
  private readonly configProvider: AutomationsConfigProvider;
  private bus: EventBus | null = null;
  private boundHandler: ((event: AutomationEvent, payload: BaseEventPayload) => Promise<void>) | null = null;

  constructor(options: PromptHandlerOptions, configProvider: AutomationsConfigProvider) {
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
   * Handle an event by processing matching prompt actions.
   */
  private async handleEvent(event: AutomationEvent, payload: BaseEventPayload): Promise<void> {
    // Only process App events for prompt actions
    if (!APP_EVENTS.includes(event as AppEvent)) {
      return;
    }

    const matchers = this.configProvider.getMatchersForEvent(event);
    if (matchers.length === 0) return;

    // Group prompt actions by matcher for per-matcher history
    const matcherPrompts: Array<{
      matcherId: string | undefined;
      prompts: Array<{ prompt: PromptAction; labels?: string[]; permissionMode?: 'safe' | 'ask' | 'allow-all' }>;
    }> = [];

    for (const matcher of matchers) {
      if (!matcherMatches(matcher, event, payload as unknown as Record<string, unknown>)) continue;

      const prompts: Array<{ prompt: PromptAction; labels?: string[]; permissionMode?: 'safe' | 'ask' | 'allow-all' }> = [];
      for (const action of matcher.actions) {
        if (action.type === 'prompt') {
          prompts.push({ prompt: action, labels: matcher.labels, permissionMode: matcher.permissionMode });
        }
      }
      if (prompts.length > 0) {
        matcherPrompts.push({ matcherId: matcher.id, prompts });
      }
    }

    if (matcherPrompts.length === 0) return;

    const totalPrompts = matcherPrompts.reduce((s, m) => s + m.prompts.length, 0);
    log.debug(`[PromptHandler] Processing ${totalPrompts} prompts for ${event}`);

    // Build environment variables
    const env = buildEnvFromPayload(event, payload);

    // Process prompts per matcher
    const pendingPrompts: PendingPrompt[] = [];

    for (const { matcherId, prompts } of matcherPrompts) {
      for (const { prompt, labels, permissionMode } of prompts) {
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

      // Record prompt queuing as successful execution
      this.appendHistory(matcherId, true);
    }

    // Deliver prompts via callback
    if (pendingPrompts.length > 0 && this.options.onPromptsReady) {
      log.debug(`[PromptHandler] Delivering ${pendingPrompts.length} prompts`);
      this.options.onPromptsReady(pendingPrompts);
    }
  }

  /**
   * Append a single execution record to automations-history.jsonl.
   * Fire-and-forget — failures are silently ignored.
   */
  private appendHistory(matcherId: string | undefined, ok: boolean): void {
    if (!matcherId) return;
    const line = JSON.stringify({ id: matcherId, ts: Date.now(), ok }) + '\n';
    appendFile(join(this.options.workspaceRootPath, AUTOMATIONS_HISTORY_FILE), line, 'utf-8')
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
    log.debug(`[PromptHandler] Disposed`);
  }
}
