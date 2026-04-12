import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';

export interface ArchiveSessionArgs {
  sessionId?: string;
  unarchive?: boolean;
}

export async function handleArchiveSession(
  ctx: SessionToolContext,
  args: ArchiveSessionArgs
): Promise<ToolResult> {
  if (!ctx.archiveSession) {
    return errorResponse('archive_session is not available in this context.');
  }

  try {
    const archive = !args.unarchive;
    await ctx.archiveSession(args.sessionId, archive);
    const target = args.sessionId ? `session ${args.sessionId}` : 'current session';
    const action = archive ? 'Archived' : 'Unarchived';
    return successResponse(`${action} ${target}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(`Failed to archive session: ${message}`);
  }
}
