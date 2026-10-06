/**
 * Host-side decision points.
 *
 * Every harness feature that asks the decision model something (task verdicts,
 * semantic labels, turn outcomes, ...) goes through `openDecisionPoint`:
 *
 *   1. resolve a client: Settings switch → the feature's toggle → key → endpoint;
 *   2. decide under the user's background deadline (`decisionLayer.deadlineMs`)
 *      unless the request sets its own, and under at least `DECISION_COLD_DEADLINE_MS`
 *      when the provider has not answered for `DECISION_COLD_AFTER_MS` (a cold start);
 *   3. record every call (feature tag, question keys, answers, state hash, never
 *      the state itself);
 *   4. return `null` on any failure so the caller keeps its pre-decision behaviour;
 *   5. `recordDecisionOutcome(result, ...)` then records what the point did with the
 *      answer (an outcome line joined to the decision by id), so usage can be judged
 *      without re-deriving thresholds from the code; `recordDecisionFollowUp` adds what
 *      turned out later (was the suggested source used?), which is what tunes a threshold.
 *
 * A decision is advice for the host. It never grants authority.
 */

import {
  buildDecisionRecord,
  getDecisionRecorder,
  type DecisionFollowUp,
  type DecisionOutcome,
  type DecisionRecord,
  resolveDecisionClient,
  type DecisionClientResolution,
  type DecisionFeature,
  type DecisionLayerFeature,
  type DecisionRecorder,
  type DecisionRequest,
  type DecisionResult,
  type ResolveDecisionClientOptions,
} from '@craft-agent/shared/decisions'

/** Ask a resolved decision point. `null` means no answer: behave as before. `signal` cancels the call. */
export type DecisionPointFn = (request: DecisionRequest, meta?: Record<string, unknown>, signal?: AbortSignal) => Promise<DecisionResult | null>

/** Test seams and logging shared by every decision point. */
export interface DecisionPointDeps {
  log?: (message: string) => void
  resolveClient?: (options: ResolveDecisionClientOptions) => Promise<DecisionClientResolution>
  recorder?: DecisionRecorder
  /** Clock for the cold-start check, in ms. */
  now?: () => number
}

export interface DecisionPointOptions extends DecisionPointDeps {
  /** Settings toggle that gates this point. */
  feature: DecisionLayerFeature
  /** Tag written to decisions.jsonl. */
  record: DecisionFeature
  sessionId?: string
  /** Upper bound on the deadline for points someone waits on (a turn start, a message ack). */
  maxDeadlineMs?: number
}

/** Deadline cap for decision points that hold up a turn start or a message acknowledgement. */
export const FOREGROUND_MAX_DEADLINE_MS = 3_000

/**
 * A provider that has not answered for this long starts cold. In the 2026-09-30 log, calls
 * failed 1% of the time within 30 s of the previous one and 6–12% after longer idle, all at
 * the 1.5 s default deadline.
 */
export const DECISION_COLD_AFTER_MS = 30_000
/** Deadline floor for a cold call; still under `FOREGROUND_MAX_DEADLINE_MS`. */
export const DECISION_COLD_DEADLINE_MS = 2_800

/** When each provider last answered (process-wide: every point shares the provider's warmth). */
const lastAnsweredAt = new Map<string, number>()

/**
 * Resolve once and return a function that asks the model, possibly several
 * times (batches). `null` when the point is switched off or unavailable.
 * Never throws.
 */
export async function openDecisionPoint(options: DecisionPointOptions): Promise<DecisionPointFn | null> {
  const resolveClient = options.resolveClient ?? resolveDecisionClient
  const tag = `[decision:${options.record}]`
  let resolution: DecisionClientResolution
  try {
    resolution = await resolveClient({ feature: options.feature })
  } catch (error) {
    options.log?.(`${tag} resolver failed: ${errorMessage(error)}`)
    return null
  }
  if (!resolution.ok) {
    if (resolution.failure.kind !== 'disabled') options.log?.(`${tag} unavailable: ${resolution.failure.message}`)
    return null
  }

  const { client, provider, endpoint, settings } = resolution.value
  const recorder = options.recorder ?? getDecisionRecorder()
  const now = options.now ?? Date.now
  return async (request, meta, signal) => {
    const startedAt = performance.now()
    const lastAnswer = lastAnsweredAt.get(provider)
    const coldStart = lastAnswer === undefined || now() - lastAnswer >= DECISION_COLD_AFTER_MS
    const base = { feature: options.record, provider, model: endpoint.model, questions: request.questions, sessionId: options.sessionId, meta, coldStart }
    try {
      const requested = request.deadlineMs ?? settings.deadlineMs
      const deadlineMs = Math.min(coldStart ? Math.max(requested, DECISION_COLD_DEADLINE_MS) : requested, options.maxDeadlineMs ?? Number.POSITIVE_INFINITY)
      const result = await client.decide({ ...request, deadlineMs }, signal)
      lastAnsweredAt.set(provider, now())
      const record = buildDecisionRecord({ ...base, result })
      void recorder.append(record)
      recordHandles.set(result, { record, recorder })
      return result
    } catch (error) {
      void recorder.record({ ...base, error, latencyMs: Math.round(performance.now() - startedAt) })
      options.log?.(`${tag} failed: ${errorMessage(error)}`)
      return null
    }
  }
}

/** Decision record behind each result a decision point returned, for `recordDecisionOutcome`/`recordDecisionFollowUp`. */
const recordHandles = new WeakMap<DecisionResult, { record: DecisionRecord; recorder: DecisionRecorder; outcomeRecorded?: boolean }>()

/**
 * Record what the point did with `result`'s answer. Call once per result, including when
 * the answer changed nothing (`changed: false`): the ratio is what shows whether a toggle
 * earns its keep. No-op for `null` (no answer; the decision line already says why) and for
 * a second call on the same result.
 */
export function recordDecisionOutcome(result: DecisionResult | null | undefined, outcome: DecisionOutcome): void {
  if (!result) return
  const handle = recordHandles.get(result)
  if (!handle || handle.outcomeRecorded) return
  handle.outcomeRecorded = true
  void handle.recorder.recordOutcome(handle.record, outcome)
}

/** Record what turned out later about `result`'s answer (e.g. the suggested source was used). */
export function recordDecisionFollowUp(result: DecisionResult | null | undefined, followUp: DecisionFollowUp): void {
  if (!result) return
  const handle = recordHandles.get(result)
  if (!handle) return
  void handle.recorder.recordFollowUp(handle.record, followUp)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
