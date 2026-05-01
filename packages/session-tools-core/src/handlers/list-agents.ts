import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';

export interface ListAgentsArgs {
  activeOnly?: boolean;
  search?: string;
  tags?: string[];
}

export async function handleListAgents(
  ctx: SessionToolContext,
  args: ListAgentsArgs
): Promise<ToolResult> {
  if (!ctx.listAgents) {
    return errorResponse('list_agents is not available in this context.');
  }

  try {
    const result = ctx.listAgents({
      activeOnly: args.activeOnly,
      search: args.search,
      tags: args.tags,
    });
    return successResponse(JSON.stringify(result, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(`Failed to list agents: ${message}`);
  }
}
