import { describe, expect, it } from 'bun:test';
import { deferContextUsage, readContextUsage } from './context-usage.ts';

function session(overrides: Partial<any> = {}) {
  return {
    getContextUsage: () => ({ tokens: 42_000, contextWindow: 500_000, percent: 8.4 }),
    settingsManager: { getCompactionSettings: () => ({ enabled: true, reserveTokens: 31_000 }) },
    ...overrides,
  } as any;
}

describe('Pi server context usage transport', () => {
  it('reads raw SDK usage and real compaction settings without normalizing in subprocess', () => {
    expect(readContextUsage(session())).toEqual({
      contextUsage: { tokens: 42_000, contextWindow: 500_000, percent: 8.4 },
      compactionSettings: { enabled: true, reserveTokens: 31_000 },
    });
  });

  it('fails soft when SDK usage is unavailable but still carries settings', () => {
    expect(readContextUsage(session({ getContextUsage: () => { throw new Error('not ready'); } }))).toEqual({
      compactionSettings: { enabled: true, reserveTokens: 31_000 },
    });
  });

  it('reads the active model\'s reserve, as the SDK compaction checks do', () => {
    const model = { provider: 'anthropic', id: 'claude-opus', contextWindow: 1_000_000 };
    let received: unknown;
    readContextUsage(session({
      model,
      settingsManager: { getCompactionSettings: (m: unknown) => { received = m; return { enabled: true, reserveTokens: 600_000 }; } },
    }));
    expect(received).toBe(model);
  });

  it('guards deferred post-message reads against stale session replacement', async () => {
    const first = session();
    const second = session({ getContextUsage: () => ({ tokens: 1, contextWindow: 2 }) });
    const emitted: any[] = [];
    deferContextUsage(first, () => second, payload => emitted.push(payload));
    await Promise.resolve();
    expect(emitted).toEqual([]);
  });
});
