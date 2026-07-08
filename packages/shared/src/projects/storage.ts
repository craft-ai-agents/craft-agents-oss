/**
 * Project Storage
 *
 * CRUD operations for workspace-scoped projects.
 * Projects are stored at {workspaceRootPath}/projects/{projectSlug}/
 *
 * Note: All functions take `workspaceRootPath` (absolute path to workspace folder),
 * NOT a workspace slug. The `LoadedProject.workspaceId` is derived via basename().
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  unlinkSync,
  readFileSync,
} from 'fs';
import { basename, extname, join } from 'path';
import { randomUUID } from 'crypto';
import { atomicWriteFileSync, readJsonFileSync, getMimeType } from '../utils/files.ts';
import { debug } from '../utils/debug.ts';
import { expandPath, toPortablePath } from '../utils/paths.ts';
import { estimateTokensDensityAware } from '../utils/large-response.ts';
import type {
  ProjectConfig,
  ProjectAsset,
  LoadedProject,
  CreateProjectInput,
} from './types.ts';

// ============================================================
// Directory Utilities
// ============================================================

/**
 * Get path to workspace projects directory.
 */
export function getWorkspaceProjectsPath(workspaceRootPath: string): string {
  return join(workspaceRootPath, 'projects');
}

/**
 * Get path to a project folder within a workspace.
 */
export function getProjectPath(workspaceRootPath: string, projectSlug: string): string {
  return join(getWorkspaceProjectsPath(workspaceRootPath), projectSlug);
}

/**
 * Get path to a project's assets directory.
 */
export function getProjectAssetsPath(workspaceRootPath: string, projectSlug: string): string {
  return join(getProjectPath(workspaceRootPath, projectSlug), 'assets');
}

/** Filename of a project's agent-maintained "lessons learned" doc. */
export const MEMORY_FILENAME = 'MEMORY.md';

/**
 * Get path to a project's MEMORY.md. Deliberately a sibling of config.json
 * (outside assets/) so it never shows up in the asset manifest.
 */
export function getProjectMemoryPath(workspaceRootPath: string, projectSlug: string): string {
  return join(getProjectPath(workspaceRootPath, projectSlug), MEMORY_FILENAME);
}

/**
 * Ensure projects directory exists for a workspace.
 */
export function ensureProjectsDir(workspaceRootPath: string): void {
  const dir = getWorkspaceProjectsPath(workspaceRootPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Ensure a project's assets directory exists.
 */
export function ensureProjectAssetsDir(workspaceRootPath: string, projectSlug: string): void {
  const dir = getProjectAssetsPath(workspaceRootPath, projectSlug);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// ============================================================
// Config Operations
// ============================================================

/**
 * Load project config.json.
 * Returns null if the config does not exist or fails to parse.
 */
export function loadProjectConfig(
  workspaceRootPath: string,
  projectSlug: string,
): ProjectConfig | null {
  const configPath = join(getProjectPath(workspaceRootPath, projectSlug), 'config.json');
  if (!existsSync(configPath)) return null;

  try {
    const config = readJsonFileSync<ProjectConfig>(configPath);

    // Expand portable paths on read so consumers always see absolute paths.
    if (config.workingDirectory) {
      config.workingDirectory = expandPath(config.workingDirectory);
    }

    return config;
  } catch (error) {
    debug('[loadProjectConfig] Failed to read project config:', projectSlug, error);
    return null;
  }
}

/**
 * Save project config.json (atomic write, bumps updatedAt).
 */
export function saveProjectConfig(workspaceRootPath: string, config: ProjectConfig): void {
  const dir = getProjectPath(workspaceRootPath, config.slug);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const storageConfig: ProjectConfig = {
    ...config,
    updatedAt: Date.now(),
  };

  if (storageConfig.workingDirectory) {
    storageConfig.workingDirectory = toPortablePath(storageConfig.workingDirectory);
  }

  atomicWriteFileSync(join(dir, 'config.json'), JSON.stringify(storageConfig, null, 2));
}

// ============================================================
// Memory Operations
// ============================================================

/**
 * Load a project's MEMORY.md, capped at `maxTokens` for prompt injection.
 *
 * Returns `null` when the file is missing or effectively empty. When the
 * content exceeds the budget it is **head-truncated** (the top is kept, since
 * the agent is instructed to write newest/most-important first) and a one-line
 * marker is appended. The returned string — marker included — stays within the
 * token budget.
 */
export function loadProjectMemory(
  workspaceRootPath: string,
  projectSlug: string,
  maxTokens = 5000,
): string | null {
  const memoryPath = getProjectMemoryPath(workspaceRootPath, projectSlug);
  if (!existsSync(memoryPath)) return null;

  let content: string;
  try {
    content = readFileSync(memoryPath, 'utf-8');
  } catch (error) {
    debug('[loadProjectMemory] Failed to read MEMORY.md:', projectSlug, error);
    return null;
  }

  if (!content.trim()) return null;

  const tokens = estimateTokensDensityAware(content);
  if (tokens <= maxTokens) return content;

  // Over budget: reserve room for the marker, then head-truncate. `charsPerToken`
  // is derived from the actual content so a density-corrected estimate (base64-heavy
  // memory) still maps back to a sensible character budget.
  const marker = `\n\n…[MEMORY.md truncated at ${maxTokens}-token cap — keep it shorter]`;
  const markerTokens = estimateTokensDensityAware(marker);
  const bodyBudget = Math.max(0, maxTokens - markerTokens);
  const charsPerToken = content.length / tokens;
  const charBudget = Math.floor(bodyBudget * charsPerToken);
  const head = content.slice(0, charBudget).trimEnd();
  return `${head}${marker}`;
}

// ============================================================
// Load Operations
// ============================================================

/**
 * Load a single project by slug.
 */
export function loadProject(
  workspaceRootPath: string,
  projectSlug: string,
): LoadedProject | null {
  const config = loadProjectConfig(workspaceRootPath, projectSlug);
  if (!config) return null;

  const folderPath = getProjectPath(workspaceRootPath, projectSlug);
  const assetsPath = getProjectAssetsPath(workspaceRootPath, projectSlug);
  const workspaceId = basename(workspaceRootPath);

  return {
    config,
    folderPath,
    assetsPath,
    workspaceRootPath,
    workspaceId,
  };
}

/**
 * Load a project by id (scans workspace projects for a matching id).
 * Slugs are unique within a workspace, but callers may persist the project id
 * on a session (more stable across renames).
 */
export function loadProjectById(
  workspaceRootPath: string,
  projectId: string,
): LoadedProject | null {
  const projects = loadWorkspaceProjects(workspaceRootPath);
  return projects.find((p) => p.config.id === projectId) ?? null;
}

/**
 * Load all projects for a workspace.
 */
export function loadWorkspaceProjects(workspaceRootPath: string): LoadedProject[] {
  ensureProjectsDir(workspaceRootPath);

  const projects: LoadedProject[] = [];
  const projectsDir = getWorkspaceProjectsPath(workspaceRootPath);

  if (!existsSync(projectsDir)) return projects;

  const entries = readdirSync(projectsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const project = loadProject(workspaceRootPath, entry.name);
    if (project) projects.push(project);
  }

  return projects;
}

// ============================================================
// Create / Update / Delete
// ============================================================

/**
 * Generate a URL-safe, workspace-unique project slug.
 */
export function generateProjectSlug(workspaceRootPath: string, name: string): string {
  let slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);

  if (!slug) slug = 'project';

  const projectsDir = getWorkspaceProjectsPath(workspaceRootPath);
  const existingSlugs = new Set<string>();
  if (existsSync(projectsDir)) {
    for (const entry of readdirSync(projectsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) existingSlugs.add(entry.name);
    }
  }

  if (!existingSlugs.has(slug)) return slug;

  let counter = 2;
  while (existingSlugs.has(`${slug}-${counter}`)) counter++;
  return `${slug}-${counter}`;
}

/**
 * Create a new project in a workspace.
 */
export function createProject(
  workspaceRootPath: string,
  input: CreateProjectInput,
): ProjectConfig {
  const slug = generateProjectSlug(workspaceRootPath, input.name);
  const now = Date.now();

  const config: ProjectConfig = {
    id: `proj_${randomUUID().slice(0, 8)}`,
    slug,
    name: input.name,
    description: input.description,
    workingDirectory: input.workingDirectory,
    details: input.details,
    colorTheme: input.colorTheme,
    createdAt: now,
    updatedAt: now,
  };

  saveProjectConfig(workspaceRootPath, config);
  ensureProjectAssetsDir(workspaceRootPath, slug);

  return config;
}

/**
 * Update a project's config with a partial patch.
 * `id` and `slug` cannot be changed.
 */
export function updateProject(
  workspaceRootPath: string,
  projectSlug: string,
  patch: Partial<Omit<ProjectConfig, 'id' | 'slug' | 'createdAt'>>,
): ProjectConfig {
  const existing = loadProjectConfig(workspaceRootPath, projectSlug);
  if (!existing) {
    throw new Error(`Project not found: ${projectSlug}`);
  }

  const updated: ProjectConfig = {
    ...existing,
    ...patch,
    id: existing.id,
    slug: existing.slug,
    createdAt: existing.createdAt,
    updatedAt: Date.now(),
  };

  saveProjectConfig(workspaceRootPath, updated);
  return updated;
}

/**
 * Delete a project (removes folder and all assets).
 * Caller is responsible for unsetting `projectId` on sessions that referenced it.
 */
export function deleteProject(workspaceRootPath: string, projectSlug: string): void {
  const dir = getProjectPath(workspaceRootPath, projectSlug);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true });
  }
}

/**
 * Check if a project exists in a workspace.
 */
export function projectExists(workspaceRootPath: string, projectSlug: string): boolean {
  return existsSync(join(getProjectPath(workspaceRootPath, projectSlug), 'config.json'));
}

// ============================================================
// Asset Operations
// ============================================================

/**
 * Sanitize an upload filename so it stays inside the assets directory.
 * Strips path separators and leading dots; falls back to a uuid name if empty.
 */
export function sanitizeAssetFilename(filename: string): string {
  // Strip path separators AND control chars (NUL/newlines/DEL) so a crafted upload name can't
  // escape the assets dir or, once listed, forge new lines in the <project_assets> prompt block.
  // eslint-disable-next-line no-control-regex
  const base = basename(filename).replace(/[\\/\x00-\x1f\x7f]+/g, '').replace(/^\.+/, '');
  if (!base) return `asset_${randomUUID().slice(0, 8)}`;
  return base.slice(0, 255);
}

/**
 * List all assets for a project (sorted newest first).
 */
export function listProjectAssets(
  workspaceRootPath: string,
  projectSlug: string,
): ProjectAsset[] {
  ensureProjectAssetsDir(workspaceRootPath, projectSlug);

  const assetsDir = getProjectAssetsPath(workspaceRootPath, projectSlug);
  if (!existsSync(assetsDir)) return [];

  const assets: ProjectAsset[] = [];
  for (const entry of readdirSync(assetsDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const filePath = join(assetsDir, entry.name);
    try {
      const stats = statSync(filePath);
      assets.push({
        filename: entry.name,
        sizeBytes: stats.size,
        mimeType: getMimeType(filePath),
        uploadedAt: stats.mtimeMs,
        absolutePath: filePath,
      });
    } catch (error) {
      debug('[listProjectAssets] Failed to stat asset:', filePath, error);
    }
  }

  assets.sort((a, b) => b.uploadedAt - a.uploadedAt);
  return assets;
}

export interface UploadProjectAssetInput {
  filename: string;
  /** Base64-encoded contents (preferred for cross-process IPC) */
  base64?: string;
  /** Raw text contents (for small text/markdown uploads) */
  text?: string;
  /** Absolute source path on disk; copied into the assets folder */
  sourcePath?: string;
}

/**
 * Upload (write) an asset into the project's assets directory.
 * Accepts base64, text, or a sourcePath to copy from.
 * Resolves filename collisions by appending `-{n}` before the extension.
 */
export function uploadProjectAsset(
  workspaceRootPath: string,
  projectSlug: string,
  input: UploadProjectAssetInput,
): ProjectAsset {
  if (!projectExists(workspaceRootPath, projectSlug)) {
    throw new Error(`Project not found: ${projectSlug}`);
  }

  ensureProjectAssetsDir(workspaceRootPath, projectSlug);

  const safeName = sanitizeAssetFilename(input.filename);
  const assetsDir = getProjectAssetsPath(workspaceRootPath, projectSlug);
  const targetPath = resolveUniqueAssetPath(assetsDir, safeName);

  if (input.base64 !== undefined) {
    writeFileSync(targetPath, Buffer.from(input.base64, 'base64'));
  } else if (input.text !== undefined) {
    writeFileSync(targetPath, input.text, 'utf-8');
  } else if (input.sourcePath) {
    if (!existsSync(input.sourcePath)) {
      throw new Error(`Source file does not exist: ${input.sourcePath}`);
    }
    const data = readFileSync(input.sourcePath);
    writeFileSync(targetPath, data);
  } else {
    throw new Error('uploadProjectAsset requires one of: base64, text, sourcePath');
  }

  const stats = statSync(targetPath);
  return {
    filename: basename(targetPath),
    sizeBytes: stats.size,
    mimeType: getMimeType(targetPath),
    uploadedAt: stats.mtimeMs,
    absolutePath: targetPath,
  };
}

/**
 * Delete a single asset from a project (no-op if missing).
 */
export function deleteProjectAsset(
  workspaceRootPath: string,
  projectSlug: string,
  filename: string,
): void {
  const safe = sanitizeAssetFilename(filename);
  const target = join(getProjectAssetsPath(workspaceRootPath, projectSlug), safe);
  if (!existsSync(target)) return;

  // Refuse to follow path traversal — `safe` should already be the bare filename.
  if (basename(target) !== safe) {
    throw new Error(`Refusing to delete asset outside assets directory: ${filename}`);
  }

  try {
    unlinkSync(target);
  } catch (error) {
    debug('[deleteProjectAsset] Failed to delete asset:', target, error);
    throw error;
  }
}

/**
 * Resolve a target path inside `assetsDir` that does not collide with existing files.
 * Returns the original name if free; otherwise appends `-2`, `-3`, ... before the extension.
 */
function resolveUniqueAssetPath(assetsDir: string, filename: string): string {
  const candidate = join(assetsDir, filename);
  if (!existsSync(candidate)) return candidate;

  const ext = extname(filename);
  const stem = ext ? filename.slice(0, -ext.length) : filename;

  let counter = 2;
  while (existsSync(join(assetsDir, `${stem}-${counter}${ext}`))) counter++;
  return join(assetsDir, `${stem}-${counter}${ext}`);
}
