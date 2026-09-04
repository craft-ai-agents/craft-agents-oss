import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse, successResponse } from '../response.ts';
import { CanvasStore, type CanvasOp } from '../canvas-store.ts';

export type CanvasAgentOp = CanvasOp;
export interface GetCanvasContextArgs {}
export interface ApplyCanvasOpsArgs { ops: CanvasAgentOp[]; summary?: string; projectId?: string }

export async function handleGetCanvasContext(ctx: SessionToolContext, _args: GetCanvasContextArgs): Promise<ToolResult> {
  try {
    const store = new CanvasStore(ctx.workspacePath);
    const projectId = store.sessionProject(ctx.sessionId);
    if (!projectId) return errorResponse('当前任务未绑定画布，禁止读取其他项目或最近打开的画布。');
    const stored = store.state(projectId);
    if (!stored.state?.snapshot) {
      return errorResponse('画布尚未同步。请先打开“无限画布”并进入一个画布项目。');
    }
    return successResponse(JSON.stringify({ ...stored.state, stateFile: stored.stateFile, blockedUpdates: stored.pendingUpdates, results: stored.results }, null, 2));
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

export async function handleApplyCanvasOps(ctx: SessionToolContext, args: ApplyCanvasOpsArgs): Promise<ToolResult> {
  try {
    if (!args.projectId) return errorResponse('必须提供 get_canvas_context 返回的 snapshot.projectId。');
    const store = new CanvasStore(ctx.workspacePath);
    if (store.sessionProject(ctx.sessionId) !== args.projectId) return errorResponse('任务未绑定目标画布，禁止跨项目写入。');
    const entry = await store.enqueue(ctx.sessionId, args.ops, args.summary, args.projectId);
    const revision = entry.revision;
    return successResponse(JSON.stringify({ queued: true, revision, operationCount: args.ops.length, updateId: entry.id }, null, 2));
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}
