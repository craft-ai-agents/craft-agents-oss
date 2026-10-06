/**
 * Relevance scoring via the decision model: which parts of a text a goal needs.
 *
 * One yes/no question per part, with the part's text in the question, about a state
 * that holds only the goal. Each question is judged with the state on its own, so
 * look-alike parts cannot be mixed up: with the parts in the state and questions naming
 * their keys, Jev answered for a neighbouring calendar event (fixtures: 6/9 against 9/9,
 * same latency and tokens). Parts are packed into calls of at most
 * `DECISION_MAX_QUESTIONS_PER_CALL` questions and `RELEVANCE_MAX_CALL_CHARS` of part
 * text; the calls run in parallel.
 */

import { DECISION_MAX_QUESTIONS_PER_CALL, type DecisionQuestion, type DecisionResult } from '@craft-agent/shared/decisions'
import type { DecisionPointFn } from './decision-point'

/** Part text per call (about 15k tokens). */
export const RELEVANCE_MAX_CALL_CHARS = 60_000
/** Calls in flight at once. */
export const RELEVANCE_MAX_PARALLEL_CALLS = 8
/** The goal is cut to this many characters. */
export const RELEVANCE_MAX_GOAL_CHARS = 1_000

export interface RelevanceScores {
  /** P(needed) per part, in the order of the parts. */
  scores: number[]
  /** One result per call, for the caller's outcome line. */
  results: DecisionResult[]
}

/** Group part indexes into calls: at most 64 parts and `maxChars` of part text per call. */
export function packRelevanceCalls(parts: readonly string[], maxChars: number = RELEVANCE_MAX_CALL_CHARS): number[][] {
  const calls: number[][] = []
  let current: number[] = []
  let chars = 0
  parts.forEach((part, index) => {
    if (current.length > 0 && (current.length >= DECISION_MAX_QUESTIONS_PER_CALL || chars + part.length > maxChars)) {
      calls.push(current)
      current = []
      chars = 0
    }
    current.push(index)
    chars += part.length
  })
  if (current.length > 0) calls.push(current)
  return calls
}

/** `null` when any call gave no answer: a partial view would drop parts it never judged. */
export async function scoreRelevance(
  decide: DecisionPointFn,
  goal: string,
  parts: readonly string[],
  meta: Record<string, unknown> = {},
): Promise<RelevanceScores | null> {
  const calls = packRelevanceCalls(parts)
  const results: (DecisionResult | null)[] = []
  for (let start = 0; start < calls.length; start += RELEVANCE_MAX_PARALLEL_CALLS) {
    const wave = calls.slice(start, start + RELEVANCE_MAX_PARALLEL_CALLS)
    results.push(...await Promise.all(wave.map((indexes, offset) => {
      const questions: Record<string, DecisionQuestion> = {}
      for (const index of indexes) {
        questions[`p${index}`] = { type: 'noul', instructions: `Does this part of a tool result contain information needed to accomplish the goal?\n\nPart:\n${parts[index]}` }
      }
      return decide({ state: { goal: goal.slice(0, RELEVANCE_MAX_GOAL_CHARS) }, questions }, { ...meta, call: start + offset + 1, calls: calls.length, parts: indexes.length })
    })))
    if (results.some(result => !result)) return null
  }

  const scores = parts.map((_, index) => {
    const answer = results[calls.findIndex(indexes => indexes.includes(index))]?.answers[`p${index}`]
    return answer?.type === 'noul' ? answer.noul : 0
  })
  return { scores, results: results as DecisionResult[] }
}
