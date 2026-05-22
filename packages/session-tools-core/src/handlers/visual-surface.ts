import type { SessionToolContext } from '../context.ts';
import { errorResponse } from '../response.ts';
import type { ToolResult } from '../types.ts';

export type VisualSurfaceToolInput =
  | { action: 'open_board'; title?: string }
  | { action: 'add_note'; title: string; body?: string }
  | { action: 'pin_output'; outputId: string };

export interface VisualSurfaceToolResult {
  ok: boolean;
  eventId?: string;
  outputId?: string;
  board?: { title: string; cards: unknown[]; updatedAt: string };
  receipt?: string;
  error?: string;
}

export async function handleVisualSurface(
  ctx: SessionToolContext,
  args: VisualSurfaceToolInput,
): Promise<ToolResult> {
  if (!ctx.applyVisualSurfaceEvent) {
    return errorResponse('visual_surface is not available in this context.');
  }

  let input: VisualSurfaceToolInput;
  try {
    input = normalizeVisualSurfaceToolInput(args);
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : String(err));
  }

  try {
    const result = await ctx.applyVisualSurfaceEvent(input);
    if (!result.ok) return errorResponse(result.error ?? 'Failed to update Canvas.');
    const receipt = result.receipt ?? 'Updated Canvas.';
    return {
      content: [{ type: 'text', text: receipt }],
      structuredContent: {
        ok: true,
        eventId: result.eventId,
        outputId: result.outputId,
        receipt,
        board: result.board ? {
          title: result.board.title,
          cardCount: result.board.cards.length,
          updatedAt: result.board.updatedAt,
        } : undefined,
      },
      isError: false,
    };
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : String(err));
  }
}

function normalizeVisualSurfaceToolInput(input: unknown): VisualSurfaceToolInput {
  if (!isRecord(input)) throw new Error('visual_surface input must be an object.');
  if (input.action === 'open_board') {
    const title = input.title === undefined ? undefined : normalizeOptionalString(input.title, 'title', 120);
    return title ? { action: 'open_board', title } : { action: 'open_board' };
  }
  if (input.action === 'add_note') {
    const title = normalizeRequiredString(input.title, 'title', 120);
    const body = input.body === undefined ? '' : normalizeOptionalString(input.body, 'body', 4000) ?? '';
    return { action: 'add_note', title, body };
  }
  if (input.action === 'pin_output') {
    const outputId = normalizeRequiredString(input.outputId, 'outputId', 160);
    return { action: 'pin_output', outputId };
  }
  throw new Error('action must be one of: open_board, add_note, pin_output.');
}

function normalizeRequiredString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') throw new Error(`${field} is required.`);
  const normalized = value.trim().slice(0, maxLength);
  if (!normalized) throw new Error(`${field} is required.`);
  return normalized;
}

function normalizeOptionalString(value: unknown, field: string, maxLength: number): string | undefined {
  if (typeof value !== 'string') throw new Error(`${field} must be a string.`);
  const normalized = value.trim().slice(0, maxLength);
  return normalized || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
