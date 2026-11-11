/**
 * Pi SDK Event Adapter
 *
 * Maps Pi Agent Core events (AgentEvent / AgentSessionEvent) to
 * Craft Agent's AgentEvent format for UI compatibility.
 *
 * Pi emits fine-grained lifecycle events. We translate them into
 * the same event vocabulary the renderer already understands from
 * Claude / Codex / Copilot backends.
 */

import type { AgentEvent as CraftAgentEvent, ContextUsageSnapshot } from '@craft-agent/core/types';
import { contextAfterCompaction, contextFromPi } from '../../context-usage.ts';
import type { PiContextUsagePayload } from './protocol.ts';
import type {
  AgentEvent as PiAgentEvent,
} from '@earendil-works/pi-agent-core';
import type {
  AgentSessionEvent,
  JsonAgentSessionEvent,
} from '@earendil-works/pi-coding-agent';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { isContextOverflow, isRetryableAssistantError } from '@earendil-works/pi-ai';
import { BaseEventAdapter } from '../base-event-adapter.ts';
import { PI_TOOL_NAME_MAP } from './constants.ts';
import { toolMetadataStore } from '../../../interceptor-common.ts';
import { createAgentError, parseError } from '../../errors.ts';

/**
 * Pi SDK auto-compaction race signature — the AbortController crash described
 * in `_runAutoCompaction` (`@earendil-works/pi-coding-agent` agent-session.ts).
 * When two `_runAutoCompaction` calls overlap, one's `finally` clears the
 * shared `_autoCompactionAbortController` field while the other is still
 * suspended on an await; the next `.signal` read crashes. Matched against
 * `compaction_end.errorMessage` to surface a friendly message instead of the
 * raw stack until the upstream fix lands. See plans/fix-pi-gpt-compaction.md.
 */
const SDK_AUTOCOMPACT_RACE_SIGNATURE = /_autoCompactionAbortController\.signal/;

/** How long to wait after a held overflow `agent_end` for a `compaction_start`
 *  before giving up and surfacing the original error. The SDK fires
 *  `_checkCompaction` on the same event-queue tick, so the only delay is event
 *  serialization — 5 s is well above any plausible jitter. */
const OVERFLOW_FALLBACK_TIMEOUT_MS = 5_000;

/** How long to wait after an `agent_end { willRetry: true }` for the SDK's
 *  `auto_retry_start`. `_prepareRetry` emits it synchronously right after the
 *  agent loop returns, so — as with overflow — only event serialization can
 *  delay it. */
const RETRY_START_FALLBACK_TIMEOUT_MS = 5_000;

/** Grace added on top of the backoff the SDK announced in
 *  `auto_retry_start.delayMs` before we stop waiting for the retried run's
 *  `agent_start` and surface the parked error instead. */
const RETRY_RUN_GRACE_MS = 15_000;

/** Retryable provider errors that the shared `parseError` cannot classify are
 *  split into provider-side incidents (surfaced as `service_error`) and
 *  transport failures (surfaced as `network_error`). Patterns mirror the
 *  provider-side group of pi-ai's `RETRYABLE_PROVIDER_ERROR_PATTERN`. */
const RETRYABLE_PROVIDER_SIDE_PATTERN =
  /overloaded|provider.?returned.?error|retry your request|request again|resource.?exhausted|retry delay|server.?error|internal.?error|service.?unavailable|exceeded request buffer limit/i;

/**
 * Combined event type the adapter can handle.
 * AgentSessionEvent is a superset of PiAgentEvent (adds compaction_*, auto_retry_*, queue_update).
 */
type PiEvent = (PiAgentEvent | AgentSessionEvent | JsonAgentSessionEvent | { type: 'context_usage' }) & PiContextUsagePayload;

/**
 * Maps Pi SDK events to Craft AgentEvents for UI compatibility.
 *
 * Event mapping:
 * - message_update (text_delta in assistantMessageEvent) → text_delta
 * - message_end → text_complete
 * - tool_execution_start → tool_start
 * - tool_execution_end → tool_result
 * - agent_end → complete (deferred while overflow recovery or an auto-retry is in flight)
 * - compaction_start → status (with "Compacting" keyword)
 * - compaction_end → info/error
 * - failed message_end → text_discard (only its unfinished text)
 * - auto_retry_start / retried agent_start → retry (backoff / active)
 * - auto_retry_end → retry (end) + info on success; releases errors on cancellation
 * - queue_update / agent_settled / entry_appended / summarization_retry_* → ignored
 */
export class PiEventAdapter extends BaseEventAdapter {
  // Track tool names from execution_start for proper tool_result correlation
  private toolNames: Map<string, string> = new Map();

  // Track whether streaming deltas have been received for the current message
  private hasStreamedDeltas: boolean = false;

  // Track whether a final (non-intermediate) text_complete has been emitted this turn
  private hasEmittedFinalText: boolean = false;

  // Sub-turnId isolation for tool calls within a single Pi turn
  private subTurnCounter: number = 0;
  private messageSubTurnId: string | null = null;

  // Model context window for usage_update events
  private contextWindow: number | undefined;

  // Mini model ID for call_llm display default (#596).
  // Used when the caller didn't specify an explicit model — we fill args.model
  // on the tool_start event so the UI shows the effective default instead of
  // leaving the badge blank.
  private miniModel: string | undefined;

  // Occupancy is independent of API billing; never fall back to lastUsage.
  private contextUsage: ContextUsageSnapshot | undefined;

  /** Normalize raw subprocess metadata at the host boundary (also used by manual RPC). */
  *adaptContextUsage(payload: PiContextUsagePayload, afterCompaction = false, estimatedTokensAfter?: number): Generator<CraftAgentEvent> {
    const snapshot = contextFromPi(payload.contextUsage, payload.compactionSettings, estimatedTokensAfter)
      ?? (afterCompaction ? contextAfterCompaction(estimatedTokensAfter, this.contextUsage) : undefined);
    if (snapshot) {
      this.contextUsage = snapshot;
      yield { type: 'context_usage', contextUsage: snapshot };
    }
  }

  // Track last usage for emitting with complete event
  private lastUsage: { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number; cost: { total: number } } | undefined;
  // Output and cost of every assistant message in the turn (lastUsage holds only the final call)
  private turnOutputTokens = 0;
  private turnCostUsd = 0;

  // ============================================================
  // Overflow-recovery state machine
  // ============================================================
  //
  // When a Pi-routed assistant message returns a context_length_exceeded
  // error, the Pi SDK's `_checkCompaction` fires `_runAutoCompaction("overflow",
  // true)` and, on success, calls `agent.continue()` to retry. That recovered
  // turn arrives AFTER the original `agent_end`. If we yield `complete` and
  // call `eventQueue.complete()` on the original `agent_end` (the historic
  // behavior), the recovered turn lands in a closed iterator. The state
  // machine below holds the queue open across the SDK's recovery flow so the
  // recovered response reaches the UI.
  private overflowState: 'none' | 'held' | 'awaiting' | 'compacting' | 'recovering' = 'none';
  private heldOverflowError: string | null = null;
  private fallbackTimerId: ReturnType<typeof setTimeout> | null = null;

  // ============================================================
  // Auto-retry state machine
  // ============================================================
  //
  // The Pi SDK retries transient provider/transport errors on its own
  // (`isRetryableAssistantError`: 429/5xx/overloaded, "fetch failed",
  // "terminated", "socket hang up", …) with exponential backoff. The event
  // sequence is: message_end(error) → agent_end { willRetry: true } →
  // auto_retry_start → [backoff] → agent_start … agent_end. Exactly like
  // overflow recovery, the retried run arrives AFTER an agent_end, so the
  // adapter must not complete the queue on that agent_end. It also parks the
  // classified error instead of surfacing it: the user sees a "retrying"
  // status and either the recovered answer or, if every attempt fails, one
  // error at the end.
  //
  //   none ──message_end(retryable)──► held
  //   held ──agent_end{willRetry:false}──► none        (release error, complete)
  //   held ──agent_end{willRetry:true}───► awaitingRetry (5 s fallback)
  //   awaitingRetry ──auto_retry_start──► backoff      (delayMs + grace fallback)
  //   backoff ──agent_start────────────► recovering
  //   recovering ──agent_end───────────► none          (normal complete)
  //   awaitingRetry|backoff ──auto_retry_end{success:false}──► none (release, complete)
  private retryState: 'none' | 'held' | 'awaitingRetry' | 'backoff' | 'recovering' = 'none';
  private heldRetryError: CraftAgentEvent | null = null;
  private retryFallbackTimerId: ReturnType<typeof setTimeout> | null = null;

  /** Set when the adapter wants the caller to call `eventQueue.complete()`
   *  on a non-`agent_end` event (e.g. `compaction_end` failure, cancelled
   *  auto-retry). Consumed by `shouldCompleteQueue()`. */
  private pendingQueueComplete: boolean = false;
  /** Caller-supplied callbacks for the asynchronous fallback timer paths —
   *  the timers fire outside `adaptEvent()` so we can't yield through the
   *  generator. */
  private onFallbackEvent: ((event: CraftAgentEvent) => void) | null = null;
  private onFallbackComplete: (() => void) | null = null;

  constructor() {
    super('pi-event');
  }

  /**
   * Set the model's context window size for usage reporting.
   */
  setContextWindow(cw: number): void {
    this.contextWindow = cw;
  }

  /**
   * Register handlers invoked when a recovery fallback timer fires — the SDK
   * didn't emit a `compaction_start` after a held overflow `agent_end`, or no
   * `auto_retry_start` / retried `agent_start` followed an
   * `agent_end { willRetry: true }`. The adapter calls `onEvent` to enqueue the
   * parked error, then `onComplete` to terminate the iterator.
   */
  setRecoveryFallbackHandlers(
    onEvent: (event: CraftAgentEvent) => void,
    onComplete: () => void,
  ): void {
    this.onFallbackEvent = onEvent;
    this.onFallbackComplete = onComplete;
  }

  /**
   * Decide whether the caller should call `eventQueue.complete()` after
   * processing this SDK event. The historical rule was "always on
   * `agent_end`"; with overflow recovery and auto-retry we defer completion
   * until the recovered turn finishes (or recovery fails / times out).
   */
  shouldCompleteQueue(isAgentEnd: boolean): boolean {
    if (this.pendingQueueComplete) {
      this.pendingQueueComplete = false;
      return true;
    }
    return isAgentEnd && this.overflowState === 'none' && this.retryState === 'none';
  }

  /**
   * Reset overflow-recovery and auto-retry state. Call from session disposal
   * and hard aborts so a stale fallback timer doesn't fire on a torn-down
   * adapter and a held turn can't leak into the next one.
   */
  resetRecoveryState(): void {
    this.cancelOverflowFallbackTimer();
    this.overflowState = 'none';
    this.heldOverflowError = null;
    this.cancelRetryFallbackTimer();
    this.retryState = 'none';
    this.heldRetryError = null;
    this.pendingQueueComplete = false;
  }

  /** Whether an overflow recovery or auto-retry currently holds the turn open. */
  get isHoldingTurn(): boolean {
    return this.overflowState !== 'none' || this.retryState !== 'none';
  }

  /**
   * Yield the parked retryable error (if any) and leave the retry state
   * machine. Used when the SDK will not retry (disabled/exhausted) or when a
   * retry was cancelled.
   */
  private *releaseHeldRetryError(): Generator<CraftAgentEvent> {
    const held = this.heldRetryError;
    this.heldRetryError = null;
    this.retryState = 'none';
    this.cancelRetryFallbackTimer();
    yield { type: 'retry', phase: 'end' };
    if (held) yield held;
  }

  /**
   * Arm the auto-retry fallback timer. Fires only if the state is unchanged
   * when the timeout elapses (a late event may already have moved us on).
   */
  private armRetryFallbackTimer(timeoutMs: number, reason: string): void {
    this.cancelRetryFallbackTimer();
    const armedState = this.retryState;
    this.retryFallbackTimerId = setTimeout(() => {
      this.retryFallbackTimerId = null;
      if (this.retryState !== armedState) return;
      this.log.warn(`Auto-retry fallback fired — ${reason}`, { timeoutMs, state: armedState });
      const held: CraftAgentEvent = this.heldRetryError ?? {
        type: 'error',
        message: 'The model request failed and the automatic retry did not start. Please try again.',
      };
      this.heldRetryError = null;
      this.retryState = 'none';
      this.onFallbackEvent?.({ type: 'retry', phase: 'end' });
      this.onFallbackEvent?.(held);
      this.onFallbackComplete?.();
    }, timeoutMs);
  }

  private cancelRetryFallbackTimer(): void {
    if (this.retryFallbackTimerId !== null) {
      clearTimeout(this.retryFallbackTimerId);
      this.retryFallbackTimerId = null;
    }
  }

  /**
   * Classify a failed assistant message for the UI.
   *
   * Auth/billing/rate-limit/5xx errors go through the shared `parseError` so
   * SessionManager can run its auth-retry pipeline (refresh token + resend).
   * Transient errors that parser doesn't know but the SDK retries ("terminated",
   * "socket hang up", "stream ended before message_stop", …) become typed
   * connection/service errors so the UI offers Retry instead of a raw string.
   */
  private classifyAssistantError(message: AssistantMessage, errorMessage: string): CraftAgentEvent {
    const parsed = parseError(new Error(errorMessage));
    if (parsed.code !== 'unknown_error') {
      return { type: 'typed_error', error: parsed };
    }
    if (isRetryableAssistantError(message)) {
      const code = RETRYABLE_PROVIDER_SIDE_PATTERN.test(errorMessage) ? 'service_error' : 'network_error';
      return { type: 'typed_error', error: createAgentError(code, errorMessage) };
    }
    return { type: 'error', message: errorMessage };
  }

  /** Short human-readable label for the retry status line. */
  private retryReasonLabel(sdkErrorMessage: string | undefined): string {
    const held = this.heldRetryError;
    if (held?.type === 'typed_error') return held.error.title;
    const raw = (held?.type === 'error' ? held.message : sdkErrorMessage) ?? '';
    const oneLine = raw.replace(/\s+/g, ' ').trim();
    if (!oneLine) return 'Temporary model error';
    return oneLine.length > 80 ? `${oneLine.slice(0, 77)}...` : oneLine;
  }

  private armOverflowFallbackTimer(): void {
    this.cancelOverflowFallbackTimer();
    this.fallbackTimerId = setTimeout(() => {
      this.fallbackTimerId = null;
      // Re-check state at fire time — a late `compaction_start` may have
      // already transitioned us to `compacting`.
      if (this.overflowState !== 'awaiting') return;
      const errorMessage = this.heldOverflowError ?? 'Context overflow';
      this.heldOverflowError = null;
      this.overflowState = 'none';
      this.log.warn('Overflow recovery fallback fired — SDK emitted no compaction events', {
        timeoutMs: OVERFLOW_FALLBACK_TIMEOUT_MS,
      });
      this.onFallbackEvent?.({ type: 'error', message: errorMessage });
      this.onFallbackComplete?.();
    }, OVERFLOW_FALLBACK_TIMEOUT_MS);
  }

  private cancelOverflowFallbackTimer(): void {
    if (this.fallbackTimerId !== null) {
      clearTimeout(this.fallbackTimerId);
      this.fallbackTimerId = null;
    }
  }

  /**
   * Set the mini model ID for call_llm badge default.
   * When the agent's call_llm invocation omits `args.model`, we fill it with
   * this so the UI badge shows the effective default instead of nothing.
   * Explicit `args.model` values from the agent are always preserved.
   */
  setMiniModel(model: string | undefined): void {
    this.miniModel = model;
  }

  /**
   * Generate a unique sub-turnId for a text block within the current turn.
   */
  private nextSubTurnId(prefix: string): string {
    const base = this.currentTurnId || 'unknown';
    return `${base}__${prefix}${this.subTurnCounter++}`;
  }

  protected onTurnStart(): void {
    this.toolNames.clear();
    this.hasStreamedDeltas = false;
    this.hasEmittedFinalText = false;
    this.subTurnCounter = 0;
    this.messageSubTurnId = null;
    this.turnOutputTokens = 0;
    this.turnCostUsd = 0;
    // A new Craft turn can only start once the previous queue completed (or
    // was force-aborted), so any recovery state left here is stale.
    this.resetRecoveryState();
    this.log.debug('Turn started', { turnIndex: this.turnIndex });
  }

  /**
   * Adapt a Pi SDK event to zero or more Craft AgentEvents.
   */
  *adaptEvent(event: PiEvent): Generator<CraftAgentEvent> {
    // Occupancy metadata must arrive before completion can close the queue. A
    // compaction success uses its fresh result estimate below, not old API usage.
    if (event.type !== 'compaction_end') {
      yield* this.adaptContextUsage(event);
    }
    if (event.type === 'context_usage') return;

    // Craft-injected event from pi-agent-server (not part of the Pi SDK).
    // The subprocess emits this immediately after each `message_end` to deliver
    // the correct `sdkTurnAnchor` (the leaf id AFTER the SDK has appended the
    // assistant entry). We forward it through as-is — SessionManager correlates
    // it to a Craft assistant message via `sdkMessageId`. See craft-agents-oss#782.
    if ((event as { type?: string }).type === 'pi_turn_anchor') {
      const e = event as unknown as { sdkMessageId?: string; sdkTurnAnchor?: string };
      if (e.sdkMessageId && e.sdkTurnAnchor) {
        yield {
          type: 'pi_turn_anchor',
          sdkMessageId: e.sdkMessageId,
          sdkTurnAnchor: e.sdkTurnAnchor,
        };
      }
      return;
    }

    switch (event.type) {
      // ============================================================
      // Agent lifecycle events
      // ============================================================

      case 'agent_start':
        // After an auto-retry backoff the SDK re-runs the turn via
        // agent.continue(); this agent_start is the retried run. Stop waiting
        // for it and let the run flow through normally.
        if (this.retryState === 'backoff') {
          this.cancelRetryFallbackTimer();
          this.retryState = 'recovering';
          this.heldRetryError = null;
          yield { type: 'retry', phase: 'active' };
        }
        break;

      case 'agent_end': {
        // Overflow recovery: hold the queue open while the SDK runs
        // _runAutoCompaction("overflow") + agent.continue(). The recovered
        // turn will arrive as a fresh agent_start … agent_end pair.
        if (this.overflowState === 'held') {
          this.overflowState = 'awaiting';
          this.armOverflowFallbackTimer();
          break;
        }
        if (this.overflowState === 'awaiting' || this.overflowState === 'compacting') {
          // Defensive: an agent_end while still mid-recovery shouldn't happen
          // in the SDK's normal flow. Keep the queue open and wait for
          // compaction_end (success → recovering, error → drain).
          break;
        }
        if (this.overflowState === 'recovering') {
          // Recovered turn just finished — fall through to normal completion.
          this.overflowState = 'none';
        }

        // Auto-retry: AgentSession stamps `willRetry` on agent_end
        // (`_willRetryAfterAgentEnd`). When true, `_prepareRetry` follows with
        // auto_retry_start, sleeps the backoff and re-runs the turn, so this
        // agent_end is NOT the end of the Craft turn.
        const willRetry = (event as { willRetry?: boolean }).willRetry === true;
        if (willRetry && this.retryState !== 'awaitingRetry' && this.retryState !== 'backoff') {
          this.retryState = 'awaitingRetry';
          this.armRetryFallbackTimer(
            RETRY_START_FALLBACK_TIMEOUT_MS,
            'no auto_retry_start followed agent_end { willRetry: true }',
          );
          break;
        }
        if (this.retryState === 'awaitingRetry' || this.retryState === 'backoff') {
          // Defensive: no agent run is active in these states, so an agent_end
          // is unexpected. Keep the queue open; the fallback timer drains it.
          break;
        }
        if (this.retryState === 'held') {
          // Retries disabled or exhausted: surface the parked error, then
          // complete the turn normally below.
          yield* this.releaseHeldRetryError();
        } else if (this.retryState === 'recovering') {
          // The retried run finished cleanly.
          this.retryState = 'none';
        }
        if (this.lastUsage) {
          const inputTokens = this.lastUsage.input + (this.lastUsage.cacheRead || 0);
          yield {
            type: 'complete',
            usage: {
              inputTokens,
              outputTokens: this.turnOutputTokens,
              cacheReadTokens: this.lastUsage.cacheRead,
              cacheCreationTokens: this.lastUsage.cacheWrite,
              costUsd: this.turnCostUsd,
              contextWindow: this.contextWindow,
            },
          };
        } else {
          yield { type: 'complete' };
        }
        break;
      }

      // ============================================================
      // Turn events
      // ============================================================

      case 'turn_start':
        // Pi SDK turn_start has no ID, so generate one for event correlation
        this.currentTurnId = `pi-turn-${this.turnIndex}`;
        break;

      case 'turn_end':
        // Don't emit 'complete' here — agent_end handles it.
        // Emitting from both causes duplicate messages in session persistence.
        this.currentTurnId = null;
        this.hasStreamedDeltas = false;
        this.hasEmittedFinalText = false;
        // Keep sub-turn IDs unique across SDK turns/retries within this Craft
        // turn. startTurn() is the only place the counter resets.
        this.messageSubTurnId = null;
        break;

      // ============================================================
      // Message events (text streaming)
      // ============================================================

      case 'message_start':
        // Pi SDK emits message_start for user messages too — skip non-assistant
        break;

      case 'message_update': {
        // Pi SDK emits message_update only for assistant messages (streaming deltas)
        const amEvent = event.assistantMessageEvent;
        if (amEvent.type === 'text_delta' && amEvent.delta) {
          this.hasStreamedDeltas = true;
          if (!this.messageSubTurnId) {
            this.messageSubTurnId = this.nextSubTurnId('m');
          }
          yield {
            type: 'text_delta',
            text: amEvent.delta,
            turnId: this.messageSubTurnId,
          };
        }
        break;
      }

      case 'message_end': {
        // Pi SDK emits message_end for ALL messages (user, assistant, toolResult).
        // Only process assistant messages — skip user prompts and tool results.
        const msg = event.message as { role?: string; stopReason?: string; errorMessage?: string; usage?: { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number; cost: { total: number } }; id?: string } | undefined;
        // SDK message id, set by pi-agent-server when forwarding the event.
        // SessionManager uses this to correlate the follow-up `pi_turn_anchor`
        // event to the Craft assistant message created here (#782).
        const sdkMessageId = (event as { sdkMessageId?: string }).sdkMessageId ?? msg?.id;
        if (msg?.role !== 'assistant') break;

        // Surface API errors — Pi SDK sets stopReason: 'error' and errorMessage on failures
        if (msg.stopReason === 'error' && msg.errorMessage) {
          // Failed streams never become text_complete. Explicitly discard the
          // partial before the SDK can retry (or terminate), including any
          // pending server-side delta batch. Completed messages are untouched.
          if (this.messageSubTurnId) {
            yield { type: 'text_discard', turnId: this.messageSubTurnId };
            this.messageSubTurnId = null;
            this.hasStreamedDeltas = false;
          }
          // Context overflow: hand recovery to the SDK's _runAutoCompaction
          // and keep the UI quiet until we know the outcome (recovered turn
          // arrives, or compaction fails). Suppress the raw provider error.
          if (
            this.overflowState === 'none' &&
            isContextOverflow(event.message as AssistantMessage, this.contextWindow)
          ) {
            this.overflowState = 'held';
            this.heldOverflowError = msg.errorMessage;
            break;
          }

          const errorEvent = this.classifyAssistantError(event.message as AssistantMessage, msg.errorMessage);

          // Transient provider/transport errors: the SDK's retry loop uses the
          // same `isRetryableAssistantError` classifier, so it will retry
          // unless retries are disabled or exhausted — and the following
          // agent_end { willRetry } tells us which. Park the error instead of
          // showing it now; agent_end either releases it or holds the queue
          // open for the retried run.
          if (
            (this.retryState === 'none' || this.retryState === 'recovering') &&
            isRetryableAssistantError(event.message as AssistantMessage)
          ) {
            this.retryState = 'held';
            this.heldRetryError = errorEvent;
            break;
          }

          yield errorEvent;
          break;
        }

        // Extract text content from the final assistant message
        const textContent = this.extractTextFromMessage(event.message);
        // Pi SDK stopReason: 'toolUse' means the model will call tools next (intermediate commentary),
        // 'stop'/'end_turn' means final response. Same logic as Claude's stop_reason === 'tool_use'.
        const isIntermediate = msg.stopReason === 'toolUse';
        if (textContent && (isIntermediate || !this.hasEmittedFinalText)) {
          if (!isIntermediate) this.hasEmittedFinalText = true;

          const mTurnId = this.messageSubTurnId || this.nextSubTurnId('m');
          this.messageSubTurnId = null;

          yield {
            type: 'text_complete',
            text: textContent,
            isIntermediate,
            turnId: mTurnId,
            sdkMessageId,
          };
          this.hasStreamedDeltas = false;
        } else if (!textContent && !isIntermediate && !this.hasEmittedFinalText && msg.usage && (msg.usage as { output?: number }).output) {
          // The model used output tokens but produced no text. This typically means
          // reasoning consumed the entire output budget (observed with DeepSeek models
          // when context is large and no budget_tokens cap is set). Without this warning
          // the turn silently completes and the user sees no reply with no error.
          console.warn(
            `[PiEventAdapter] Turn produced ${(msg.usage as { output?: number }).output} output token(s) but zero text. ` +
            `Reasoning likely consumed the full output budget (seen with DeepSeek + thinkingLevel≥medium at large contexts). ` +
            `Lower the thinking level or start a fresh session to recover.`
          );
        }

        // Emit usage_update if the assistant message includes token usage
        if (msg.usage && typeof msg.usage.input === 'number') {
          this.lastUsage = msg.usage;
          this.turnOutputTokens += msg.usage.output || 0;
          this.turnCostUsd += msg.usage.cost?.total || 0;
          const inputTokens = msg.usage.input + (msg.usage.cacheRead || 0);
          yield {
            type: 'usage_update',
            usage: {
              inputTokens,
              contextWindow: this.contextWindow,
            },
          };
        }
        break;
      }

      // ============================================================
      // Tool events
      // ============================================================

      case 'tool_execution_start': {
        const toolCallId = event.toolCallId;
        const toolName = this.resolveToolName(event.toolName);
        this.toolNames.set(toolCallId, toolName);

        // Normalize Pi field names to Claude Code format for UI compatibility
        // (diff stats, diff overlay, document routing all expect Claude Code format)
        const args = this.normalizeToolInput(toolName, (event.args ?? {}) as Record<string, unknown>);

        // For call_llm, fill in the default display model when the caller didn't
        // specify one — Pi's call_llm defaults to miniModel. We only fill the gap;
        // we never overwrite an explicit agent-provided model (that was the #596 bug).
        if (toolName.includes('call_llm') && this.miniModel && !args.model) {
          args.model = this.miniModel;
        }

        // Canonical metadata from subprocess event payload (interceptor/bridge-authoritative path).
        const eventMeta = this.extractToolMetadataFromEvent(event);

        // Backward-compatibility fallback: shared store (legacy side-channel),
        // with id canonicalization fallback for mixed call-id formats.
        const { meta: storedMeta, keyTried } = this.resolveStoredMetadata(toolCallId);

        // Last-resort fallback: args metadata if present.
        const argsIntent = typeof args._intent === 'string' ? args._intent : undefined;
        const argsDisplayName = typeof args._displayName === 'string' ? args._displayName : undefined;

        const intent = eventMeta?.intent
          || storedMeta?.intent
          || argsIntent
          || (typeof args.description === 'string' ? args.description : undefined);

        const displayName = eventMeta?.displayName
          || storedMeta?.displayName
          || argsDisplayName
          || this.getToolDisplayName(toolName);

        const metadataSource = eventMeta
          ? 'event'
          : storedMeta
            ? `store(${keyTried})`
            : (argsIntent || argsDisplayName)
              ? 'args'
              : (typeof args.description === 'string')
                ? 'description'
                : 'fallback';

        this.log.debug('Tool metadata resolution', {
          toolName,
          toolCallId,
          metadataSource,
          hasIntent: !!intent,
          hasDisplayName: !!displayName,
        });

        // Classify bash commands that are actually file reads
        if (toolName === 'Bash' && typeof args.command === 'string') {
          const readInfo = this.classifyReadCommand(toolCallId, args.command);
          if (readInfo) {
            yield this.createReadToolStart(
              toolCallId,
              readInfo,
              intent,
              'Read File',
            );
            break;
          }
        }

        yield this.createToolStart(
          toolCallId,
          toolName,
          args,
          intent,
          displayName,
        );
        break;
      }

      case 'tool_execution_update': {
        // Accumulate partial output for streaming tool results
        const partialResult = event.partialResult;
        if (partialResult && typeof partialResult === 'object') {
          const content = (partialResult as { content?: Array<{ type: string; text?: string }> }).content;
          if (Array.isArray(content)) {
            for (const part of content) {
              if (part.type === 'text' && part.text) {
                this.accumulateOutput(event.toolCallId, part.text);
              }
            }
          }
        }
        break;
      }

      case 'tool_execution_end': {
        const toolCallId = event.toolCallId;
        const resolvedToolName = this.toolNames.get(toolCallId) || 'tool';
        this.toolNames.delete(toolCallId);

        // Check for block reason
        const blockReason = this.consumeBlockReason(toolCallId, resolvedToolName);

        // Use accumulated output from partial results if available
        const accumulatedOutput = this.consumeOutput(toolCallId);

        const isError = event.isError;
        let result: string;

        if (accumulatedOutput) {
          result = accumulatedOutput;
        } else if (blockReason) {
          result = blockReason;
        } else {
          result = this.extractToolResult(event.result, isError);
        }

        // After tool completion, the assistant may generate new text
        this.hasEmittedFinalText = false;
        this.messageSubTurnId = null;

        // Check if this was classified as a file read
        const readInfo = this.consumeReadCommand(toolCallId);
        if (readInfo) {
          yield this.createToolResult(toolCallId, 'Read', result, isError);
          break;
        }

        yield this.createToolResult(toolCallId, resolvedToolName, result, isError);
        break;
      }

      // ============================================================
      // Session-level events (AgentSessionEvent extensions)
      // ============================================================

      case 'compaction_start':
        // Cancel the overflow fallback timer — the SDK is now actively
        // recovering, so we no longer need the "no compaction event arrived"
        // safety net. State transitions: held|awaiting → compacting.
        if (this.overflowState === 'held' || this.overflowState === 'awaiting') {
          this.cancelOverflowFallbackTimer();
          this.overflowState = 'compacting';
        }
        // Use "Compacting" keyword so session handler detects statusType: 'compacting'
        yield { type: 'status', message: 'Compacting context...' };
        break;

      case 'compaction_end': {
        const compactionEvent = event as Extract<AgentSessionEvent, { type: 'compaction_end' }>;
        if (compactionEvent.result && !compactionEvent.aborted) {
          // Success: stay open and wait for the recovered agent_end. State
          // transitions: compacting → recovering. Threshold-only compactions
          // (state was 'none') just emit the info and continue normally.
          if (this.overflowState === 'compacting') {
            this.overflowState = 'recovering';
            this.heldOverflowError = null;
          }
          yield* this.adaptContextUsage(event, true, compactionEvent.result.estimatedTokensAfter);
          // Explicit trigger keeps automatic compaction from accepting a pending plan.
          yield {
            type: 'info', message: 'Compacted context to fit within limits',
            compactionTrigger: compactionEvent.reason === 'manual' ? 'manual' : 'auto',
          };
        } else {
          yield { type: 'compaction_failed' };
          // Defensive handler for the Pi SDK auto-compaction race (cause A
          // in plans/fix-pi-gpt-compaction.md). The raw stack
          // `undefined is not an object (evaluating 'this._autoCompactionAbortController.signal')`
          // is unhelpful to the user; convert it to a friendly retry hint and
          // log for diagnostics. Remove once the upstream fix ships.
          if (compactionEvent.errorMessage && SDK_AUTOCOMPACT_RACE_SIGNATURE.test(compactionEvent.errorMessage)) {
            this.log.warn('Pi SDK auto-compaction race; recommend manual /compact', {
              errorMessage: compactionEvent.errorMessage,
            });
            yield {
              type: 'error',
              message: 'Auto-compaction hit a transient error. Try /compact manually.',
            };
          } else if (compactionEvent.errorMessage) {
            yield {
              type: 'error',
              message: `Context compaction failed: ${compactionEvent.errorMessage}`,
            };
          }
          // If we were holding the queue open for overflow recovery, finalize
          // the turn now — no recovered agent_end will arrive on the failure
          // path. pendingQueueComplete signals the caller to terminate the
          // iterator since this is a non-agent_end event.
          if (
            this.overflowState === 'compacting' ||
            this.overflowState === 'awaiting' ||
            this.overflowState === 'held'
          ) {
            yield { type: 'complete' };
            this.pendingQueueComplete = true;
            this.overflowState = 'none';
            this.heldOverflowError = null;
            this.cancelOverflowFallbackTimer();
          }
        }
        break;
      }

      case 'auto_retry_start': {
        const retryEvent = event as Extract<AgentSessionEvent, { type: 'auto_retry_start' }>;
        // The SDK is about to sleep `delayMs` and re-run the turn. Keep the
        // queue open until the retried run's agent_start arrives (plus grace).
        const delayMs = typeof retryEvent.delayMs === 'number' ? retryEvent.delayMs : 0;
        this.cancelRetryFallbackTimer();
        this.retryState = 'backoff';
        this.armRetryFallbackTimer(delayMs + RETRY_RUN_GRACE_MS, 'retried run did not start after the announced backoff');
        const attempt = `attempt ${retryEvent.attempt}/${retryEvent.maxAttempts}`;
        const wait = delayMs > 0 ? ` in ${Math.max(1, Math.round(delayMs / 1000))}s` : '';
        yield {
          type: 'retry',
          phase: 'backoff',
          message: `${this.retryReasonLabel(retryEvent.errorMessage)}. Retrying${wait} (${attempt})...`,
        };
        break;
      }

      case 'auto_retry_end': {
        const retryEndEvent = event as Extract<AgentSessionEvent, { type: 'auto_retry_end' }>;
        if (retryEndEvent.success) {
          // Emitted on the first successful assistant message after one or
          // more retries, before that run's agent_end. Nothing is held here.
          yield { type: 'retry', phase: 'end' };
          const n = retryEndEvent.attempt;
          if (n > 0) {
            yield { type: 'info', message: `Recovered after ${n} ${n === 1 ? 'retry' : 'retries'}` };
          }
          break;
        }
        if (
          this.retryState === 'held' ||
          this.retryState === 'awaitingRetry' ||
          this.retryState === 'backoff'
        ) {
          // The retry was cancelled (abort during backoff) or never ran while
          // we were still holding the turn open. No agent_end follows on this
          // path, so surface the parked error and finalize the turn here.
          this.cancelRetryFallbackTimer();
          if (this.heldRetryError) {
            yield* this.releaseHeldRetryError();
          } else {
            this.retryState = 'none';
            yield { type: 'retry', phase: 'end' };
            if (retryEndEvent.finalError) {
              yield { type: 'error', message: `Retry failed: ${retryEndEvent.finalError}` };
            }
          }
          yield { type: 'complete' };
          this.pendingQueueComplete = true;
          break;
        }
        // Exhaustion ordering: the final agent_end { willRetry: false } already
        // released the parked error and completed the turn; this trailing
        // event describes the same failure. Stay quiet so the user gets one
        // error, not two.
        break;
      }

      case 'queue_update':
        // Queue contents are currently reflected by existing session/message state.
        // Ignore the event explicitly so newer Pi SDK sessions don't log noisy
        // "Unknown Pi event" warnings until we add a dedicated UI consumer.
        break;

      case 'agent_settled':
      case 'entry_appended':
      case 'session_info_changed':
      case 'thinking_level_changed':
      case 'bash_execution_update':
      case 'summarization_retry_scheduled':
      case 'summarization_retry_attempt_start':
      case 'summarization_retry_finished':
        // Session bookkeeping and compaction/branch-summary retry telemetry
        // (Pi SDK 0.84+/0.85). Compaction progress already surfaces through
        // compaction_start/compaction_end; nothing to show for these.
        break;

      default:
        this.log.warn(`Unknown Pi event type: ${(event as { type: string }).type}`);
        break;
    }
  }

  // ============================================================
  // Helpers
  // ============================================================

  /**
   * Extract canonical tool metadata from enriched tool_execution_start events.
   * This is the interceptor-authoritative path emitted by pi-agent-server.
   */
  private extractToolMetadataFromEvent(event: PiEvent): { intent?: string; displayName?: string } | undefined {
    const metadata = (event as {
      toolMetadata?: { intent?: unknown; displayName?: unknown };
    }).toolMetadata;

    if (!metadata) return undefined;

    const intent = typeof metadata.intent === 'string' ? metadata.intent : undefined;
    const displayName = typeof metadata.displayName === 'string' ? metadata.displayName : undefined;

    if (!intent && !displayName) return undefined;
    return { intent, displayName };
  }

  /**
   * Resolve stored metadata by tool call id with fallback variants.
   * Handles mixed id forms like `call_xxx|fc_yyy` by trying the base id.
   */
  private resolveStoredMetadata(toolCallId: string): { meta?: { intent?: string; displayName?: string }; keyTried?: string } {
    const candidates = new Set<string>([toolCallId]);
    if (toolCallId.includes('|')) {
      const [base] = toolCallId.split('|');
      if (base) candidates.add(base);
    }

    for (const candidate of candidates) {
      const meta = toolMetadataStore.get(candidate, this.sessionDir);
      if (meta) return { meta, keyTried: candidate };
    }

    return { meta: undefined, keyTried: Array.from(candidates).join(' -> ') };
  }

  /**
   * Normalize Pi SDK tool input field names to Claude Code format.
   * Pi uses camelCase (oldText, newText, path) while Claude Code uses
   * snake_case (old_string, new_string, file_path). The UI pipeline expects
   * Claude Code format for diff computation, overlay rendering, and
   * document type detection.
   */
  private normalizeToolInput(
    toolName: string,
    args: Record<string, unknown>,
  ): Record<string, unknown> {
    if (toolName === 'Edit') {
      const normalized = { ...args };
      if ('path' in normalized && !('file_path' in normalized)) {
        normalized.file_path = normalized.path;
        delete normalized.path;
      }

      // Pi SDK >= 0.63.2 uses edits[] array instead of top-level oldText/newText.
      // Preserve the full edits[] payload so the renderer can expand and display
      // every replacement block. Also derive the first edit into flat old/new
      // fields as a compatibility bridge for UI paths that still expect them.
      const edits = normalized.edits as Array<{ oldText?: string; newText?: string }> | undefined;
      if (Array.isArray(edits) && edits.length > 0 && edits[0]) {
        const first = edits[0];
        if (first.oldText != null && !('old_string' in normalized)) {
          normalized.old_string = first.oldText;
        }
        if (first.newText != null && !('new_string' in normalized)) {
          normalized.new_string = first.newText;
        }
      }

      // Legacy path: top-level oldText/newText (Pi SDK < 0.63.2 or resumed sessions)
      if ('oldText' in normalized && !('old_string' in normalized)) {
        normalized.old_string = normalized.oldText;
        delete normalized.oldText;
      }
      if ('newText' in normalized && !('new_string' in normalized)) {
        normalized.new_string = normalized.newText;
        delete normalized.newText;
      }
      return normalized;
    }

    if (toolName === 'Write') {
      const normalized = { ...args };
      if ('path' in normalized && !('file_path' in normalized)) {
        normalized.file_path = normalized.path;
        delete normalized.path;
      }
      return normalized;
    }

    if (toolName === 'Read' || toolName === 'Glob' || toolName === 'Grep') {
      const normalized = { ...args };
      if ('path' in normalized && !('file_path' in normalized)) {
        normalized.file_path = normalized.path;
        delete normalized.path;
      }
      return normalized;
    }

    return args;
  }

  /**
   * Resolve Pi tool name to PascalCase for UI consistency.
   * Pi tools use lowercase names (read, write, edit, bash, grep, find, ls).
   */
  private resolveToolName(rawName: string): string {
    return PI_TOOL_NAME_MAP[rawName] || rawName;
  }

  /**
   * Extract text content from a Pi AgentMessage.
   * Pi messages use the pi-ai Message format with content arrays.
   */
  private extractTextFromMessage(message: unknown): string | null {
    if (!message || typeof message !== 'object') return null;

    const msg = message as {
      role?: string;
      content?: string | Array<{ type: string; text?: string }>;
    };

    if (typeof msg.content === 'string') {
      return msg.content || null;
    }

    if (Array.isArray(msg.content)) {
      const textParts = msg.content
        .filter((c) => c.type === 'text' && c.text)
        .map((c) => c.text!);
      return textParts.length > 0 ? textParts.join('') : null;
    }

    return null;
  }

  /**
   * Extract a string result from Pi tool execution result.
   */
  private extractToolResult(result: unknown, isError: boolean): string {
    if (!result) {
      return isError ? 'Tool execution failed' : 'Success';
    }

    if (typeof result === 'string') return result;

    // Pi tool results follow the AgentToolResult shape: { content: [...], details: ... }
    const typed = result as {
      content?: Array<{ type: string; text?: string }>;
      details?: unknown;
    };

    if (Array.isArray(typed.content)) {
      const texts = typed.content
        .filter((c) => c.type === 'text' && c.text)
        .map((c) => c.text!);
      if (texts.length > 0) return texts.join('\n');
    }

    // Fall back to JSON
    try {
      return JSON.stringify(result);
    } catch {
      return String(result);
    }
  }

  /**
   * Get a human-readable display name for a tool.
   */
  private getToolDisplayName(toolName: string): string | undefined {
    switch (toolName) {
      case 'Bash':
        return 'Run Command';
      case 'Read':
        return 'Read File';
      case 'Write':
        return 'Write File';
      case 'Edit':
        return 'Edit File';
      case 'Glob':
      case 'Find':
        return 'Search Files';
      case 'Grep':
        return 'Search Content';
      case 'Ls':
        return 'List Directory';
      default:
        return undefined;
    }
  }
}
