import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';

export interface ListWorkflowsArgs {
  activeOnly?: boolean;
  search?: string;
}

export interface GetWorkflowArgs {
  slug: string;
}

export interface StartWorkflowArgs {
  slug: string;
  triggerInputs?: Record<string, unknown>;
}

export interface GetWorkflowRunArgs {
  runId: string;
}

export interface CancelWorkflowRunArgs {
  runId: string;
}

export async function handleListWorkflows(ctx: SessionToolContext, args: ListWorkflowsArgs): Promise<ToolResult> {
  if (!ctx.listWorkflows) return errorResponse('list_workflows is not available in this context.');
  try {
    return successResponse(JSON.stringify(ctx.listWorkflows(args), null, 2));
  } catch (error) {
    return errorResponse(`Failed to list workflows: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function handleGetWorkflow(ctx: SessionToolContext, args: GetWorkflowArgs): Promise<ToolResult> {
  if (!ctx.getWorkflow) return errorResponse('get_workflow is not available in this context.');
  try {
    const workflow = ctx.getWorkflow(args.slug);
    if (!workflow) return errorResponse(`Workflow not found: ${args.slug}`);
    return successResponse(JSON.stringify(workflow, null, 2));
  } catch (error) {
    return errorResponse(`Failed to get workflow: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function handleStartWorkflow(ctx: SessionToolContext, args: StartWorkflowArgs): Promise<ToolResult> {
  if (!ctx.startWorkflow) return errorResponse('start_workflow is not available in this context.');
  try {
    const run = await ctx.startWorkflow(args.slug, args.triggerInputs ?? {});
    return successResponse(JSON.stringify(run, null, 2));
  } catch (error) {
    return errorResponse(`Failed to start workflow: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function handleGetWorkflowRun(ctx: SessionToolContext, args: GetWorkflowRunArgs): Promise<ToolResult> {
  if (!ctx.getWorkflowRun) return errorResponse('get_workflow_run is not available in this context.');
  try {
    const run = ctx.getWorkflowRun(args.runId);
    if (!run) return errorResponse(`Workflow run not found: ${args.runId}`);
    return successResponse(JSON.stringify(run, null, 2));
  } catch (error) {
    return errorResponse(`Failed to get workflow run: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function handleCancelWorkflowRun(ctx: SessionToolContext, args: CancelWorkflowRunArgs): Promise<ToolResult> {
  if (!ctx.cancelWorkflowRun) return errorResponse('cancel_workflow_run is not available in this context.');
  try {
    const cancelWorkflowRun = ctx.cancelWorkflowRun as (runId: string) => Promise<unknown>;
    const result = await cancelWorkflowRun(args.runId);
    if (result && typeof result === 'object') {
      return successResponse(JSON.stringify(result, null, 2));
    }
    return successResponse(`Cancelled workflow run ${args.runId}.`);
  } catch (error) {
    return errorResponse(`Failed to cancel workflow run: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
