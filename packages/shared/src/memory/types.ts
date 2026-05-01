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
}

export interface UpdateMemoryInput {
  scope: MemoryScope;
  agentSlug?: string;
  name: string;
  body?: string;
  expires?: string | null;
}

export interface DeleteMemoryInput {
  scope: MemoryScope;
  agentSlug?: string;
  name: string;
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
