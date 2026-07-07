import { getWorkspaceByNameOrId, getWorkspaces } from '@craft-agent/shared/config'
import { readGlobalSourcesManifest } from '@craft-agent/shared/sources'
import { assertTeamPermission, type TeamPermissionAction } from '@craft-agent/shared/workspaces'

type WorkspaceRef = NonNullable<ReturnType<typeof getWorkspaceByNameOrId>>
type SessionWorkspaceRef = { workspaceId: string }

function assertPermissionForWorkspace(workspace: WorkspaceRef, action: TeamPermissionAction, context: string): void {
  try {
    assertTeamPermission(workspace.rootPath, action)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${context} requires ${action} in workspace ${workspace.id}: ${message}`)
  }
}

export function assertWorkspaceSecretsUpdatePermission(workspaceId: string, context: string): WorkspaceRef {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
  assertPermissionForWorkspace(workspace, 'secrets.update', context)
  return workspace
}

export async function assertSessionFilesWritePermission(
  sessionManager: { getSession(sessionId: string): Promise<SessionWorkspaceRef | null> },
  sessionId: string,
  requestedWorkspaceId: string,
  context: string,
): Promise<SessionWorkspaceRef> {
  const session = await sessionManager.getSession(sessionId)
  if (!session) throw new Error(`Session not found: ${sessionId}`)
  if (session.workspaceId !== requestedWorkspaceId) {
    throw new Error(`Session ${sessionId} does not belong to workspace ${requestedWorkspaceId}`)
  }
  const workspace = getWorkspaceByNameOrId(session.workspaceId)
  if (!workspace) throw new Error(`Workspace not found: ${session.workspaceId}`)
  assertPermissionForWorkspace(workspace, 'files.write', context)
  return session
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
    assertPermissionForWorkspace(workspace, 'secrets.update', `Global source credential update for ${sourceSlug}`)
  }

  for (const workspace of getWorkspaces()) {
    const activatedSlugs = readGlobalSourcesManifest(workspace.rootPath).activatedSlugs
    if (!activatedSlugs.includes(sourceSlug)) continue
    check(workspace)
  }
}
