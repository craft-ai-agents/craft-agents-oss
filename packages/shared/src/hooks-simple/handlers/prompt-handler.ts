/**
 * Prompt Handler
 *
 * Creates new sessions from prompt hook actions.
 * Delegates session creation to the registered callback.
 */

import { debug } from '../../utils/debug.ts';
import type { HookAction, HookEventType, BaseEventPayload, HookHandler, PromptHookAction, PromptReadyCallback } from '../types.ts';

export class PromptHandler implements HookHandler {
  readonly type = 'prompt' as const;

  private onPromptReady: PromptReadyCallback | null = null;
  private workspaceId: string;

  constructor(workspaceId: string) {
    this.workspaceId = workspaceId;
  }

  /**
   * Register the callback that creates sessions from prompt hooks.
   * This is called by SessionManager when wiring up the hook system.
   */
  setPromptReadyCallback(callback: PromptReadyCallback): void {
    this.onPromptReady = callback;
  }

  async handle(
    action: HookAction,
    event: HookEventType,
    payload: BaseEventPayload,
  ): Promise<void> {
    if (action.type !== 'prompt') return;

    const promptAction = action as PromptHookAction;

    if (!this.onPromptReady) {
      debug(`[PromptHandler] No prompt ready callback registered, skipping prompt hook`);
      return;
    }

    debug(`[PromptHandler] Creating session from prompt hook [event=${event}, prompt="${promptAction.prompt.substring(0, 80)}..."]`);

    try {
      this.onPromptReady({
        prompt: promptAction.prompt,
        workspaceId: this.workspaceId,
        permissionMode: promptAction.permissionMode,
        model: promptAction.model,
        labels: promptAction.labels,
        enabledSourceSlugs: promptAction.enabledSourceSlugs,
      });
    } catch (error) {
      debug(`[PromptHandler] Error creating session: ${error instanceof Error ? error.message : error}`);
    }
  }

  dispose(): void {
    this.onPromptReady = null;
  }
}
