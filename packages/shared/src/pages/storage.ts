/**
 * Page Storage
 *
 * CRUD operations for workspace-scoped pages.
 * Pages are stored at {workspaceRootPath}/pages/{pageSlug}/
 *
 * Note: All functions take `workspaceRootPath` (absolute path to workspace
 * folder), NOT a workspace slug — same contract as projects/storage.ts.
 *
 * Cross-process contract: refresh scripts own data/store.sqlite (never read
 * it from here); the host only reads data/snapshot.json, and page.json is
 * always the last file touched (the watcher's completion marker).
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'fs';
import { basename, join } from 'path';
import { createHash, randomUUID } from 'crypto';
import type {
  PageActionDescriptor,
  PageActionGrant,
  PageConfig,
  PageDataSnapshot,
  PageRefreshStatus,
  PageShareInfo,
  PageThumbnailInfo,
} from '@craft-agent/core';
import { atomicWriteFileSync, readJsonFileSync } from '../utils/files.ts';
import { generateUniqueSlug } from '../utils/slug.ts';
import { debug } from '../utils/debug.ts';
import { validatePageConfig, assertValidPageSlug, isValidPageSlug } from './validation.ts';
import type { CreatePageInput, LoadedPage } from './types.ts';

/** Filename of a page's config (also the watcher's completion marker) */
export const PAGE_CONFIG_FILENAME = 'page.json';
/** Filename of a page's self-contained HTML content */
export const PAGE_CONTENT_FILENAME = 'index.html';
/** Filename of the atomically-written cross-process data snapshot */
export const PAGE_SNAPSHOT_FILENAME = 'snapshot.json';
/** Filename of the script-private SQLite working store */
export const PAGE_STORE_FILENAME = 'store.sqlite';
/**
 * Filename of the cached preview poster. JPEG, not WebP: Electron's
 * `nativeImage` can encode JPEG/PNG natively but not WebP, and adding a WebP
 * encoder dependency isn't worth it for a tile poster.
 */
export const PAGE_THUMBNAIL_FILENAME = 'thumbnail.jpg';

/** Default grant lifetime: 30 days (grants are re-approved, never auto-renewed) */
export const DEFAULT_PAGE_GRANT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Max stored length for lastRefresh.error */
const REFRESH_ERROR_MAX_LENGTH = 2000;

// ============================================================
// Directory Utilities
// ============================================================

/**
 * Get path to workspace pages directory.
 */
export function getWorkspacePagesPath(workspaceRootPath: string): string {
  return join(workspaceRootPath, 'pages');
}

/**
 * Get path to a page folder within a workspace.
 */
export function getPagePath(workspaceRootPath: string, pageSlug: string): string {
  // Single chokepoint: every page path (config/content/data/snapshot/store/
  // thumbnail, and thus delete/read/write) derives from here, so validating the
  // slug once guarantees no on-disk path can escape {workspaceRoot}/pages/.
  assertValidPageSlug(pageSlug);
  return join(getWorkspacePagesPath(workspaceRootPath), pageSlug);
}

/**
 * Get path to a page's page.json.
 */
export function getPageConfigPath(workspaceRootPath: string, pageSlug: string): string {
  return join(getPagePath(workspaceRootPath, pageSlug), PAGE_CONFIG_FILENAME);
}

/**
 * Get path to a page's index.html content.
 */
export function getPageContentPath(workspaceRootPath: string, pageSlug: string): string {
  return join(getPagePath(workspaceRootPath, pageSlug), PAGE_CONTENT_FILENAME);
}

/**
 * Get path to a page's data directory.
 */
export function getPageDataPath(workspaceRootPath: string, pageSlug: string): string {
  return join(getPagePath(workspaceRootPath, pageSlug), 'data');
}

/**
 * Get path to a page's data/snapshot.json (cross-process data contract).
 */
export function getPageSnapshotPath(workspaceRootPath: string, pageSlug: string): string {
  return join(getPageDataPath(workspaceRootPath, pageSlug), PAGE_SNAPSHOT_FILENAME);
}

/**
 * Get path to a page's data/store.sqlite (script-private; see pages/data-store.ts).
 */
export function getPageStorePath(workspaceRootPath: string, pageSlug: string): string {
  return join(getPageDataPath(workspaceRootPath, pageSlug), PAGE_STORE_FILENAME);
}

/**
 * Get path to a page's cached preview poster (pages/{slug}/thumbnail.jpg).
 */
export function getPageThumbnailPath(workspaceRootPath: string, pageSlug: string): string {
  return join(getPagePath(workspaceRootPath, pageSlug), PAGE_THUMBNAIL_FILENAME);
}

/**
 * Ensure pages directory exists for a workspace.
 */
export function ensurePagesDir(workspaceRootPath: string): void {
  const dir = getWorkspacePagesPath(workspaceRootPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Ensure a page's data directory exists.
 */
export function ensurePageDataDir(workspaceRootPath: string, pageSlug: string): void {
  const dir = getPageDataPath(workspaceRootPath, pageSlug);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// ============================================================
// Config Operations
// ============================================================

/**
 * Load page.json.
 * Returns null if the config does not exist or fails to parse.
 */
export function loadPageConfig(
  workspaceRootPath: string,
  pageSlug: string,
): PageConfig | null {
  // Lenient read: an unsafe slug is simply "not found" (never a thrown path
  // traversal). This also keeps loadPage/GET_ONE's id-or-slug fallback working
  // — an id like `page_ab12` isn't a valid slug, so it falls through to loadPageById.
  if (!isValidPageSlug(pageSlug)) return null;
  const configPath = getPageConfigPath(workspaceRootPath, pageSlug);
  if (!existsSync(configPath)) return null;

  try {
    return readJsonFileSync<PageConfig>(configPath);
  } catch (error) {
    debug('[loadPageConfig] Failed to read page config:', pageSlug, error);
    return null;
  }
}

/**
 * Save page.json (validated, atomic write, bumps updatedAt).
 *
 * @throws Error if the config fails schema validation
 */
export function savePageConfig(workspaceRootPath: string, config: PageConfig): void {
  const storageConfig: PageConfig = {
    ...config,
    updatedAt: Date.now(),
  };

  const validation = validatePageConfig(storageConfig);
  if (!validation.valid) {
    const errorMessages = validation.errors.map((e) => `${e.path}: ${e.message}`).join(', ');
    debug('[savePageConfig] Validation failed:', errorMessages);
    throw new Error(`Invalid page config: ${errorMessages}`);
  }

  const dir = getPagePath(workspaceRootPath, config.slug);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  atomicWriteFileSync(join(dir, PAGE_CONFIG_FILENAME), JSON.stringify(storageConfig, null, 2));
}

// ============================================================
// Load Operations
// ============================================================

/**
 * Load a single page by slug.
 */
export function loadPage(
  workspaceRootPath: string,
  pageSlug: string,
): LoadedPage | null {
  const config = loadPageConfig(workspaceRootPath, pageSlug);
  if (!config) return null;

  return {
    config,
    folderPath: getPagePath(workspaceRootPath, pageSlug),
    contentPath: getPageContentPath(workspaceRootPath, pageSlug),
    dataPath: getPageDataPath(workspaceRootPath, pageSlug),
    snapshotPath: getPageSnapshotPath(workspaceRootPath, pageSlug),
    workspaceRootPath,
    workspaceId: basename(workspaceRootPath),
  };
}

/**
 * Load a page by id (scans workspace pages for a matching id).
 */
export function loadPageById(
  workspaceRootPath: string,
  pageId: string,
): LoadedPage | null {
  const pages = loadWorkspacePages(workspaceRootPath);
  return pages.find((p) => p.config.id === pageId) ?? null;
}

/**
 * Load all pages for a workspace.
 */
export function loadWorkspacePages(workspaceRootPath: string): LoadedPage[] {
  const pages: LoadedPage[] = [];
  const pagesDir = getWorkspacePagesPath(workspaceRootPath);

  if (!existsSync(pagesDir)) return pages;

  const entries = readdirSync(pagesDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const page = loadPage(workspaceRootPath, entry.name);
    if (page) pages.push(page);
  }

  return pages;
}

/**
 * Check if a page exists in a workspace.
 */
export function pageExists(workspaceRootPath: string, pageSlug: string): boolean {
  if (!isValidPageSlug(pageSlug)) return false;
  return existsSync(getPageConfigPath(workspaceRootPath, pageSlug));
}

// ============================================================
// Create / Update / Delete
// ============================================================

/**
 * Generate a URL-safe, workspace-unique page slug.
 */
export function generatePageSlug(workspaceRootPath: string, name: string): string {
  const pagesDir = getWorkspacePagesPath(workspaceRootPath);
  const existingSlugs = new Set<string>();
  if (existsSync(pagesDir)) {
    for (const entry of readdirSync(pagesDir, { withFileTypes: true })) {
      if (entry.isDirectory()) existingSlugs.add(entry.name);
    }
  }
  return generateUniqueSlug(name, existingSlugs, 'page');
}

/**
 * Create a new page in a workspace.
 */
export function createPage(
  workspaceRootPath: string,
  input: CreatePageInput,
): PageConfig {
  const slug = generatePageSlug(workspaceRootPath, input.name);
  const now = Date.now();

  let config: PageConfig = {
    schemaVersion: 1,
    id: `page_${randomUUID().slice(0, 8)}`,
    slug,
    name: input.name,
    description: input.description,
    kind: input.kind ?? 'interactive',
    projectId: input.projectId,
    refresh: input.refresh,
    createdAt: now,
    updatedAt: now,
  };

  savePageConfig(workspaceRootPath, config);
  ensurePageDataDir(workspaceRootPath, slug);

  if (input.content !== undefined) {
    config = savePageContent(workspaceRootPath, slug, input.content);
  }

  return config;
}

/**
 * Patch shape for updatePage. The optional fields additionally accept an
 * explicit `null` meaning "clear this field": `undefined` cannot cross a JSON
 * transport (the RPC layer drops it, so the key never reaches the merge) and
 * a bare missing key must keep meaning "leave unchanged".
 */
export type UpdatePagePatch = Partial<
  // The null-clearable fields are OMITTED here and re-added below — an
  // intersection would intersect their property types ((string | undefined) &
  // (string | null) = string) and silently forbid the null again.
  Omit<
    PageConfig,
    'schemaVersion' | 'id' | 'slug' | 'createdAt' | 'contentDigest' | 'lastRefresh' | 'grants' | 'share' | 'thumbnail' | 'projectId' | 'description' | 'refresh'
  >
> & {
  projectId?: string | null;
  description?: string | null;
  refresh?: PageConfig['refresh'] | null;
};

/** Patch fields where an explicit null means "clear" (see UpdatePagePatch) */
const NULL_CLEARABLE_PAGE_FIELDS = ['projectId', 'description', 'refresh'] as const;

/**
 * Update a page's config with a partial patch.
 * `id`, `slug`, and the managed fields (`contentDigest`, `lastRefresh`,
 * `grants`, `share`, `thumbnail`) cannot be changed here — use savePageContent /
 * recordPageRefresh / the grant operations / setPageShareState /
 * recordPageThumbnail instead.
 *
 * This is the single normalization point for null-clears — the pages:update
 * RPC and the update_page session tool both pass their patches through
 * verbatim, so "null clears" behaves identically from every caller.
 */
export function updatePage(
  workspaceRootPath: string,
  pageSlug: string,
  patch: UpdatePagePatch,
): PageConfig {
  const existing = loadPageConfig(workspaceRootPath, pageSlug);
  if (!existing) {
    throw new Error(`Page not found: ${pageSlug}`);
  }

  // Null → PRESENT undefined key: the spread below then overrides the existing
  // value, and the validate-on-write schema sees a valid absent optional.
  // Keys not in the patch stay absent and leave the field unchanged.
  const normalized = { ...patch } as Partial<PageConfig>;
  for (const field of NULL_CLEARABLE_PAGE_FIELDS) {
    if (patch[field] === null) (normalized as Record<string, unknown>)[field] = undefined;
  }

  const updated: PageConfig = {
    ...existing,
    ...normalized,
    schemaVersion: existing.schemaVersion,
    id: existing.id,
    slug: existing.slug,
    createdAt: existing.createdAt,
    contentDigest: existing.contentDigest,
    lastRefresh: existing.lastRefresh,
    grants: existing.grants,
    share: existing.share,
    thumbnail: existing.thumbnail,
    updatedAt: Date.now(),
  };

  savePageConfig(workspaceRootPath, updated);
  return updated;
}

/**
 * Delete a page (removes folder including content and data).
 * `force` rides over mid-tree races (a file vanishing between listing and
 * unlink, Windows EBUSY retries) instead of aborting half-deleted.
 */
export function deletePage(workspaceRootPath: string, pageSlug: string): void {
  const dir = getPagePath(workspaceRootPath, pageSlug);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Unbind a project from all pages that reference it (project deletion).
 * Mirrors session unbinding. Returns the number of pages touched.
 */
export function unbindProjectFromPages(workspaceRootPath: string, projectId: string): number {
  let touched = 0;
  for (const page of loadWorkspacePages(workspaceRootPath)) {
    if (page.config.projectId !== projectId) continue;
    const { projectId: _removed, ...rest } = page.config;
    savePageConfig(workspaceRootPath, rest);
    touched++;
  }
  return touched;
}

// ============================================================
// Content Operations
// ============================================================

/**
 * Compute the sha256 hex digest of page content.
 * Grants and render leases are bound to this digest.
 */
export function computePageContentDigest(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * Load a page's index.html content.
 * Returns null if the file does not exist or cannot be read.
 */
export function loadPageContent(workspaceRootPath: string, pageSlug: string): string | null {
  if (!isValidPageSlug(pageSlug)) return null;
  const contentPath = getPageContentPath(workspaceRootPath, pageSlug);
  if (!existsSync(contentPath)) return null;

  try {
    return readFileSync(contentPath, 'utf-8');
  } catch (error) {
    debug('[loadPageContent] Failed to read page content:', pageSlug, error);
    return null;
  }
}

/**
 * Save a page's index.html content (atomic) and update contentDigest.
 *
 * Existing grants stay persisted but are bound to the previous digest, so
 * they stop validating until re-approved — that is the security model, not
 * an oversight.
 */
export function savePageContent(
  workspaceRootPath: string,
  pageSlug: string,
  content: string,
): PageConfig {
  const existing = loadPageConfig(workspaceRootPath, pageSlug);
  if (!existing) {
    throw new Error(`Page not found: ${pageSlug}`);
  }

  atomicWriteFileSync(getPageContentPath(workspaceRootPath, pageSlug), content);

  const updated: PageConfig = {
    ...existing,
    contentDigest: computePageContentDigest(content),
    updatedAt: Date.now(),
  };
  savePageConfig(workspaceRootPath, updated);
  return updated;
}

// ============================================================
// Data Operations
// ============================================================

/**
 * Read a page's data/snapshot.json.
 * Returns null when missing or malformed (a refresh may not have run yet).
 */
export function readPageDataSnapshot(
  workspaceRootPath: string,
  pageSlug: string,
): PageDataSnapshot | null {
  if (!isValidPageSlug(pageSlug)) return null;
  const snapshotPath = getPageSnapshotPath(workspaceRootPath, pageSlug);
  if (!existsSync(snapshotPath)) return null;

  try {
    return readJsonFileSync<PageDataSnapshot>(snapshotPath);
  } catch (error) {
    debug('[readPageDataSnapshot] Failed to read snapshot:', pageSlug, error);
    return null;
  }
}

/**
 * Record the outcome of a refresh run on page.json.
 *
 * This is deliberately the LAST write of a refresh flow: the config watcher
 * reacts to page.json (and only page.json) with a `pages:changed` push, so
 * observers never see a half-written data/ directory as complete.
 */
export function recordPageRefresh(
  workspaceRootPath: string,
  pageSlug: string,
  status: PageRefreshStatus,
): PageConfig {
  const existing = loadPageConfig(workspaceRootPath, pageSlug);
  if (!existing) {
    throw new Error(`Page not found: ${pageSlug}`);
  }

  const updated: PageConfig = {
    ...existing,
    lastRefresh: {
      ...status,
      error: status.error?.slice(0, REFRESH_ERROR_MAX_LENGTH),
    },
    updatedAt: Date.now(),
  };
  savePageConfig(workspaceRootPath, updated);
  return updated;
}

// ============================================================
// Grant Operations
// ============================================================

export interface AddPageGrantInput {
  action: PageActionDescriptor;
  description?: string;
  /** Grant lifetime in ms (default DEFAULT_PAGE_GRANT_TTL_MS) */
  ttlMs?: number;
}

/**
 * Persist a user-approved grant on a page, bound to the current content
 * digest. Approval UX happens upstream — by the time this is called the
 * user has already consented.
 *
 * @throws Error if the page is missing or has no content yet (nothing to bind to)
 */
export function addPageGrant(
  workspaceRootPath: string,
  pageSlug: string,
  input: AddPageGrantInput,
): PageActionGrant {
  const existing = loadPageConfig(workspaceRootPath, pageSlug);
  if (!existing) {
    throw new Error(`Page not found: ${pageSlug}`);
  }
  if (!existing.contentDigest) {
    throw new Error(`Page "${pageSlug}" has no content yet, so access can't be approved. Add content to the page first.`);
  }

  const now = Date.now();
  const grant: PageActionGrant = {
    id: `grant_${randomUUID().slice(0, 8)}`,
    description: input.description,
    action: input.action,
    contentDigest: existing.contentDigest,
    createdAt: now,
    expiresAt: now + (input.ttlMs ?? DEFAULT_PAGE_GRANT_TTL_MS),
  };

  savePageConfig(workspaceRootPath, {
    ...existing,
    grants: [...(existing.grants ?? []), grant],
  });
  return grant;
}

// ============================================================
// Share State
// ============================================================

/**
 * A cached poster is fresh only when it was captured for the page's CURRENT
 * content digest. Data-only refreshes deliberately do not invalidate it (v1).
 * Single source of truth for the freshness check (RPC + capturer both use it).
 */
export function isThumbnailFresh(
  config: Pick<PageConfig, 'contentDigest' | 'thumbnail'>,
): boolean {
  return (
    config.thumbnail !== undefined &&
    config.contentDigest !== undefined &&
    config.thumbnail.digest === config.contentDigest
  );
}

/**
 * Record (or clear) a page's cached-poster pointer (the managed `thumbnail`
 * field). Written only by the thumbnail capture flow after the .jpg is on disk;
 * stamping page.json last makes the config watcher emit `pages:changed` so open
 * grids pick up the fresh poster. Pass `undefined` to clear (e.g. capture
 * failed or content removed).
 */
export function recordPageThumbnail(
  workspaceRootPath: string,
  pageSlug: string,
  thumbnail: PageThumbnailInfo | undefined,
): PageConfig {
  const existing = loadPageConfig(workspaceRootPath, pageSlug);
  if (!existing) {
    throw new Error(`Page not found: ${pageSlug}`);
  }

  const { thumbnail: _previous, ...rest } = existing;
  const updated: PageConfig = {
    ...rest,
    ...(thumbnail ? { thumbnail } : {}),
    updatedAt: Date.now(),
  };
  savePageConfig(workspaceRootPath, updated);
  return updated;
}

/**
 * Set or clear a page's publication pointer (the managed `share` field).
 *
 * Written only by the publish/unpublish flow — the remote Cloudflare record
 * stays authoritative and the admin token never passes through here.
 */
export function setPageShareState(
  workspaceRootPath: string,
  pageSlug: string,
  share: PageShareInfo | undefined,
): PageConfig {
  const existing = loadPageConfig(workspaceRootPath, pageSlug);
  if (!existing) {
    throw new Error(`Page not found: ${pageSlug}`);
  }

  const { share: _previous, ...rest } = existing;
  const updated: PageConfig = {
    ...rest,
    ...(share ? { share } : {}),
    updatedAt: Date.now(),
  };
  savePageConfig(workspaceRootPath, updated);
  return updated;
}

/**
 * Remove a grant from a page. Returns false if the grant was not present.
 */
export function revokePageGrant(
  workspaceRootPath: string,
  pageSlug: string,
  grantId: string,
): boolean {
  const existing = loadPageConfig(workspaceRootPath, pageSlug);
  if (!existing) {
    throw new Error(`Page not found: ${pageSlug}`);
  }

  const grants = existing.grants ?? [];
  const remaining = grants.filter((g) => g.id !== grantId);
  if (remaining.length === grants.length) return false;

  savePageConfig(workspaceRootPath, { ...existing, grants: remaining });
  return true;
}
