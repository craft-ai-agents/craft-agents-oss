/**
 * Tests for the feature-gate pin in buildClaudeSubprocessEnv (agent/options.ts)
 *
 * The spawned Claude Code CLI is pinned to its compiled-in feature-gate
 * defaults via DISABLE_GROWTHBOOK so remote config cannot silently change
 * subprocess behavior (e.g. blocking vs async Task subagent launches) between
 * or during runs. An explicit value already present in the environment or
 * passed via envOverrides is respected.
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { buildClaudeSubprocessEnv } from '../src/agent/options.ts';

const saved = process.env.DISABLE_GROWTHBOOK;

afterEach(() => {
  if (saved === undefined) delete process.env.DISABLE_GROWTHBOOK;
  else process.env.DISABLE_GROWTHBOOK = saved;
});

describe('buildClaudeSubprocessEnv feature-gate pin', () => {
  it('pins DISABLE_GROWTHBOOK=1 so feature gates resolve to compiled defaults', () => {
    delete process.env.DISABLE_GROWTHBOOK;
    const env = buildClaudeSubprocessEnv();
    expect(env.DISABLE_GROWTHBOOK).toBe('1');
  });

  it('respects a DISABLE_GROWTHBOOK value already present in the environment', () => {
    process.env.DISABLE_GROWTHBOOK = 'preset';
    const env = buildClaudeSubprocessEnv();
    expect(env.DISABLE_GROWTHBOOK).toBe('preset');
  });

  it('respects a DISABLE_GROWTHBOOK value passed via envOverrides', () => {
    delete process.env.DISABLE_GROWTHBOOK;
    const env = buildClaudeSubprocessEnv({ DISABLE_GROWTHBOOK: 'override' });
    expect(env.DISABLE_GROWTHBOOK).toBe('override');
  });
});
