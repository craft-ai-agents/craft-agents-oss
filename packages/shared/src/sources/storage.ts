/**
 * Source Storage
 *
 * CRUD operations for workspace-scoped sources.
 * Sources are stored at {workspaceRootPath}/sources/{sourceSlug}/
 *
 * Note: All functions take `workspaceRootPath` (absolute path to workspace folder),
 * NOT a workspace slug. The `LoadedSource.workspaceId` is derived via basename().
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'fs';
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
import { expandPath, toPortablePath } from '../utils/paths.ts';
import { getWorkspaceSourcesPath, getWorkspaceAgentsPath } from '../workspaces/storage.ts';

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
 * Get path to an agent-scoped source folder
 */
export function getAgentSourcePath(
  workspaceRootPath: string,
  agentSlug: string,
  sourceSlug: string
): string {
  return join(getWorkspaceAgentsPath(workspaceRootPath), agentSlug, 'sources', sourceSlug);
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
    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as FolderSourceConfig;

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
 * Load agent-scoped source config.json
 */
export function loadAgentSourceConfig(
  workspaceRootPath: string,
  agentSlug: string,
  sourceSlug: string
): FolderSourceConfig | null {
  const configPath = join(getAgentSourcePath(workspaceRootPath, agentSlug, sourceSlug), 'config.json');
  if (!existsSync(configPath)) return null;

  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as FolderSourceConfig;

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

/**
 * Save agent-scoped source config.json
 */
export function saveAgentSourceConfig(
  workspaceRootPath: string,
  agentSlug: string,
  config: FolderSourceConfig
): void {
  // Validate config before writing
  const validation = validateSourceConfig(config);
  if (!validation.valid) {
    const errorMessages = validation.errors.map((e) => `${e.path}: ${e.message}`).join(', ');
    debug('[saveAgentSourceConfig] Validation failed:', errorMessages);
    throw new Error(`Invalid source config: ${errorMessages}`);
  }

  const dir = getAgentSourcePath(workspaceRootPath, agentSlug, config.slug);
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
 * Load agent-scoped source guide
 */
export function loadAgentSourceGuide(
  workspaceRootPath: string,
  agentSlug: string,
  sourceSlug: string
): SourceGuide | null {
  const guidePath = join(getAgentSourcePath(workspaceRootPath, agentSlug, sourceSlug), 'guide.md');
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

/**
 * Save agent-scoped source guide.md
 */
export function saveAgentSourceGuide(
  workspaceRootPath: string,
  agentSlug: string,
  sourceSlug: string,
  guide: SourceGuide
): void {
  const dir = getAgentSourcePath(workspaceRootPath, agentSlug, sourceSlug);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(join(dir, 'guide.md'), guide.raw);
}

// ============================================================
// Icon Operations
// ============================================================

/** Icon file extensions we recognize */
const ICON_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.svg', '.webp', '.ico', '.gif'];

/**
 * Find an icon file in a directory
 * Looks for files named "icon" with common image extensions
 */
export function findIconInDir(dir: string): string | null {
  if (!existsSync(dir)) return null;

  const entries = readdirSync(dir);
  for (const ext of ICON_EXTENSIONS) {
    const iconName = `icon${ext}`;
    if (entries.includes(iconName)) {
      return join(dir, iconName);
    }
  }
  return null;
}

/**
 * Find icon file for a source
 */
export function findSourceIcon(workspaceRootPath: string, sourceSlug: string): string | null {
  return findIconInDir(getSourcePath(workspaceRootPath, sourceSlug));
}

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

  return {
    config,
    guide: loadSourceGuide(workspaceRootPath, sourceSlug),
    folderPath,
    workspaceId,
  };
}

/**
 * Load agent-scoped source
 * @param workspaceRootPath - Absolute path to workspace folder
 */
export function loadAgentSource(
  workspaceRootPath: string,
  agentSlug: string,
  sourceSlug: string
): LoadedSource | null {
  const folderPath = getAgentSourcePath(workspaceRootPath, agentSlug, sourceSlug);
  const config = loadAgentSourceConfig(workspaceRootPath, agentSlug, sourceSlug);
  if (!config) return null;

  // Extract workspace folder name for credential lookup
  const workspaceId = basename(workspaceRootPath);

  return {
    config,
    guide: loadAgentSourceGuide(workspaceRootPath, agentSlug, sourceSlug),
    folderPath,
    workspaceId,
    agentSlug,
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
 * Load all agent-scoped sources
 */
export function loadAgentSources(workspaceRootPath: string, agentSlug: string): LoadedSource[] {
  const sourcesDir = join(getWorkspaceAgentsPath(workspaceRootPath), agentSlug, 'sources');

  if (!existsSync(sourcesDir)) return [];

  const sources: LoadedSource[] = [];
  const entries = readdirSync(sourcesDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const source = loadAgentSource(workspaceRootPath, agentSlug, entry.name);
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
 * Get sources by slugs for a workspace
 */
export function getSourcesBySlugs(workspaceRootPath: string, slugs: string[]): LoadedSource[] {
  const sources: LoadedSource[] = [];
  for (const slug of slugs) {
    const source = loadSource(workspaceRootPath, slug);
    if (source) {
      sources.push(source);
    }
  }
  return sources;
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
    id: `src_${randomUUID().slice(0, 8)}`,
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

  // Save config first to create the directory
  saveSourceConfig(workspaceRootPath, config);

  // Cache icon locally
  const sourcePath = getSourcePath(workspaceRootPath, slug);
  if (input.iconUrl) {
    // User-provided URL: download and cache it
    const { cacheIcon } = await import('../utils/logo.js');
    const cached = await cacheIcon(input.iconUrl, sourcePath);
    if (cached) {
      config.iconUrl = cached;
      config.iconSourceUrl = input.iconUrl;
      saveSourceConfig(workspaceRootPath, config);
    } else {
      config.iconUrl = input.iconUrl; // Fallback to URL if download fails
    }
  } else {
    // Auto-fetch from service URL
    let serviceUrl = input.type === 'api' ? input.api?.baseUrl :
                     input.type === 'mcp' ? input.mcp?.url : null;
    // For stdio sources (no URL), try provider name as domain
    if (!serviceUrl && input.provider) {
      serviceUrl = `https://${input.provider}.com`;
    }
    if (serviceUrl) {
      const { getHighQualityLogoUrl, cacheIcon } = await import('../utils/logo.js');
      const logoUrl = await getHighQualityLogoUrl(serviceUrl, input.provider);
      if (logoUrl) {
        const cached = await cacheIcon(logoUrl, sourcePath);
        if (cached) {
          config.iconUrl = cached;
          config.iconSourceUrl = logoUrl;
          saveSourceConfig(workspaceRootPath, config);
        }
      }
    }
  }

  // Create guide.md - use bundled guide if available, otherwise skeleton
  const { getSourceGuide } = await import('../docs/source-guides.ts');
  const bundledGuide = getSourceGuide(config);

  let guideContent: string;
  if (bundledGuide) {
    // Use bundled knowledge section as starting point
    guideContent = `# ${input.name}\n\n${bundledGuide.knowledge}`;
    debug(`[createSource] Using bundled guide for ${slug}`);
  } else {
    // Fallback to skeleton
    guideContent = `# ${input.name}

## Guidelines

(Add usage guidelines here)

## Context

(Add context about this source)
`;
  }
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
// Agent-Scoped Source Operations
// ============================================================

/**
 * Generate URL-safe slug for agent-scoped source
 */
export function generateAgentSourceSlug(
  workspaceRootPath: string,
  agentSlug: string,
  name: string
): string {
  let slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);

  // Ensure slug is not empty
  if (!slug) {
    slug = 'source';
  }

  // Check for existing slugs in agent's sources folder
  const sourcesDir = join(getWorkspaceAgentsPath(workspaceRootPath), agentSlug, 'sources');
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
 * Create a new agent-scoped source
 */
export async function createAgentSource(
  workspaceRootPath: string,
  agentSlug: string,
  input: CreateSourceInput
): Promise<FolderSourceConfig> {
  const slug = generateAgentSourceSlug(workspaceRootPath, agentSlug, input.name);
  const now = Date.now();

  const config: FolderSourceConfig = {
    id: `src_${randomUUID().slice(0, 8)}`,
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

  // Save config first to create the directory
  saveAgentSourceConfig(workspaceRootPath, agentSlug, config);

  // Cache icon locally
  const sourcePath = getAgentSourcePath(workspaceRootPath, agentSlug, slug);
  if (input.iconUrl) {
    // User-provided URL: download and cache it
    const { cacheIcon } = await import('../utils/logo.js');
    const cached = await cacheIcon(input.iconUrl, sourcePath);
    if (cached) {
      config.iconUrl = cached;
      config.iconSourceUrl = input.iconUrl;
      saveAgentSourceConfig(workspaceRootPath, agentSlug, config);
    } else {
      config.iconUrl = input.iconUrl; // Fallback to URL if download fails
    }
  } else {
    // Auto-fetch from service URL
    let serviceUrl = input.type === 'api' ? input.api?.baseUrl :
                     input.type === 'mcp' ? input.mcp?.url : null;
    // For stdio sources (no URL), try provider name as domain
    if (!serviceUrl && input.provider) {
      serviceUrl = `https://${input.provider}.com`;
    }
    if (serviceUrl) {
      const { getHighQualityLogoUrl, cacheIcon } = await import('../utils/logo.js');
      const logoUrl = await getHighQualityLogoUrl(serviceUrl, input.provider);
      if (logoUrl) {
        const cached = await cacheIcon(logoUrl, sourcePath);
        if (cached) {
          config.iconUrl = cached;
          config.iconSourceUrl = logoUrl;
          saveAgentSourceConfig(workspaceRootPath, agentSlug, config);
        }
      }
    }
  }

  // Create default guide.md
  const guideContent = `# ${input.name}

## Guidelines

(Add usage guidelines here)

## Context

(Add context about this source)
`;
  saveAgentSourceGuide(workspaceRootPath, agentSlug, slug, { raw: guideContent });

  return config;
}

/**
 * Delete an agent-scoped source
 */
export function deleteAgentSource(
  workspaceRootPath: string,
  agentSlug: string,
  sourceSlug: string
): void {
  const dir = getAgentSourcePath(workspaceRootPath, agentSlug, sourceSlug);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true });
  }
}

/**
 * Check if an agent-scoped source exists
 */
export function agentSourceExists(
  workspaceRootPath: string,
  agentSlug: string,
  sourceSlug: string
): boolean {
  return existsSync(join(getAgentSourcePath(workspaceRootPath, agentSlug, sourceSlug), 'config.json'));
}

// ============================================================
// Agent-Aware Source Loading/Saving
// ============================================================

/**
 * Result of loading a source with agent context
 */
export interface SourceWithContext {
  config: FolderSourceConfig;
  /** Whether this source is agent-scoped (vs workspace-scoped) */
  isAgentScoped: boolean;
  /** Agent slug if this is an agent-scoped source */
  agentSlug?: string;
}

/**
 * Load source config, checking agent folder first (if activeAgentSlug provided), then workspace.
 * Returns null if not found in either location.
 */
export function loadSourceConfigWithFallback(
  workspaceRootPath: string,
  sourceSlug: string,
  activeAgentSlug?: string
): SourceWithContext | null {
  // If active agent context, check agent folder first
  if (activeAgentSlug) {
    const agentConfig = loadAgentSourceConfig(workspaceRootPath, activeAgentSlug, sourceSlug);
    if (agentConfig) {
      return {
        config: agentConfig,
        isAgentScoped: true,
        agentSlug: activeAgentSlug,
      };
    }
  }

  // Fall back to workspace folder
  const workspaceConfig = loadSourceConfig(workspaceRootPath, sourceSlug);
  if (workspaceConfig) {
    return {
      config: workspaceConfig,
      isAgentScoped: false,
    };
  }

  return null;
}

/**
 * Save source config back to the correct location based on context.
 */
export function saveSourceConfigWithContext(
  workspaceRootPath: string,
  config: FolderSourceConfig,
  context: { isAgentScoped: boolean; agentSlug?: string }
): void {
  if (context.isAgentScoped && context.agentSlug) {
    saveAgentSourceConfig(workspaceRootPath, context.agentSlug, config);
  } else {
    saveSourceConfig(workspaceRootPath, config);
  }
}

// ============================================================
// Re-export parseGuideMarkdown for use in agent folder storage
// ============================================================

export { parseGuideMarkdown };

// ============================================================
// Icon Migration
// ============================================================

/**
 * Migrate a source's remote iconUrl to a locally cached icon.
 * Returns true if migration was performed, false if skipped.
 */
export async function migrateSourceIcon(
  workspaceRootPath: string,
  sourceSlug: string,
  agentSlug?: string
): Promise<boolean> {
  const config = agentSlug
    ? loadAgentSourceConfig(workspaceRootPath, agentSlug, sourceSlug)
    : loadSourceConfig(workspaceRootPath, sourceSlug);

  if (!config?.iconUrl) return false;

  // Skip if already a relative path (already cached)
  if (config.iconUrl.startsWith('./')) return false;

  const sourcePath = agentSlug
    ? getAgentSourcePath(workspaceRootPath, agentSlug, sourceSlug)
    : getSourcePath(workspaceRootPath, sourceSlug);

  const { cacheIcon } = await import('../utils/logo.js');
  const cached = await cacheIcon(config.iconUrl, sourcePath);

  if (cached) {
    config.iconSourceUrl = config.iconUrl;
    config.iconUrl = cached;
    if (agentSlug) {
      saveAgentSourceConfig(workspaceRootPath, agentSlug, config);
    } else {
      saveSourceConfig(workspaceRootPath, config);
    }
    return true;
  }

  return false;
}

/**
 * Migrate all sources in a workspace to use locally cached icons.
 * Returns count of migrated sources.
 */
export async function migrateWorkspaceIcons(workspaceRootPath: string): Promise<number> {
  let migrated = 0;

  // Migrate workspace-scoped sources
  const sourcesDir = getWorkspaceSourcesPath(workspaceRootPath);
  if (existsSync(sourcesDir)) {
    for (const entry of readdirSync(sourcesDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (await migrateSourceIcon(workspaceRootPath, entry.name)) {
          migrated++;
        }
      }
    }
  }

  // Migrate agent-scoped sources
  const agentsDir = getWorkspaceAgentsPath(workspaceRootPath);
  if (existsSync(agentsDir)) {
    for (const agentEntry of readdirSync(agentsDir, { withFileTypes: true })) {
      if (agentEntry.isDirectory()) {
        const agentSourcesDir = join(agentsDir, agentEntry.name, 'sources');
        if (existsSync(agentSourcesDir)) {
          for (const sourceEntry of readdirSync(agentSourcesDir, { withFileTypes: true })) {
            if (sourceEntry.isDirectory()) {
              if (await migrateSourceIcon(workspaceRootPath, sourceEntry.name, agentEntry.name)) {
                migrated++;
              }
            }
          }
        }
      }
    }
  }

  return migrated;
}
