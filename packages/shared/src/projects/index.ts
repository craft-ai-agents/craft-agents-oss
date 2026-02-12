/**
 * Project Module
 *
 * Re-exports types and storage functions for projects.
 */

// Types
export type {
  ProjectConfig,
  CreateProjectInput,
  ProjectSummary,
} from './types.ts';

// Storage types
export type { ProjectFile } from './storage.ts';

// Storage functions
export {
  // Path utilities
  getWorkspaceProjectsPath,
  getProjectPath,
  getProjectFilesPath,
  // Config operations
  loadProjectConfig,
  saveProjectConfig,
  // Load operations
  loadProject,
  getProjectSummary,
  listProjects,
  // Create/Delete operations
  createProject,
  deleteProject,
  updateProject,
  // File operations
  listProjectFiles,
  readProjectFile,
  writeProjectFile,
  createProjectFile,
  deleteProjectFile,
  renameProjectFile,
} from './storage.ts';
