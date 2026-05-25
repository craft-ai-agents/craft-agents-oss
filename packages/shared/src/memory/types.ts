/**
 * File-based memory types.
 *
 * Phase 1 keeps markdown as the canonical store:
 *   ~/.agents/USER.md
 *   ~/.agents/agents/<slug>/MEMORY.md
 */

export const MEMORY_FILE = 'MEMORY.md';
export const USER_MEMORY_FILE = 'USER.md';
export const DELETED_MEMORIES_FILE = '.deleted-memories.json';
export const MEMORY_EVENTS_FILE = '.memory-events.jsonl';
export const MEMORY_REVIEW_QUEUE_FILE = '.memory-review-queue.json';
export const MEMORY_SCHEMA_VERSION = 1;

export type MemoryScope = 'user' | 'agent';

export type MemoryEntryType = 'user' | 'feedback' | 'project' | 'reference';

export const MEMORY_ENTRY_TYPES: readonly MemoryEntryType[] = [
  'user',
  'feedback',
  'project',
  'reference',
] as const;

export interface MemoryFileEnvelope {
  version: 1;
  agent?: string;
}

export interface MemoryEntry {
  name: string;
  type: MemoryEntryType;
  created: string;
  updated?: string;
  expires?: string;
  body: string;
}

export interface LoadedMemoryFile {
  scope: MemoryScope;
  agentSlug?: string;
  envelope: MemoryFileEnvelope;
  entries: MemoryEntry[];
  filePath: string;
  parseWarnings?: MemoryParseWarning[];
}

export interface MemoryStorageOptions {
  /**
   * Test-only escape hatch; production callers should use ~/.agents.
   *
   * This is the agents root, not the global agent library directory:
   *   <globalAgentsDir>/USER.md
   *   <globalAgentsDir>/agents/<slug>/MEMORY.md
   */
  globalAgentsDir?: string;
}

export interface SaveMemoryInput {
  scope: MemoryScope;
  agentSlug?: string;
  name: string;
  type: MemoryEntryType;
  body: string;
  expires?: string;
  /**
   * Bypass the tombstone block. Defaults to false. Set true ONLY for
   * user-initiated saves (UI manual add); agent tool calls must leave it
   * false so an agent can't immediately re-save what the user just forgot.
   * On a successful forced save, the matching tombstone is cleared so
   * subsequent saves of the same name behave normally.
   */
  force?: boolean;
  event?: MemoryMutationEventMetadata;
}

/**
 * Thrown when saveMemoryEntry is called with a name that's currently
 * tombstoned (via prior `forget_memory`). The caller can recover by
 * either explicitly passing `force: true` or calling `forgetDeletedMemoryName`
 * first.
 */
export class MemoryTombstonedError extends Error {
  readonly code = 'memory-tombstoned';
  constructor(public readonly entryName: string) {
    super(`"${entryName}" was previously forgotten. Pass force: true to overwrite the tombstone, or call forgetDeletedMemoryName(...) first.`);
    this.name = 'MemoryTombstonedError';
  }
}

export interface UpdateMemoryInput {
  scope: MemoryScope;
  agentSlug?: string;
  name: string;
  body?: string;
  expires?: string | null;
  event?: MemoryMutationEventMetadata;
}

export interface DeleteMemoryInput {
  scope: MemoryScope;
  agentSlug?: string;
  name: string;
  event?: MemoryMutationEventMetadata;
}

export type MemoryEventAction = 'save' | 'update' | 'forget' | 'recall' | 'consolidate';

export type MemoryEventSource =
  | 'user'
  | 'agent_tool'
  | 'sidecar'
  | 'import'
  | 'consolidation'
  | 'rpc'
  | 'system';

export interface MemoryMutationEventMetadata {
  source?: MemoryEventSource;
  runId?: string;
  evidence?: string;
  actor?: string;
}

export interface MemoryEvent {
  id: string;
  action: MemoryEventAction;
  scope: MemoryScope;
  agentSlug?: string;
  entryName?: string;
  source: MemoryEventSource;
  runId?: string;
  evidence?: string;
  actor?: string;
  createdAt: string;
}

export type MemoryReviewAction = 'save' | 'update' | 'forget';

export type MemoryReviewStatus = 'pending' | 'approved' | 'rejected' | 'applied';

export interface MemoryReviewItem {
  id: string;
  status: MemoryReviewStatus;
  action: MemoryReviewAction;
  scope: MemoryScope;
  agentSlug?: string;
  name: string;
  type?: MemoryEntryType;
  body?: string;
  expires?: string | null;
  confidence: number;
  evidence?: string;
  sourceRunId?: string;
  source: MemoryEventSource;
  createdAt: string;
  decidedAt?: string;
  decisionReason?: string;
}

export interface EnqueueMemoryReviewInput {
  action: MemoryReviewAction;
  scope: MemoryScope;
  agentSlug?: string;
  name: string;
  type?: MemoryEntryType;
  body?: string;
  expires?: string | null;
  confidence: number;
  evidence?: string;
  sourceRunId?: string;
  source?: MemoryEventSource;
}

export interface ResolveMemoryReviewInput {
  id: string;
  status: Exclude<MemoryReviewStatus, 'pending'>;
  decisionReason?: string;
}

export type MemoryParseWarningCode =
  | 'missing-entry-frontmatter'
  | 'invalid-entry-frontmatter'
  | 'missing-name'
  | 'invalid-type'
  | 'missing-created'
  | 'invalid-date'
  | 'duplicate-name';

export interface MemoryParseWarning {
  entryName?: string;
  field?: keyof MemoryEntry | 'entry';
  code: MemoryParseWarningCode;
  message: string;
}

export interface DeletedMemoryTombstones {
  version: 1;
  deleted: string[];
  updatedAt: string;
}
