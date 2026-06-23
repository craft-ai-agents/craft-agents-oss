import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  listAgentMessageReceipts,
  readAgentMessageReceipt,
  writeAgentMessageReceipt,
  type AgentMessageReceipt,
} from './index.ts';

let root = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'runner-agent-message-test-'));
});

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

function receipt(id: string): AgentMessageReceipt {
  return {
    schemaVersion: 1,
    id,
    workspaceId: 'ws',
    targetAgentSlug: 'reviewer',
    task: 'Review this.',
    status: 'succeeded',
    policy: {
      permissionMode: 'safe',
      timeoutSeconds: 300,
      maxTurns: 1,
      maxDepth: 2,
      depth: 0,
    },
    constraints: {
      sourceSlugs: [],
      skillSlugs: [],
    },
    createdAt: `2026-06-08T00:00:0${id}.000Z`,
    updatedAt: `2026-06-08T00:00:0${id}.000Z`,
  };
}

describe('agent messaging storage', () => {
  test('writes, reads, and lists receipts', () => {
    writeAgentMessageReceipt(root, receipt('1'));
    writeAgentMessageReceipt(root, receipt('2'));

    expect(readAgentMessageReceipt(root, '1')?.targetAgentSlug).toBe('reviewer');
    expect(listAgentMessageReceipts(root).map((item) => item.id)).toEqual(['2', '1']);
  });
});
