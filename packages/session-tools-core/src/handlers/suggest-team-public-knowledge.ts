import { join } from 'node:path';
import { parseMarkdownEntries, type MarkdownEntry, type MarkdownEntryKind } from '../../../shared/src/markdown-entry-parser/index.ts';
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

interface SuggestionItem {
  id: string;
  kind: MarkdownEntryKind;
  title?: string;
  summary?: string;
  excerpt: string;
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
  relevance: number;
  matchReason: string;
  safety: TeamKnowledgeSafety;
}

interface SuggestionResult {
  suggestions: SuggestionItem[];
  total: number;
}

export interface SuggestTeamPublicKnowledgeArgs {
  /** Full user message to use for message-level team knowledge suggestions. */
  message: string;
  /** Optional entry kinds to include in suggestions. */
  kinds?: MarkdownEntryKind[];
  /** Maximum suggestions to return. Defaults to 3 and is capped at 5. */
  limit?: number;
}

interface ScoredEntry {
  entry: MarkdownEntry;
  confidence: number;
  relevance: number;
  matchReason: string;
  priorityScore: number;
}

const DEFAULT_LIMIT = 3;
const MAX_LIMIT = 5;
const MIN_RELEVANCE = 0.22;
const PRIORITY_RELEVANCE_THRESHOLD = 0.32;
const PRIORITY_KINDS = new Set<MarkdownEntryKind>(['rule', 'warning']);

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'can',
  'do',
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
  'our',
  'should',
  'the',
  'this',
  'to',
  'we',
  'what',
  'when',
  'with',
]);

function loadCache(workspacePath: string, fs: SessionToolContext['fs']): TeamPublicKnowledgeCache | null {
  const cachePath = join(workspacePath, 'team-public-knowledge', 'cache.json');
  if (!fs.exists(cachePath)) return null;
  try {
    return JSON.parse(fs.readFile(cachePath)) as TeamPublicKnowledgeCache;
  } catch {
    return null;
  }
}

/** Suggests relevant team public knowledge for a full user message. */
export async function handleSuggestTeamPublicKnowledge(
  ctx: SessionToolContext,
  args: SuggestTeamPublicKnowledgeArgs,
): Promise<ToolResult> {
  const message = args.message?.trim();
  if (!message) {
    return errorResponse('suggest_team_public_knowledge requires a non-empty message parameter.');
  }

  const limit = normalizeLimit(args.limit);
  const allowedKinds = args.kinds ? new Set(args.kinds) : null;
  const cache = loadCache(ctx.workspacePath, ctx.fs);
  if (!cache || Object.keys(cache.entries).length === 0) {
    const result: SuggestionResult = { suggestions: [], total: 0 };
    return successResponse(JSON.stringify(result, null, 2));
  }

  const { entries, staleDocIds, ttlExpiredDocIds } = parseCacheEntries(cache);
  const conflictTerms = buildConflictTermMap(entries);

  const scored = entries
    .map(entry => scoreEntry(entry, message))
    .filter((score): score is ScoredEntry => score !== null)
    .filter(score => !allowedKinds || allowedKinds.has(score.entry.kind))
    .filter(score => getMarkdownEntryStaleReason(score.entry, staleDocIds, ttlExpiredDocIds) === undefined)
    .filter(score => !conflictTerms.has(entryKey(score.entry)))
    .filter(score => score.relevance >= MIN_RELEVANCE)
    .sort(compareSuggestions);

  const suggestions = scored.slice(0, limit).map(score => toSuggestionItem(score, staleDocIds, ttlExpiredDocIds, conflictTerms));
  const result: SuggestionResult = { suggestions, total: scored.length };
  return successResponse(JSON.stringify(result, null, 2));
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit)));
}

function parseCacheEntries(cache: TeamPublicKnowledgeCache): {
  entries: MarkdownEntry[];
  staleDocIds: Set<string>;
  ttlExpiredDocIds: Set<string>;
} {
  const entries: MarkdownEntry[] = [];
  const staleDocIds = new Set<string>();
  const ttlExpiredDocIds = new Set<string>();

  for (const entry of Object.values(cache.entries)) {
    const staleReason = getCacheEntryStaleReason(entry);
    if (staleReason === 'document_stale') staleDocIds.add(entry.id);
    if (staleReason === 'stale_ttl_expired') ttlExpiredDocIds.add(entry.id);
    entries.push(...parseMarkdownEntries(entry.content, {
      sourceDocId: entry.id,
      sourceTitle: entry.title,
      priority: entry.priority,
      updatedAt: entry.updatedAt,
    }));
  }

  return { entries, staleDocIds, ttlExpiredDocIds };
}

function scoreEntry(entry: MarkdownEntry, message: string): ScoredEntry | null {
  const normalizedMessage = normalizeText(message);
  const messageTokens = tokenize(message);
  if (messageTokens.size === 0) return null;

  const titleTokens = tokenize(entry.title ?? '');
  const summaryTokens = tokenize(entry.summary ?? '');
  const contentTokens = tokenize(entry.content);
  const metadataTokens = tokenize([
    entry.headingPath.join(' '),
    entry.metadata.tags?.join(' ') ?? '',
    entry.metadata.scope ?? '',
    entry.term ?? '',
    entry.canonical ?? '',
  ].join(' '));

  const weightedOverlap =
    countOverlap(messageTokens, titleTokens) * 2.2 +
    countOverlap(messageTokens, summaryTokens) * 2 +
    countOverlap(messageTokens, contentTokens) +
    countOverlap(messageTokens, metadataTokens) * 1.4;

  const relevance = weightedOverlap / Math.max(3, messageTokens.size);
  const directConfidence = computeDirectConfidence(entry, normalizedMessage);
  const confidence = Math.max(directConfidence, Math.min(0.85, 0.25 + clamp(relevance) * 0.6));
  const priorityScore = PRIORITY_KINDS.has(entry.kind) && relevance >= PRIORITY_RELEVANCE_THRESHOLD ? 0.12 : 0;

  if (relevance <= 0 && confidence <= 0) return null;

  return {
    entry,
    confidence: round(confidence),
    relevance: round(relevance),
    matchReason: buildMatchReason(entry, directConfidence, relevance),
    priorityScore,
  };
}

function computeDirectConfidence(entry: MarkdownEntry, normalizedMessage: string): number {
  const term = normalizeText(entry.term ?? '');
  if (term && hasPhrase(normalizedMessage, term)) return 1;

  const title = normalizeText(entry.title ?? '');
  if (title && hasPhrase(normalizedMessage, title)) return 0.9;

  const summary = normalizeText(entry.summary ?? '');
  if (summary && hasPhrase(normalizedMessage, summary)) return 0.85;

  return 0;
}

function buildMatchReason(entry: MarkdownEntry, directConfidence: number, relevance: number): string {
  if (directConfidence >= 1) return 'Direct term match in message';
  if (directConfidence > 0) return 'Direct title or summary match in message';
  if (PRIORITY_KINDS.has(entry.kind) && relevance >= PRIORITY_RELEVANCE_THRESHOLD) {
    return `Relevant ${entry.kind} matched message context`;
  }
  return 'Entry text matched message context';
}

function compareSuggestions(a: ScoredEntry, b: ScoredEntry): number {
  const relevanceDelta = (b.relevance + b.priorityScore) - (a.relevance + a.priorityScore);
  if (relevanceDelta !== 0) return relevanceDelta;

  const confidenceDelta = b.confidence - a.confidence;
  if (confidenceDelta !== 0) return confidenceDelta;

  return compareResolutionPrecedence(a.entry, b.entry);
}

function toSuggestionItem(
  score: ScoredEntry,
  staleDocIds: Set<string>,
  ttlExpiredDocIds: Set<string>,
  conflictTerms: Map<string, string>,
): SuggestionItem {
  const staleReason = getMarkdownEntryStaleReason(score.entry, staleDocIds, ttlExpiredDocIds);
  const conflictReason = conflictTerms.get(entryKey(score.entry));
  const safety = analyzeTeamKnowledgeEntry(score.entry);
  return {
    id: score.entry.metadata.id ?? score.entry.sourceDocId ?? '',
    kind: score.entry.kind,
    title: score.entry.title,
    summary: score.entry.summary,
    excerpt: createTeamKnowledgeExcerpt(score.entry.content),
    term: score.entry.term,
    content: score.entry.content,
    headingPath: score.entry.headingPath,
    sourceDocId: score.entry.sourceDocId,
    source: score.entry.sourceTitle ?? '',
    tags: score.entry.metadata.tags,
    scope: score.entry.metadata.scope,
    defaults: score.entry.metadata.defaults,
    validUntil: score.entry.metadata.validUntil,
    stale: staleReason !== undefined,
    staleReason,
    conflict: conflictReason !== undefined,
    conflictReason,
    confidence: score.confidence,
    relevance: score.relevance,
    matchReason: score.matchReason,
    safety,
  };
}

function tokenize(value: string): Set<string> {
  const normalized = normalizeText(value);
  const tokens = new Set<string>();

  for (const match of normalized.matchAll(/[a-z0-9]+/g)) {
    const token = stem(match[0]!);
    if (token.length >= 2 && !STOPWORDS.has(token)) tokens.add(token);
  }

  const cjkChars = [...normalized.matchAll(/[\p{Script=Han}]/gu)].map(match => match[0]);
  for (let i = 0; i < cjkChars.length - 1; i++) {
    tokens.add(`${cjkChars[i]}${cjkChars[i + 1]}`);
  }

  return tokens;
}

function countOverlap(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const token of a) {
    if (b.has(token)) count += 1;
  }
  return count;
}

function normalizeText(value: string): string {
  return value.toLowerCase().normalize('NFKC').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function stem(token: string): string {
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length > 4 && token.endsWith('es')) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith('s')) return token.slice(0, -1);
  return token;
}

function hasPhrase(normalizedMessage: string, normalizedPhrase: string): boolean {
  if (!normalizedPhrase) return false;
  return normalizedMessage === normalizedPhrase || normalizedMessage.includes(normalizedPhrase);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
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
