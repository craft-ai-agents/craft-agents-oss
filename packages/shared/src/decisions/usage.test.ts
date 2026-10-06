import { describe, expect, it } from 'bun:test';
import type { DecisionLogLine } from './records.ts';
import { formatDecisionUsage, parseDecisionLog, summarizeDecisionUsage } from './usage.ts';

const decision = (id: string | undefined, feature: string, extra: Record<string, unknown> = {}): DecisionLogLine => ({
  ...(id ? { id } : {}),
  t: '2026-09-27T10:00:00.000Z',
  feature,
  provider: 'vercel-ai-gateway',
  model: 'typesafe-ai/jev',
  ok: true,
  questions: {},
  state: null,
  latencyMs: 300,
  usage: { inputTokens: 100, outputTokens: 5 },
  sessionId: 's1',
  ...extra,
} as DecisionLogLine);

const outcome = (decisionId: string, action: string, changed: boolean): DecisionLogLine => ({
  kind: 'outcome',
  t: '2026-09-27T10:00:01.000Z',
  decisionId,
  feature: 'adaptive_thinking',
  action,
  changed,
});

const followUp = (decisionId: string, result: string): DecisionLogLine => ({
  kind: 'followup',
  t: '2026-09-27T10:05:00.000Z',
  decisionId,
  feature: 'suggestions',
  result,
});

describe('decision usage summary', () => {
  const lines: DecisionLogLine[] = [
    decision('a', 'adaptive_thinking'),
    outcome('a', 'thinking:medium', true),
    decision('b', 'adaptive_thinking', { latencyMs: 900, sessionId: 's2' }),
    outcome('b', 'keep', false),
    decision(undefined, 'adaptive_thinking'), // written before outcomes existed
    decision('c', 'turn_outcome', { ok: false, error: { kind: 'cancelled', message: 'x' }, usage: undefined }),
    decision('d', 'smart_titles', { provider: 'openrouter', t: '2026-09-20T10:00:00.000Z' }),
  ];

  it('joins outcomes, counts changes, failures, latency, tokens and sessions per feature', () => {
    const summary = summarizeDecisionUsage(lines);
    expect(summary.total).toBe(5);
    expect(summary.failures).toBe(1);
    expect(summary.providers).toEqual({ 'vercel-ai-gateway': 4, openrouter: 1 });
    const thinking = summary.features.find(f => f.feature === 'adaptive_thinking')!;
    expect(thinking).toMatchObject({
      calls: 3,
      failures: 0,
      withOutcome: 2,
      changed: 1,
      actions: { 'thinking:medium': 1, keep: 1 },
      inputTokens: 300,
      sessions: 2,
      latencyP50Ms: 300,
      latencyP95Ms: 900,
    });
    expect(summary.features.find(f => f.feature === 'turn_outcome')).toMatchObject({ failures: 1, failureKinds: { cancelled: 1 } });
  });

  it('filters by session, feature, provider and time', () => {
    expect(summarizeDecisionUsage(lines, { sessionId: 's2' }).total).toBe(1);
    expect(summarizeDecisionUsage(lines, { feature: 'turn_outcome' }).total).toBe(1);
    expect(summarizeDecisionUsage(lines, { providers: ['openrouter'] }).total).toBe(1);
    expect(summarizeDecisionUsage(lines, { since: new Date('2026-09-25T00:00:00Z') }).total).toBe(4);
  });

  it('counts follow-ups per feature without counting them as decisions', () => {
    const withFollowUps: DecisionLogLine[] = [
      decision('s1', 'suggestions'),
      outcome('s1', 'hint:source:gmail', true),
      followUp('s1', 'hint_used'),
      decision('s2', 'suggestions'),
      outcome('s2', 'none', false),
      followUp('s2', 'held_back_used'),
      followUp('unknown', 'hint_used'),  // its decision was rotated away
    ];
    const summary = summarizeDecisionUsage(withFollowUps);
    expect(summary.total).toBe(2);
    expect(summary.features[0]).toMatchObject({ feature: 'suggestions', followUps: { hint_used: 1, held_back_used: 1 } });
    expect(summary.features[0]!.followUpsByAction).toEqual({ 'hint:source:gmail': { hint_used: 1 }, none: { held_back_used: 1 } });
    const table = formatDecisionUsage(summary);
    expect(table).toContain('follow-ups');
    expect(table).toContain('held_back_used×1');
    expect(table).toContain('  none → held_back_used×1');
  });

  it('counts calls made after the provider was idle, and how many of those failed', () => {
    const summary = summarizeDecisionUsage([
      decision('a', 'suggestions', { coldStart: true }),
      decision('b', 'suggestions', { coldStart: true, ok: false, error: { kind: 'timeout', message: 'x' } }),
      decision('c', 'suggestions'),
    ]);
    expect(summary.features[0]).toMatchObject({ calls: 3, failures: 1, coldCalls: 2, coldFailures: 1 });
    expect(formatDecisionUsage(summary)).toContain('cold failed');
  });

  it('skips torn lines and formats a table', () => {
    const text = `${lines.map(line => JSON.stringify(line)).join('\n')}\n{"t":"2026-09`;
    expect(parseDecisionLog(text)).toHaveLength(lines.length);
    const table = formatDecisionUsage(summarizeDecisionUsage(lines));
    expect(table).toContain('adaptive_thinking');
    expect(table).toContain('1/2');
    expect(formatDecisionUsage(summarizeDecisionUsage([]))).toBe('No decision records match.');
  });
});

describe('decision usage per Settings toggle', () => {
  it('reads the current and rotated log and reports per toggle since the window start', async () => {
    const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const { readDecisionToggleUsage, DECISION_RECORD_TAGS } = await import('./usage.ts');
    const dir = mkdtempSync(join(tmpdir(), 'toggle-usage-'));
    try {
      const recent = (id: string, feature: string, extra: Record<string, unknown> = {}) => decision(id, feature, { t: '2026-09-30T10:00:00.000Z', ...extra });
      writeFileSync(join(dir, 'decisions.prev.jsonl'), [recent('a', 'adaptive_thinking'), outcome('a', 'thinking:low', true)].map(line => JSON.stringify(line)).join('\n'));
      writeFileSync(join(dir, 'decisions.jsonl'), [
        recent('b', 'adaptive_thinking', { ok: false, error: { kind: 'timeout', message: 'x' } }),
        recent('c', 'large_results'), outcome('c', 'summarize', false),
        decision('d', 'large_results'), // 2026-09-27: before the window
      ].map(line => JSON.stringify(line)).join('\n'));
      expect(await readDecisionToggleUsage(new Date('2026-09-29T00:00:00Z'), join(dir, 'decisions.jsonl'))).toEqual({
        adaptiveThinking: { calls: 2, failures: 1, changed: 1, withOutcome: 1 },
        largeResults: { calls: 1, failures: 0, changed: 0, withOutcome: 1 },
      });
      expect(new Set(Object.values(DECISION_RECORD_TAGS)).size).toBe(Object.keys(DECISION_RECORD_TAGS).length);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
