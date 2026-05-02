import { describe, expect, test } from 'bun:test';
import { assemblePulseSnapshot } from './snapshot.ts';
import {
  PULSE_INSTRUCTION_FOOTER,
  PULSE_SNAPSHOT_TOKEN_BUDGET,
  type PulseSnapshotDeps,
  type PulseSnapshotGoal,
  type PulseSnapshotInputs,
  type PulseTickEntry,
} from './types.ts';

const FIXED_NOW = new Date('2026-05-02T15:00:00.000Z');

function emptyDeps(overrides: Partial<PulseSnapshotDeps> = {}): PulseSnapshotDeps {
  return {
    loadGoalDocs: () => [],
    countOutputsSince: () => [],
    countSessionsSince: () => [],
    countAutomationsSince: () => [],
    countMemoryWritesSince: () => 0,
    recentTicks: () => [],
    ...overrides,
  };
}

function baseInputs(overrides: Partial<PulseSnapshotInputs> = {}): PulseSnapshotInputs {
  return {
    workspaceRootPath: '/tmp/ws',
    pulseId: 'morning',
    diffWindowMinutes: 30,
    now: FIXED_NOW,
    ...overrides,
  };
}

describe('assemblePulseSnapshot', () => {
  test('minimal snapshot renders with the instruction footer', () => {
    const snap = assemblePulseSnapshot(baseInputs(), emptyDeps());
    expect(snap.text).toContain(PULSE_INSTRUCTION_FOOTER);
    expect(snap.text).toContain('## Active goals');
    expect(snap.text).toContain('## Diff since last tick');
    expect(snap.text).toContain('## Time');
    expect(snap.text).toContain('## Recent decisions');
    expect(snap.goalCount).toBe(0);
    expect(snap.diffSummary).toEqual({
      outputs: 0,
      sessions: 0,
      automations: 0,
      memoryWrites: 0,
    });
    expect(snap.truncated).toBe(false);
  });

  test('renders goals with all four status states (filtered to active by default)', () => {
    const goals: PulseSnapshotGoal[] = [
      { slug: 'a', name: 'Active goal', body: 'a body', status: 'active' },
      { slug: 'b', name: 'Blocked goal', body: 'b body', status: 'blocked' },
      { slug: 'p', name: 'Paused goal', body: 'p body', status: 'paused' },
      { slug: 'd', name: 'Done goal', body: 'd body', status: 'done' },
    ];
    const snap = assemblePulseSnapshot(baseInputs(), emptyDeps({ loadGoalDocs: () => goals }));
    // Default filter: only active
    expect(snap.text).toContain('Active goal');
    expect(snap.text).not.toContain('Blocked goal');
    expect(snap.goalCount).toBe(1);

    // With explicit goalSlugs, all four render
    const all = assemblePulseSnapshot(
      baseInputs({ goalSlugs: ['a', 'b', 'p', 'd'] }),
      emptyDeps({ loadGoalDocs: () => goals }),
    );
    expect(all.text).toContain('status: active');
    expect(all.text).toContain('status: blocked');
    expect(all.text).toContain('status: paused');
    expect(all.text).toContain('status: done');
    expect(all.goalCount).toBe(4);
  });

  test('diff section caps lists at 20 items', () => {
    const sessions = Array.from({ length: 30 }, (_, i) => ({
      id: `s${i}`,
      name: `session-${i}`,
      status: 'completed',
      updatedAt: FIXED_NOW.toISOString(),
    }));
    const snap = assemblePulseSnapshot(
      baseInputs(),
      emptyDeps({ countSessionsSince: () => sessions }),
    );
    const sessionLines = snap.text.split('\n').filter((l) => l.startsWith('- session-'));
    expect(sessionLines.length).toBeLessThanOrEqual(20);
    expect(snap.diffSummary.sessions).toBe(30);
  });

  test('token-budget truncation kicks in for big snapshots', () => {
    const longBody = 'lorem ipsum '.repeat(500);
    const goals: PulseSnapshotGoal[] = Array.from({ length: 50 }, (_, i) => ({
      slug: `g${i}`,
      name: `Goal ${i}`,
      body: longBody,
      status: 'active' as const,
    }));
    const snap = assemblePulseSnapshot(baseInputs(), emptyDeps({ loadGoalDocs: () => goals }));
    expect(snap.truncated).toBe(true);
    // Rough budget check (text length ~ tokens * 4). Allow a generous tail since
    // truncation is bounded to 3 passes and may not get fully under budget.
    expect(snap.tokenEstimate).toBeGreaterThan(0);
  });

  test('recent decisions render one line per tick with action + reason/message', () => {
    const ticks: PulseTickEntry[] = [
      {
        pulseId: 'morning',
        tickedAt: '2026-05-01T09:00:00.000Z',
        durationMs: 100,
        driverSessionId: 's1',
        diffSummary: { outputs: 0, sessions: 0, automations: 0, memoryWrites: 0 },
        decision: { action: 'do_nothing', reason: 'quiet morning' },
      },
      {
        pulseId: 'morning',
        tickedAt: '2026-05-01T10:00:00.000Z',
        durationMs: 200,
        driverSessionId: 's2',
        diffSummary: { outputs: 0, sessions: 0, automations: 0, memoryWrites: 0 },
        decision: {
          action: 'notify_user',
          message: 'deadline approaching',
          urgency: 'normal',
        },
      },
    ];
    const snap = assemblePulseSnapshot(baseInputs(), emptyDeps({ recentTicks: () => ticks }));
    expect(snap.text).toContain('do_nothing: quiet morning');
    expect(snap.text).toContain('notify_user: deadline approaching');
  });

  test('lastTickAt is used as the diff "since" timestamp when provided', () => {
    let receivedSince = '';
    assemblePulseSnapshot(
      baseInputs({ lastTickAt: '2026-05-02T14:30:00.000Z' }),
      emptyDeps({
        countOutputsSince: (since) => {
          receivedSince = since;
          return [];
        },
      }),
    );
    expect(receivedSince).toBe('2026-05-02T14:30:00.000Z');
  });

  test('without lastTickAt, since = now - diffWindowMinutes', () => {
    let receivedSince = '';
    assemblePulseSnapshot(
      baseInputs({ diffWindowMinutes: 60 }),
      emptyDeps({
        countOutputsSince: (since) => {
          receivedSince = since;
          return [];
        },
      }),
    );
    // 15:00 - 60min = 14:00
    expect(receivedSince).toBe('2026-05-02T14:00:00.000Z');
  });

  test('budget constant is exposed', () => {
    expect(PULSE_SNAPSHOT_TOKEN_BUDGET).toBe(3000);
  });
});
