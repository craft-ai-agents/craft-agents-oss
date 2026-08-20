import type { Workspace } from '../../../shared/types'

const NO_TEAM_SPACES: Workspace[] = []

/** Returns only TeamSpaces atomically linked to the selected organization. */
export function getTeamSpacesForOrganization(
  workspaces: readonly Workspace[],
  orgId: string | null,
): readonly Workspace[] {
  const normalizedOrgId = orgId?.trim()
  if (!normalizedOrgId) return NO_TEAM_SPACES

  return workspaces.filter(
    (workspace) => workspace.kind === 'team' && workspace.orgId === normalizedOrgId,
  )
}
