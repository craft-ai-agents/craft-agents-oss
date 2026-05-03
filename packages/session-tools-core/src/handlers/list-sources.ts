import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';

export interface ListSourcesArgs {
  activeOnly?: boolean;
  search?: string;
  tags?: string[];
  type?: 'mcp' | 'api' | 'local';
}

export async function handleListSources(
  ctx: SessionToolContext,
  args: ListSourcesArgs,
): Promise<ToolResult> {
  if (!ctx.listSources) {
    return errorResponse('list_sources is not available in this context.');
  }

  try {
    const result = ctx.listSources({
      activeOnly: args.activeOnly,
      search: args.search,
      tags: args.tags,
      type: args.type,
    });
    return successResponse(JSON.stringify(result, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(`Failed to list sources: ${message}`);
  }
}
