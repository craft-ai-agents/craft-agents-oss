import { describe, it, expect } from 'bun:test';
import * as os from 'node:os';
import * as path from 'node:path';
import { handleSetWorkingDirectory } from './set-working-directory.ts';
import type { SessionToolContext } from '../context.ts';

function makeCtx(opts: {
  setWorkingDirectory?: (p: string) => Promise<{ ok: boolean; reason?: string }>;
  workingDirectory?: string;
}): SessionToolContext {
  return {
    sessionId: 's1',
    workspacePath: '/tmp/ws',
    plansFolderPath: '/tmp/ws/plans',
    callbacks: { onPlanSubmitted: () => {}, onAuthRequest: () => {} },
    fs: {} as any,
    workingDirectory: opts.workingDirectory,
    setWorkingDirectory: opts.setWorkingDirectory,
    loadSourceConfig: () => null,
    get sourcesPath() { return '/tmp/ws/sources'; },
    get skillsPath() { return '/tmp/ws/skills'; },
  } as SessionToolContext;
}

describe('handleSetWorkingDirectory', () => {
  it('returns error when binding is missing', async () => {
    const result = await handleSetWorkingDirectory(makeCtx({}), { path: '/tmp' });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('not available');
  });

  it('rejects empty path', async () => {
    const result = await handleSetWorkingDirectory(
      makeCtx({ setWorkingDirectory: async () => ({ ok: true }) }),
      { path: '   ' }
    );
    expect(result.isError).toBe(true);
  });

  it('expands tilde and forwards to backend', async () => {
    let received: string | null = null;
    const ctx = makeCtx({
      setWorkingDirectory: async (p) => {
        received = p;
        return { ok: true, path: p };
      },
    });
    const result = await handleSetWorkingDirectory(ctx, { path: '~' });
    expect(result.isError).toBeFalsy();
    expect(received).toBe(os.homedir());
  });

  it('forwards relative paths verbatim (resolution is the backend\'s job)', async () => {
    let received: string | null = null;
    const ctx = makeCtx({
      workingDirectory: '/tmp/base',
      setWorkingDirectory: async (p) => {
        received = p;
        return { ok: true, path: '/tmp/base/sub/dir' };
      },
    });
    const result = await handleSetWorkingDirectory(ctx, { path: 'sub/dir' });
    expect(result.isError).toBeFalsy();
    // Handler must NOT resolve against process.cwd or ctx.workingDirectory —
    // SessionToolContext.workingDirectory is unreliable across backends.
    expect(received).toBe('sub/dir');
    expect(JSON.stringify(result)).toContain('/tmp/base/sub/dir');
  });

  it('expands Windows-style ~\\ home-relative paths', async () => {
    let received: string | null = null;
    const ctx = makeCtx({
      setWorkingDirectory: async (p) => {
        received = p;
        return { ok: true, path: p };
      },
    });
    await handleSetWorkingDirectory(ctx, { path: '~\\projects' });
    expect(received).toBe(path.join(os.homedir(), 'projects'));
  });

  it('surfaces backend rejection reason', async () => {
    const ctx = makeCtx({
      setWorkingDirectory: async () => ({ ok: false, reason: 'not a directory' }),
    });
    const result = await handleSetWorkingDirectory(ctx, { path: '/tmp/file.txt' });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('not a directory');
  });
});
