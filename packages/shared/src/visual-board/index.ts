export const VISUAL_BOARD_TAG = 'visual-board';
export const VISUAL_BOARD_SESSION_TAG = 'session-board';
export const VISUAL_BOARD_ASSET_ID = 'board';
export const VISUAL_BOARD_ASSET_PATH = 'board.json';

export interface VisualBoardBaseCard {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface VisualBoardNoteCard extends VisualBoardBaseCard {
  type: 'note';
  body: string;
}

export interface VisualBoardOutputCard extends VisualBoardBaseCard {
  type: 'output';
  outputId: string;
  kind: string;
  summary?: string;
}

export type VisualBoardCard = VisualBoardNoteCard | VisualBoardOutputCard;

export interface VisualBoardSnapshot {
  schemaVersion: 1;
  workspaceId: string;
  sessionId: string;
  title: string;
  cards: VisualBoardCard[];
  createdAt: string;
  updatedAt: string;
}

export const VISUAL_BOARD_MAX_CARDS = 100;
export const VISUAL_BOARD_MAX_TITLE_LENGTH = 120;
export const VISUAL_BOARD_MAX_BODY_LENGTH = 4000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isIsoDateString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value));
}

function trimLimit(value: string, max: number): string {
  return value.trim().slice(0, max);
}

export function createEmptyVisualBoardSnapshot(input: {
  workspaceId: string;
  sessionId: string;
  title?: string;
  now?: string;
}): VisualBoardSnapshot {
  const now = input.now ?? new Date().toISOString();
  return {
    schemaVersion: 1,
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
    title: trimLimit(input.title ?? 'Session board', VISUAL_BOARD_MAX_TITLE_LENGTH) || 'Session board',
    cards: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function isVisualBoardSnapshot(
  value: unknown,
  expected?: { workspaceId?: string; sessionId?: string },
): value is VisualBoardSnapshot {
  if (!isRecord(value)) return false;
  if (value.schemaVersion !== 1) return false;
  if (typeof value.workspaceId !== 'string' || !value.workspaceId) return false;
  if (typeof value.sessionId !== 'string' || !value.sessionId) return false;
  if (expected?.workspaceId && value.workspaceId !== expected.workspaceId) return false;
  if (expected?.sessionId && value.sessionId !== expected.sessionId) return false;
  if (typeof value.title !== 'string' || !value.title || value.title.length > VISUAL_BOARD_MAX_TITLE_LENGTH) return false;
  if (!isIsoDateString(value.createdAt) || !isIsoDateString(value.updatedAt)) return false;
  if (!Array.isArray(value.cards) || value.cards.length > VISUAL_BOARD_MAX_CARDS) return false;
  return value.cards.every(isVisualBoardCard);
}

export function assertVisualBoardSnapshot(
  value: unknown,
  expected?: { workspaceId?: string; sessionId?: string },
): asserts value is VisualBoardSnapshot {
  if (!isVisualBoardSnapshot(value, expected)) {
    throw new Error('Invalid visual board snapshot');
  }
}

export function parseVisualBoardSnapshot(
  content: string,
  expected?: { workspaceId?: string; sessionId?: string },
): VisualBoardSnapshot | null {
  try {
    const parsed = JSON.parse(content) as unknown;
    return isVisualBoardSnapshot(parsed, expected) ? parsed : null;
  } catch {
    return null;
  }
}

export function summarizeVisualBoard(snapshot: VisualBoardSnapshot): string {
  const notes = snapshot.cards.filter((card) => card.type === 'note').length;
  const outputs = snapshot.cards.filter((card) => card.type === 'output').length;
  if (snapshot.cards.length === 0) return 'Empty visual board';
  return `${snapshot.cards.length} card${snapshot.cards.length === 1 ? '' : 's'}: ${notes} note${notes === 1 ? '' : 's'}, ${outputs} output${outputs === 1 ? '' : 's'}`;
}

function isVisualBoardCard(value: unknown): value is VisualBoardCard {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || !value.id || value.id.length > 80) return false;
  if (typeof value.title !== 'string' || value.title.length > VISUAL_BOARD_MAX_TITLE_LENGTH) return false;
  if (!isIsoDateString(value.createdAt) || !isIsoDateString(value.updatedAt)) return false;
  if (value.type === 'note') {
    return typeof value.body === 'string' && value.body.length <= VISUAL_BOARD_MAX_BODY_LENGTH;
  }
  if (value.type === 'output') {
    if (typeof value.outputId !== 'string' || !value.outputId) return false;
    if (typeof value.kind !== 'string' || !value.kind) return false;
    return value.summary === undefined || typeof value.summary === 'string';
  }
  return false;
}
