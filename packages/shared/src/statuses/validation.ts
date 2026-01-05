/**
 * Status Validation
 *
 * Runtime validation for session status IDs.
 * Ensures sessions always have valid status references.
 */

import { isValidStatusId } from './storage.ts';

/**
 * Validate and normalize a session's todoState
 * If invalid or undefined, returns 'todo' as fallback
 *
 * @param workspaceRootPath - Workspace root path
 * @param todoState - Status ID to validate
 * @returns Valid status ID (or 'todo' fallback)
 */
export function validateSessionStatus(
  workspaceRootPath: string,
  todoState: string | undefined
): string {
  // Default to 'todo' if undefined
  if (!todoState) {
    return 'todo';
  }

  // Check if status exists in workspace config
  if (isValidStatusId(workspaceRootPath, todoState)) {
    return todoState;
  }

  // Invalid status - log warning and fallback to 'todo'
  console.warn(
    `[validateSessionStatus] Invalid status '${todoState}' for workspace, ` +
    `falling back to 'todo'. The status may have been deleted.`
  );

  return 'todo';
}
