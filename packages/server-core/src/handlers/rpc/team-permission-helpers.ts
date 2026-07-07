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

export function assertGlobalSourceCredentialPermission(originWorkspaceId: string, sourceSlug: string): void {
  const originWorkspace = getWorkspaceByNameOrId(originWorkspaceId)
  if (!originWorkspace) throw new Error(`Workspace not found: ${originWorkspaceId}`)

  const checkedRootPaths = new Set<string>()
  const check = (workspace: WorkspaceRef): void => {
    if (checkedRootPaths.has(workspace.rootPath)) return
    checkedRootPaths.add(workspace.rootPath)
    assertSecretsUpdateForWorkspace(workspace, `Global source credential update for ${sourceSlug}`)
  }

  check(originWorkspace)

  for (const workspace of getWorkspaces()) {
    const activatedSlugs = readGlobalSourcesManifest(workspace.rootPath).activatedSlugs
    if (!activatedSlugs.includes(sourceSlug)) continue
    check(workspace)
  }
}
