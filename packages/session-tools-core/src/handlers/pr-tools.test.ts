import { describe, expect, it } from 'bun:test';
import type { SessionToolContext, PrWatchToolCallbacks, PrToolStatusResult } from '../context.ts';
import { handlePrStatus, handlePrBind, handlePrUnbind, handlePrSetAutoMerge } from './pr-tools.ts';

function ctxWith(prWatch?: Partial<PrWatchToolCallbacks>): SessionToolContext {
  return { prWatch } as unknown as SessionToolContext;
}

const text = (r: { content: Array<{ text: string }> }) => r.content.map(c => c.text).join('');

describe('pr tools: unavailable when ctx.prWatch is missing', () => {
  it('each tool returns a clean error', async () => {
    const ctx = ctxWith(undefined);
    for (const result of [
      await handlePrStatus(ctx, {}),
      await handlePrBind(ctx, { pr: '123' }),
      await handlePrUnbind(ctx, { pr: '123' }),
      await handlePrSetAutoMerge(ctx, { pr: '123', enabled: true }),
    ]) {
      expect(result.isError).toBe(true);
      expect(text(result)).toContain('unavailable');
    }
  });
});

describe('pr_status', () => {
  it('passes session_id through and returns the status JSON', async () => {
    let seen: { sessionId?: string } | undefined;
    const status: PrToolStatusResult = { kind: 'ready', sessionId: 's2', prs: [], cached: true };
    const ctx = ctxWith({ status: async (input) => { seen = input; return status; } });
    const result = await handlePrStatus(ctx, { session_id: 's2' });
    expect(result.isError).toBe(false);
    expect(seen).toEqual({ sessionId: 's2' });
    expect(JSON.parse(text(result))).toMatchObject({ kind: 'ready', sessionId: 's2', cached: true });
  });
});

describe('pr_bind', () => {
  it('requires a pr argument', async () => {
    const ctx = ctxWith({ bind: async () => ({ ok: true }) });
    const result = await handlePrBind(ctx, { pr: '  ' });
    expect(result.isError).toBe(true);
  });

  it('surfaces a verify failure as an error', async () => {
    const ctx = ctxWith({ bind: async () => ({ ok: false, error: 'PR #9 not found in acme/app.' }) });
    const result = await handlePrBind(ctx, { pr: '9' });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('not found');
  });

  it('returns the bound PR on success', async () => {
    const ctx = ctxWith({ bind: async ({ ref }) => ({ ok: true, boundCount: 2, pr: { id: `x#${ref}` } as never }) });
    const result = await handlePrBind(ctx, { pr: 'https://github.com/o/r/pull/5' });
    expect(result.isError).toBe(false);
    expect(JSON.parse(text(result))).toMatchObject({ ok: true, boundCount: 2 });
  });
});

describe('pr_unbind', () => {
  it('reports when the PR was not bound', async () => {
    const ctx = ctxWith({ unbind: async () => ({ ok: true, removed: false, boundCount: 1 }) });
    const result = await handlePrUnbind(ctx, { pr: '7' });
    expect(result.isError).toBe(false);
    expect(text(result)).toContain("wasn't bound");
  });
});

describe('pr_set_auto_merge', () => {
  it('requires the enabled flag', async () => {
    const ctx = ctxWith({ setAutoMerge: async () => ({ ok: true, enabled: true }) });
    const result = await handlePrSetAutoMerge(ctx, { pr: '7' } as never);
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('enabled is required');
  });

  it('passes the method through and returns the new state', async () => {
    let seen: unknown;
    const ctx = ctxWith({ setAutoMerge: async (input) => { seen = input; return { ok: true, enabled: true, method: 'squash' }; } });
    const result = await handlePrSetAutoMerge(ctx, { pr: '7', enabled: true, method: 'squash' });
    expect(result.isError).toBe(false);
    expect(seen).toEqual({ ref: '7', enabled: true, method: 'squash' });
    expect(JSON.parse(text(result))).toMatchObject({ ok: true, enabled: true, method: 'squash' });
  });
});
