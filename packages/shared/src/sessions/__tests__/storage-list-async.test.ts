/**
 * Tests for listSessionsAsync (#1113): parity with the sync listSessions for
 * healthy sessions, resilience (skip unreadable without throwing), ordering,
 * and empty-for-missing-dir.
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { listSessions, listSessionsAsync } from '../storage.ts';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function makeWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'ws-list-async-'));
  tempDirs.push(root);
  return root;
}

function writeSession(root: string, id: string, lastUsedAt: number, body?: string): void {
  const dir = join(root, 'sessions', id);
  mkdirSync(dir, { recursive: true });
  const header = {
    id,
    workspaceRootPath: root,
    createdAt: 1,
    lastUsedAt,
    messageCount: 0,
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 },
  };
  writeFileSync(join(dir, 'session.jsonl'), body ?? `${JSON.stringify(header)}\n`, 'utf-8');
}

describe('listSessionsAsync()', () => {
  it('returns [] for a workspace with no sessions dir', async () => {
    const root = makeWorkspace();
    expect(await listSessionsAsync(root)).toEqual([]);
  });

  it('matches the sync listSessions for healthy sessions, newest first', async () => {
    const root = makeWorkspace();
    writeSession(root, 's-old', 100);
    writeSession(root, 's-new', 300);
    writeSession(root, 's-mid', 200);

    const asyncResult = await listSessionsAsync(root);
    const syncResult = listSessions(root);

    expect(asyncResult.map(s => s.id)).toEqual(['s-new', 's-mid', 's-old']);
    expect(asyncResult.map(s => s.id)).toEqual(syncResult.map(s => s.id));
  });

  it('skips a corrupt session.jsonl without throwing or dropping healthy ones', async () => {
    const root = makeWorkspace();
    writeSession(root, 's-good', 100);
    writeSession(root, 's-corrupt', 200, '{ not valid json\n');

    const result = await listSessionsAsync(root);
    expect(result.map(s => s.id)).toEqual(['s-good']);
  });

  it('ignores a session directory with no session.jsonl', async () => {
    const root = makeWorkspace();
    writeSession(root, 's-good', 100);
    mkdirSync(join(root, 'sessions', 's-empty'), { recursive: true });

    const result = await listSessionsAsync(root);
    expect(result.map(s => s.id)).toEqual(['s-good']);
  });

  it('respects the concurrency option (still returns every session)', async () => {
    const root = makeWorkspace();
    for (let i = 0; i < 10; i++) writeSession(root, `s-${i}`, i);
    const result = await listSessionsAsync(root, { concurrency: 2 });
    expect(result).toHaveLength(10);
  });
});
