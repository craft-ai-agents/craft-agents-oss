import { join } from 'node:path';
import { parseMarkdownEntries, type MarkdownEntry } from '../../../shared/src/markdown-entry-parser/index.ts';
import {
  compareResolutionPrecedence,
  getCacheEntryStaleReason,
  getMarkdownEntryStaleReason,
  resolveTeamKnowledgeMatches,
  type TeamKnowledgeStaleReason,
} from '../../../shared/src/team-public-knowledge/entry-resolution.ts';
import {
  analyzeTeamKnowledgeEntry,
  createTeamKnowledgeExcerpt,
  type TeamKnowledgeSafety,
} from '../../../shared/src/team-public-knowledge/safety.ts';
import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse } from '../response.ts';

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

interface TermMatch {
  id: string;
  kind: string;
  term?: string;
  canonical?: string;
  title?: string;
  summary?: string;
  excerpt: string;
  content: string;
  headingPath: string[];
  sourceDocId?: string;
  sourceTitle?: string;
  tags?: string[];
  scope?: string;
  priority?: number;
  updatedAt?: number;
  explicit: boolean;
  stale: boolean;
  staleReason?: TeamKnowledgeStaleReason;
  confidence: number;
  relevance: string;
  matchReason: string;
  safety: TeamKnowledgeSafety;
}

interface ResolveResult {
  status: 'found' | 'not_found' | 'ambiguous' | 'conflict';
  match?: TermMatch;
  matches?: TermMatch[];
  suggestions?: Array<{ term: string; kind: string; sourceTitle: string; confidence: number }>;
  conflicts?: Array<{ id: string; title?: string; sourceDocId?: string; staleAt?: number; error?: string; reason: string }>;
  source?: string;
  confidence?: number;
  relevance?: string;
  matchReason?: string;
}

export interface ResolveTeamPublicTermArgs {
  term: string;
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

function parseAllEntries(cache: TeamPublicKnowledgeCache): MarkdownEntry[] {
  const allEntries: MarkdownEntry[] = [];
  for (const entry of Object.values(cache.entries)) {
    const parsed = parseMarkdownEntries(entry.content, {
      sourceDocId: entry.id,
      sourceTitle: entry.title,
      priority: entry.priority,
      updatedAt: entry.updatedAt,
    });
    allEntries.push(...parsed);
  }
  return allEntries;
}

function similarity(query: string, target: string | undefined): number {
  if (!target) return 0;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (t === q) return 1;
  if (t.includes(q)) return 0.8;
  if (q.includes(t)) return 0.6;
  const qTokens = q.split(/[\s_-]+/).filter(Boolean);
  const tTokens = t.split(/[\s_-]+/).filter(Boolean);
  if (qTokens.length > 0 && tTokens.length > 0) {
    const overlap = qTokens.filter(tok => tTokens.some(tt => tt.includes(tok) || tok.includes(tt)));
    return (overlap.length / Math.max(qTokens.length, tTokens.length)) * 0.5;
  }
  return 0;
}

function findExactTermMatches(entries: MarkdownEntry[], term: string): MarkdownEntry[] {
  return entries
    .filter(e => e.term !== undefined && e.term.toLowerCase() === term.toLowerCase())
    .sort(compareResolutionPrecedence);
}

function buildSuggestions(entries: MarkdownEntry[], term: string): Array<{ term: string; kind: string; sourceTitle: string; confidence: number }> {
  const scored = entries
    .filter(e => e.term !== undefined)
    .map(e => ({
      term: e.term!,
      kind: e.kind,
      sourceTitle: e.sourceTitle ?? '',
      confidence: similarity(term, e.term),
    }))
    .filter(s => s.confidence > 0.3)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);
  return scored;
}

function buildTermMatch(
  entry: MarkdownEntry,
  staleDocIds: Set<string> = new Set(),
  ttlExpiredDocIds: Set<string> = new Set(),
): TermMatch {
  const staleReason = getMarkdownEntryStaleReason(entry, staleDocIds, ttlExpiredDocIds);
  const safety = analyzeTeamKnowledgeEntry(entry);
  return {
    id: entry.metadata.id ?? entry.sourceDocId ?? '',
    kind: entry.kind,
    term: entry.term,
    canonical: entry.canonical,
    title: entry.title,
    summary: entry.summary,
    excerpt: createTeamKnowledgeExcerpt(entry.content),
    content: entry.content,
    headingPath: entry.headingPath,
    sourceDocId: entry.sourceDocId,
    sourceTitle: entry.sourceTitle,
    tags: entry.metadata.tags,
    scope: entry.metadata.scope,
    priority: entry.priority,
    updatedAt: entry.updatedAt,
    explicit: entry.explicit,
    stale: staleReason !== undefined,
    staleReason,
    confidence: 1,
    relevance: 'high',
    matchReason: entry.term ? 'Term matches entry term field' : 'Content match',
    safety,
  };
}

function findStaleConflicts(cache: TeamPublicKnowledgeCache): Array<{ id: string; title?: string; sourceDocId?: string; staleAt?: number; error?: string; reason: string }> {
  return Object.values(cache.entries)
    .map(e => ({ entry: e, reason: getCacheEntryStaleReason(e) }))
    .filter((item): item is { entry: TeamPublicKnowledgeCacheEntry; reason: TeamKnowledgeStaleReason } => item.reason === 'document_stale')
    .map(e => ({
      id: e.entry.id,
      title: e.entry.title,
      sourceDocId: e.entry.id,
      staleAt: e.entry.staleAt,
      error: e.entry.lastError,
      reason: e.reason,
    }));
}

export async function handleResolveTeamPublicTerm(
  ctx: SessionToolContext,
  args: ResolveTeamPublicTermArgs,
): Promise<ToolResult> {
  const { term } = args;

  const cache = loadCache(ctx.workspacePath, ctx.fs);
  if (!cache || Object.keys(cache.entries).length === 0) {
    const result: ResolveResult = { status: 'not_found' };
    return successResponse(JSON.stringify(result, null, 2));
  }

  const staleConflicts = findStaleConflicts(cache);
  const staleDocIds = new Set(staleConflicts.map(c => c.id));
  const ttlExpiredDocIds = new Set<string>();
  const hasStaleConflicts = staleConflicts.length > 0;

  const allEntries = parseAllEntries(cache);

  const exactMatches = findExactTermMatches(allEntries, term);

  const staleMatches = exactMatches.filter(e => getMarkdownEntryStaleReason(e, staleDocIds, ttlExpiredDocIds) !== undefined);
  if (staleMatches.length > 0) {
    const result: ResolveResult = {
      status: 'conflict',
      conflicts: staleConflicts,
      matches: exactMatches.map(e => buildTermMatch(e, staleDocIds, ttlExpiredDocIds)),
      match: buildTermMatch(staleMatches[0]!, staleDocIds, ttlExpiredDocIds),
      source: staleMatches[0]!.sourceTitle,
      confidence: 0.5,
      relevance: 'low',
      matchReason: 'Matched entry comes from stale document',
    };
    return successResponse(JSON.stringify(result, null, 2));
  }

  if (exactMatches.length > 0) {
    const resolution = resolveTeamKnowledgeMatches(exactMatches);
    if (resolution.status === 'conflict') {
      const result: ResolveResult = {
        status: 'conflict',
        matches: resolution.matches.map(e => buildTermMatch(e, staleDocIds, ttlExpiredDocIds)),
        conflicts: resolution.matches.map(e => ({
          id: e.metadata.id ?? e.sourceDocId ?? '',
          title: e.title,
          sourceDocId: e.sourceDocId,
          reason: resolution.conflictReason ?? 'unresolved_conflict',
        })),
      };
      return successResponse(JSON.stringify(result, null, 2));
    }

    if (resolution.status === 'found' && resolution.winner) {
      const match = buildTermMatch(resolution.winner, staleDocIds, ttlExpiredDocIds);
      const result: ResolveResult = {
        status: 'found',
        match,
        matches: resolution.matches.map(e => buildTermMatch(e, staleDocIds, ttlExpiredDocIds)),
        source: match.sourceTitle,
        confidence: match.confidence,
        relevance: match.relevance,
        matchReason: match.matchReason,
      };
      if (hasStaleConflicts) {
        result.conflicts = staleConflicts;
      }
      return successResponse(JSON.stringify(result, null, 2));
    }
    const result: ResolveResult = {
      status: 'ambiguous',
      matches: resolution.matches.map(e => buildTermMatch(e, staleDocIds, ttlExpiredDocIds)),
    };
    if (hasStaleConflicts) {
      result.conflicts = staleConflicts;
    }
    return successResponse(JSON.stringify(result, null, 2));
  }

  const suggestions = buildSuggestions(allEntries, term);

  // If there are stale entries and they're the only ones with anything related
  if (hasStaleConflicts && suggestions.length === 0) {
    const result: ResolveResult = {
      status: 'conflict',
      conflicts: staleConflicts,
    };
    return successResponse(JSON.stringify(result, null, 2));
  }

  const result: ResolveResult = {
    status: 'not_found',
    suggestions,
  };
  if (hasStaleConflicts) {
    result.conflicts = staleConflicts;
  }
  return successResponse(JSON.stringify(result, null, 2));
}
