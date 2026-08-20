/**
 * Session context payloads captured from a knowledge provider.
 * ContextMode/ContextPayload verbatim K-03 §3.2; ContextSnapshot is the batch-merged
 * storage record for `knowledge_context_snapshots` (K-04 §3.4, wrapped around ContextPayload).
 */

import type { KnowledgeAttribute } from './provider.ts';
import type { KnowledgeRef } from './refs.ts';

export type ContextMode = 'snapshot' | 'live-reference';

export interface ContextPayload {
  ref: KnowledgeRef;
  mode: ContextMode;
  blockId: string;                                  // корневой block/document ID (att1 §11)
  content: string;                                  // markdown
  children: Array<{ blockId: string; content: string }>;
  backlinks: Array<{ ref: KnowledgeRef; title: string }>;
  attributes: KnowledgeAttribute[];
  capturedAt: number;                               // captured_at
  contentHash: string;                              // content_hash на момент захвата
  provenance?: { sessionId?: string; runId?: string };
}

/**
 * Persisted snapshot record (`{workspaceRoot}/knowledge/snapshots/<snapshotId>.json`, K-04).
 * Immutable after write; `snapshot` holds the captured payload verbatim.
 */
export interface ContextSnapshot {
  id: string;
  sessionId: string;
  provider: string;
  ref: KnowledgeRef;
  contentHash: string;
  capturedAt: number;                // epoch ms, aligned with ContextPayload.capturedAt
  snapshot: ContextPayload;
}
