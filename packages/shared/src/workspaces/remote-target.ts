import type { Workspace } from '@craft-agent/core/types'

const REMOTE_WORKSPACE_PREFIX = 'remote:'

export interface ParsedRemoteWorkspaceTargetId {
  serverId: string
  workspaceId: string
}

export function buildRemoteWorkspaceTargetId(serverId: string, workspaceId: string): string {
  return `${REMOTE_WORKSPACE_PREFIX}${serverId}:${workspaceId}`
}

export function isRemoteWorkspaceTargetId(workspaceId: string | null | undefined): workspaceId is string {
  return typeof workspaceId === 'string' && workspaceId.startsWith(REMOTE_WORKSPACE_PREFIX)
}

export function parseRemoteWorkspaceTargetId(workspaceId: string): ParsedRemoteWorkspaceTargetId | null {
  if (!isRemoteWorkspaceTargetId(workspaceId)) return null
  const remainder = workspaceId.slice(REMOTE_WORKSPACE_PREFIX.length)
  const separatorIndex = remainder.indexOf(':')
  if (separatorIndex <= 0 || separatorIndex === remainder.length - 1) return null

  return {
    serverId: remainder.slice(0, separatorIndex),
    workspaceId: remainder.slice(separatorIndex + 1),
  }
}

export function isRemoteWorkspace(workspace: Workspace | null | undefined): workspace is Workspace & Required<Pick<Workspace, 'remoteServerId' | 'remoteWorkspaceId'>> {
  return !!workspace?.isRemote && !!workspace.remoteServerId && !!workspace.remoteWorkspaceId
}
