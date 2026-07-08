import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';

export interface ListBackgroundTasksArgs {
  sessionId?: string;
}

/**
 * list_background_tasks — enumerate the background agents/tasks tracked for a
 * session by the MAIN PROCESS registry.
 *
 * Why this exists (and why the SDK's own task tools are not enough): the SDK's
 * in-subprocess task tools only know about tasks launched inside the CURRENT
 * subprocess. Each turn runs in its own subprocess, so a background agent from a
 * previous turn is invisible to them once that subprocess is torn down. This
 * tool reads the cross-subprocess registry instead, so a "status?" query returns
 * a truthful answer — including tasks that were `orphaned` when their owning turn
 * ended. Never guess or claim "the app restarted"; report exactly what the
 * registry says.
 */
export async function handleListBackgroundTasks(
  ctx: SessionToolContext,
  args: ListBackgroundTasksArgs
): Promise<ToolResult> {
  if (!ctx.listBackgroundTasks) {
    return errorResponse('list_background_tasks is not available in this context.');
  }

  try {
    const tasks = ctx.listBackgroundTasks(args.sessionId);
    const targetId = args.sessionId ?? ctx.sessionId;

    if (tasks.length === 0) {
      return successResponse(
        `No background tasks are tracked for session ${targetId}. ` +
          `This means none were launched, or they finished and were already reported.`
      );
    }

    const running = tasks.filter((t) => t.status === 'running');
    const orphaned = tasks.filter((t) => t.status === 'orphaned');
    const terminal = tasks.filter(
      (t) => t.status === 'completed' || t.status === 'failed' || t.status === 'stopped'
    );

    const summary =
      `${tasks.length} background task(s) for session ${targetId}: ` +
      `${running.length} running, ${orphaned.length} orphaned, ${terminal.length} finished.` +
      (orphaned.length > 0
        ? ` Orphaned tasks were terminated when their owning turn ended (the per-turn subprocess was torn down); their in-process state was lost.`
        : '');

    return successResponse(`${summary}\n\n${JSON.stringify(tasks, null, 2)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(`Failed to list background tasks: ${message}`);
  }
}
