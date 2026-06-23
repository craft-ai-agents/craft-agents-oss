import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import type { FileSystemInterface, SessionToolContext } from '../context.ts';
import { handleListAgentMessageReceipts } from './list-agent-message-receipts.ts';

let roots: string[] = [];

function realFs(): FileSystemInterface {
  return {
    exists: (path) => {
      try {
        statSync(path);
        return true;
      } catch {
        return false;
      }
    },
    readFile: (path) => readFileSync(path, 'utf-8'),
    readFileBuffer: (path) => readFileSync(path),
    writeFile: (path, content) => writeFileSync(path, content),
    isDirectory: (path) => statSync(path).isDirectory(),
    readdir: (path) => readdirSync(path),
    stat: (path) => statSync(path),
  };
}

function makeCtx(): SessionToolContext {
  const root = mkdtempSync(join(tmpdir(), 'agent-message-receipts-'));
  roots.push(root);
  return {
    sessionId: 'parent',
    workspacePath: root,
    get sourcesPath() { return join(root, 'sources'); },
    get skillsPath() { return join(root, 'skills'); },
    plansFolderPath: join(root, 'plans'),
    callbacks: {
      onPlanSubmitted: () => {},
      onAuthRequest: () => {},
    },
    fs: realFs(),
    loadSourceConfig: () => null,
  } as SessionToolContext;
}

function writeReceipt(ctx: SessionToolContext, receipt: Record<string, unknown>): void {
  const dir = join(ctx.workspacePath, 'agent-messages');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${receipt.id}.json`), JSON.stringify(receipt, null, 2));
}

function receipt(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: 'r1',
    workspaceId: 'workspace',
    childSessionId: 'child',
    callerAgentSlug: 'orchestrator',
    targetAgentSlug: 'reviewer',
    task: 'Review this.',
    status: 'succeeded',
    policy: { permissionMode: 'safe', timeoutSeconds: 300, maxTurns: 1, maxDepth: 2, depth: 0 },
    constraints: { sourceSlugs: [], skillSlugs: [] },
    result: { summary: 'Looks good.', toolUseCount: 1, toolNames: ['read_file'] },
    createdAt: '2026-06-23T01:00:00.000Z',
    updatedAt: '2026-06-23T01:00:05.000Z',
    completedAt: '2026-06-23T01:00:05.000Z',
    ...overrides,
  };
}

afterEach(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
  roots = [];
});

describe('list_agent_message_receipts handler', () => {
  test('returns an empty list when no receipts exist', async () => {
    const result = await handleListAgentMessageReceipts(makeCtx(), {});

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent?.total).toBe(0);
    expect(result.content[0]?.text).toContain('Found 0 agent message receipts');
  });

  test('lists recent receipts with filters and limits', async () => {
    const ctx = makeCtx();
    writeReceipt(ctx, receipt({ id: 'old', targetAgentSlug: 'reviewer', createdAt: '2026-06-23T01:00:00.000Z' }));
    writeReceipt(ctx, receipt({ id: 'new', targetAgentSlug: 'reviewer', createdAt: '2026-06-23T02:00:00.000Z' }));
    writeReceipt(ctx, receipt({ id: 'other', targetAgentSlug: 'researcher', createdAt: '2026-06-23T03:00:00.000Z' }));

    const result = await handleListAgentMessageReceipts(ctx, { agentSlug: 'reviewer', limit: 1 });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent?.total).toBe(2);
    const receipts = result.structuredContent?.receipts as Array<{ id: string }> | undefined;
    expect(receipts?.map((item) => item.id)).toEqual(['new']);
  });

  test('reads a specific receipt by id', async () => {
    const ctx = makeCtx();
    writeReceipt(ctx, receipt({ id: 'r42', childSessionId: 'child-42' }));

    const result = await handleListAgentMessageReceipts(ctx, { receiptId: 'r42' });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent?.total).toBe(1);
    expect(result.content[0]?.text).toContain('childSessionId=child-42');
  });

  test('errors when a specific receipt is missing', async () => {
    const result = await handleListAgentMessageReceipts(makeCtx(), { receiptId: 'missing' });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('not found');
  });
});
