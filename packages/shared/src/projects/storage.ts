/**
 * Project Storage
 *
 * Workspace-scoped project CRUD operations.
 * Projects are stored at {workspaceRootPath}/projects/{slug}/
 * Each project folder contains:
 * - config.json (project metadata)
 * - files/ (user-managed project files)
 * - guidelines.md (optional AI instructions)
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  renameSync,
} from 'fs';
import { join, basename, extname, relative } from 'path';
import { randomUUID } from 'crypto';
import type {
  ProjectConfig,
  CreateProjectInput,
  ProjectSummary,
} from './types.ts';

// ============================================================
// Path Utilities
// ============================================================

/**
 * Get path to workspace projects directory
 * @param workspaceRootPath - Absolute path to workspace root folder
 */
export function getWorkspaceProjectsPath(workspaceRootPath: string): string {
  return join(workspaceRootPath, 'projects');
}

/**
 * Get path to a specific project directory
 * @param workspaceRootPath - Absolute path to workspace root folder
 * @param projectSlug - Project slug (folder name)
 */
export function getProjectPath(workspaceRootPath: string, projectSlug: string): string {
  return join(getWorkspaceProjectsPath(workspaceRootPath), projectSlug);
}

/**
 * Get path to a project's files directory
 * @param workspaceRootPath - Absolute path to workspace root folder
 * @param projectSlug - Project slug (folder name)
 */
export function getProjectFilesPath(workspaceRootPath: string, projectSlug: string): string {
  return join(getProjectPath(workspaceRootPath, projectSlug), 'files');
}

// ============================================================
// Slug Generation
// ============================================================

/**
 * Generate URL-safe slug from name
 */
function generateSlug(name: string): string {
  let slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);

  if (!slug) {
    slug = 'project';
  }

  return slug;
}

/**
 * Generate a unique project slug within a workspace
 */
function generateUniqueProjectSlug(name: string, projectsDir: string): string {
  const slug = generateSlug(name);
  let candidate = slug;

  if (!existsSync(join(projectsDir, candidate))) {
    return candidate;
  }

  let counter = 2;
  while (existsSync(join(projectsDir, `${slug}-${counter}`))) {
    counter++;
  }

  return `${slug}-${counter}`;
}

// ============================================================
// Config Operations
// ============================================================

/**
 * Load project config.json from a project folder
 * @param workspaceRootPath - Absolute path to workspace root folder
 * @param projectSlug - Project slug
 */
export function loadProjectConfig(workspaceRootPath: string, projectSlug: string): ProjectConfig | null {
  const configPath = join(getProjectPath(workspaceRootPath, projectSlug), 'config.json');
  if (!existsSync(configPath)) return null;

  try {
    return JSON.parse(readFileSync(configPath, 'utf-8')) as ProjectConfig;
  } catch {
    return null;
  }
}

/**
 * Save project config.json
 * @param workspaceRootPath - Absolute path to workspace root folder
 * @param projectSlug - Project slug
 * @param config - Project configuration to save
 */
export function saveProjectConfig(workspaceRootPath: string, projectSlug: string, config: ProjectConfig): void {
  const projectPath = getProjectPath(workspaceRootPath, projectSlug);
  if (!existsSync(projectPath)) {
    mkdirSync(projectPath, { recursive: true });
  }

  const storageConfig: ProjectConfig = {
    ...config,
    updatedAt: Date.now(),
  };

  writeFileSync(join(projectPath, 'config.json'), JSON.stringify(storageConfig, null, 2));
}

// ============================================================
// Load Operations
// ============================================================

/**
 * Count files recursively in a directory
 */
function countFiles(dirPath: string): number {
  if (!existsSync(dirPath)) return 0;
  try {
    let count = 0;
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        count++;
      } else if (entry.isDirectory()) {
        count += countFiles(join(dirPath, entry.name));
      }
    }
    return count;
  } catch {
    return 0;
  }
}

/**
 * Load a project from a workspace
 * @param workspaceRootPath - Absolute path to workspace root folder
 * @param projectSlug - Project slug
 */
export function loadProject(workspaceRootPath: string, projectSlug: string): ProjectConfig | null {
  return loadProjectConfig(workspaceRootPath, projectSlug);
}

/**
 * Get project summary for listing
 * @param workspaceRootPath - Absolute path to workspace root folder
 * @param projectSlug - Project slug
 * @param sessionCount - Number of sessions associated with this project (passed externally)
 */
export function getProjectSummary(
  workspaceRootPath: string,
  projectSlug: string,
  sessionCount: number = 0
): ProjectSummary | null {
  const config = loadProjectConfig(workspaceRootPath, projectSlug);
  if (!config) return null;

  return {
    id: config.id,
    slug: config.slug,
    name: config.name,
    description: config.description,
    sessionCount,
    fileCount: countFiles(getProjectFilesPath(workspaceRootPath, projectSlug)),
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  };
}

/**
 * List all projects in a workspace
 * @param workspaceRootPath - Absolute path to workspace root folder
 */
export function listProjects(workspaceRootPath: string): ProjectSummary[] {
  const projectsDir = getWorkspaceProjectsPath(workspaceRootPath);
  if (!existsSync(projectsDir)) return [];

  const projects: ProjectSummary[] = [];

  try {
    const entries = readdirSync(projectsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const summary = getProjectSummary(workspaceRootPath, entry.name);
      if (summary) {
        projects.push(summary);
      }
    }
  } catch {
    // Ignore errors scanning directory
  }

  // Sort by updatedAt descending (most recently updated first)
  projects.sort((a, b) => b.updatedAt - a.updatedAt);

  return projects;
}

// ============================================================
// Create/Update/Delete Operations
// ============================================================

/**
 * Create a new project in a workspace
 * @param workspaceRootPath - Absolute path to workspace root folder
 * @param input - Project creation input
 * @returns The created ProjectConfig
 */
export function createProject(
  workspaceRootPath: string,
  input: CreateProjectInput
): ProjectConfig {
  const now = Date.now();
  const projectsDir = getWorkspaceProjectsPath(workspaceRootPath);

  // Ensure projects directory exists
  if (!existsSync(projectsDir)) {
    mkdirSync(projectsDir, { recursive: true });
  }

  const slug = generateUniqueProjectSlug(input.name, projectsDir);

  const config: ProjectConfig = {
    id: `proj_${randomUUID().slice(0, 8)}`,
    name: input.name,
    slug,
    description: input.description,
    guidelines: input.guidelines,
    createdAt: now,
    updatedAt: now,
    enabledSourceSlugs: input.enabledSourceSlugs,
  };

  // Create project directory structure
  const projectPath = join(projectsDir, slug);
  mkdirSync(projectPath, { recursive: true });
  mkdirSync(join(projectPath, 'files'), { recursive: true });

  // Save config
  writeFileSync(join(projectPath, 'config.json'), JSON.stringify(config, null, 2));

  // Write guidelines.md if provided
  if (input.guidelines) {
    writeFileSync(join(projectPath, 'guidelines.md'), input.guidelines);
  }

  return config;
}

/**
 * Update a project's configuration
 * @param workspaceRootPath - Absolute path to workspace root folder
 * @param projectSlug - Project slug
 * @param updates - Partial updates to apply
 */
export function updateProject(
  workspaceRootPath: string,
  projectSlug: string,
  updates: Partial<Pick<ProjectConfig, 'name' | 'description' | 'guidelines' | 'enabledSourceSlugs'>>
): ProjectConfig | null {
  const config = loadProjectConfig(workspaceRootPath, projectSlug);
  if (!config) return null;

  const updated: ProjectConfig = {
    ...config,
    ...updates,
    updatedAt: Date.now(),
  };

  saveProjectConfig(workspaceRootPath, projectSlug, updated);

  // Update guidelines.md if guidelines changed
  if (updates.guidelines !== undefined) {
    const guidelinesPath = join(getProjectPath(workspaceRootPath, projectSlug), 'guidelines.md');
    if (updates.guidelines) {
      writeFileSync(guidelinesPath, updates.guidelines);
    } else if (existsSync(guidelinesPath)) {
      unlinkSync(guidelinesPath);
    }
  }

  return updated;
}

/**
 * Delete a project folder (sessions are NOT deleted, they become unorganized)
 * @param workspaceRootPath - Absolute path to workspace root folder
 * @param projectSlug - Project slug
 */
export function deleteProject(workspaceRootPath: string, projectSlug: string): boolean {
  const projectPath = getProjectPath(workspaceRootPath, projectSlug);
  if (!existsSync(projectPath)) return false;

  try {
    rmSync(projectPath, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

// ============================================================
// File Operations
// ============================================================

/**
 * File/directory entry in a project folder
 */
export interface ProjectFile {
  name: string;
  path: string;         // Relative path from project files root
  type: 'file' | 'directory';
  size?: number;
  children?: ProjectFile[];
}

/**
 * List files in a project's files directory (recursive)
 * @param workspaceRootPath - Absolute path to workspace root folder
 * @param projectSlug - Project slug
 * @param subPath - Optional subdirectory relative path
 */
export function listProjectFiles(
  workspaceRootPath: string,
  projectSlug: string,
  subPath?: string
): ProjectFile[] {
  const filesRoot = getProjectFilesPath(workspaceRootPath, projectSlug);
  const dirPath = subPath ? join(filesRoot, subPath) : filesRoot;

  if (!existsSync(dirPath)) return [];

  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    const files: ProjectFile[] = [];

    for (const entry of entries) {
      // Skip hidden files
      if (entry.name.startsWith('.')) continue;

      const fullPath = join(dirPath, entry.name);
      const relativePath = relative(filesRoot, fullPath);

      if (entry.isDirectory()) {
        files.push({
          name: entry.name,
          path: relativePath,
          type: 'directory',
          children: listProjectFiles(workspaceRootPath, projectSlug, relativePath),
        });
      } else if (entry.isFile()) {
        const stat = statSync(fullPath);
        files.push({
          name: entry.name,
          path: relativePath,
          type: 'file',
          size: stat.size,
        });
      }
    }

    // Sort: directories first, then alphabetically
    files.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return files;
  } catch {
    return [];
  }
}

/**
 * Read a file from a project's files directory
 * @param workspaceRootPath - Absolute path to workspace root folder
 * @param projectSlug - Project slug
 * @param filePath - Relative path within the project's files directory
 */
export function readProjectFile(
  workspaceRootPath: string,
  projectSlug: string,
  filePath: string
): string | null {
  const fullPath = join(getProjectFilesPath(workspaceRootPath, projectSlug), filePath);
  if (!existsSync(fullPath)) return null;

  try {
    return readFileSync(fullPath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Write content to a file in a project's files directory
 * @param workspaceRootPath - Absolute path to workspace root folder
 * @param projectSlug - Project slug
 * @param filePath - Relative path within the project's files directory
 * @param content - File content
 */
export function writeProjectFile(
  workspaceRootPath: string,
  projectSlug: string,
  filePath: string,
  content: string
): void {
  const fullPath = join(getProjectFilesPath(workspaceRootPath, projectSlug), filePath);
  const dir = join(fullPath, '..');

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(fullPath, content);
}

/**
 * Create a new file in a project's files directory
 * @param workspaceRootPath - Absolute path to workspace root folder
 * @param projectSlug - Project slug
 * @param filePath - Relative path within the project's files directory
 * @param content - Optional initial content (defaults to empty string)
 * @returns true if created, false if already exists
 */
export function createProjectFile(
  workspaceRootPath: string,
  projectSlug: string,
  filePath: string,
  content: string = ''
): boolean {
  const fullPath = join(getProjectFilesPath(workspaceRootPath, projectSlug), filePath);

  if (existsSync(fullPath)) return false;

  const dir = join(fullPath, '..');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(fullPath, content);
  return true;
}

/**
 * Delete a file from a project's files directory
 * @param workspaceRootPath - Absolute path to workspace root folder
 * @param projectSlug - Project slug
 * @param filePath - Relative path within the project's files directory
 */
export function deleteProjectFile(
  workspaceRootPath: string,
  projectSlug: string,
  filePath: string
): boolean {
  const fullPath = join(getProjectFilesPath(workspaceRootPath, projectSlug), filePath);
  if (!existsSync(fullPath)) return false;

  try {
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      rmSync(fullPath, { recursive: true });
    } else {
      unlinkSync(fullPath);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Rename a file in a project's files directory
 * @param workspaceRootPath - Absolute path to workspace root folder
 * @param projectSlug - Project slug
 * @param oldPath - Current relative path
 * @param newPath - New relative path
 */
export function renameProjectFile(
  workspaceRootPath: string,
  projectSlug: string,
  oldPath: string,
  newPath: string
): boolean {
  const filesRoot = getProjectFilesPath(workspaceRootPath, projectSlug);
  const fullOldPath = join(filesRoot, oldPath);
  const fullNewPath = join(filesRoot, newPath);

  if (!existsSync(fullOldPath)) return false;
  if (existsSync(fullNewPath)) return false;

  try {
    const newDir = join(fullNewPath, '..');
    if (!existsSync(newDir)) {
      mkdirSync(newDir, { recursive: true });
    }
    renameSync(fullOldPath, fullNewPath);
    return true;
  } catch {
    return false;
  }
}
