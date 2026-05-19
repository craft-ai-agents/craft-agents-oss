import type { MarkdownEntry } from '../markdown-entry-parser/index.ts';
import { TEAM_PUBLIC_KNOWLEDGE_STALE_TTL_MS, type TeamPublicKnowledgeCacheEntry } from './index.ts';

export type TeamKnowledgeStaleReason =
  | 'document_stale'
  | 'stale_ttl_expired'
  | 'valid_until_expired';

export type TeamKnowledgeResolutionStatus = 'found' | 'ambiguous' | 'conflict';

export interface TeamKnowledgeResolution {
  status: TeamKnowledgeResolutionStatus;
  winner?: MarkdownEntry;
  matches: MarkdownEntry[];
  conflictReason?: string;
}

export function getCacheEntryStaleReason(
  entry: Pick<TeamPublicKnowledgeCacheEntry, 'stale' | 'fetchedAt'>,
  now = Date.now(),
): TeamKnowledgeStaleReason | undefined {
  if (entry.stale) return 'document_stale';
  if (now - entry.fetchedAt > TEAM_PUBLIC_KNOWLEDGE_STALE_TTL_MS) return 'stale_ttl_expired';
  return undefined;
}

export function getMarkdownEntryStaleReason(
  entry: MarkdownEntry,
  staleDocIds: Set<string>,
  ttlExpiredDocIds: Set<string> = new Set(),
  now = Date.now(),
): TeamKnowledgeStaleReason | undefined {
  if (entry.sourceDocId && staleDocIds.has(entry.sourceDocId)) return 'document_stale';
  if (entry.sourceDocId && ttlExpiredDocIds.has(entry.sourceDocId)) return 'stale_ttl_expired';
  if (isValidUntilExpired(entry.metadata.validUntil, now)) return 'valid_until_expired';
  return undefined;
}

export function isEntryFreshForRuntime(
  entry: MarkdownEntry,
  staleDocIds: Set<string>,
  ttlExpiredDocIds: Set<string>,
  now = Date.now(),
): boolean {
  return getMarkdownEntryStaleReason(entry, staleDocIds, ttlExpiredDocIds, now) === undefined;
}

export function resolveTeamKnowledgeMatches(matches: MarkdownEntry[]): TeamKnowledgeResolution {
  const ordered = [...matches].sort(compareResolutionPrecedence);
  if (ordered.length === 0) {
    return { status: 'ambiguous', matches: [] };
  }
  if (ordered.length === 1) {
    return { status: 'found', winner: ordered[0], matches: ordered };
  }

  const top = ordered[0]!;
  const tiedWithTop = ordered.filter(entry => compareResolutionPrecedence(entry, top) === 0);
  if (tiedWithTop.length === 1) {
    return { status: 'found', winner: top, matches: ordered };
  }

  if (hasContradictoryExplicitEntries(tiedWithTop)) {
    return {
      status: 'conflict',
      matches: ordered,
      conflictReason: 'contradictory_explicit_entries',
    };
  }

  if (allSameFact(ordered)) {
    return { status: 'found', winner: top, matches: ordered };
  }

  return { status: 'ambiguous', matches: ordered };
}

export function compareResolutionPrecedence(a: MarkdownEntry, b: MarkdownEntry): number {
  const explicitDelta = Number(b.explicit) - Number(a.explicit);
  if (explicitDelta !== 0) return explicitDelta;

  const priorityDelta = (a.priority ?? Number.MAX_SAFE_INTEGER) - (b.priority ?? Number.MAX_SAFE_INTEGER);
  if (priorityDelta !== 0) return priorityDelta;

  const updatedAtDelta = (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
  if (updatedAtDelta !== 0) return updatedAtDelta;

  return 0;
}

function hasContradictoryExplicitEntries(entries: MarkdownEntry[]): boolean {
  const explicitEntries = entries.filter(entry => entry.explicit);
  if (explicitEntries.length < 2) return false;

  const signaturesByTermKind = new Map<string, Set<string>>();
  for (const entry of explicitEntries) {
    const key = `${entry.kind}\u0000${normalize(entry.term)}`;
    const signatures = signaturesByTermKind.get(key) ?? new Set<string>();
    signatures.add(factSignature(entry));
    if (signatures.size > 1) return true;
    signaturesByTermKind.set(key, signatures);
  }

  return false;
}

function allSameFact(entries: MarkdownEntry[]): boolean {
  const first = factSignature(entries[0]!);
  return entries.every(entry => factSignature(entry) === first);
}

function factSignature(entry: MarkdownEntry): string {
  const value = entry.canonical ?? entry.summary ?? entry.content;
  return [
    entry.kind,
    normalize(entry.term),
    normalize(value),
  ].join('\u0000');
}

function isValidUntilExpired(validUntil: string | undefined, now: number): boolean {
  if (!validUntil) return false;
  const parsed = parseValidUntil(validUntil);
  if (parsed === undefined) return false;
  return now > parsed;
}

function parseValidUntil(validUntil: string): number | undefined {
  const dateOnly = validUntil.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    return Date.UTC(
      Number(dateOnly[1]),
      Number(dateOnly[2]) - 1,
      Number(dateOnly[3]),
      23,
      59,
      59,
      999,
    );
  }

  const parsed = Date.parse(validUntil);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function normalize(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}
