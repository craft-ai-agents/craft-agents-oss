import { getWorkspaceByNameOrId, getWorkspaces } from '@craft-agent/shared/config'
import { readGlobalSourcesManifest } from '@craft-agent/shared/sources'
import { assertTeamPermission } from '@craft-agent/shared/workspaces'

type WorkspaceRef = NonNullable<ReturnType<typeof getWorkspaceByNameOrId>>

function assertSecretsUpdateForWorkspace(workspace: WorkspaceRef, context: string): void {
  try {
    assertTeamPermission(workspace.rootPath, 'secrets.update')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${context} requires secrets.update in workspace ${workspace.id}: ${message}`)
  }
}

export function assertWorkspaceSecretsUpdatePermission(workspaceId: string, context: string): WorkspaceRef {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
  assertSecretsUpdateForWorkspace(workspace, context)
  return workspace
}

export function assertGlobalSourceCredentialPermission(originWorkspaceId: string, sourceSlug: string): void {
  const originWorkspace = assertWorkspaceSecretsUpdatePermission(
    originWorkspaceId,
    `Global source credential update for ${sourceSlug}`,
  )

  const checkedRootPaths = new Set<string>()
  checkedRootPaths.add(originWorkspace.rootPath)
  const check = (workspace: WorkspaceRef): void => {
    if (checkedRootPaths.has(workspace.rootPath)) return
    checkedRootPaths.add(workspace.rootPath)
    assertSecretsUpdateForWorkspace(workspace, `Global source credential update for ${sourceSlug}`)
  }

  for (const workspace of getWorkspaces()) {
    const activatedSlugs = readGlobalSourcesManifest(workspace.rootPath).activatedSlugs
    if (!activatedSlugs.includes(sourceSlug)) continue
    check(workspace)
  }
}
