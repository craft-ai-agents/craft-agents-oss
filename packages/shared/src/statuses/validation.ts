/**
 * Status Validation
 *
 * Runtime validation for session status IDs.
 * Ensures sessions always have valid status references.
 */

import { isValidStatusId } from './storage.ts';

/**
 * Validate and normalize a session's status
 * If invalid or undefined, returns 'todo' as fallback
 *
 * @param workspaceRootPath - Workspace root path
 * @param sessionStatus - Status ID to validate
 * @returns Valid status ID (or 'todo' fallback)
 */
export function validateSessionStatus(
  workspaceRootPath: string,
  sessionStatus: string | undefined
): string {
  // Default to 'find' if undefined (procurement default task type)
  if (!sessionStatus) {
    return 'find';
  }

  // Check if status exists in workspace config
  if (isValidStatusId(workspaceRootPath, sessionStatus)) {
    return sessionStatus;
  }

  // Invalid status - log warning and fallback to 'find'. This also auto-migrates
  // legacy sessions (old todo/done/backlog/… statuses) into the 找料 bucket on load
  // instead of dropping them out of the status-grouped list.
  console.warn(
    `[validateSessionStatus] Invalid status '${sessionStatus}' for workspace, ` +
    `falling back to 'find'. The status may have been deleted.`
  );

  return 'find';
}
