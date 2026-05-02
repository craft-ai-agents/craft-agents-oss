import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { appendFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendPulseTick,
  getPulseTicksFile,
  pulseIdFromAutomationMatcher,
  readPulseTicks,
} from './storage.ts';
import type { PulseTickEntry } from './types.ts';

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'pulses-'));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function makeEntry(overrides: Partial<PulseTickEntry> = {}): PulseTickEntry {
  return {
    pulseId: 'morning',
    tickedAt: '2026-05-01T09:00:00.000Z',
    durationMs: 1234,
    decision: { action: 'do_nothing', reason: 'quiet morning' },
    driverSessionId: 'sess_1',
    diffSummary: { outputs: 0, sessions: 0, automations: 0, memoryWrites: 0 },
    ...overrides,
  };
}

describe('appendPulseTick / readPulseTicks', () => {
  test('appendPulseTick creates the directory and file on first call', () => {
    const file = getPulseTicksFile(workspace, 'morning');
    expect(existsSync(file)).toBe(false);
    appendPulseTick(workspace, 'morning', makeEntry());
    expect(existsSync(file)).toBe(true);
  });

  test('readPulseTicks tails N entries newest-first when no filter', () => {
    appendPulseTick(workspace, 'morning', makeEntry({ tickedAt: '2026-05-01T09:00:00.000Z' }));
    appendPulseTick(workspace, 'morning', makeEntry({ tickedAt: '2026-05-01T09:10:00.000Z' }));
    appendPulseTick(workspace, 'morning', makeEntry({ tickedAt: '2026-05-01T09:20:00.000Z' }));
    const got = readPulseTicks(workspace, 'morning', { limit: 2 });
    expect(got.map((e) => e.tickedAt)).toEqual([
      '2026-05-01T09:20:00.000Z',
      '2026-05-01T09:10:00.000Z',
    ]);
  });

  test('readPulseTicks skips malformed JSONL lines', () => {
    appendPulseTick(workspace, 'morning', makeEntry());
    const file = getPulseTicksFile(workspace, 'morning');
    appendFileSync(file, '{not json\n', 'utf-8');
    appendPulseTick(workspace, 'morning', makeEntry({ tickedAt: '2026-05-01T10:00:00.000Z' }));
    const got = readPulseTicks(workspace, 'morning');
    expect(got).toHaveLength(2);
  });

  test('invalid pulseId throws on append and read', () => {
    expect(() => appendPulseTick(workspace, 'Bad ID!', makeEntry())).toThrow();
    expect(() => readPulseTicks(workspace, 'Bad ID!')).toThrow();
  });

  test('appendPulseTick then readPulseTicks(limit:1) returns the just-appended entry', () => {
    appendPulseTick(workspace, 'morning', makeEntry({ tickedAt: '2026-05-01T08:00:00.000Z' }));
    appendPulseTick(workspace, 'morning', makeEntry({ tickedAt: '2026-05-01T11:00:00.000Z' }));
    const got = readPulseTicks(workspace, 'morning', { limit: 1 });
    expect(got).toHaveLength(1);
    expect(got[0]!.tickedAt).toBe('2026-05-01T11:00:00.000Z');
  });

  test('readPulseTicks with `after` returns chronological filtered entries', () => {
    appendPulseTick(workspace, 'morning', makeEntry({ tickedAt: '2026-05-01T09:00:00.000Z' }));
    appendPulseTick(workspace, 'morning', makeEntry({ tickedAt: '2026-05-01T09:10:00.000Z' }));
    appendPulseTick(workspace, 'morning', makeEntry({ tickedAt: '2026-05-01T09:20:00.000Z' }));
    const got = readPulseTicks(workspace, 'morning', { after: '2026-05-01T09:05:00.000Z' });
    expect(got.map((e) => e.tickedAt)).toEqual([
      '2026-05-01T09:10:00.000Z',
      '2026-05-01T09:20:00.000Z',
    ]);
  });
});

describe('pulseIdFromAutomationMatcher', () => {
  test('returns id when present', () => {
    expect(pulseIdFromAutomationMatcher({ id: 'morning' })).toBe('morning');
  });
  test('falls back to slug', () => {
    expect(pulseIdFromAutomationMatcher({ slug: 'morning' })).toBe('morning');
  });
  test('throws when neither id nor slug is provided', () => {
    expect(() => pulseIdFromAutomationMatcher({})).toThrow();
  });
  test('throws on invalid id', () => {
    expect(() => pulseIdFromAutomationMatcher({ id: 'NOT VALID' })).toThrow();
  });
});
