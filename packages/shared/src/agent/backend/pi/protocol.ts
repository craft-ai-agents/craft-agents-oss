import type { LargeResultExcerpt } from '../../../utils/large-response.ts';

/** Raw Pi SDK context metadata on JSONL events/responses. No runtime imports. */
export interface PiContextUsagePayload {
  contextUsage?: { tokens: number | null; contextWindow: number; percent?: number | null };
  compactionSettings?: { enabled: boolean; reserveTokens: number };
}

export interface PiCompactResult extends PiContextUsagePayload {
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  /** Fresh local estimate supplied by the SDK, not pre-compaction API usage. */
  estimatedTokensAfter?: number;
}

/**
 * Subprocess → main: which parts of this large tool result does the agent's intent
 * need? The decision layer lives in the main process (decision model, toggle `largeResults`).
 */
export interface PiLargeResultGateRequest {
  type: 'large_result_gate_request';
  requestId: string;
  toolName: string;
  intent?: string;
  /** The whole result (at most `MAX_SUMMARIZATION_INPUT` tokens). */
  text: string;
  budgetChars: number;
  filePath: string;
}

/** Main → subprocess: the kept parts, or `null` to summarize as before. */
export interface PiLargeResultGateResponse {
  type: 'large_result_gate_response';
  requestId: string;
  excerpt: LargeResultExcerpt | null;
}
