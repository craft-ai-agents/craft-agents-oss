/**
 * Target eligibility for "Send to Workspace".
 *
 * A session can be sent to any workspace other than the one it lives in —
 * remote targets are pushed to over an outbound WS connection, local targets
 * import in-process on the embedded server. Remote targets additionally need a
 * connectivity check before they are selectable; local targets are always
 * reachable.
 */

import type { Workspace } from '../../../shared/types'

/** All workspaces a session in `activeWorkspaceId` can be sent to. */
export function getTransferTargets(workspaces: Workspace[], activeWorkspaceId: string | null): Workspace[] {
  return workspaces.filter(w => w.id !== activeWorkspaceId)
}

/**
 * Menu gating: is there anywhere to send a session to? Expects the full
 * workspace list (including the active workspace), so "more than one" means
 * at least one other workspace exists.
 */
export function hasTransferTargets(workspaces: Workspace[] | undefined | null): boolean {
  return (workspaces?.length ?? 0) > 1
}
