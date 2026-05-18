import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWriteFileSync, readJsonFileSync } from '../utils/files.ts';
import { loadWorkspaceConfig } from '../workspaces/storage.ts';
import type { TeamPublicKnowledgeDocumentConfig } from '../workspaces/types.ts';

export const TEAM_PUBLIC_KNOWLEDGE_REFRESH_INTERVAL_MS = 30 * 60 * 1_000;
export const TEAM_PUBLIC_KNOWLEDGE_STALE_TTL_MS = 24 * 60 * 60 * 1_000;

export interface TeamPublicKnowledgeCacheEntry extends TeamPublicKnowledgeDocumentConfig {
  content: string;
  contentHash: string;
  version: number;
  fetchedAt: number;
  updatedAt: number;
  stale: boolean;
  staleAt?: number;
  lastError?: string;
}

export interface TeamPublicKnowledgeRefreshSummary {
  added: number;
  updated: number;
  removed: number;
  stale: number;
  conflicts: number;
  refreshedAt: number;
}

export interface TeamPublicKnowledgeCache {
  entries: Record<string, TeamPublicKnowledgeCacheEntry>;
  lastSummary?: TeamPublicKnowledgeRefreshSummary;
}

export interface TeamPublicKnowledgeResult {
  id: string;
  title: string;
  url: string;
  priority: number;
  content: string;
  contentHash: string;
  version: number;
  fetchedAt: number;
}

export type TeamPublicKnowledgeFetcher = (document: TeamPublicKnowledgeDocumentConfig) => Promise<string>;

export interface RefreshTeamPublicKnowledgeOptions {
  now?: number;
  fetchMarkdown?: TeamPublicKnowledgeFetcher;
}

export interface TeamPublicKnowledgeReadOptions {
  now?: number;
}

const EMPTY_CACHE: TeamPublicKnowledgeCache = { entries: {} };

export async function refreshTeamPublicKnowledge(
  workspaceRoot: string,
  options: RefreshTeamPublicKnowledgeOptions = {},
): Promise<TeamPublicKnowledgeRefreshSummary> {
  const now = options.now ?? Date.now();
  const config = loadWorkspaceConfig(workspaceRoot);
  const cache = loadTeamPublicKnowledgeCache(workspaceRoot);
  const summary: TeamPublicKnowledgeRefreshSummary = {
    added: 0,
    updated: 0,
    removed: 0,
    stale: 0,
    conflicts: 0,
    refreshedAt: now,
  };

  const knowledgeConfig = config?.teamPublicKnowledge;
  if (!knowledgeConfig?.enabled) {
    summary.removed = Object.keys(cache.entries).length;
    saveTeamPublicKnowledgeCache(workspaceRoot, { entries: {}, lastSummary: summary });
    return summary;
  }

  const fetchMarkdown = options.fetchMarkdown ?? defaultFetchMarkdown;
  const documents = dedupeDocuments(knowledgeConfig.documents, summary);
  const nextEntries: Record<string, TeamPublicKnowledgeCacheEntry> = {};
  const configuredIds = new Set(documents.map(doc => doc.id));

  for (const existingId of Object.keys(cache.entries)) {
    if (!configuredIds.has(existingId)) summary.removed += 1;
  }

  for (const document of documents) {
    const previous = cache.entries[document.id];
    try {
      const content = await fetchMarkdown(document);
      const contentHash = sha256(content);
      const version = previous
        ? previous.contentHash === contentHash
          ? previous.version
          : previous.version + 1
        : 1;

      if (!previous) {
        summary.added += 1;
      } else if (previous.contentHash !== contentHash || previous.stale) {
        summary.updated += 1;
      }

      nextEntries[document.id] = {
        ...document,
        content,
        contentHash,
        version,
        fetchedAt: now,
        updatedAt: previous?.contentHash === contentHash ? previous.updatedAt : now,
        stale: false,
      };
    } catch (error) {
      if (previous) {
        summary.stale += 1;
        nextEntries[document.id] = {
          ...previous,
          ...document,
          stale: true,
          staleAt: now,
          lastError: error instanceof Error ? error.message : String(error),
        };
      } else {
        summary.stale += 1;
      }
    }
  }

  saveTeamPublicKnowledgeCache(workspaceRoot, { entries: nextEntries, lastSummary: summary });
  return summary;
}

export function getTeamPublicKnowledgeTriggerResults(
  workspaceRoot: string,
  options: TeamPublicKnowledgeReadOptions = {},
): TeamPublicKnowledgeResult[] {
  return getFreshTeamPublicKnowledgeResults(workspaceRoot, options);
}

export function getTeamPublicKnowledgePrefetchResults(
  workspaceRoot: string,
  options: TeamPublicKnowledgeReadOptions = {},
): TeamPublicKnowledgeResult[] {
  return getFreshTeamPublicKnowledgeResults(workspaceRoot, options);
}

export function loadTeamPublicKnowledgeCache(workspaceRoot: string): TeamPublicKnowledgeCache {
  const path = getTeamPublicKnowledgeCachePath(workspaceRoot);
  if (!existsSync(path)) return { ...EMPTY_CACHE };
  try {
    const cache = readJsonFileSync<TeamPublicKnowledgeCache>(path);
    return {
      entries: cache.entries && typeof cache.entries === 'object' ? cache.entries : {},
      lastSummary: cache.lastSummary,
    };
  } catch {
    return { ...EMPTY_CACHE };
  }
}

export function getTeamPublicKnowledgeRefreshSummary(workspaceRoot: string): TeamPublicKnowledgeRefreshSummary | null {
  return loadTeamPublicKnowledgeCache(workspaceRoot).lastSummary ?? null;
}

export function getTeamPublicKnowledgeCachePath(workspaceRoot: string): string {
  return join(workspaceRoot, 'team-public-knowledge', 'cache.json');
}

function getFreshTeamPublicKnowledgeResults(
  workspaceRoot: string,
  options: TeamPublicKnowledgeReadOptions,
): TeamPublicKnowledgeResult[] {
  const now = options.now ?? Date.now();
  const cache = loadTeamPublicKnowledgeCache(workspaceRoot);
  return Object.values(cache.entries)
    .filter(entry => !entry.stale)
    .filter(entry => now - entry.fetchedAt <= TEAM_PUBLIC_KNOWLEDGE_STALE_TTL_MS)
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
    .map(entry => ({
      id: entry.id,
      title: entry.title,
      url: entry.url,
      priority: entry.priority,
      content: entry.content,
      contentHash: entry.contentHash,
      version: entry.version,
      fetchedAt: entry.fetchedAt,
    }));
}

function saveTeamPublicKnowledgeCache(workspaceRoot: string, cache: TeamPublicKnowledgeCache): void {
  const dir = join(workspaceRoot, 'team-public-knowledge');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  atomicWriteFileSync(getTeamPublicKnowledgeCachePath(workspaceRoot), JSON.stringify(cache, null, 2));
}

function dedupeDocuments(
  documents: TeamPublicKnowledgeDocumentConfig[],
  summary: TeamPublicKnowledgeRefreshSummary,
): TeamPublicKnowledgeDocumentConfig[] {
  const seen = new Set<string>();
  const deduped: TeamPublicKnowledgeDocumentConfig[] = [];
  for (const document of documents) {
    if (seen.has(document.id)) {
      summary.conflicts += 1;
      continue;
    }
    seen.add(document.id);
    deduped.push(document);
  }
  return deduped;
}

async function defaultFetchMarkdown(document: TeamPublicKnowledgeDocumentConfig): Promise<string> {
  const response = await fetch(document.url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${document.url}: HTTP ${response.status}`);
  }
  return response.text();
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export class TeamPublicKnowledgeRefreshLoop {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly workspaceRoot: string,
    private readonly options: Omit<RefreshTeamPublicKnowledgeOptions, 'now'> = {},
  ) {}

  start(): void {
    if (this.timer) return;
    void refreshTeamPublicKnowledge(this.workspaceRoot, this.options);
    this.timer = setInterval(() => {
      void refreshTeamPublicKnowledge(this.workspaceRoot, this.options);
    }, TEAM_PUBLIC_KNOWLEDGE_REFRESH_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}
