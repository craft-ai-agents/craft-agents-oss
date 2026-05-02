import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';

export interface ListSkillsArgs {
  activeOnly?: boolean;
  search?: string;
  tags?: string[];
}

export async function handleListSkills(
  ctx: SessionToolContext,
  args: ListSkillsArgs
): Promise<ToolResult> {
  if (!ctx.listSkills) {
    return errorResponse('list_skills is not available in this context.');
  }

  try {
    const result = ctx.listSkills({
      activeOnly: args.activeOnly,
      search: args.search,
      tags: args.tags,
    });
    return successResponse(JSON.stringify(result, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(`Failed to list skills: ${message}`);
  }
}
