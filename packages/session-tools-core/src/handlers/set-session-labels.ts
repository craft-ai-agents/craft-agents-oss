import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';

export interface SetSessionLabelsArgs {
  labels: string[];
}

export async function handleSetSessionLabels(
  ctx: SessionToolContext,
  args: SetSessionLabelsArgs
): Promise<ToolResult> {
  if (!ctx.setSessionLabels) {
    return errorResponse('set_session_labels is not available in this context.');
  }

  try {
    ctx.setSessionLabels(args.labels);
    return successResponse(
      args.labels.length === 0
        ? 'Labels cleared.'
        : `Labels set: ${args.labels.join(', ')}`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(`Failed to set labels: ${message}`);
  }
}
