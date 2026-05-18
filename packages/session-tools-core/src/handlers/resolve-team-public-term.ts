/**
 * resolve_team_public_term Handler
 *
 * Resolves a term against team public knowledge entries.
 * Returns found, not_found, ambiguous, or conflict status with metadata.
 */

import { join } from 'node:path';
import { parseMarkdownEntries, type MarkdownEntry } from '../../../shared/src/markdown-entry-parser/index.ts';
import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse } from '../response.ts';

// ── Types ───────────────────────────────────────────────────────

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
  content: string;
  headingPath: string[];
  sourceDocId?: string;
  sourceTitle?: string;
  tags?: string[];
  scope?: string;
  confidence: number;
  relevance: string;
  matchReason: string;
}

interface ResolveResult {
  status: 'found' | 'not_found' | 'ambiguous' | 'conflict';
  match?: TermMatch;
  matches?: TermMatch[];
  suggestions?: Array<{ term: string; kind: string; sourceTitle: string; confidence: number }>;
  conflicts?: Array<{ id: string; title: string; staleAt: number; error: string }>;
  source?: string;
  confidence?: number;
  relevance?: string;
  matchReason?: string;
}

export interface ResolveTeamPublicTermArgs {
  term: string;
}

// ── Cache loading ───────────────────────────────────────────────

function loadCache(workspacePath: string, fs: SessionToolContext['fs']): TeamPublicKnowledgeCache | null {
  const cachePath = join(workspacePath, 'team-public-knowledge', 'cache.json');
  if (!fs.exists(cachePath)) return null;
  try {
    return JSON.parse(fs.readFile(cachePath)) as TeamPublicKnowledgeCache;
  } catch {
    return null;
  }
}

// ── Entry parsing ──────────────────────────────────────────────

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

// ── Matching logic ─────────────────────────────────────────────

/** Compute similarity between query and target (basic substring-based). */
function similarity(query: string, target: string | undefined): number {
  if (!target) return 0;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (t === q) return 1;
  if (t.includes(q)) return 0.8;
  if (q.includes(t)) return 0.6;
  // Token overlap
  const qTokens = q.split(/[\s_-]+/).filter(Boolean);
  const tTokens = t.split(/[\s_-]+/).filter(Boolean);
  if (qTokens.length > 0 && tTokens.length > 0) {
    const overlap = qTokens.filter(tok => tTokens.some(tt => tt.includes(tok) || tok.includes(tt)));
    return (overlap.length / Math.max(qTokens.length, tTokens.length)) * 0.5;
  }
  return 0;
}

function findExactTermMatches(entries: MarkdownEntry[], term: string): MarkdownEntry[] {
  return entries.filter(e => e.term !== undefined && e.term.toLowerCase() === term.toLowerCase());
}

function findContentMatches(entries: MarkdownEntry[], term: string): MarkdownEntry[] {
  return entries.filter(
    e => e.term !== undefined && (e.term.toLowerCase().includes(term.toLowerCase()) || term.toLowerCase().includes(e.term.toLowerCase()))
  );
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

function buildTermMatch(entry: MarkdownEntry): TermMatch {
  return {
    id: entry.metadata.id ?? entry.sourceDocId ?? '',
    kind: entry.kind,
    term: entry.term,
    canonical: entry.canonical,
    title: entry.title,
    summary: entry.summary,
    content: entry.content,
    headingPath: entry.headingPath,
    sourceDocId: entry.sourceDocId,
    sourceTitle: entry.sourceTitle,
    tags: entry.metadata.tags,
    scope: entry.metadata.scope,
    confidence: 1,
    relevance: 'high',
    matchReason: entry.term ? 'Term matches entry term field' : 'Content match',
  };
}

function findConflicts(cache: TeamPublicKnowledgeCache): Array<{ id: string; title: string; staleAt: number; error: string }> {
  return Object.values(cache.entries)
    .filter(e => e.stale)
    .map(e => ({
      id: e.id,
      title: e.title,
      staleAt: e.staleAt ?? 0,
      error: e.lastError ?? 'Unknown',
    }));
}

// ── Handler ─────────────────────────────────────────────────────

export async function handleResolveTeamPublicTerm(
  ctx: SessionToolContext,
  args: ResolveTeamPublicTermArgs,
): Promise<ToolResult> {
  const { term } = args;

  // Load cache
  const cache = loadCache(ctx.workspacePath, ctx.fs);
  if (!cache || Object.keys(cache.entries).length === 0) {
    const result: ResolveResult = { status: 'not_found' };
    return successResponse(JSON.stringify(result, null, 2));
  }

  // Check for stale entries (conflicts)
  const conflicts = findConflicts(cache);
  const hasConflicts = conflicts.length > 0;

  // Parse all entries
  const allEntries = parseAllEntries(cache);

  // Find exact term matches
  const exactMatches = findExactTermMatches(allEntries, term);

  // If conflicts exist and the matched term comes from a stale doc, return conflict
  if (hasConflicts && exactMatches.length > 0) {
    const staleDocIds = new Set(conflicts.map(c => c.id));
    const fromStale = exactMatches.some(e => e.sourceDocId && staleDocIds.has(e.sourceDocId));
    if (fromStale) {
      const result: ResolveResult = {
        status: 'conflict',
        conflicts,
        match: buildTermMatch(exactMatches[0]!),
        source: exactMatches[0]!.sourceTitle,
        confidence: 0.5,
        relevance: 'low',
        matchReason: 'Matched entry comes from stale document',
      };
      return successResponse(JSON.stringify(result, null, 2));
    }
  }

  if (exactMatches.length === 1) {
    const match = buildTermMatch(exactMatches[0]!);
    const result: ResolveResult = {
      status: 'found',
      match,
      source: match.sourceTitle,
      confidence: match.confidence,
      relevance: match.relevance,
      matchReason: match.matchReason,
    };
    if (hasConflicts) {
      result.conflicts = conflicts;
    }
    return successResponse(JSON.stringify(result, null, 2));
  }

  if (exactMatches.length > 1) {
    const result: ResolveResult = {
      status: 'ambiguous',
      matches: exactMatches.map(buildTermMatch),
    };
    if (hasConflicts) {
      result.conflicts = conflicts;
    }
    return successResponse(JSON.stringify(result, null, 2));
  }

  // No exact match — return not_found with suggestions
  const suggestions = buildSuggestions(allEntries, term);

  // If there are stale entries and they're the only ones with anything related
  if (hasConflicts && suggestions.length === 0) {
    const result: ResolveResult = {
      status: 'conflict',
      conflicts,
    };
    return successResponse(JSON.stringify(result, null, 2));
  }

  const result: ResolveResult = {
    status: 'not_found',
    suggestions,
  };
  if (hasConflicts) {
    result.conflicts = conflicts;
  }
  return successResponse(JSON.stringify(result, null, 2));
}
