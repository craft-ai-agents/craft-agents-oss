import { describe, expect, test } from 'bun:test';
import {
  createEmptyVisualBoardSnapshot,
  isVisualBoardSnapshot,
  parseVisualBoardSnapshot,
  summarizeVisualBoard,
  type VisualBoardSnapshot,
} from './index.ts';

describe('visual board snapshots', () => {
  test('creates and validates an empty session board', () => {
    const board = createEmptyVisualBoardSnapshot({
      workspaceId: 'ws',
      sessionId: 'session-1',
      now: '2026-05-22T00:00:00.000Z',
    });

    expect(isVisualBoardSnapshot(board, { workspaceId: 'ws', sessionId: 'session-1' })).toBe(true);
    expect(board.cards).toEqual([]);
    expect(summarizeVisualBoard(board)).toBe('Empty visual board');
  });

  test('rejects mismatched workspace or session snapshots', () => {
    const board = createEmptyVisualBoardSnapshot({ workspaceId: 'ws', sessionId: 'session-1' });

    expect(isVisualBoardSnapshot(board, { workspaceId: 'other', sessionId: 'session-1' })).toBe(false);
    expect(isVisualBoardSnapshot(board, { workspaceId: 'ws', sessionId: 'other' })).toBe(false);
  });

  test('parses populated note and output cards', () => {
    const now = '2026-05-22T00:00:00.000Z';
    const board: VisualBoardSnapshot = {
      schemaVersion: 1,
      workspaceId: 'ws',
      sessionId: 'session-1',
      title: 'Session board',
      createdAt: now,
      updatedAt: now,
      cards: [
        { id: 'note-1', type: 'note', title: 'Plan', body: 'Ship it', createdAt: now, updatedAt: now },
        { id: 'out-1', type: 'output', outputId: 'output-1', title: 'Preview', kind: 'image', createdAt: now, updatedAt: now },
      ],
    };

    const parsed = parseVisualBoardSnapshot(JSON.stringify(board), { workspaceId: 'ws', sessionId: 'session-1' });
    expect(parsed?.cards.length).toBe(2);
    expect(summarizeVisualBoard(board)).toBe('2 cards: 1 note, 1 output');
  });
});

