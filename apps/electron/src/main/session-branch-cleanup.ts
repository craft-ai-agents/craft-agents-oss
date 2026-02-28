export interface BranchRollbackManagedSession {
  agent?: { destroy?: () => void } | null
  poolServer?: { stop?: () => void }
}

interface RollbackParams {
  managed: BranchRollbackManagedSession
  workspaceRootPath: string
  sessionId: string
  sessions: Map<string, unknown>
  deleteStoredSession: (workspaceRootPath: string, sessionId: string) => Promise<void>
}

/**
 * Best-effort rollback when branch creation fails during backend preflight.
 * Ensures no orphan child session remains in memory or persistent storage.
 */
export async function rollbackFailedBranchCreation(params: RollbackParams): Promise<void> {
  const { managed, workspaceRootPath, sessionId, sessions, deleteStoredSession } = params

  try {
    managed.agent?.destroy?.()
  } catch {
    // Best-effort cleanup
  }
  managed.agent = null

  if (managed.poolServer) {
    try {
      managed.poolServer.stop?.()
    } catch {
      // Best-effort cleanup
    }
    managed.poolServer = undefined
  }

  sessions.delete(sessionId)
  await deleteStoredSession(workspaceRootPath, sessionId)
}
