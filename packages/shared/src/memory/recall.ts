import {
  listAgentMemoryEntries,
  listUserMemoryEntries,
} from './storage.ts';
import type {
  MemoryEntry,
  MemoryRecallResult,
  MemoryScope,
  MemoryStorageOptions,
  RecallMemoryInput,
} from './types.ts';

interface ScopedEntry {
  scope: MemoryScope;
  agentSlug?: string;
  entry: MemoryEntry;
}

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 25;
const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'for',
  'from',
  'how',
  'i',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'we',
  'what',
  'with',
  'you',
]);

export function recallMemoryEntries(
  input: RecallMemoryInput,
  options?: MemoryStorageOptions,
): MemoryRecallResult[] {
  const query = input.query.trim();
  if (!query) return [];

  const scopes = input.scopes?.length ? input.scopes : defaultRecallScopes(input.agentSlug);
  const entries = collectRecallEntries(scopes, input.agentSlug, options);
  return rankMemoryEntries(query, entries, input.limit);
}

export function rankMemoryEntries(
  query: string,
  entries: readonly ScopedEntry[],
  limit = DEFAULT_LIMIT,
): MemoryRecallResult[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  const normalizedQuery = normalize(query);
  const cappedLimit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit || DEFAULT_LIMIT)));

  return entries
    .map((scoped) => scoreEntry(scoped, tokens, normalizedQuery))
    .filter((result): result is MemoryRecallResult => result !== null)
    .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
    .slice(0, cappedLimit);
}

function defaultRecallScopes(agentSlug: string | undefined): MemoryScope[] {
  return agentSlug ? ['user', 'agent'] : ['user'];
}

function collectRecallEntries(
  scopes: readonly MemoryScope[],
  agentSlug: string | undefined,
  options?: MemoryStorageOptions,
): ScopedEntry[] {
  const scoped: ScopedEntry[] = [];
  if (scopes.includes('user')) {
    scoped.push(...listUserMemoryEntries(options).map((entry) => ({ scope: 'user' as const, entry })));
  }
  if (scopes.includes('agent')) {
    if (!agentSlug) throw new Error('agentSlug is required for agent memory recall');
    scoped.push(...listAgentMemoryEntries(agentSlug, options).map((entry) => ({ scope: 'agent' as const, agentSlug, entry })));
  }
  return scoped;
}

function scoreEntry(
  scoped: ScopedEntry,
  tokens: readonly string[],
  normalizedQuery: string,
): MemoryRecallResult | null {
  const name = normalize(scoped.entry.name);
  const type = normalize(scoped.entry.type);
  const body = normalize(scoped.entry.body);
  const haystack = `${name} ${type} ${body}`;
  let score = 0;
  const matched: string[] = [];

  for (const token of tokens) {
    let tokenScore = 0;
    if (name.includes(token)) tokenScore += 5;
    if (type.includes(token)) tokenScore += 2;
    if (body.includes(token)) tokenScore += 1;
    if (tokenScore > 0) {
      score += tokenScore;
      matched.push(token);
    }
  }

  if (normalizedQuery.length > 2 && haystack.includes(normalizedQuery)) score += 8;
  if (matched.length === 0 && score === 0) return null;

  return {
    scope: scoped.scope,
    agentSlug: scoped.agentSlug,
    entry: scoped.entry,
    score,
    reason: `Matched ${matched.slice(0, 5).join(', ') || 'phrase'}`,
    excerpt: buildExcerpt(scoped.entry.body, tokens),
  };
}

function tokenize(value: string): string[] {
  const seen = new Set<string>();
  const tokens = normalize(value)
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
  return tokens.filter((token) => {
    if (seen.has(token)) return false;
    seen.add(token);
    return true;
  });
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function buildExcerpt(body: string, tokens: readonly string[]): string {
  const compact = body.replace(/\s+/g, ' ').trim();
  if (compact.length <= 220) return compact;
  const lower = compact.toLowerCase();
  const firstHit = tokens
    .map((token) => lower.indexOf(token))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, firstHit - 70);
  const end = Math.min(compact.length, start + 220);
  return `${start > 0 ? '...' : ''}${compact.slice(start, end)}${end < compact.length ? '...' : ''}`;
}
