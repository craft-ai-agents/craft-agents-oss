import type { SessionToolContext } from '../context.ts';
import { errorResponse } from '../response.ts';
import type { ToolResult } from '../types.ts';

export interface VisualSurfaceStateCanvasCard {
  id: string;
  type: 'note' | 'output';
  title: string;
  outputId?: string;
  kind?: string;
  summary?: string;
  createdAt: string;
  updatedAt: string;
}

export interface VisualSurfaceStateWebPreview {
  url: string;
  displayHost: string;
  kind: 'local-web' | 'generated-html';
}

export interface VisualSurfaceStateOutput {
  id: string;
  title: string;
  kind: string;
  status: string;
  summary: string;
  previewMode?: string;
  pinnable: boolean;
  canOpenInCanvas: boolean;
  canInspectInBrowserPane: boolean;
  previewSurface: 'canvas' | 'browser-pane' | 'none';
  webPreview?: VisualSurfaceStateWebPreview;
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
    cards: VisualSurfaceStateCanvasCard[];
    updatedAt?: string;
  };
  outputs: VisualSurfaceStateOutput[];
  webPreviews: VisualSurfaceStateOutput[];
  capabilities: {
    canOpenCanvas: boolean;
    canPinOutputs: boolean;
    canInspectWebConsole: boolean;
    canInspectWebPreviewsInBrowserPane: boolean;
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
    ? 'No web previews are available.'
    : `${state.webPreviews.length} web preview${state.webPreviews.length === 1 ? '' : 's'} available for Browser Pane inspection.`;
  const outputs = `${state.outputs.length} visual output${state.outputs.length === 1 ? '' : 's'} available.`;
  return `${canvas} ${outputs} ${web}`;
}
