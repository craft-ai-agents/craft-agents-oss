import { app } from 'electron'
import { getWorkspaceByNameOrId, type Workspace } from '@craft-agent/shared/config'

/**
 * Get workspace by ID or name, throwing if not found.
 * Use this when a workspace must exist for the operation to proceed.
 */
export function getWorkspaceOrThrow(workspaceId: string): Workspace {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`)
  }
  return workspace
}

export function buildBackendHostRuntimeContext() {
  return {
    appRootPath: app.isPackaged ? app.getAppPath() : process.cwd(),
    resourcesPath: process.resourcesPath,
    isPackaged: app.isPackaged,
  }
}
