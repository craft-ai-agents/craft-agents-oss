/**
 * KnowledgeWorkEnvelope (S-08) — lightweight work metadata layered on a KnowledgeRef
 * without mutating the underlying provider node.
 *
 * Persisted by server-core work-envelopes-store at
 * {workspaceRoot}/knowledge/work-envelopes.jsonl (key = kind:id).
 */

import type { KnowledgeRef } from './refs.ts';

export interface KnowledgeWorkEnvelope {
  knowledgeRef: KnowledgeRef;
  status?: string;
  labels?: string[];
  flagged?: boolean;
  archived?: boolean;
  assignedTo?: string;
  createdAt: number;
  updatedAt: number;
}

/** Stable map/storage key for an envelope: `${kind}:${id}`. */
export function knowledgeEnvelopeKey(ref: Pick<KnowledgeRef, 'kind' | 'id'>): string {
  return `${ref.kind}:${ref.id}`;
}
