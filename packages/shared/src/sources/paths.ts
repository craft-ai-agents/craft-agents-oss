/**
 * Source path utilities
 *
 * Pure path-join helpers with no credential/SDK dependencies, kept in their
 * own leaf module so callers that only need a path (e.g. agent/permissions-config.ts)
 * don't transitively pull in credential-manager.ts / api-tools.ts (and, through
 * that, the Claude Agent SDK).
 */

import { join } from 'path';
import { getWorkspaceSourcesPath } from '../workspaces/storage.ts';

/**
 * Get path to a source folder within a workspace
 */
export function getSourcePath(workspaceRootPath: string, sourceSlug: string): string {
  return join(getWorkspaceSourcesPath(workspaceRootPath), sourceSlug);
}
