import { join } from 'path';

/**
 * Hidden workspace state directory for app-owned files.
 */
export const WORKSPACE_STATE_DIR = '.craft-agent';

/**
 * Get workspace state directory path.
 */
export function getWorkspaceStateDir(rootPath: string): string {
  return join(rootPath, WORKSPACE_STATE_DIR);
}

/**
 * Get a path inside workspace state directory.
 */
export function getWorkspaceStatePath(rootPath: string, relativePath: string): string {
  return join(getWorkspaceStateDir(rootPath), relativePath);
}
