import type { SessionToolContext } from '../context.ts';
import { errorResponse } from '../response.ts';
import type { ToolResult } from '../types.ts';

export interface VisualSurfaceStateOutput {
  id: string;
  title: string;
  kind: string;
  status: string;
  summary: string;
  previewMode?: string;
  pinnable: boolean;
  localWebPreview?: {
    url: string;
    displayHost: string;
  };
}

export interface VisualSurfaceStateToolResult {
  canvas: {
    exists: boolean;
    outputId?: string;
    title?: string;
    cardCount: number;
    noteCount: number;
    outputCardCount: number;
    updatedAt?: string;
  };
  outputs: VisualSurfaceStateOutput[];
  webPreviews: VisualSurfaceStateOutput[];
  capabilities: {
    canOpenCanvas: boolean;
    canPinOutputs: boolean;
    canInspectWebConsole: boolean;
  };
}

export async function handleVisualSurfaceState(
  ctx: SessionToolContext,
): Promise<ToolResult> {
  if (!ctx.getVisualSurfaceState) {
    return errorResponse('visual_surface_state is not available in this context.');
  }

  try {
    const state = await ctx.getVisualSurfaceState();
    return {
      content: [{ type: 'text', text: summarizeVisualSurfaceState(state) }],
      structuredContent: { ...state },
      isError: false,
    };
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : String(err));
  }
}

function summarizeVisualSurfaceState(state: VisualSurfaceStateToolResult): string {
  const canvas = state.canvas.exists
    ? `Canvas has ${state.canvas.cardCount} card${state.canvas.cardCount === 1 ? '' : 's'}.`
    : 'Canvas has not been created yet.';
  const web = state.webPreviews.length === 0
    ? 'No local web previews are available.'
    : `${state.webPreviews.length} local web preview${state.webPreviews.length === 1 ? '' : 's'} available.`;
  const outputs = `${state.outputs.length} visual output${state.outputs.length === 1 ? '' : 's'} available.`;
  return `${canvas} ${outputs} ${web}`;
}
