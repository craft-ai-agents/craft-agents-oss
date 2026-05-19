import { join } from 'node:path';
import { parseMarkdownEntries, type MarkdownEntry } from '../../../shared/src/markdown-entry-parser/index.ts';
import {
  compareResolutionPrecedence,
  getCacheEntryStaleReason,
  getMarkdownEntryStaleReason,
  resolveTeamKnowledgeMatches,
  type TeamKnowledgeStaleReason,
} from '../../../shared/src/team-public-knowledge/entry-resolution.ts';
import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';

interface TeamPublicKnowledgeCacheEntry {
  id: string;
  title: string;
  url: string;
  priority: number;
  content: string;
  contentHash: string;
  version: number;
  fetchedAt: number;
  updatedAt: number;
  stale: boolean;
  staleAt?: number;
  lastError?: string;
}

interface TeamPublicKnowledgeCache {
  entries: Record<string, TeamPublicKnowledgeCacheEntry>;
}

interface SearchResultItem {
  id: string;
  kind: string;
  title?: string;
  summary?: string;
  term?: string;
  content: string;
  headingPath: string[];
  sourceDocId?: string;
  source: string;
  tags?: string[];
  scope?: string;
  defaults?: Record<string, string>;
  validUntil?: string;
  stale: boolean;
  staleReason?: TeamKnowledgeStaleReason;
  conflict: boolean;
  conflictReason?: string;
  confidence: number;
  relevance: string;
  matchReason: string;
}

interface SearchResult {
  results: SearchResultItem[];
  total: number;
  nextCursor?: string;
}

export interface SearchTeamPublicKnowledgeArgs {
  query: string;
  kind?: string;
  tag?: string;
  scope?: string;
  limit?: number;
  cursor?: string;
}

function loadCache(workspacePath: string, fs: SessionToolContext['fs']): TeamPublicKnowledgeCache | null {
  const cachePath = join(workspacePath, 'team-public-knowledge', 'cache.json');
  if (!fs.exists(cachePath)) return null;
  try {
    return JSON.parse(fs.readFile(cachePath)) as TeamPublicKnowledgeCache;
  } catch {
    return null;
  }
}

function scoreEntry(entry: MarkdownEntry, query: string): { confidence: number; relevance: string; matchReason: string } {
  const q = query.toLowerCase();
  const content = entry.content.toLowerCase();
  const title = entry.title?.toLowerCase() ?? '';
  const summary = entry.summary?.toLowerCase() ?? '';
  const term = entry.term?.toLowerCase() ?? '';

  // Exact match in term/title/summary
  if (term === q || title === q || summary === q) {
    return { confidence: 1, relevance: 'high', matchReason: 'Exact match on term/title/summary' };
  }

  // Contains match on term/title
  if (term.includes(q) || title.includes(q) || (entry.term && q.includes(entry.term))) {
    return { confidence: 0.85, relevance: 'high', matchReason: 'Partial match on term or title' };
  }

  // Contains match in content
  if (content.includes(q)) {
    return { confidence: 0.6, relevance: 'medium', matchReason: 'Content contains query terms' };
  }

  // Word-level match (individual words)
  const qWords = q.split(/\s+/).filter(Boolean);
  const contentWords = content.split(/\s+/);
  const matchedWords = qWords.filter(w => contentWords.some(cw => cw.includes(w)));
  if (matchedWords.length > 0) {
    const ratio = matchedWords.length / qWords.length;
    return {
      confidence: 0.3 + ratio * 0.3,
      relevance: ratio >= 0.5 ? 'medium' : 'low',
      matchReason: `Matched ${matchedWords.length}/${qWords.length} query words`,
    };
  }

  return { confidence: 0, relevance: 'none', matchReason: '' };
}

function matchesKind(entry: MarkdownEntry, kind?: string): boolean {
  if (!kind) return true;
  return entry.kind === kind;
}

function matchesTag(entry: MarkdownEntry, tag?: string): boolean {
  if (!tag) return true;
  return (entry.metadata.tags ?? []).some(t => t.toLowerCase() === tag.toLowerCase());
}

function matchesScope(entry: MarkdownEntry, scope?: string): boolean {
  if (!scope) return true;
  return entry.metadata.scope?.toLowerCase() === scope.toLowerCase();
}

function encodeCursor(index: number): string {
  return Buffer.from(String(index)).toString('base64');
}

function decodeCursor(cursor?: string): number {
  if (!cursor) return 0;
  try {
    return parseInt(Buffer.from(cursor, 'base64').toString('utf-8'), 10) || 0;
  } catch {
    return 0;
  }
}

export async function handleSearchTeamPublicKnowledge(
  ctx: SessionToolContext,
  args: SearchTeamPublicKnowledgeArgs,
): Promise<ToolResult> {
  const { query, kind, tag, scope, limit = 20, cursor } = args;

  if (!query || query.trim().length === 0) {
    return errorResponse('search_team_public_knowledge requires a non-empty query parameter.');
  }

  const trimmedQuery = query.trim();

  const cache = loadCache(ctx.workspacePath, ctx.fs);
  if (!cache || Object.keys(cache.entries).length === 0) {
    const result: SearchResult = { results: [], total: 0 };
    return successResponse(JSON.stringify(result, null, 2));
  }

  const allEntries: MarkdownEntry[] = [];
  const staleDocIds = new Set<string>();
  const ttlExpiredDocIds = new Set<string>();
  for (const entry of Object.values(cache.entries)) {
    const parsed = parseMarkdownEntries(entry.content, {
      sourceDocId: entry.id,
      sourceTitle: entry.title,
      priority: entry.priority,
      updatedAt: entry.updatedAt,
    });
    allEntries.push(...parsed);
    const staleReason = getCacheEntryStaleReason(entry);
    if (staleReason === 'document_stale') staleDocIds.add(entry.id);
    if (staleReason === 'stale_ttl_expired') ttlExpiredDocIds.add(entry.id);
  }

  const conflictTerms = buildConflictTermMap(allEntries);

  const scored = allEntries
    .map(e => {
      const scoring = scoreEntry(e, trimmedQuery);
      return { entry: e, ...scoring };
    })
    .filter(s => s.confidence > 0 && matchesKind(s.entry, kind) && matchesTag(s.entry, tag) && matchesScope(s.entry, scope))
    .sort((a, b) => b.confidence - a.confidence || compareResolutionPrecedence(a.entry, b.entry));

  const total = scored.length;

  const offset = decodeCursor(cursor);
  const pageItems = scored.slice(offset, offset + limit);

  const results: SearchResultItem[] = pageItems.map(s => {
    const staleReason = getMarkdownEntryStaleReason(s.entry, staleDocIds, ttlExpiredDocIds);
    const conflictReason = conflictTerms.get(entryKey(s.entry));
    return {
      id: s.entry.metadata.id ?? s.entry.sourceDocId ?? '',
      kind: s.entry.kind,
      title: s.entry.title,
      summary: s.entry.summary,
      term: s.entry.term,
      content: s.entry.content,
      headingPath: s.entry.headingPath,
      sourceDocId: s.entry.sourceDocId,
      source: s.entry.sourceTitle ?? '',
      tags: s.entry.metadata.tags,
      scope: s.entry.metadata.scope,
      defaults: s.entry.metadata.defaults,
      validUntil: s.entry.metadata.validUntil,
      stale: staleReason !== undefined,
      staleReason,
      conflict: conflictReason !== undefined,
      conflictReason,
      confidence: s.confidence,
      relevance: s.relevance,
      matchReason: s.matchReason,
    };
  });

  const response: SearchResult = { results, total };
  const nextOffset = offset + limit;
  if (nextOffset < total) {
    response.nextCursor = encodeCursor(nextOffset);
  }

  return successResponse(JSON.stringify(response, null, 2));
}

function groupExactTermMatches(entries: MarkdownEntry[]): Map<string, MarkdownEntry[]> {
  const groups = new Map<string, MarkdownEntry[]>();
  for (const entry of entries) {
    if (!entry.term) continue;
    const normalized = entry.term.toLowerCase();
    const existing = groups.get(normalized);
    if (existing) {
      existing.push(entry);
    } else {
      groups.set(normalized, [entry]);
    }
  }
  return groups;
}

function buildConflictTermMap(entries: MarkdownEntry[]): Map<string, string> {
  const conflictTerms = new Map<string, string>();
  for (const group of groupExactTermMatches(entries).values()) {
    const resolution = resolveTeamKnowledgeMatches(group);
    if (resolution.status !== 'conflict') continue;

    for (const entry of group) {
      conflictTerms.set(entryKey(entry), resolution.conflictReason ?? 'unresolved_conflict');
    }
  }
  return conflictTerms;
}

function entryKey(entry: MarkdownEntry): string {
  return [
    entry.sourceDocId ?? '',
    entry.metadata.id ?? '',
    entry.kind,
    entry.term ?? '',
    entry.canonical ?? '',
    entry.content,
  ].join('\u0000');
}
