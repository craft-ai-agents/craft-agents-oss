import { join } from 'node:path';
import { parseMarkdownEntries, type MarkdownEntry } from '../../../shared/src/markdown-entry-parser/index.ts';
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

const MAX_CONTENT_LENGTH = 4000;

export interface GetTeamPublicKnowledgeEntryArgs {
  id: string;
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

function findEntryById(entries: MarkdownEntry[], id: string): MarkdownEntry | undefined {
  return entries.find(e => e.metadata.id === id);
}

function findRelatedIds(entries: MarkdownEntry[], entry: MarkdownEntry, maxRelated: number = 10): string[] {
  const related = new Set<string>();

  // Same heading path (sibling entries)
  const sameHeadingPath = entries.filter(
    e => e.metadata.id && e.metadata.id !== entry.metadata.id &&
      e.headingPath.length === entry.headingPath.length &&
      e.headingPath.every((h, i) => h === entry.headingPath[i])
  );
  for (const r of sameHeadingPath) {
    if (r.metadata.id) related.add(r.metadata.id);
    if (related.size >= maxRelated) break;
  }

  // Same source document (if not enough heading-path siblings)
  if (related.size < maxRelated && entry.sourceDocId) {
    const sameDoc = entries.filter(
      e => e.metadata.id && e.metadata.id !== entry.metadata.id &&
        e.sourceDocId === entry.sourceDocId
    );
    for (const r of sameDoc) {
      if (r.metadata.id) related.add(r.metadata.id);
      if (related.size >= maxRelated) break;
    }
  }

  // Same tags (if not enough related from above)
  const entryTags = entry.metadata.tags ?? [];
  if (related.size < maxRelated && entryTags.length > 0) {
    const sameTags = entries.filter(
      e => e.metadata.id && e.metadata.id !== entry.metadata.id &&
        (e.metadata.tags ?? []).some(t => entryTags.includes(t))
    );
    for (const r of sameTags) {
      if (r.metadata.id) related.add(r.metadata.id);
      if (related.size >= maxRelated) break;
    }
  }

  return Array.from(related);
}

export async function handleGetTeamPublicKnowledgeEntry(
  ctx: SessionToolContext,
  args: GetTeamPublicKnowledgeEntryArgs,
): Promise<ToolResult> {
  const { id } = args;

  const cache = loadCache(ctx.workspacePath, ctx.fs);
  if (!cache || Object.keys(cache.entries).length === 0) {
    return successResponse(JSON.stringify({ found: false }, null, 2));
  }

  const allEntries = parseAllEntries(cache);

  const entry = findEntryById(allEntries, id);
  if (!entry) {
    return successResponse(JSON.stringify({ found: false }, null, 2));
  }

  let content = entry.content;
  const truncated = content.length > MAX_CONTENT_LENGTH;
  if (truncated) {
    content = content.slice(0, MAX_CONTENT_LENGTH) + '\n... [truncated]';
  }

  const relatedIds = findRelatedIds(allEntries, entry);

  const result = {
    found: true,
    truncated,
    entry: {
      id: entry.metadata.id,
      kind: entry.kind,
      title: entry.title,
      summary: entry.summary,
      term: entry.term,
      canonical: entry.canonical,
      content,
      headingPath: entry.headingPath,
      source: entry.sourceTitle ?? '',
      sourceDocId: entry.sourceDocId,
      tags: entry.metadata.tags,
      scope: entry.metadata.scope,
      defaults: entry.metadata.defaults,
      validUntil: entry.metadata.validUntil,
    },
    relatedIds: relatedIds.length > 0 ? relatedIds : undefined,
  };

  return successResponse(JSON.stringify(result, null, 2));
}
