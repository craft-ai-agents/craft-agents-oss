import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';

export interface ArchiveSessionArgs {
  sessionId: string;
  archived?: boolean;
}

/**
 * Archive (or unarchive) another session by ID. Archiving is reversible and does
 * not delete anything — it moves a session out of the active list / unread counts.
 *
 * Guards (defence-in-depth; the authoritative workspace + mid-turn checks live in
 * the SessionManager-side callback):
 *  - the tool must be wired in this context,
 *  - sessionId is required,
 *  - a session may not archive itself (that would hide the live conversation),
 *  - the target must exist (best-effort pre-check via getSessionInfo).
 */
export async function handleArchiveSession(
  ctx: SessionToolContext,
  args: ArchiveSessionArgs
): Promise<ToolResult> {
  if (!ctx.archiveSession) {
    return errorResponse('archive_session is not available in this context.');
  }
  if (!args.sessionId?.trim()) {
    return errorResponse('sessionId is required — pass the ID of the session to archive.');
  }
  if (args.sessionId === ctx.sessionId) {
    return errorResponse('Refusing to archive your own session. Pass the sessionId of a different session.');
  }

  const archived = args.archived ?? true;

  // Best-effort existence pre-check. getSessionInfo returns null for unknown
  // sessions; the SessionManager callback enforces the same-workspace boundary.
  if (ctx.getSessionInfo && !ctx.getSessionInfo(args.sessionId)) {
    return errorResponse(`Session not found in this workspace: ${args.sessionId}`);
  }

  try {
    await ctx.archiveSession(args.sessionId, archived);
    return successResponse(
      archived
        ? `Session ${args.sessionId} archived.`
        : `Session ${args.sessionId} unarchived.`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(`Failed to ${archived ? 'archive' : 'unarchive'} session: ${message}`);
  }
}
