import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readSessionJsonl,
  writeSessionJsonl,
} from '../jsonl.ts';
import { listSessions } from '../storage.ts';
import { SESSION_PERSISTENT_FIELDS, type StoredSession } from '../types.ts';
import { pickSessionFields } from '../utils.ts';

describe('session persistence: branchFromSessionId', () => {
  it('includes branchFromSessionId in SESSION_PERSISTENT_FIELDS', () => {
    expect(SESSION_PERSISTENT_FIELDS).toContain('branchFromSessionId');
  });

  it('pickSessionFields preserves branchFromSessionId when present', () => {
    const source = {
      id: 'child',
      workspaceRootPath: '/tmp/ws',
      branchFromMessageId: 'm-42',
      branchFromSessionId: 'parent',
      createdAt: 1,
      lastUsedAt: 2,
      ignoredRuntimeField: 'nope',
    } as const;

    const picked = pickSessionFields(source);
    expect(picked.branchFromMessageId).toBe('m-42');
    expect(picked.branchFromSessionId).toBe('parent');
    expect((picked as Record<string, unknown>).ignoredRuntimeField).toBeUndefined();
  });

  it('round-trips branchFromSessionId through JSONL write/read and listSessions', () => {
    const root = mkdtempSync(join(tmpdir(), 'branch-lineage-'));
    try {
      const sessionId = 'child-session';
      const sessionDir = join(root, 'sessions', sessionId);
      mkdirSync(sessionDir, { recursive: true });
      const file = join(sessionDir, 'session.jsonl');

      const stored: StoredSession = {
        id: sessionId,
        workspaceRootPath: root,
        createdAt: 100,
        lastUsedAt: 200,
        lastMessageAt: 200,
        name: 'Branch of parent',
        branchFromMessageId: 'msg-7',
        branchFromSessionId: 'parent-session',
        messages: [],
        tokenUsage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          contextTokens: 0,
          costUsd: 0,
        },
      };

      writeSessionJsonl(file, stored);

      const reread = readSessionJsonl(file);
      expect(reread?.branchFromSessionId).toBe('parent-session');
      expect(reread?.branchFromMessageId).toBe('msg-7');

      const listed = listSessions(root);
      const meta = listed.find((s) => s.id === sessionId);
      expect(meta).toBeDefined();
      expect((meta as unknown as Record<string, unknown>).branchFromSessionId).toBe('parent-session');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
