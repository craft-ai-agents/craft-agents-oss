import type { SessionToolContext, CreateTaskInput } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';

export type CreateTaskArgs = CreateTaskInput;

/**
 * create_task — create a Craft Agents Task (board card + task.yaml +
 * orchestrator session) WITHOUT running it. All spec building (slug
 * derivation, node synthesis, schema validation) happens behind the injected
 * ctx.createTask callback where the task/schema primitives live — this
 * package must stay dependency-free of @craft-agent/shared.
 */
export async function handleCreateTask(
  ctx: SessionToolContext,
  args: CreateTaskArgs
): Promise<ToolResult> {
  if (!ctx.createTask) {
    return errorResponse('create_task is not available in this context.');
  }
  if (!args.title?.trim()) {
    return errorResponse('title is required.');
  }
  if (!args.description?.trim()) {
    return errorResponse('description is required.');
  }

  try {
    const result = await ctx.createTask(args);
    return successResponse(JSON.stringify(result, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(`Failed to create task: ${message}`);
  }
}
