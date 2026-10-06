/**
 * Large-result filter for the Pi subprocess (decision model, toggle `largeResults`).
 * The decision layer (settings, keys, recorder) lives in the main process, so the
 * filter sends it the whole result over the JSONL protocol, like pre-tool-use checks.
 * A reply that never comes counts as "no answer": summarize as before.
 */

import type { LargeResultExcerpt, LargeResultFilter } from '../../shared/src/utils/large-response.ts';
import type { PiLargeResultGateRequest } from '../../shared/src/agent/backend/pi/protocol.ts';
import { DECISION_MAX_DEADLINE_MS } from '../../shared/src/decisions/types.ts';

/** Safety net for a lost reply: the longest allowed decision deadline plus slack. */
export const LARGE_RESULT_GATE_TIMEOUT_MS = DECISION_MAX_DEADLINE_MS + 5_000;

export function createLargeResultGateClient(
  send: (request: PiLargeResultGateRequest) => void,
  timeoutMs: number = LARGE_RESULT_GATE_TIMEOUT_MS,
): { filter: LargeResultFilter; handleResponse: (requestId: string, excerpt: LargeResultExcerpt | null) => void } {
  const pending = new Map<string, (excerpt: LargeResultExcerpt | null) => void>();
  // Unique per subprocess, so a late answer meant for a crashed predecessor never matches.
  const nonce = Math.random().toString(36).slice(2, 10);
  let counter = 0;

  const filter: LargeResultFilter = ({ text, context, budgetChars, filePath }) =>
    new Promise((resolve) => {
      const requestId = `pi-lrg-${nonce}-${++counter}`;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const settle = (excerpt: LargeResultExcerpt | null) => {
        clearTimeout(timer);
        pending.delete(requestId);
        resolve(excerpt);
      };
      timer = setTimeout(() => settle(null), timeoutMs);
      pending.set(requestId, settle);
      send({
        type: 'large_result_gate_request',
        requestId,
        toolName: context.toolName,
        ...(context.intent ? { intent: context.intent } : {}),
        text,
        budgetChars,
        filePath,
      });
    });

  return { filter, handleResponse: (requestId, excerpt) => pending.get(requestId)?.(excerpt) };
}
