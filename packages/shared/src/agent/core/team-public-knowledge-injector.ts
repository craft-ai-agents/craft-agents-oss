import { loadWorkspaceConfig } from '../../workspaces/storage.ts';
import {
  loadTeamPublicKnowledgeCache,
  type TeamPublicKnowledgeCacheEntry,
} from '../../team-public-knowledge/index.ts';
import { parseMarkdownEntries, type MarkdownEntry, type MarkdownEntryKind } from '../../markdown-entry-parser/index.ts';

const TRIGGER_KINDS: readonly MarkdownEntryKind[] = ['alias', 'slang', 'concept'];
const MAX_TRIGGER_TERMS = 5;
const MAX_PREFETCH = 3;

export interface PrefetchEntry {
  kind: MarkdownEntryKind;
  summary: string;
  confidence: number;
  relevance: string;
  source: string;
  updatedAt: number;
}

export interface TriggerTermEntry {
  term: string;
  kind: MarkdownEntryKind;
  priority: number;
}

/**
 * Formats a compact team public knowledge policy block with top 5 trigger terms.
 * Returns null when team public knowledge is disabled or no trigger terms exist.
 */
export function formatTeamKnowledgePolicy(workspaceRoot: string): string | null {
  const config = loadWorkspaceConfig(workspaceRoot);
  if (!config?.teamPublicKnowledge?.enabled) return null;

  const cache = loadTeamPublicKnowledgeCache(workspaceRoot);
  const entries = Object.values(cache.entries);
  if (entries.length === 0) return null;

  const allParsed = parseAllFilteredEntries(entries);
  const triggerTerms = collectTopTriggerTerms(allParsed);

  if (triggerTerms.length === 0) return null;

  const termLines = triggerTerms.map(
    (t, i) => `${i + 1}. "${t.term}" (${t.kind})`,
  );

  return `<team_public_knowledge>
<policy>
This workspace maintains team public knowledge documents covering project terminology, slang, and concepts. When your message references one of the trigger terms listed below, relevant reference data is appended.
</policy>
<trigger_terms>
${termLines.join('\n')}
</trigger_terms>
</team_public_knowledge>`;
}

/**
 * Scans the user message for exact matches against the full normalized term index.
 * Returns at most 3 prefetch entries with metadata for matched terms.
 */
export function prefetchTeamKnowledge(
  workspaceRoot: string,
  userMessage: string,
): PrefetchEntry[] {
  if (!userMessage || userMessage.trim().length === 0) return [];

  const config = loadWorkspaceConfig(workspaceRoot);
  if (!config?.teamPublicKnowledge?.enabled) return [];

  const cache = loadTeamPublicKnowledgeCache(workspaceRoot);
  const entries = Object.values(cache.entries);
  if (entries.length === 0) return [];

  const allParsed = parseAllFilteredEntries(entries);
  const termIndex = buildNormalizedTermIndex(allParsed);

  return scanMessageForMatches(userMessage, termIndex);
}

/**
 * Formats prefetch results as a reference data block.
 * Returns null when results are empty.
 */
export function formatPrefetchBlock(results: PrefetchEntry[]): string | null {
  if (results.length === 0) return null;

  const entryBlocks = results.map((r) => {
    return `<entry kind="${r.kind}" confidence="${r.confidence}" relevance="${r.relevance}" source="${escapeXml(r.source)}" updatedAt="${r.updatedAt}">
<summary>${escapeXml(r.summary)}</summary>
</entry>`;
  });

  return `<reference_data>
${entryBlocks.join('\n')}
</reference_data>`;
}

// ── Internal helpers ────────────────────────────────────────────

function parseAllFilteredEntries(entries: TeamPublicKnowledgeCacheEntry[]): MarkdownEntry[] {
  const result: MarkdownEntry[] = [];
  for (const entry of entries) {
    if (entry.stale) continue;
    const parsed = parseMarkdownEntries(entry.content, {
      sourceDocId: entry.id,
      sourceTitle: entry.title,
      priority: entry.priority,
      updatedAt: entry.updatedAt,
    });
    result.push(...parsed);
  }
  return result;
}

function collectTopTriggerTerms(parsed: MarkdownEntry[]): TriggerTermEntry[] {
  return parsed
    .filter((e) => TRIGGER_KINDS.includes(e.kind) && e.term && e.term.trim().length > 0)
    .map((e) => ({
      term: e.term!,
      kind: e.kind,
      priority: e.priority ?? 100,
    }))
    .filter((t, index, self) => self.findIndex((s) => s.term === t.term) === index)
    .sort((a, b) => a.priority - b.priority)
    .slice(0, MAX_TRIGGER_TERMS);
}

interface TermIndexEntry {
  normalizedTerm: string;
  kind: MarkdownEntryKind;
  summary: string;
  source: string;
  updatedAt: number;
}

function buildNormalizedTermIndex(parsed: MarkdownEntry[]): Map<string, TermIndexEntry[]> {
  const index = new Map<string, TermIndexEntry[]>();

  for (const entry of parsed) {
    if (!entry.term || entry.term.trim().length === 0) continue;

    const normalized = entry.term.toLowerCase().trim();
    const indexEntry: TermIndexEntry = {
      normalizedTerm: normalized,
      kind: entry.kind,
      summary: entry.summary ?? entry.content.slice(0, 200),
      source: entry.sourceTitle ?? entry.headingPath.join(' > ') ?? '',
      updatedAt: entry.updatedAt ?? 0,
    };

    const existing = index.get(normalized);
    if (existing) {
      existing.push(indexEntry);
    } else {
      index.set(normalized, [indexEntry]);
    }
  }

  return index;
}

function scanMessageForMatches(
  userMessage: string,
  termIndex: Map<string, TermIndexEntry[]>,
): PrefetchEntry[] {
  const normalizedMessage = userMessage.toLowerCase().trim();
  const results: PrefetchEntry[] = [];

  for (const [, entries] of termIndex) {
    if (results.length >= MAX_PREFETCH) break;

    for (const entry of entries) {
      if (results.length >= MAX_PREFETCH) break;

      // Check if the normalized message contains the exact normalized term
      // using word boundary or substring matching
      const confidence = computeMatchConfidence(normalizedMessage, entry.normalizedTerm);
      if (confidence <= 0) continue;

      results.push({
        kind: entry.kind,
        summary: entry.summary,
        confidence,
        relevance: confidence >= 1 ? 'exact match' : 'term match',
        source: entry.source,
        updatedAt: entry.updatedAt,
      });
    }
  }

  // Sort by confidence descending, then by updatedAt descending (newer first)
  results.sort((a, b) => b.confidence - a.confidence || b.updatedAt - a.updatedAt);

  return results.slice(0, MAX_PREFETCH);
}

function computeMatchConfidence(normalizedMessage: string, normalizedTerm: string): number {
  if (normalizedTerm.length === 0) return 0;

  // Exact match of the whole message
  if (normalizedMessage === normalizedTerm) return 1;

  // Word-boundary match: term appears as a complete word in the message
  const wordBoundary = new RegExp(`\\b${escapeRegex(normalizedTerm)}\\b`);
  if (wordBoundary.test(normalizedMessage)) return 1;

  // Substring match within the message (for multi-word terms or partials)
  if (normalizedMessage.includes(normalizedTerm)) return 0.9;

  return 0;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
