/**
 * Tests for BaseAgent.setPendingSourceActivationRestart first-writer-wins
 * guard (#790).
 *
 * Without the guard, parallel `mcp__session__source_test` calls race on
 * `_pendingSourceActivationRestart` — only the last writer's slug survives,
 * and the user-facing "[{slug} activated]" suffix on the auto-resend becomes
 * non-deterministic across runs.
 */
import { describe, expect, it, beforeEach } from 'bun:test';
import { TestAgent, createMockBackendConfig } from './test-utils.ts';

describe('BaseAgent.setPendingSourceActivationRestart — first-writer-wins', () => {
  let agent: TestAgent;

  beforeEach(() => {
    agent = new TestAgent(createMockBackendConfig());
  });

  it('keeps the first writer when called twice without consume in between', () => {
    agent.setPendingSourceActivationRestart({ sourceSlug: 'first', userMessage: 'msg' });
    agent.setPendingSourceActivationRestart({ sourceSlug: 'second', userMessage: 'msg' });
    expect(agent.consumePendingSourceActivationRestart()?.sourceSlug).toBe('first');
  });

  it('accepts a new writer after consume', () => {
    agent.setPendingSourceActivationRestart({ sourceSlug: 'first', userMessage: 'msg' });
    expect(agent.consumePendingSourceActivationRestart()?.sourceSlug).toBe('first');

    agent.setPendingSourceActivationRestart({ sourceSlug: 'second', userMessage: 'msg' });
    expect(agent.consumePendingSourceActivationRestart()?.sourceSlug).toBe('second');
  });

  it('emits debug log when overlapping activation is rejected', () => {
    const logs: string[] = [];
    agent.onDebug = (msg) => logs.push(msg);

    agent.setPendingSourceActivationRestart({ sourceSlug: 'first', userMessage: 'msg' });
    agent.setPendingSourceActivationRestart({ sourceSlug: 'second', userMessage: 'msg' });

    expect(logs.some((m) => m.includes('overlapping activation') && m.includes('"second"'))).toBe(true);
  });

  it('consume clears state — subsequent calls return null', () => {
    agent.setPendingSourceActivationRestart({ sourceSlug: 'first', userMessage: 'msg' });
    expect(agent.consumePendingSourceActivationRestart()?.sourceSlug).toBe('first');
    expect(agent.consumePendingSourceActivationRestart()).toBeNull();
  });
});
