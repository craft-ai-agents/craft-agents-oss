import {
  VISUAL_BOARD_MAX_BODY_LENGTH,
  VISUAL_BOARD_MAX_TITLE_LENGTH,
  type VisualBoardSnapshot,
} from '../visual-board/index.ts';

export const VISUAL_SURFACE_EVENTS_ASSET_ID = 'visual-events';
export const VISUAL_SURFACE_EVENTS_ASSET_PATH = 'visual-events.jsonl';
export const VISUAL_SURFACE_EVENTS_MIME_TYPE = 'application/x-ndjson';

export type VisualSurfaceEventAction = 'open_board' | 'add_note' | 'pin_output' | 'add_image' | 'add_video';
export type VisualSurfaceEventSource = 'agent' | 'user' | 'system';

export interface VisualSurfaceOpenBoardInput {
  action: 'open_board';
  title?: string;
}

export interface VisualSurfaceAddNoteInput {
  action: 'add_note';
  title: string;
  body?: string;
}

export interface VisualSurfacePinOutputInput {
  action: 'pin_output';
  outputId: string;
}

export interface VisualSurfaceAddImageInput {
  action: 'add_image';
  outputId: string;
}

export interface VisualSurfaceAddVideoInput {
  action: 'add_video';
  outputId: string;
}

export type VisualSurfaceEventInput =
  | VisualSurfaceOpenBoardInput
  | VisualSurfaceAddNoteInput
  | VisualSurfacePinOutputInput
  | VisualSurfaceAddImageInput
  | VisualSurfaceAddVideoInput;

export interface VisualSurfaceEventRecord {
  schemaVersion: 1;
  id: string;
  workspaceId: string;
  sessionId: string;
  action: VisualSurfaceEventAction;
  payload: VisualSurfaceEventInput;
  source: VisualSurfaceEventSource;
  createdAt: string;
}

export interface ApplyVisualSurfaceEventResult {
  ok: boolean;
  eventId?: string;
  outputId?: string;
  board?: VisualBoardSnapshot;
  receipt?: string;
  error?: string;
}

export function normalizeVisualSurfaceEventInput(input: unknown): VisualSurfaceEventInput {
  if (!isRecord(input)) throw new Error('visual_surface input must be an object.');
  if (input.action === 'open_board') {
    const title = input.title === undefined ? undefined : normalizeOptionalString(input.title, 'title', VISUAL_BOARD_MAX_TITLE_LENGTH);
    return title ? { action: 'open_board', title } : { action: 'open_board' };
  }
  if (input.action === 'add_note') {
    const title = normalizeRequiredString(input.title, 'title', VISUAL_BOARD_MAX_TITLE_LENGTH);
    const body = input.body === undefined ? '' : normalizeOptionalString(input.body, 'body', VISUAL_BOARD_MAX_BODY_LENGTH) ?? '';
    return { action: 'add_note', title, body };
  }
  if (input.action === 'pin_output' || input.action === 'add_image' || input.action === 'add_video') {
    const outputId = normalizeRequiredString(input.outputId, 'outputId', 160);
    return { action: input.action, outputId };
  }
  throw new Error('action must be one of: open_board, add_note, pin_output, add_image, add_video.');
}

export function isVisualSurfaceEventRecord(value: unknown, expected?: { workspaceId?: string; sessionId?: string }): value is VisualSurfaceEventRecord {
  if (!isRecord(value)) return false;
  if (value.schemaVersion !== 1) return false;
  if (typeof value.id !== 'string' || !value.id) return false;
  if (typeof value.workspaceId !== 'string' || !value.workspaceId) return false;
  if (typeof value.sessionId !== 'string' || !value.sessionId) return false;
  if (expected?.workspaceId && value.workspaceId !== expected.workspaceId) return false;
  if (expected?.sessionId && value.sessionId !== expected.sessionId) return false;
  if (!['open_board', 'add_note', 'pin_output', 'add_image', 'add_video'].includes(String(value.action))) return false;
  if (!['agent', 'user', 'system'].includes(String(value.source))) return false;
  if (typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) return false;
  try {
    normalizeVisualSurfaceEventInput(value.payload);
    return (value.payload as { action?: unknown }).action === value.action;
  } catch {
    return false;
  }
}

export function parseVisualSurfaceEventLines(
  content: string,
  expected?: { workspaceId?: string; sessionId?: string },
): VisualSurfaceEventRecord[] {
  const records: VisualSurfaceEventRecord[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (isVisualSurfaceEventRecord(parsed, expected)) records.push(parsed);
    } catch {
      // Ignore corrupt history lines; board.json remains the source of truth.
    }
  }
  return records;
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
