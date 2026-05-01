/**
 * Memory storage.
 *
 * CRUD over USER.md and per-agent MEMORY.md. Markdown is canonical; callers
 * should treat invalid files as empty/missing and surface parse warnings where
 * useful for hand-edited files.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import matter from 'gray-matter';
import { AGENT_SLUG_REGEX } from '../agent-definitions/types.ts';
import {
  DELETED_MEMORIES_FILE,
  MEMORY_ENTRY_TYPES,
  MEMORY_FILE,
  MEMORY_SCHEMA_VERSION,
  USER_MEMORY_FILE,
  type DeleteMemoryInput,
  type DeletedMemoryTombstones,
  type LoadedMemoryFile,
  type MemoryEntry,
  type MemoryEntryType,
  type MemoryFileEnvelope,
  type MemoryParseWarning,
  type MemoryScope,
  type MemoryStorageOptions,
  type SaveMemoryInput,
  type UpdateMemoryInput,
} from './types.ts';

// ============================================================================
// Paths
// ============================================================================

export const GLOBAL_AGENTS_ROOT = join(homedir(), '.agents');

function getGlobalAgentsRoot(options?: MemoryStorageOptions): string {
  return options?.globalAgentsDir ?? GLOBAL_AGENTS_ROOT;
}

export function getUserMemoryFile(options?: MemoryStorageOptions): string {
  return join(getGlobalAgentsRoot(options), USER_MEMORY_FILE);
}

export function getAgentMemoryDir(agentSlug: string, options?: MemoryStorageOptions): string {
  return join(getGlobalAgentsRoot(options), 'agents', agentSlug);
}

export function getAgentMemoryFile(agentSlug: string, options?: MemoryStorageOptions): string {
  return join(getAgentMemoryDir(agentSlug, options), MEMORY_FILE);
}

export function getMemoryFilePath(
  scope: MemoryScope,
  agentSlug?: string,
  options?: MemoryStorageOptions,
): string {
  if (scope === 'user') return getUserMemoryFile(options);
  assertValidAgentSlug(agentSlug);
  return getAgentMemoryFile(agentSlug, options);
}

function getDeletedMemoriesFile(filePath: string): string {
  return join(dirname(filePath), DELETED_MEMORIES_FILE);
}

// ============================================================================
// Validation
// ============================================================================

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function isValidMemoryEntryType(type: string): type is MemoryEntryType {
  return (MEMORY_ENTRY_TYPES as readonly string[]).includes(type);
}

export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_REGEX.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function isValidAgentSlug(slug: string): boolean {
  return AGENT_SLUG_REGEX.test(slug);
}

function assertValidAgentSlug(slug: string | undefined): asserts slug is string {
  if (!slug || !isValidAgentSlug(slug)) {
    throw new Error(`Invalid agent slug: "${slug ?? ''}" (lowercase letters, digits, hyphens; 1-64 chars)`);
  }
}

function normalizeName(name: string): string {
  return name.trim();
}

function assertValidEntryName(name: string): void {
  if (!normalizeName(name)) throw new Error('Memory entry name is required');
}

function assertValidEntryType(type: string): asserts type is MemoryEntryType {
  if (!isValidMemoryEntryType(type)) {
    throw new Error(`Invalid memory type: "${type}" (expected one of: ${MEMORY_ENTRY_TYPES.join(', ')})`);
  }
}

function assertValidOptionalDate(value: string | undefined, field: 'expires'): void {
  if (value != null && value !== '' && !isValidIsoDate(value)) {
    throw new Error(`${field} must be an ISO date (YYYY-MM-DD)`);
  }
}

function warning(
  code: MemoryParseWarning['code'],
  message: string,
  field?: MemoryParseWarning['field'],
  entryName?: string,
): MemoryParseWarning {
  return { code, message, field, entryName };
}

// ============================================================================
// Parsing
// ============================================================================

function parseEnvelope(
  data: Record<string, unknown>,
  scope: MemoryScope,
  expectedAgentSlug?: string,
): MemoryFileEnvelope | null {
  if (data.version !== MEMORY_SCHEMA_VERSION) return null;

  if (scope === 'agent') {
    if (typeof data.agent !== 'string') return null;
    const agent = data.agent.trim();
    if (!agent || agent !== expectedAgentSlug) return null;
    return { version: MEMORY_SCHEMA_VERSION, agent };
  }

  return { version: MEMORY_SCHEMA_VERSION };
}

function parseEntry(rawFrontmatter: string, rawBody: string): { entry?: MemoryEntry; warnings: MemoryParseWarning[] } {
  const warnings: MemoryParseWarning[] = [];
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(`---\n${rawFrontmatter.trim()}\n---\n${rawBody.trim()}`);
  } catch {
    return {
      warnings: [warning('invalid-entry-frontmatter', 'Entry frontmatter is malformed.', 'entry')],
    };
  }

  const data = parsed.data as Record<string, unknown>;
  const entryName = typeof data.name === 'string' ? normalizeName(data.name) : undefined;
  if (!entryName) {
    warnings.push(warning('missing-name', 'Memory entry is missing a name.', 'name'));
  }

  const type = typeof data.type === 'string' ? data.type.trim() : '';
  if (!type || !isValidMemoryEntryType(type)) {
    warnings.push(warning('invalid-type', `Memory entry type must be one of: ${MEMORY_ENTRY_TYPES.join(', ')}.`, 'type', entryName));
  }

  const created = coerceYamlDate(data.created);
  if (!created) {
    warnings.push(warning('missing-created', 'Memory entry is missing created date.', 'created', entryName));
  } else if (!isValidIsoDate(created)) {
    warnings.push(warning('invalid-date', 'Memory entry created date must be YYYY-MM-DD.', 'created', entryName));
  }

  const updated = coerceYamlDate(data.updated);
  if (updated && !isValidIsoDate(updated)) {
    warnings.push(warning('invalid-date', 'Memory entry updated date must be YYYY-MM-DD.', 'updated', entryName));
  }

  const expires = coerceYamlDate(data.expires);
  if (expires && !isValidIsoDate(expires)) {
    warnings.push(warning('invalid-date', 'Memory entry expires date must be YYYY-MM-DD.', 'expires', entryName));
  }

  if (warnings.length > 0 || !entryName || !isValidMemoryEntryType(type) || !created) {
    return { warnings };
  }

  return {
    entry: {
      name: entryName,
      type,
      created,
      updated: updated || undefined,
      expires: expires || undefined,
      body: parsed.content.trim(),
    },
    warnings,
  };
}

function coerceYamlDate(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim();
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  return undefined;
}

function parseEntryBlocks(content: string): { entries: MemoryEntry[]; warnings: MemoryParseWarning[] } {
  const trimmed = content.trim();
  if (!trimmed) return { entries: [], warnings: [] };

  const parts = trimmed.split(/^---\s*$/m);
  const entries: MemoryEntry[] = [];
  const warnings: MemoryParseWarning[] = [];
  const seen = new Set<string>();

  if (parts[0]?.trim()) {
    warnings.push(warning('missing-entry-frontmatter', 'Memory file body must start each entry with mini-frontmatter.', 'entry'));
  }

  for (let i = 1; i < parts.length; i += 2) {
    const rawFrontmatter = parts[i];
    const rawBody = parts[i + 1];
    if (rawFrontmatter == null || rawBody == null) {
      warnings.push(warning('missing-entry-frontmatter', 'Memory entry is missing a closing frontmatter delimiter.', 'entry'));
      continue;
    }

    const parsed = parseEntry(rawFrontmatter, rawBody);
    warnings.push(...parsed.warnings);
    if (!parsed.entry) continue;
    if (seen.has(parsed.entry.name)) {
      warnings.push(warning('duplicate-name', `Duplicate memory entry name "${parsed.entry.name}" skipped.`, 'name', parsed.entry.name));
      continue;
    }
    seen.add(parsed.entry.name);
    entries.push(parsed.entry);
  }

  return { entries, warnings };
}

export function parseMemoryFile(
  content: string,
  scope: MemoryScope,
  expectedAgentSlug?: string,
): { envelope: MemoryFileEnvelope; entries: MemoryEntry[]; warnings: MemoryParseWarning[] } | null {
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(content);
  } catch {
    return null;
  }

  const envelope = parseEnvelope(parsed.data as Record<string, unknown>, scope, expectedAgentSlug);
  if (!envelope) return null;

  const entryParse = parseEntryBlocks(parsed.content);
  return {
    envelope,
    entries: entryParse.entries,
    warnings: entryParse.warnings,
  };
}

export function serializeMemoryFile(envelope: MemoryFileEnvelope, entries: MemoryEntry[]): string {
  const body = entries
    .map((entry) => {
      const lines = [
        '---',
        `name: ${quoteYamlString(entry.name)}`,
        `type: ${entry.type}`,
        `created: ${quoteYamlString(entry.created)}`,
      ];
      if (entry.updated) lines.push(`updated: ${quoteYamlString(entry.updated)}`);
      if (entry.expires) lines.push(`expires: ${quoteYamlString(entry.expires)}`);
      lines.push('---', '', entry.body.trimEnd());
      return lines.join('\n').trimEnd();
    })
    .join('\n\n');

  const envelopeLines = ['---'];
  if (envelope.agent) envelopeLines.push(`agent: ${envelope.agent}`);
  envelopeLines.push(`version: ${envelope.version}`, '---');

  if (!body) return `${envelopeLines.join('\n')}\n`;
  return `${envelopeLines.join('\n')}\n\n${body}\n`;
}

function quoteYamlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

// ============================================================================
// Load
// ============================================================================

function emptyMemoryFile(scope: MemoryScope, filePath: string, agentSlug?: string): LoadedMemoryFile {
  return {
    scope,
    agentSlug,
    envelope: scope === 'agent'
      ? { version: MEMORY_SCHEMA_VERSION, agent: agentSlug }
      : { version: MEMORY_SCHEMA_VERSION },
    entries: [],
    filePath,
  };
}

export function loadMemoryFile(
  scope: MemoryScope,
  agentSlug?: string,
  options?: MemoryStorageOptions,
): LoadedMemoryFile | null {
  const filePath = getMemoryFilePath(scope, agentSlug, options);
  if (!existsSync(filePath)) return emptyMemoryFile(scope, filePath, agentSlug);

  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }

  const parsed = parseMemoryFile(raw, scope, agentSlug);
  if (!parsed) return null;
  return {
    scope,
    agentSlug,
    envelope: parsed.envelope,
    entries: parsed.entries,
    filePath,
    parseWarnings: parsed.warnings.length > 0 ? parsed.warnings : undefined,
  };
}

export function loadUserMemory(options?: MemoryStorageOptions): LoadedMemoryFile | null {
  return loadMemoryFile('user', undefined, options);
}

export function loadAgentMemory(agentSlug: string, options?: MemoryStorageOptions): LoadedMemoryFile | null {
  assertValidAgentSlug(agentSlug);
  return loadMemoryFile('agent', agentSlug, options);
}

export function listMemoryEntries(
  scope: MemoryScope,
  agentSlug?: string,
  options?: MemoryStorageOptions,
): MemoryEntry[] {
  return loadMemoryFile(scope, agentSlug, options)?.entries ?? [];
}

export function listUserMemoryEntries(options?: MemoryStorageOptions): MemoryEntry[] {
  return listMemoryEntries('user', undefined, options);
}

export function listAgentMemoryEntries(agentSlug: string, options?: MemoryStorageOptions): MemoryEntry[] {
  assertValidAgentSlug(agentSlug);
  return listMemoryEntries('agent', agentSlug, options);
}

// ============================================================================
// Tombstones
// ============================================================================

export function readDeletedMemoryNames(
  scope: MemoryScope,
  agentSlug?: string,
  options?: MemoryStorageOptions,
): Set<string> {
  const filePath = getMemoryFilePath(scope, agentSlug, options);
  const tombstoneFile = getDeletedMemoriesFile(filePath);
  if (!existsSync(tombstoneFile)) return new Set();
  try {
    const parsed = JSON.parse(readFileSync(tombstoneFile, 'utf-8')) as Partial<DeletedMemoryTombstones>;
    if (!Array.isArray(parsed.deleted)) return new Set();
    return new Set(parsed.deleted.filter((name): name is string => typeof name === 'string' && name.trim().length > 0));
  } catch {
    return new Set();
  }
}

function writeDeletedMemoryNames(filePath: string, names: Set<string>): DeletedMemoryTombstones {
  const tombstones: DeletedMemoryTombstones = {
    version: MEMORY_SCHEMA_VERSION,
    deleted: [...names].sort(),
    updatedAt: new Date().toISOString(),
  };
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(getDeletedMemoriesFile(filePath), JSON.stringify(tombstones, null, 2) + '\n', 'utf-8');
  return tombstones;
}

function forgetDeletedMemoryNameUnlocked(filePath: string, name: string): DeletedMemoryTombstones | null {
  const tombstoneFile = getDeletedMemoriesFile(filePath);
  if (!existsSync(tombstoneFile)) return null;
  let deleted: Set<string>;
  try {
    const parsed = JSON.parse(readFileSync(tombstoneFile, 'utf-8')) as Partial<DeletedMemoryTombstones>;
    deleted = new Set(Array.isArray(parsed.deleted)
      ? parsed.deleted.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      : []);
  } catch {
    deleted = new Set();
  }
  if (!deleted.delete(normalizeName(name))) return null;
  return writeDeletedMemoryNames(filePath, deleted);
}

function rememberDeletedMemoryNameUnlocked(filePath: string, name: string): DeletedMemoryTombstones {
  let deleted: Set<string>;
  const tombstoneFile = getDeletedMemoriesFile(filePath);
  if (!existsSync(tombstoneFile)) {
    deleted = new Set();
  } else {
    try {
      const parsed = JSON.parse(readFileSync(tombstoneFile, 'utf-8')) as Partial<DeletedMemoryTombstones>;
      deleted = new Set(Array.isArray(parsed.deleted)
        ? parsed.deleted.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        : []);
    } catch {
      deleted = new Set();
    }
  }
  deleted.add(normalizeName(name));
  return writeDeletedMemoryNames(filePath, deleted);
}

export function isMemoryNameDeleted(
  scope: MemoryScope,
  name: string,
  agentSlug?: string,
  options?: MemoryStorageOptions,
): boolean {
  return readDeletedMemoryNames(scope, agentSlug, options).has(normalizeName(name));
}

export async function rememberDeletedMemoryName(
  scope: MemoryScope,
  name: string,
  agentSlug?: string,
  options?: MemoryStorageOptions,
): Promise<DeletedMemoryTombstones> {
  assertValidEntryName(name);
  const filePath = getMemoryFilePath(scope, agentSlug, options);
  return withMemoryFileMutex(filePath, async () => {
    return rememberDeletedMemoryNameUnlocked(filePath, name);
  });
}

export async function forgetDeletedMemoryName(
  scope: MemoryScope,
  name: string,
  agentSlug?: string,
  options?: MemoryStorageOptions,
): Promise<DeletedMemoryTombstones | null> {
  assertValidEntryName(name);
  const filePath = getMemoryFilePath(scope, agentSlug, options);
  return withMemoryFileMutex(filePath, async () => {
    return forgetDeletedMemoryNameUnlocked(filePath, name);
  });
}

// ============================================================================
// Mutex
// ============================================================================

const memoryFileMutexes = new Map<string, Promise<void>>();

export function withMemoryFileMutex<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const prev = memoryFileMutexes.get(filePath) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  memoryFileMutexes.set(filePath, next.then(() => {}, () => {}));
  return next;
}

// ============================================================================
// Mutations
// ============================================================================

function ensureLoadableMemoryFile(
  scope: MemoryScope,
  agentSlug: string | undefined,
  options?: MemoryStorageOptions,
): LoadedMemoryFile {
  const loaded = loadMemoryFile(scope, agentSlug, options);
  if (!loaded) throw new Error(`Memory file is invalid or unreadable: ${getMemoryFilePath(scope, agentSlug, options)}`);
  return loaded;
}

function writeMemoryFile(loaded: LoadedMemoryFile): LoadedMemoryFile {
  mkdirSync(dirname(loaded.filePath), { recursive: true });
  writeFileSync(loaded.filePath, serializeMemoryFile(loaded.envelope, loaded.entries), 'utf-8');
  return loaded;
}

function uniqueMemoryName(desiredName: string, entries: readonly MemoryEntry[]): string {
  const base = normalizeName(desiredName);
  const existing = new Set(entries.map((entry) => entry.name));
  if (!existing.has(base)) return base;

  let suffix = 2;
  while (existing.has(`${base} (${suffix})`)) suffix += 1;
  return `${base} (${suffix})`;
}

export async function saveMemoryEntry(
  input: SaveMemoryInput,
  options?: MemoryStorageOptions,
): Promise<MemoryEntry> {
  if (input.scope === 'agent') assertValidAgentSlug(input.agentSlug);
  assertValidEntryName(input.name);
  assertValidEntryType(input.type);
  if (!input.body.trim()) throw new Error('Memory entry body is required');
  assertValidOptionalDate(input.expires, 'expires');

  const filePath = getMemoryFilePath(input.scope, input.agentSlug, options);
  return withMemoryFileMutex(filePath, async () => {
    const loaded = ensureLoadableMemoryFile(input.scope, input.agentSlug, options);
    const entry: MemoryEntry = {
      name: uniqueMemoryName(input.name, loaded.entries),
      type: input.type,
      created: todayIsoDate(),
      expires: input.expires?.trim() || undefined,
      body: input.body.trim(),
    };
    loaded.entries.push(entry);
    writeMemoryFile(loaded);
    forgetDeletedMemoryNameUnlocked(filePath, entry.name);
    return entry;
  });
}

export async function updateMemoryEntry(
  input: UpdateMemoryInput,
  options?: MemoryStorageOptions,
): Promise<MemoryEntry | null> {
  if (input.scope === 'agent') assertValidAgentSlug(input.agentSlug);
  assertValidEntryName(input.name);
  if (input.expires != null) assertValidOptionalDate(input.expires, 'expires');

  const filePath = getMemoryFilePath(input.scope, input.agentSlug, options);
  return withMemoryFileMutex(filePath, async () => {
    const loaded = ensureLoadableMemoryFile(input.scope, input.agentSlug, options);
    const index = loaded.entries.findIndex((entry) => entry.name === normalizeName(input.name));
    if (index === -1) return null;

    const current = loaded.entries[index]!;
    const next: MemoryEntry = {
      ...current,
      body: input.body != null ? input.body.trim() : current.body,
      updated: todayIsoDate(),
    };
    if (input.expires === null || input.expires === '') delete next.expires;
    else if (input.expires != null) next.expires = input.expires.trim();

    if (!next.body.trim()) throw new Error('Memory entry body is required');
    loaded.entries[index] = next;
    writeMemoryFile(loaded);
    return next;
  });
}

export async function deleteMemoryEntry(
  input: DeleteMemoryInput,
  options?: MemoryStorageOptions,
): Promise<boolean> {
  if (input.scope === 'agent') assertValidAgentSlug(input.agentSlug);
  assertValidEntryName(input.name);

  const filePath = getMemoryFilePath(input.scope, input.agentSlug, options);
  return withMemoryFileMutex(filePath, async () => {
    const loaded = ensureLoadableMemoryFile(input.scope, input.agentSlug, options);
    const name = normalizeName(input.name);
    const nextEntries = loaded.entries.filter((entry) => entry.name !== name);
    const deleted = nextEntries.length !== loaded.entries.length;
    if (deleted) {
      loaded.entries = nextEntries;
      writeMemoryFile(loaded);
    } else if (!existsSync(filePath)) {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, serializeMemoryFile(loaded.envelope, []), 'utf-8');
    }
    rememberDeletedMemoryNameUnlocked(filePath, name);
    return deleted;
  });
}

export async function deleteMemoryFile(
  scope: MemoryScope,
  agentSlug?: string,
  options?: MemoryStorageOptions,
): Promise<boolean> {
  const filePath = getMemoryFilePath(scope, agentSlug, options);
  return withMemoryFileMutex(filePath, async () => {
    if (!existsSync(filePath)) return false;
    rmSync(filePath, { force: true });
    return true;
  });
}
