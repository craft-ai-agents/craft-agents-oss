/**
 * Guard logic for the archive_session tool: may the invoking session archive or
 * unarchive the target session? Extracted from the SessionManager callback so
 * the authoritative checks (workspace scoping, mid-turn refusal) are
 * unit-testable — the session-tools-core handler only re-states these as
 * best-effort pre-checks.
 */

export interface ArchiveTargetState {
  workspaceId: string
  isProcessing: boolean
}

/**
 * Returns an error message when the operation must be refused, or null when it
 * is allowed. "Not found" and "different workspace" intentionally share one
 * opaque message so the error text can't be used to probe for sessions in
 * other workspaces.
 */
export function validateArchiveTarget(
  target: ArchiveTargetState | undefined,
  invokingWorkspaceId: string,
  sessionId: string,
  archived: boolean
): string | null {
  if (!target || target.workspaceId !== invokingWorkspaceId) {
    return `Session ${sessionId} not found in this workspace`
  }
  if (archived && target.isProcessing) {
    return `Session ${sessionId} is currently processing a turn — try again once it is idle`
  }
  return null
}
