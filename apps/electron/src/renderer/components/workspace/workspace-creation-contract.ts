import type {
  Workspace,
  WorkspaceActivation,
  WorkspaceCreationResult,
} from '../../../shared/types'

export interface WorkspaceCreationSuccess {
  workspace: Workspace
  activation?: WorkspaceActivation
}

export type TeamSpaceCreateArguments = readonly [
  folderPath: string,
  name: string,
  remoteServer: undefined,
  authority: { kind: 'team'; orgId: string },
]

/**
 * Builds the local-only request shape for a TeamSpace. The server remains the
 * authority for organization membership; this only prevents an empty client
 * selection from being submitted.
 */
export function buildTeamSpaceCreateArguments(
  folderPath: string,
  name: string,
  orgId: string,
): TeamSpaceCreateArguments {
  const normalizedOrgId = orgId.trim()
  if (!normalizedOrgId) {
    throw new Error('An organization is required to create a TeamSpace')
  }

  return [folderPath, name, undefined, { kind: 'team', orgId: normalizedOrgId }]
}

/**
 * Normalizes the mixed local/remote create response. Local creation is not
 * considered complete until its activation transaction is present and points
 * at the created workspace. Remote creation intentionally keeps its existing
 * response shape and does not claim local lifecycle activation.
 */
export function resolveWorkspaceCreation(
  result: WorkspaceCreationResult,
  requiresActivation: boolean,
): WorkspaceCreationSuccess {
  const { activation, ...workspace } = result

  if (
    requiresActivation &&
    (!activation ||
      activation.workspaceId !== workspace.id ||
      activation.activeWorkspaceId !== workspace.id)
  ) {
    throw new Error('Workspace creation completed without activating the new workspace')
  }

  return activation ? { workspace, activation } : { workspace }
}
