/**
 * Source Storage
 *
 * CRUD operations for workspace-scoped sources.
 * Sources are stored at {workspaceRootPath}/sources/{sourceSlug}/
 *
 * Note: All functions take `workspaceRootPath` (absolute path to workspace folder),
 * NOT a workspace slug. The `LoadedSource.workspaceId` is derived via basename().
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, renameSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join, basename } from 'path';
import { randomUUID } from 'crypto';
import type {
  FolderSourceConfig,
  SourceGuide,
  LoadedSource,
  CreateSourceInput,
} from './types.ts';
import { validateSourceConfig } from '../config/validators.ts';
import { debug } from '../utils/debug.ts';
import { readJsonFileSync } from '../utils/files.ts';
import { getBuiltinSources, isBuiltinSource, getDocsSource } from './builtin-sources.ts';
import { expandPath, toPortablePath } from '../utils/paths.ts';
import { getWorkspaceSourcesPath } from '../workspaces/storage.ts';
import {
  validateIconValue,
  findIconFile,
  downloadIcon,
  needsIconDownload,
  isIconUrl,
} from '../utils/icon.ts';

// ============================================================
// Directory Utilities
// ============================================================

/**
 * Get path to a source folder within a workspace
 */
export function getSourcePath(workspaceRootPath: string, sourceSlug: string): string {
  return join(getWorkspaceSourcesPath(workspaceRootPath), sourceSlug);
}

/**
 * Ensure sources directory exists for a workspace
 */
export function ensureSourcesDir(workspaceRootPath: string): void {
  const dir = getWorkspaceSourcesPath(workspaceRootPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// ============================================================
// Config Operations
// ============================================================

/**
 * Load source config.json
 */
export function loadSourceConfig(
  workspaceRootPath: string,
  sourceSlug: string
): FolderSourceConfig | null {
  const configPath = join(getSourcePath(workspaceRootPath, sourceSlug), 'config.json');
  if (!existsSync(configPath)) return null;

  try {
    const config = readJsonFileSync<FolderSourceConfig>(configPath);

    // Expand path variables in local source paths for portability
    if (config.type === 'local' && config.local?.path) {
      config.local.path = expandPath(config.local.path);
    }

    return config;
  } catch {
    return null;
  }
}

/**
 * Mark a source as authenticated and connected.
 * Updates isAuthenticated, connectionStatus, and clears any connection error.
 *
 * @returns true if the source was found and updated, false otherwise
 */
export function markSourceAuthenticated(
  workspaceRootPath: string,
  sourceSlug: string
): boolean {
  const config = loadSourceConfig(workspaceRootPath, sourceSlug);
  if (!config) {
    debug(`[markSourceAuthenticated] Source ${sourceSlug} not found`);
    return false;
  }

  config.isAuthenticated = true;
  config.connectionStatus = 'connected';
  config.connectionError = undefined;

  saveSourceConfig(workspaceRootPath, config);
  debug(`[markSourceAuthenticated] Marked ${sourceSlug} as authenticated`);
  return true;
}

/**
 * Save source config.json
 * @throws Error if config is invalid
 */
export function saveSourceConfig(
  workspaceRootPath: string,
  config: FolderSourceConfig
): void {
  // Validate config before writing
  const validation = validateSourceConfig(config);
  if (!validation.valid) {
    const errorMessages = validation.errors.map((e) => `${e.path}: ${e.message}`).join(', ');
    debug('[saveSourceConfig] Validation failed:', errorMessages);
    throw new Error(`Invalid source config: ${errorMessages}`);
  }

  const dir = getSourcePath(workspaceRootPath, config.slug);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Convert local source paths to portable form
  const storageConfig: FolderSourceConfig = { ...config, updatedAt: Date.now() };
  if (storageConfig.type === 'local' && storageConfig.local?.path) {
    storageConfig.local = {
      ...storageConfig.local,
      path: toPortablePath(storageConfig.local.path),
    };
  }

  writeFileSync(join(dir, 'config.json'), JSON.stringify(storageConfig, null, 2));
}

// ============================================================
// Guide Operations
// ============================================================

/**
 * Parse guide markdown.
 * Extracts sections (Scope, Guidelines, Context, API Notes) and Cache (JSON in code block).
 */
function parseGuideMarkdown(raw: string): SourceGuide {
  const guide: SourceGuide = { raw };

  // Extract sections by headers (including Cache)
  const sectionRegex = /^## (Scope|Guidelines|Context|API Notes|Cache)\n([\s\S]*?)(?=\n## |\Z)/gim;
  let match;
  while ((match = sectionRegex.exec(raw)) !== null) {
    const sectionName = (match[1] ?? '').toLowerCase().replace(/\s+/g, '');
    const content = (match[2] ?? '').trim();

    switch (sectionName) {
      case 'scope':
        guide.scope = content;
        break;
      case 'guidelines':
        guide.guidelines = content;
        break;
      case 'context':
        guide.context = content;
        break;
      case 'apinotes':
        guide.apiNotes = content;
        break;
      case 'cache':
        // Parse JSON from code block: ```json ... ```
        const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/);
        if (jsonMatch && jsonMatch[1]) {
          try {
            guide.cache = JSON.parse(jsonMatch[1]);
          } catch {
            // Invalid JSON, ignore
          }
        }
        break;
    }
  }

  return guide;
}

/**
 * Load and parse guide.md with frontmatter cache
 */
export function loadSourceGuide(workspaceRootPath: string, sourceSlug: string): SourceGuide | null {
  const guidePath = join(getSourcePath(workspaceRootPath, sourceSlug), 'guide.md');
  if (!existsSync(guidePath)) return null;

  try {
    const raw = readFileSync(guidePath, 'utf-8');
    return parseGuideMarkdown(raw);
  } catch {
    return null;
  }
}

/**
 * Extract a short tagline from guide.md content
 * Looks for the first non-empty paragraph after the title, or falls back to scope section
 * @returns Tagline string (max 100 chars) or null if not found
 */
export function extractTagline(guide: SourceGuide | null): string | null {
  if (!guide?.raw) return null;

  const content = guide.raw;

  // Try to get first paragraph after the title (# Title)
  // Match: # Title\n\n<first paragraph>
  const titleMatch = content.match(/^#[^\n]+\n+([^\n#][^\n]*)/);
  if (titleMatch?.[1]?.trim()) {
    const tagline = titleMatch[1].trim();
    // Skip if it looks like a section or placeholder
    if (!tagline.startsWith('##') && !tagline.startsWith('(')) {
      return tagline.slice(0, 100);
    }
  }

  // Fallback to first line of scope section
  if (guide.scope) {
    const firstLine = guide.scope.split('\n')[0]?.trim();
    if (firstLine && !firstLine.startsWith('(')) {
      return firstLine.slice(0, 100);
    }
  }

  return null;
}

/**
 * Save guide.md
 */
export function saveSourceGuide(
  workspaceRootPath: string,
  sourceSlug: string,
  guide: SourceGuide
): void {
  const dir = getSourcePath(workspaceRootPath, sourceSlug);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(join(dir, 'guide.md'), guide.raw);
}

// ============================================================
// Icon Operations (uses shared utilities from utils/icon.ts)
// ============================================================

/**
 * Find icon file for a source
 * Returns absolute path to icon file or undefined
 */
export function findSourceIcon(workspaceRootPath: string, sourceSlug: string): string | undefined {
  return findIconFile(getSourcePath(workspaceRootPath, sourceSlug));
}

/**
 * Download an icon from a URL and save it to the source directory.
 * Returns the path to the downloaded icon, or null on failure.
 */
export async function downloadSourceIcon(
  workspaceRootPath: string,
  sourceSlug: string,
  iconUrl: string
): Promise<string | null> {
  const sourceDir = getSourcePath(workspaceRootPath, sourceSlug);
  return downloadIcon(sourceDir, iconUrl, 'Sources');
}

/**
 * Check if a source needs its icon downloaded.
 * Returns true if config has a URL icon and no local icon file exists.
 */
export function sourceNeedsIconDownload(
  workspaceRootPath: string,
  sourceSlug: string,
  config: FolderSourceConfig
): boolean {
  const iconPath = findSourceIcon(workspaceRootPath, sourceSlug);
  return needsIconDownload(config.icon, iconPath);
}

// Re-export icon utilities for convenience
export { isIconUrl } from '../utils/icon.ts';

// ============================================================
// Load Operations
// ============================================================

/**
 * Load complete source with all files
 * @param workspaceRootPath - Absolute path to workspace folder (e.g., ~/.craft-agent/workspaces/xxx)
 * @param sourceSlug - Source folder name
 */
export function loadSource(workspaceRootPath: string, sourceSlug: string): LoadedSource | null {
  const folderPath = getSourcePath(workspaceRootPath, sourceSlug);
  const config = loadSourceConfig(workspaceRootPath, sourceSlug);
  if (!config) return null;

  // Extract workspace folder name for credential lookup
  // Credentials are keyed by folder name (e.g., "046a02d0-..."), not full path
  const workspaceId = basename(workspaceRootPath);

  // Pre-compute icon path for renderer (avoids fs access in browser)
  const iconPath = findIconFile(folderPath);

  return {
    config,
    guide: loadSourceGuide(workspaceRootPath, sourceSlug),
    folderPath,
    workspaceRootPath,
    workspaceId,
    iconPath,
    tier: 'workspace',
  };
}

/**
 * Load all sources for a workspace
 */
export function loadWorkspaceSources(workspaceRootPath: string): LoadedSource[] {
  ensureSourcesDir(workspaceRootPath);

  const sources: LoadedSource[] = [];
  const sourcesDir = getWorkspaceSourcesPath(workspaceRootPath);

  if (!existsSync(sourcesDir)) return sources;

  const entries = readdirSync(sourcesDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const source = loadSource(workspaceRootPath, entry.name);
      if (source) {
        sources.push(source);
      }
    }
  }

  return sources;
}

/**
 * Get enabled sources for a workspace
 */
export function getEnabledSources(workspaceRootPath: string): LoadedSource[] {
  return loadWorkspaceSources(workspaceRootPath).filter((s) => s.config.enabled);
}

/**
 * Check if a source is ready for use (enabled and authenticated).
 * Sources with authType: 'none' or undefined are considered authenticated.
 *
 * Use this instead of inline `s.config.enabled && s.config.isAuthenticated` checks
 * to ensure consistent handling of no-auth sources.
 */
export function isSourceUsable(source: LoadedSource): boolean {
  if (!source.config.enabled) return false;

  // Get auth type from MCP or API config
  const authType = source.config.mcp?.authType || source.config.api?.authType;

  // Sources with no auth requirement are always usable when enabled
  if (authType === 'none' || authType === undefined) return true;

  // Sources requiring auth must be authenticated
  return source.config.isAuthenticated === true;
}

/**
 * Get sources by slugs for a workspace.
 * Includes both user-configured sources from disk and builtin sources
 * (like craft-agents-docs) that don't have filesystem folders.
 */
export function getSourcesBySlugs(workspaceRootPath: string, slugs: string[]): LoadedSource[] {
  const workspaceId = basename(workspaceRootPath);
  const sources: LoadedSource[] = [];
  for (const slug of slugs) {
    // Check builtin sources first (they don't exist on disk)
    if (isBuiltinSource(slug)) {
      // Currently only craft-agents-docs is a builtin source
      if (slug === 'craft-agents-docs') {
        sources.push({ ...getDocsSource(workspaceId, workspaceRootPath), tier: 'project' });
      }
      continue;
    }
    // Load user-configured source from disk
    const source = loadSource(workspaceRootPath, slug);
    if (source) {
      sources.push(source);
    }
  }
  return sources;
}

/**
 * Options for loadAllSources.
 */
export interface LoadAllSourcesOptions {
  /**
   * When true, include globals not activated in this workspace as
   * `tier: 'global-dormant'`. UI listings only — never spawned.
   */
  includeDormant?: boolean;
}

/**
 * Load all sources visible to a workspace. Unions, in priority order:
 *   1. workspace-tier sources (`tier: 'workspace'`)
 *   2. activated globals from `<workspace>/sources/.global-sources.json` (`tier: 'global'`)
 *   3. project/built-in sources (`tier: 'project'`)
 *   4. dormant globals (only when `opts.includeDormant === true`; `tier: 'global-dormant'`)
 *
 * Dedup by slug — first match wins.
 */
export function loadAllSources(
  workspaceRootPath: string,
  opts: LoadAllSourcesOptions = {}
): LoadedSource[] {
  const workspaceId = basename(workspaceRootPath);
  const seen = new Set<string>();
  const result: LoadedSource[] = [];

  for (const s of loadWorkspaceSources(workspaceRootPath)) {
    if (seen.has(s.config.slug)) continue;
    seen.add(s.config.slug);
    result.push(s);
  }

  const manifest = readGlobalSourcesManifest(workspaceRootPath);
  for (const slug of manifest.activatedSlugs) {
    if (seen.has(slug)) continue;
    const g = loadGlobalSource(slug);
    if (!g) {
      debug(`[loadAllSources] activated global '${slug}' not found in ${GLOBAL_AGENT_SOURCES_DIR}`);
      continue;
    }
    seen.add(slug);
    result.push(g);
  }

  for (const b of getBuiltinSources(workspaceId, workspaceRootPath)) {
    if (seen.has(b.config.slug)) continue;
    seen.add(b.config.slug);
    result.push({ ...b, tier: 'project' });
  }

  if (opts.includeDormant) {
    for (const slug of listGlobalSourceSlugs()) {
      if (seen.has(slug)) continue;
      const g = loadGlobalSource(slug);
      if (!g) continue;
      seen.add(slug);
      result.push({ ...g, tier: 'global-dormant' });
    }
  }

  return result;
}

// ============================================================
// Global Tier
// ============================================================

/** Sentinel workspace id for global-tier sources. Used by credential keying in Phase 3. */
export const GLOBAL_WORKSPACE_ID = '__global__';

/** Global agent sources directory: ~/.agents/sources/ */
export const GLOBAL_AGENT_SOURCES_DIR = join(homedir(), '.agents', 'sources');

/** Filename of the per-workspace activation manifest. */
export const WORKSPACE_GLOBAL_SOURCES_MANIFEST = '.global-sources.json';

/** Current schema version for the activation manifest. */
const GLOBAL_SOURCES_MANIFEST_VERSION = 1;

/**
 * Activation manifest schema — see docs/global-sources/01-spec.md.
 */
export interface GlobalSourcesManifest {
  version: number;
  activatedSlugs: string[];
  lastModified: string;
}

/** Path to a global source's directory. */
export function getGlobalSourcePath(slug: string): string {
  return join(GLOBAL_AGENT_SOURCES_DIR, slug);
}

/** Path to the activation manifest for a workspace. */
export function getWorkspaceGlobalSourcesManifestPath(workspaceRootPath: string): string {
  return join(getWorkspaceSourcesPath(workspaceRootPath), WORKSPACE_GLOBAL_SOURCES_MANIFEST);
}

function emptyManifest(): GlobalSourcesManifest {
  return {
    version: GLOBAL_SOURCES_MANIFEST_VERSION,
    activatedSlugs: [],
    lastModified: new Date().toISOString(),
  };
}

/**
 * Read the activation manifest for a workspace.
 * - Missing file → empty manifest, no error.
 * - Malformed JSON → log error, back up to .global-sources.json.broken-<ts>, return empty.
 * - Unknown slug entries are tolerated; duplicates deduped.
 */
export function readGlobalSourcesManifest(workspaceRootPath: string): GlobalSourcesManifest {
  const path = getWorkspaceGlobalSourcesManifestPath(workspaceRootPath);
  if (!existsSync(path)) return emptyManifest();

  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (err) {
    debug(`[readGlobalSourcesManifest] read failed: ${(err as Error).message}`);
    return emptyManifest();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    debug(`[readGlobalSourcesManifest] malformed JSON at ${path}: ${(err as Error).message}`);
    try {
      const backup = `${path}.broken-${Date.now()}`;
      renameSync(path, backup);
      debug(`[readGlobalSourcesManifest] backed up to ${backup}`);
    } catch {
      // best-effort
    }
    return emptyManifest();
  }

  const obj = (parsed && typeof parsed === 'object') ? parsed as Record<string, unknown> : {};
  const rawSlugs = Array.isArray(obj.activatedSlugs) ? obj.activatedSlugs : [];
  const activatedSlugs = Array.from(new Set(
    rawSlugs.filter((s): s is string => typeof s === 'string' && s.length > 0)
  ));
  const version = typeof obj.version === 'number' ? obj.version : GLOBAL_SOURCES_MANIFEST_VERSION;
  const lastModified = typeof obj.lastModified === 'string'
    ? obj.lastModified
    : new Date().toISOString();

  return { version, activatedSlugs, lastModified };
}

/** Whether `slug` is listed in the workspace's activation manifest. */
export function isGlobalSourceActivatedInWorkspace(workspaceRootPath: string, slug: string): boolean {
  return readGlobalSourcesManifest(workspaceRootPath).activatedSlugs.includes(slug);
}

// NOTE: write-path helpers (`activateGlobalSourceInWorkspace`,
// `deactivateGlobalSourceInWorkspace`, `writeGlobalSourcesManifest`,
// `mirrorSourceToGlobal`) ship in Phase 2 alongside the RPC handlers.

/**
 * Load a single global source by slug from `~/.agents/sources/<slug>/`.
 * Returns null when the slug doesn't resolve. The returned source has
 * `tier: 'global'` and `workspaceId: GLOBAL_WORKSPACE_ID`; callers
 * (`loadAllSources`) may re-tag as `'global-dormant'` based on workspace context.
 */
export function loadGlobalSource(slug: string): LoadedSource | null {
  const folderPath = getGlobalSourcePath(slug);
  const configPath = join(folderPath, 'config.json');
  if (!existsSync(configPath)) return null;

  let config: FolderSourceConfig;
  try {
    config = readJsonFileSync<FolderSourceConfig>(configPath);
  } catch (err) {
    debug(`[loadGlobalSource] failed to parse ${configPath}: ${(err as Error).message}`);
    return null;
  }

  if (config.type === 'local' && config.local?.path) {
    config.local.path = expandPath(config.local.path);
  }

  let guide: SourceGuide | null = null;
  const guidePath = join(folderPath, 'guide.md');
  if (existsSync(guidePath)) {
    try {
      guide = parseGuideMarkdown(readFileSync(guidePath, 'utf-8'));
    } catch {
      guide = null;
    }
  }

  return {
    config,
    guide,
    folderPath,
    workspaceRootPath: '',
    workspaceId: GLOBAL_WORKSPACE_ID,
    iconPath: findIconFile(folderPath),
    tier: 'global',
  };
}

/** Load every source defined globally. */
export function loadGlobalSources(): LoadedSource[] {
  if (!existsSync(GLOBAL_AGENT_SOURCES_DIR)) return [];
  const out: LoadedSource[] = [];
  try {
    const entries = readdirSync(GLOBAL_AGENT_SOURCES_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const s = loadGlobalSource(entry.name);
      if (s) out.push(s);
    }
  } catch (err) {
    debug(`[loadGlobalSources] readdir failed: ${(err as Error).message}`);
  }
  return out;
}

/** List slugs of global source directories (cheap; no config parse). */
export function listGlobalSourceSlugs(): string[] {
  if (!existsSync(GLOBAL_AGENT_SOURCES_DIR)) return [];
  try {
    return readdirSync(GLOBAL_AGENT_SOURCES_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(GLOBAL_AGENT_SOURCES_DIR, e.name, 'config.json')))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

// ============================================================
// Create/Delete Operations
// ============================================================

/**
 * Generate URL-safe slug from name
 */
export function generateSourceSlug(workspaceRootPath: string, name: string): string {
  let slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);

  // Ensure slug is not empty
  if (!slug) {
    slug = 'source';
  }

  // Check for existing slugs and append number if needed
  const sourcesDir = getWorkspaceSourcesPath(workspaceRootPath);
  const existingSlugs = new Set<string>();
  if (existsSync(sourcesDir)) {
    const entries = readdirSync(sourcesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        existingSlugs.add(entry.name);
      }
    }
  }

  if (!existingSlugs.has(slug)) {
    return slug;
  }

  // Find next available number
  let counter = 2;
  while (existingSlugs.has(`${slug}-${counter}`)) {
    counter++;
  }

  return `${slug}-${counter}`;
}

/**
 * Create a new source in a workspace
 */
export async function createSource(
  workspaceRootPath: string,
  input: CreateSourceInput
): Promise<FolderSourceConfig> {
  const slug = generateSourceSlug(workspaceRootPath, input.name);
  const now = Date.now();

  const config: FolderSourceConfig = {
    // ID format: {slug}_{random} for easy identification (e.g., "linear_a1b2c3d4")
    id: `${slug}_${randomUUID().slice(0, 8)}`,
    name: input.name,
    slug,
    enabled: input.enabled ?? true,
    provider: input.provider,
    type: input.type,
    createdAt: now,
    updatedAt: now,
  };

  // Add type-specific config
  switch (input.type) {
    case 'mcp':
      if (input.mcp) {
        config.mcp = input.mcp;
      }
      break;
    case 'api':
      if (input.api) {
        config.api = input.api;
      }
      break;
    case 'local':
      if (input.local) {
        config.local = input.local;
      }
      break;
  }

  // Validate and store icon (emoji or URL)
  // URL icons are downloaded on first config change via watcher
  if (input.icon) {
    const validatedIcon = validateIconValue(input.icon, 'Sources');
    if (validatedIcon) {
      config.icon = validatedIcon;
    }
  }

  // Save config first to create the directory
  saveSourceConfig(workspaceRootPath, config);

  // If icon is a URL, download it immediately
  // (watcher will also handle this, but doing it here provides immediate feedback)
  const sourcePath = getSourcePath(workspaceRootPath, slug);
  if (config.icon && isIconUrl(config.icon)) {
    const iconPath = await downloadIcon(sourcePath, config.icon, 'Sources');
    if (iconPath) {
      debug(`[createSource] Icon downloaded for ${slug}: ${iconPath}`);
    }
  } else if (!config.icon) {
    // No icon provided - try to auto-fetch from service URL
    const { deriveServiceUrl, getHighQualityLogoUrl } = await import('../utils/logo.ts');
    const { downloadIcon } = await import('../utils/icon.ts');
    const serviceUrl = deriveServiceUrl(input);
    if (serviceUrl) {
      const logoUrl = await getHighQualityLogoUrl(serviceUrl, input.provider);
      if (logoUrl) {
        const iconPath = await downloadIcon(sourcePath, logoUrl, `createSource:${slug}`);
        if (iconPath) {
          // Store the source URL for reference (not the cached path)
          config.icon = logoUrl;
          saveSourceConfig(workspaceRootPath, config);
        }
      }
    }
  }

  // Create guide.md with skeleton template
  // (bundled guides removed - agent should search craft-agents-docs MCP for service-specific guidance)
  const guideContent = `# ${input.name}

## Guidelines

(Add usage guidelines here)

## Context

(Add context about this source)
`;
  saveSourceGuide(workspaceRootPath, slug, { raw: guideContent });

  return config;
}

/**
 * Delete a source from a workspace
 */
export function deleteSource(workspaceRootPath: string, sourceSlug: string): void {
  const dir = getSourcePath(workspaceRootPath, sourceSlug);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true });
  }
}

/**
 * Check if a source exists in a workspace
 */
export function sourceExists(workspaceRootPath: string, sourceSlug: string): boolean {
  return existsSync(join(getSourcePath(workspaceRootPath, sourceSlug), 'config.json'));
}

// ============================================================
// Source Loading/Saving Helpers
// ============================================================

// Note: SourceWithContext and wrapper functions were removed in this PR.
// Use loadSourceConfig and saveSourceConfig directly instead.

// ============================================================
// Re-export parseGuideMarkdown for use in other modules
// ============================================================

export { parseGuideMarkdown };

