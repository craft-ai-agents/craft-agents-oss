/**
 * Adaptive thinking via the decision model (feature toggle `adaptiveThinking`).
 *
 * Before a turn starts, the model rates how demanding the user's message is on
 * a four-level rubric, reading it with the end of the previous reply and the
 * names of attached files (a short "here" can continue demanding work); simple
 * requests run with a lower thinking level for that turn only. It never raises
 * the level above the session's, no confident answer keeps the session level,
 * pushback on the previous reply keeps it, and a request to change or send
 * something hard to undo gets at least `high`.
 *
 * Feedback: the next user turn's `corrects_previous` answer is written as a
 * follow-up on this turn's decision (`corrected` / `accepted`), so the report
 * shows per thinking level how often the user pushed back.
 */

import type { ThinkingLevel } from '@craft-agent/shared/agent/thinking-levels'
import { THINKING_LEVEL_IDS } from '@craft-agent/shared/agent/thinking-levels'
import type { DecisionRequest, DecisionResult } from '@craft-agent/shared/decisions'
import { FOREGROUND_MAX_DEADLINE_MS, openDecisionPoint, recordDecisionFollowUp, recordDecisionOutcome, type DecisionPointDeps } from './decision-point'

/** The rated level must come with this much confidence. */
export const ADAPTIVE_THINKING_MIN_CONFIDENCE = 0.6
/** The message is cut to this many characters before it is sent. */
export const ADAPTIVE_THINKING_MAX_MESSAGE_CHARS = 4_000
/** Only the end of the previous reply is sent: enough to read a follow-up, little enough not to drown the message. */
export const ADAPTIVE_THINKING_PREVIOUS_REPLY_CHARS = 1_200
/** "The user says the previous reply was wrong" at or above this keeps the session level. */
export const ADAPTIVE_THINKING_CORRECTION_AT = 0.6
/** "Changes or sends something hard to undo" at or above this: at least `high`. */
export const ADAPTIVE_THINKING_CONSEQUENTIAL_AT = 0.5

/** Thinking cap per rubric level; the top level keeps the session's setting. */
const CAP_BY_LEVEL: readonly (ThinkingLevel | null)[] = ['low', 'medium', 'high', null]

export interface TurnToRate {
  message: string
  /** The last final assistant reply, if any. */
  previousReply?: string
  /** Attached files as "name (type, size)": never their content. */
  attachments?: string[]
}

export function buildDemandRequest(turn: TurnToRate): DecisionRequest {
  const { message } = turn
  const previous = turn.previousReply?.trim()
  return {
    state: {
      message: message.length > ADAPTIVE_THINKING_MAX_MESSAGE_CHARS ? `${message.slice(0, ADAPTIVE_THINKING_MAX_MESSAGE_CHARS)}…` : message,
      ...(previous ? { previous_assistant_reply: previous.length > ADAPTIVE_THINKING_PREVIOUS_REPLY_CHARS ? `…${previous.slice(-ADAPTIVE_THINKING_PREVIOUS_REPLY_CHARS)}` : previous } : {}),
      ...(turn.attachments?.length ? { attachments: turn.attachments } : {}),
    },
    questions: {
      demand: {
        type: 'score',
        instructions: 'How much reasoning does the assistant need for its next reply? Read the message in light of the previous reply and any attached files: a short message can continue demanding work.',
        criteria: [
          'A greeting, a thank-you, or a simple factual question with a short answer',
          'A routine request with clear instructions: a small edit, a lookup, a short summary',
          'A substantial task: multi-step work, non-trivial code, or careful analysis',
          'A hard problem: complex reasoning, debugging, architecture, or ambiguous requirements',
        ],
      },
      consequential: {
        type: 'noul',
        instructions: 'Does the message ask the assistant to change or send something that is hard to undo or reaches other people or systems (update or delete records, deploy, push, publish, send messages, spend money)? Local code edits and reading do not count.',
      },
      ...(previous ? {
        corrects_previous: {
          type: 'noul' as const,
          instructions: "Does the user say the assistant's previous reply was wrong, incomplete, or not what they asked for?",
        },
      } : {}),
    },
  }
}

/** The lower of two thinking levels. */
function lowerOf(a: ThinkingLevel, b: ThinkingLevel): ThinkingLevel {
  return THINKING_LEVEL_IDS.indexOf(a) <= THINKING_LEVEL_IDS.indexOf(b) ? a : b
}

const noul = (result: DecisionResult | null, key: string): number | undefined => {
  const answer = result?.answers[key]
  return answer?.type === 'noul' ? answer.noul : undefined
}

export type TurnLevelChoice =
  | { level: ThinkingLevel; floored: boolean }
  | { keep: 'no_answer' | 'low_confidence' | 'correction' | 'needs_session_level' | 'not_lower' }

/** The policy, on the answers alone. */
export function chooseTurnLevel(result: DecisionResult | null, sessionLevel: ThinkingLevel): TurnLevelChoice {
  const demand = result?.answers.demand
  if (!demand || demand.type !== 'score') return { keep: 'no_answer' }
  if (demand.confidence < ADAPTIVE_THINKING_MIN_CONFIDENCE) return { keep: 'low_confidence' }
  // Pushback gets the session's full thinking.
  if ((noul(result, 'corrects_previous') ?? 0) >= ADAPTIVE_THINKING_CORRECTION_AT) return { keep: 'correction' }
  let cap = CAP_BY_LEVEL[Math.min(CAP_BY_LEVEL.length - 1, Math.max(0, Math.round(demand.score)))]
  if (!cap) return { keep: 'needs_session_level' }
  const floored = cap !== 'high' && (noul(result, 'consequential') ?? 0) >= ADAPTIVE_THINKING_CONSEQUENTIAL_AT
  if (floored) cap = 'high'
  const level = lowerOf(cap, sessionLevel)
  if (level === sessionLevel) return { keep: 'not_lower' }
  return { level, floored }
}

/**
 * The thinking level to use for this turn when it is lower than `sessionLevel`
 * (`null` keeps the session level), and the answer for the next turn's
 * follow-up. Never throws.
 */
export async function pickTurnThinkingLevel(
  turn: TurnToRate,
  sessionLevel: ThinkingLevel,
  deps: DecisionPointDeps & { sessionId?: string } = {},
): Promise<{ level: ThinkingLevel | null; result: DecisionResult | null }> {
  const message = turn.message.trim()
  if (sessionLevel === 'off' || !message) return { level: null, result: null }
  // The turn start waits for this answer.
  const decide = await openDecisionPoint({ ...deps, feature: 'adaptiveThinking', record: 'adaptive_thinking', maxDeadlineMs: FOREGROUND_MAX_DEADLINE_MS })
  if (!decide) return { level: null, result: null }
  const result = await decide(buildDemandRequest({ ...turn, message }), { sessionLevel, attachments: turn.attachments?.length ?? 0 })
  const choice = chooseTurnLevel(result, sessionLevel)
  if ('keep' in choice) {
    recordDecisionOutcome(result, { action: 'keep', changed: false, detail: { reason: choice.keep, sessionLevel } })
    return { level: null, result }
  }
  recordDecisionOutcome(result, { action: `thinking:${choice.level}`, changed: true, detail: { sessionLevel, ...(choice.floored ? { reason: 'consequential_floor' } : {}) } })
  return { level: choice.level, result }
}

/** Whether the user pushed back on the reply to `previous`, as judged with the next turn's answer. */
export function recordThinkingFollowUp(previous: DecisionResult, next: DecisionResult | null): void {
  const p = noul(next, 'corrects_previous')
  if (p === undefined) return
  recordDecisionFollowUp(previous, { result: p >= ADAPTIVE_THINKING_CORRECTION_AT ? 'corrected' : 'accepted', detail: { p: Math.round(p * 100) / 100 } })
}
