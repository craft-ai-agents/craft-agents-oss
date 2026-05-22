import { describe, expect, test } from 'bun:test';
import {
  isVisualSurfaceEventRecord,
  normalizeVisualSurfaceEventInput,
  parseVisualSurfaceEventLines,
} from './index.ts';

describe('visual surface events', () => {
  test('normalizes supported event inputs', () => {
    expect(normalizeVisualSurfaceEventInput({ action: 'open_board', title: '  Board  ' })).toEqual({
      action: 'open_board',
      title: 'Board',
    });
    expect(normalizeVisualSurfaceEventInput({ action: 'add_note', title: ' Note ', body: ' Body ' })).toEqual({
      action: 'add_note',
      title: 'Note',
      body: 'Body',
    });
    expect(normalizeVisualSurfaceEventInput({ action: 'pin_output', outputId: ' out-1 ' })).toEqual({
      action: 'pin_output',
      outputId: 'out-1',
    });
  });

  test('rejects malformed inputs', () => {
    expect(() => normalizeVisualSurfaceEventInput({ action: 'add_note', body: 'Missing title' })).toThrow('title is required');
    expect(() => normalizeVisualSurfaceEventInput({ action: 'pin_output', outputId: '' })).toThrow('outputId is required');
    expect(() => normalizeVisualSurfaceEventInput({ action: 'draw' })).toThrow('action must be one of');
  });

  test('parses only valid event history records for the expected session', () => {
    const record = {
      schemaVersion: 1,
      id: 'evt-1',
      workspaceId: 'ws',
      sessionId: 's1',
      action: 'add_note',
      payload: { action: 'add_note', title: 'A', body: 'B' },
      source: 'agent',
      createdAt: new Date().toISOString(),
    };
    expect(isVisualSurfaceEventRecord(record, { workspaceId: 'ws', sessionId: 's1' })).toBe(true);
    const parsed = parseVisualSurfaceEventLines([
      JSON.stringify(record),
      '{bad json',
      JSON.stringify({ ...record, id: 'evt-2', sessionId: 'other' }),
    ].join('\n'), { workspaceId: 'ws', sessionId: 's1' });
    expect(parsed.map((entry) => entry.id)).toEqual(['evt-1']);
  });
});
