import { describe, it, expect } from 'bun:test';
import { handleArchiveSession } from './archive-session.ts';
import type { SessionToolContext } from '../context.ts';

function createCtx(opts?: {
  exists?: boolean;
  archiveImpl?: (sessionId: string, archived: boolean) => Promise<void>;
  wired?: boolean;
}): { ctx: SessionToolContext; calls: Array<{ sessionId: string; archived: boolean }> } {
  const calls: Array<{ sessionId: string; archived: boolean }> = [];
  const exists = opts?.exists ?? true;
  const base: Record<string, unknown> = {
    sessionId: 'self-1',
    getSessionInfo: (sessionId?: string) => (exists ? ({ id: sessionId } as never) : null),
  };
  if (opts?.wired !== false) {
    base.archiveSession = async (sessionId: string, archived: boolean) => {
      if (opts?.archiveImpl) return opts.archiveImpl(sessionId, archived);
      calls.push({ sessionId, archived });
    };
  }
  return { ctx: base as unknown as SessionToolContext, calls };
}

describe('handleArchiveSession (archive_session)', () => {
  it('archives another session (archived defaults to true)', async () => {
    const { ctx, calls } = createCtx();
    const res = await handleArchiveSession(ctx, { sessionId: 'other-2' });
    expect(res.isError).toBeFalsy();
    expect(calls).toEqual([{ sessionId: 'other-2', archived: true }]);
  });

  it('unarchives when archived=false', async () => {
    const { ctx, calls } = createCtx();
    const res = await handleArchiveSession(ctx, { sessionId: 'other-2', archived: false });
    expect(res.isError).toBeFalsy();
    expect(calls).toEqual([{ sessionId: 'other-2', archived: false }]);
  });

  it('rejects a missing sessionId', async () => {
    const { ctx, calls } = createCtx();
    const res = await handleArchiveSession(ctx, { sessionId: '' });
    expect(res.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('refuses to archive its own session', async () => {
    const { ctx, calls } = createCtx();
    const res = await handleArchiveSession(ctx, { sessionId: 'self-1' });
    expect(res.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('rejects when the target does not exist', async () => {
    const { ctx, calls } = createCtx({ exists: false });
    const res = await handleArchiveSession(ctx, { sessionId: 'ghost-9' });
    expect(res.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('surfaces a thrown error (e.g. cross-workspace / mid-turn guard)', async () => {
    const { ctx } = createCtx({ archiveImpl: async () => { throw new Error('not found in this workspace'); } });
    const res = await handleArchiveSession(ctx, { sessionId: 'other-2' });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res)).toContain('not found in this workspace');
  });

  it('reports "not available" when the callback is not wired (e.g. Codex context)', async () => {
    const { ctx } = createCtx({ wired: false });
    const res = await handleArchiveSession(ctx, { sessionId: 'other-2' });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res)).toContain('not available');
  });
});
