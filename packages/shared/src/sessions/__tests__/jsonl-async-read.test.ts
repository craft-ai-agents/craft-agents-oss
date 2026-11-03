/**
 * Tests for the resilient async session-header read (#1113):
 * readSessionHeaderAsync parity/null-on-missing, and the isLikelyEvicted heuristic.
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readSessionHeader, readSessionHeaderAsync, isLikelyEvicted } from '../jsonl.ts';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function writeHeader(overrides: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'session-async-read-'));
  tempDirs.push(dir);
  const sessionFile = join(dir, 'session.jsonl');
  const header = {
    id: 's-async',
    workspaceRootPath: '/tmp/ws',
    createdAt: 1,
    lastUsedAt: 2,
    messageCount: 0,
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 },
    ...overrides,
  };
  writeFileSync(sessionFile, `${JSON.stringify(header)}\n`, 'utf-8');
  return sessionFile;
}

describe('readSessionHeaderAsync()', () => {
  it('parses a valid header, matching the sync reader', async () => {
    const file = writeHeader({ id: 's1', permissionMode: 'execute' });
    const asyncHeader = await readSessionHeaderAsync(file);
    const syncHeader = readSessionHeader(file);
    expect(asyncHeader?.id).toBe('s1');
    // Canonical normalization applies on both paths.
    expect(asyncHeader?.permissionMode).toBe('allow-all');
    expect(asyncHeader).toEqual(syncHeader);
  });

  it('returns null for a missing file (stat rejects, no throw)', async () => {
    const missing = join(tmpdir(), 'definitely-does-not-exist-1113', 'session.jsonl');
    expect(await readSessionHeaderAsync(missing)).toBeNull();
  });

  it('returns null for a corrupt header line without throwing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'session-async-corrupt-'));
    tempDirs.push(dir);
    const file = join(dir, 'session.jsonl');
    writeFileSync(file, '{ this is not valid json\n', 'utf-8');
    expect(await readSessionHeaderAsync(file)).toBeNull();
  });
});

describe('isLikelyEvicted()', () => {
  const darwin = process.platform === 'darwin';

  it('flags a non-resident file (size > 0, blocks === 0) only on darwin', () => {
    expect(isLikelyEvicted({ size: 8192, blocks: 0 })).toBe(darwin);
  });

  it('treats a resident file (blocks > 0) as available everywhere', () => {
    expect(isLikelyEvicted({ size: 8192, blocks: 16 })).toBe(false);
  });

  it('treats an empty file (size 0) as available everywhere', () => {
    expect(isLikelyEvicted({ size: 0, blocks: 0 })).toBe(false);
  });
});
