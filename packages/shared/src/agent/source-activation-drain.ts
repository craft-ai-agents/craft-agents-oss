/**
 * Source-activation auto-restart drain controller (#790).
 *
 * When a session-scoped tool (`mcp__session__source_test`) successfully
 * activates a new source mid-turn, the agent must end the current turn so
 * the renderer can re-send the user's message with the new tools live. The
 * naive abort-on-first-tool_result path discards sibling tool_results from
 * the same parallel-tool batch, leaving Craft's session journal with orphan
 * `tool_use` IDs that block all subsequent sends.
 *
 * This controller defers the abort. The agent yields events normally but
 * tells the controller about each yielded event. The controller decides:
 *   - whether the agent should short-circuit normal per-event handling
 *     (inactive-source detection, compaction reset, large-result intercept)
 *     for events we're only draining
 *   - whether to fire `source_activated` + `forceAbort` at a boundary
 *
 * Two policies, picked at construction:
 *
 *   - `'batch-boundary'` (Claude): the adapted-event array is the natural
 *     batch. The Claude event adapter interleaves synthetic events
 *     (`task_backgrounded`, `shell_backgrounded`, `shell_killed`) between
 *     `tool_result` events within ONE SDK user message, so we must drain
 *     the whole batch before firing. Caller drives the fire via
 *     `shouldFireAtBoundary()` at end-of-batch and end-of-stream.
 *
 *   - `'fire-on-non-tool-result'` (Pi): the adapter is 1:1 with no
 *     interleaved synthetic events, so the first non-`tool_result` event
 *     after capture marks the start of the next assistant turn and is the
 *     natural drain boundary. Caller drives the fire via
 *     `shouldFireBeforeEvent()` before yielding each event.
 */

import type { AgentEvent } from '@craft-agent/core/types';

export interface PendingActivationRestart {
  sourceSlug: string;
  userMessage: string;
}

export interface SourceActivatedEvent {
  type: 'source_activated';
  sourceSlug: string;
  originalMessage: string;
}

export type DrainPolicy = 'batch-boundary' | 'fire-on-non-tool-result';

export class SourceActivationDrainController {
  private captured: PendingActivationRestart | null = null;
  private fired: boolean = false;

  constructor(private readonly policy: DrainPolicy) {}

  /**
   * Pre-yield check used only with `'fire-on-non-tool-result'` policy.
   *
   * If we have a captured restart AND the incoming event is not a
   * `tool_result`, we've reached the end of the parallel-tool batch.
   * Returns the `source_activated` event the caller should yield BEFORE
   * yielding the boundary event (which belongs to the next assistant turn
   * we're about to cancel — letting it through would leak a fragment of the
   * cancelled response into the session journal).
   *
   * Returns null in all other cases (including any call under the
   * `'batch-boundary'` policy — Claude fires through `shouldFireAtBoundary`).
   */
  shouldFireBeforeEvent(event: AgentEvent): SourceActivatedEvent | null {
    if (this.policy !== 'fire-on-non-tool-result') return null;
    if (!this.captured || this.fired) return null;
    if (event.type === 'tool_result') return null;
    return this.takeFire();
  }

  /**
   * Update controller state for an event the caller is about to yield.
   *
   * Returns true if the caller should yield-and-continue — i.e. skip the
   * normal per-event handlers (inactive-source detection, compaction reset,
   * large-result intercept). This applies to both the initial capture
   * (the first `tool_result` whose `consumePending` returns a record) and
   * to every event yielded while in drain mode after capture.
   *
   * Returns false for events the caller should handle normally (yield +
   * downstream agent logic).
   */
  observe(
    event: AgentEvent,
    consumePending: () => PendingActivationRestart | null,
  ): boolean {
    if (this.fired) return false;
    if (this.captured) {
      if (event.type === 'tool_result') {
        // Clear racing pending-restart from a concurrent source_test that
        // landed after the first winner. We keep the first slug.
        consumePending();
      }
      return true;
    }
    if (event.type === 'tool_result') {
      const pending = consumePending();
      if (pending) {
        this.captured = pending;
        return true;
      }
    }
    return false;
  }

  /**
   * End-of-batch (Claude) and end-of-stream (both) check.
   *
   * Returns the `source_activated` event the caller should yield, or null
   * if there's nothing to fire. Idempotent after first non-null return.
   */
  shouldFireAtBoundary(): SourceActivatedEvent | null {
    if (!this.captured || this.fired) return null;
    return this.takeFire();
  }

  private takeFire(): SourceActivatedEvent {
    const captured = this.captured;
    if (!captured) {
      throw new Error('SourceActivationDrainController.takeFire() called with no captured restart');
    }
    this.fired = true;
    return {
      type: 'source_activated',
      sourceSlug: captured.sourceSlug,
      originalMessage: captured.userMessage,
    };
  }

  /** Slug currently captured, or null. For diagnostics/debug. */
  get capturedSlug(): string | null {
    return this.captured?.sourceSlug ?? null;
  }

  /** True after `source_activated` has been emitted via any fire path. */
  get hasFired(): boolean {
    return this.fired;
  }
}
