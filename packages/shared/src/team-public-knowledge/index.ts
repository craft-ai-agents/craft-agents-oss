import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { SsoCredentialStore } from "../auth/sso-credential-store.ts";
import { atomicWriteFileSync, readJsonFileSync } from "../utils/files.ts";
import {
  loadWorkspaceConfig,
  saveWorkspaceConfig,
} from "../workspaces/storage.ts";
import {
  DEFAULT_TEAM_PUBLIC_KNOWLEDGE_MANIFEST_PATH,
  type TeamPublicKnowledgeDocumentConfig,
  type TeamPublicKnowledgeConfig,
} from "../workspaces/types.ts";

export const TEAM_PUBLIC_KNOWLEDGE_REFRESH_INTERVAL_MS = 30 * 60 * 1_000;
export const TEAM_PUBLIC_KNOWLEDGE_STALE_TTL_MS = 24 * 60 * 60 * 1_000;
export const TEAM_PUBLIC_KNOWLEDGE_FETCH_TIMEOUT_MS = 10_000;
export const TEAM_PUBLIC_KNOWLEDGE_BASE_URL_ENV =
  "MDP_TEAM_PUBLIC_KNOWLEDGE_BASE_URL";

/**
 * Cached Markdown content and refresh metadata for a configured team knowledge document.
 */
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

/**
 * Debug/UI summary for the most recent team public knowledge refresh.
 */
export interface TeamPublicKnowledgeRefreshSummary {
  added: number;
  updated: number;
  removed: number;
  stale: number;
  conflicts: number;
  refreshedAt: number;
  manifestUpdated?: boolean;
  manifestError?: string;
}

/**
 * Workspace-local cache persisted under team-public-knowledge/cache.json.
 */
export interface TeamPublicKnowledgeCache {
  entries: Record<string, TeamPublicKnowledgeCacheEntry>;
  lastSummary?: TeamPublicKnowledgeRefreshSummary;
}

/**
 * Fresh public knowledge document content returned for trigger or prefetch use.
 */
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

/**
 * Fetches Markdown content for a configured team public knowledge document.
 */
export type TeamPublicKnowledgeFetcher = (
  document: TeamPublicKnowledgeDocumentConfig,
) => Promise<string>;
export type TeamPublicKnowledgeFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/**
 * Runtime dependencies and clock overrides for a refresh operation.
 */
export interface RefreshTeamPublicKnowledgeOptions {
  now?: number;
  fetchMarkdown?: TeamPublicKnowledgeFetcher;
  fetchFn?: TeamPublicKnowledgeFetch;
  getIdToken?: () => Promise<string | null | undefined>;
  baseUrl?: string | null;
}

/**
 * Clock override for reads that filter stale cache entries.
 */
export interface TeamPublicKnowledgeReadOptions {
  now?: number;
}

const EMPTY_CACHE: TeamPublicKnowledgeCache = { entries: {} };

/**
 * Refreshes configured team public knowledge documents and persists the workspace cache.
 */
export async function refreshTeamPublicKnowledge(
  workspaceRoot: string,
  options: RefreshTeamPublicKnowledgeOptions = {},
): Promise<TeamPublicKnowledgeRefreshSummary> {
  const now = options.now ?? Date.now();
  const config = loadWorkspaceConfig(workspaceRoot);
  const cache = loadTeamPublicKnowledgeCache(workspaceRoot);
  const summary = createRefreshSummary(now);

  const knowledgeConfig = config?.teamPublicKnowledge;
  if (!knowledgeConfig?.enabled) {
    summary.removed = Object.keys(cache.entries).length;
    saveTeamPublicKnowledgeCache(workspaceRoot, {
      entries: {},
      lastSummary: summary,
    });
    return summary;
  }

  if (!resolveBaseUrl(options.baseUrl) && !options.fetchMarkdown) {
    summary.manifestError = `${TEAM_PUBLIC_KNOWLEDGE_BASE_URL_ENV} is not configured`;
    saveTeamPublicKnowledgeCache(workspaceRoot, {
      entries: cache.entries,
      lastSummary: summary,
    });
    return summary;
  }

  let documents = knowledgeConfig.documents;
  const manifestResult = await refreshManifest(
    workspaceRoot,
    knowledgeConfig,
    summary,
    options,
  );
  if (manifestResult) {
    documents = manifestResult;
  }

  const fetchMarkdown =
    options.fetchMarkdown ??
    ((document) => defaultFetchMarkdown(document, options));
  const dedupedDocuments = dedupeDocuments(documents, summary);
  const nextEntries: Record<string, TeamPublicKnowledgeCacheEntry> = {};
  const configuredIds = new Set(dedupedDocuments.map((doc) => doc.id));

  for (const existingId of Object.keys(cache.entries)) {
    if (!configuredIds.has(existingId)) summary.removed += 1;
  }

  for (const document of dedupedDocuments) {
    const previous = cache.entries[document.id];
    try {
      const content = await fetchMarkdown(document);
      const contentHash = sha256(content);
      const version = getNextVersion(previous, contentHash);

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
        updatedAt:
          previous?.contentHash === contentHash ? previous.updatedAt : now,
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

  saveTeamPublicKnowledgeCache(workspaceRoot, {
    entries: nextEntries,
    lastSummary: summary,
  });
  return summary;
}

/**
 * Returns fresh, non-stale team public knowledge entries for trigger evaluation.
 */
export function getTeamPublicKnowledgeTriggerResults(
  workspaceRoot: string,
  options: TeamPublicKnowledgeReadOptions = {},
): TeamPublicKnowledgeResult[] {
  return getFreshTeamPublicKnowledgeResults(workspaceRoot, options);
}

/**
 * Returns fresh, non-stale team public knowledge entries for prefetch context.
 */
export function getTeamPublicKnowledgePrefetchResults(
  workspaceRoot: string,
  options: TeamPublicKnowledgeReadOptions = {},
): TeamPublicKnowledgeResult[] {
  return getFreshTeamPublicKnowledgeResults(workspaceRoot, options);
}

/**
 * Loads the workspace-local team public knowledge cache, returning an empty cache on absence or corruption.
 */
export function loadTeamPublicKnowledgeCache(
  workspaceRoot: string,
): TeamPublicKnowledgeCache {
  const path = getTeamPublicKnowledgeCachePath(workspaceRoot);
  if (!existsSync(path)) return { ...EMPTY_CACHE };
  try {
    const cache = readJsonFileSync<TeamPublicKnowledgeCache>(path);
    return {
      entries:
        cache.entries && typeof cache.entries === "object" ? cache.entries : {},
      lastSummary: cache.lastSummary,
    };
  } catch {
    return { ...EMPTY_CACHE };
  }
}

/**
 * Returns the most recent refresh summary stored in the workspace cache.
 */
export function getTeamPublicKnowledgeRefreshSummary(
  workspaceRoot: string,
): TeamPublicKnowledgeRefreshSummary | null {
  return loadTeamPublicKnowledgeCache(workspaceRoot).lastSummary ?? null;
}

/**
 * Returns the path to the workspace-local team public knowledge cache file.
 */
export function getTeamPublicKnowledgeCachePath(workspaceRoot: string): string {
  return join(workspaceRoot, "team-public-knowledge", "cache.json");
}

function getFreshTeamPublicKnowledgeResults(
  workspaceRoot: string,
  options: TeamPublicKnowledgeReadOptions,
): TeamPublicKnowledgeResult[] {
  const now = options.now ?? Date.now();
  const cache = loadTeamPublicKnowledgeCache(workspaceRoot);
  return Object.values(cache.entries)
    .filter((entry) => !entry.stale)
    .filter(
      (entry) => now - entry.fetchedAt <= TEAM_PUBLIC_KNOWLEDGE_STALE_TTL_MS,
    )
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
    .map((entry) => ({
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

function saveTeamPublicKnowledgeCache(
  workspaceRoot: string,
  cache: TeamPublicKnowledgeCache,
): void {
  const dir = join(workspaceRoot, "team-public-knowledge");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  atomicWriteFileSync(
    getTeamPublicKnowledgeCachePath(workspaceRoot),
    JSON.stringify(cache, null, 2),
  );
}

function createRefreshSummary(now: number): TeamPublicKnowledgeRefreshSummary {
  return {
    added: 0,
    updated: 0,
    removed: 0,
    stale: 0,
    conflicts: 0,
    refreshedAt: now,
  };
}

function getNextVersion(
  previous: TeamPublicKnowledgeCacheEntry | undefined,
  contentHash: string,
): number {
  if (!previous) return 1;
  if (previous.contentHash === contentHash) return previous.version;
  return previous.version + 1;
}

function dedupeDocuments(
  documents: TeamPublicKnowledgeDocumentConfig[],
  summary: TeamPublicKnowledgeRefreshSummary,
): TeamPublicKnowledgeDocumentConfig[] {
  const byId = new Map<string, TeamPublicKnowledgeDocumentConfig>();
  for (const document of documents) {
    const existing = byId.get(document.id);
    if (existing) {
      summary.conflicts += 1;
      if (document.priority < existing.priority) {
        byId.set(document.id, document);
      }
      continue;
    }
    byId.set(document.id, document);
  }
  return [...byId.values()].sort(
    (a, b) => a.priority - b.priority || a.id.localeCompare(b.id),
  );
}

async function refreshManifest(
  workspaceRoot: string,
  knowledgeConfig: TeamPublicKnowledgeConfig,
  summary: TeamPublicKnowledgeRefreshSummary,
  options: RefreshTeamPublicKnowledgeOptions,
): Promise<TeamPublicKnowledgeDocumentConfig[] | null> {
  const baseUrl = resolveBaseUrl(options.baseUrl);
  if (!baseUrl) {
    summary.manifestError = `${TEAM_PUBLIC_KNOWLEDGE_BASE_URL_ENV} is not configured`;
    return null;
  }

  const manifestPath =
    knowledgeConfig.manifestPath?.trim() ||
    DEFAULT_TEAM_PUBLIC_KNOWLEDGE_MANIFEST_PATH;
  try {
    const documents = await fetchManifestDocuments(
      baseUrl,
      manifestPath,
      options,
    );
    const normalized = dedupeDocuments(documents, summary);
    const current = dedupeDocuments(
      knowledgeConfig.documents,
      createRefreshSummary(summary.refreshedAt),
    );
    summary.manifestUpdated = !sameDocumentList(current, normalized);

    const config = loadWorkspaceConfig(workspaceRoot);
    if (config?.teamPublicKnowledge) {
      config.teamPublicKnowledge = {
        ...config.teamPublicKnowledge,
        enabled: true,
        manifestPath,
        documents: normalized,
      };
      saveWorkspaceConfig(workspaceRoot, config);
    }

    return normalized;
  } catch (error) {
    summary.manifestError =
      error instanceof Error ? error.message : String(error);
    return null;
  }
}

async function fetchManifestDocuments(
  baseUrl: string,
  manifestPath: string,
  options: Pick<RefreshTeamPublicKnowledgeOptions, "fetchFn" | "getIdToken">,
): Promise<TeamPublicKnowledgeDocumentConfig[]> {
  const url = resolveTeamPublicKnowledgeUrl(baseUrl, manifestPath);
  const fetchFn = options.fetchFn ?? fetch;
  const response = await fetchFn(url, {
    headers: await buildIdTokenHeaders(options.getIdToken ?? loadSsoIdToken),
    signal: buildTimeoutSignal(),
  });
  if (!response.ok) {
    throw new Error(
      `Failed to fetch team public knowledge manifest: HTTP ${response.status}`,
    );
  }
  const json = await response.json();
  return parseManifestDocuments(json);
}

function parseManifestDocuments(
  json: unknown,
): TeamPublicKnowledgeDocumentConfig[] {
  if (
    !json ||
    typeof json !== "object" ||
    !Array.isArray((json as { documents?: unknown }).documents)
  ) {
    throw new Error(
      "Team public knowledge manifest must contain a documents array",
    );
  }

  return (json as { documents: unknown[] }).documents.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(
        `Team public knowledge manifest document at index ${index} must be an object`,
      );
    }
    const document = item as Record<string, unknown>;
    const id = typeof document.id === "string" ? document.id.trim() : "";
    const title =
      typeof document.title === "string" ? document.title.trim() : "";
    const url = typeof document.url === "string" ? document.url.trim() : "";
    const priority = document.priority;

    if (!id)
      throw new Error(
        `Team public knowledge manifest document at index ${index} must have a non-empty id`,
      );
    if (!title)
      throw new Error(
        `Team public knowledge manifest document "${id}" must have a non-empty title`,
      );
    if (!url.startsWith("/"))
      throw new Error(
        `Team public knowledge manifest document "${id}" must use a path URL`,
      );
    if (typeof priority !== "number" || !Number.isFinite(priority)) {
      throw new Error(
        `Team public knowledge manifest document "${id}" must have a numeric priority`,
      );
    }

    return { id, title, url, priority };
  });
}

function sameDocumentList(
  a: TeamPublicKnowledgeDocumentConfig[],
  b: TeamPublicKnowledgeDocumentConfig[],
): boolean {
  if (a.length !== b.length) return false;
  return a.every((doc, index) => {
    const other = b[index];
    return (
      other &&
      doc.id === other.id &&
      doc.title === other.title &&
      doc.url === other.url &&
      doc.priority === other.priority
    );
  });
}

async function defaultFetchMarkdown(
  document: TeamPublicKnowledgeDocumentConfig,
  options: Pick<
    RefreshTeamPublicKnowledgeOptions,
    "fetchFn" | "getIdToken" | "baseUrl"
  > = {},
): Promise<string> {
  const fetchFn = options.fetchFn ?? fetch;
  const url = resolveDocumentUrl(document, options.baseUrl);
  const response = await fetchFn(url, {
    headers: await buildIdTokenHeaders(options.getIdToken ?? loadSsoIdToken),
    signal: buildTimeoutSignal(),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }
  validateMarkdownContentType(response.headers.get("content-type"), url);
  return response.text();
}

function resolveDocumentUrl(
  document: TeamPublicKnowledgeDocumentConfig,
  baseUrlOverride?: string | null,
): string {
  if (!document.url.startsWith("/")) return document.url;
  const baseUrl = resolveBaseUrl(baseUrlOverride);
  if (!baseUrl)
    throw new Error(`${TEAM_PUBLIC_KNOWLEDGE_BASE_URL_ENV} is not configured`);
  return resolveTeamPublicKnowledgeUrl(baseUrl, document.url);
}

function resolveTeamPublicKnowledgeUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

function resolveBaseUrl(baseUrlOverride?: string | null): string | null {
  const value =
    baseUrlOverride ?? process.env[TEAM_PUBLIC_KNOWLEDGE_BASE_URL_ENV];
  return value?.trim() ? value.trim() : null;
}

function validateMarkdownContentType(
  contentType: string | null,
  url: string,
): void {
  if (!contentType) return;
  const normalized = contentType.toLowerCase();
  if (
    normalized.includes("text") ||
    normalized.includes("markdown") ||
    normalized.includes("plain")
  )
    return;
  throw new Error(`Unexpected content type for ${url}: ${contentType}`);
}

function buildTimeoutSignal(): AbortSignal | undefined {
  return typeof AbortSignal !== "undefined" &&
    typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(TEAM_PUBLIC_KNOWLEDGE_FETCH_TIMEOUT_MS)
    : undefined;
}

async function buildIdTokenHeaders(
  getIdToken: () => Promise<string | null | undefined>,
): Promise<Record<string, string> | undefined> {
  const idToken = await getIdToken().catch(() => null);
  return idToken ? { Authorization: `Bearer ${idToken}` } : undefined;
}

async function loadSsoIdToken(): Promise<string | null> {
  return (await new SsoCredentialStore().load())?.idToken ?? null;
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Periodically refreshes the team public knowledge cache for a single workspace.
 */
export class TeamPublicKnowledgeRefreshLoop {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly workspaceRoot: string,
    private readonly options: Omit<
      RefreshTeamPublicKnowledgeOptions,
      "now"
    > = {},
  ) {}

  start(): void {
    if (this.timer) return;
    this.refresh();
    this.timer = setInterval(() => {
      this.refresh();
    }, TEAM_PUBLIC_KNOWLEDGE_REFRESH_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private refresh(): void {
    void refreshTeamPublicKnowledge(this.workspaceRoot, this.options).catch(
      () => {
        // Refresh failures are recorded in the cache summary when possible.
      },
    );
  }
}
