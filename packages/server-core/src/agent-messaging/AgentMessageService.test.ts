import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readAgentMessageReceipt } from '@craft-agent/shared/agent-messaging';
import { AgentMessageService, type AgentMessageServiceDeps } from './AgentMessageService.ts';

let root = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'runner-agent-message-service-test-'));
});

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

function deps(overrides?: Partial<AgentMessageServiceDeps>): AgentMessageServiceDeps {
  return {
    createSession: async () => ({ id: 'child-1' }),
    resolveAgentSessionOptions: async (_workspaceId, agentSlug) => ({
      spawnedFromAgent: { agentSlug, agentName: agentSlug, timestamp: 1 },
      enabledSourceSlugs: ['exa'],
      agentSkillSlugs: ['research'],
      launchReceipt: {
        createdAt: 1,
        origin: 'agent',
        agent: { slug: agentSlug, name: agentSlug },
        config: {},
        injected: {
          skills: ['research'],
          sources: ['exa'],
          contextDocs: [{ slug: 'profile', name: 'User Profile' }],
          memory: {
            user: [{ name: 'user-preferences' }],
            agent: [{ name: 'reviewer-memory' }],
          },
        },
      },
    }),
    sendMessage: async () => {},
    abortSession: async () => {},
    getLastAssistantText: () => 'Delegated answer.',
    getSessionToolUseSummary: () => ({ count: 1, names: ['search'] }),
    getWorkspaceRootPath: () => root,
    resolveUsableSourceSlugs: (_workspaceId, sourceSlugs) => ({ usable: sourceSlugs, unavailable: [] }),
    now: () => '2026-06-08T00:00:00.000Z',
    ...overrides,
  };
}

describe('AgentMessageService', () => {
  test('creates hidden child session and persists succeeded receipt', async () => {
    const created: unknown[] = [];
    const sent: string[] = [];
    const service = new AgentMessageService(deps({
      createSession: async (_workspaceId, options) => {
        created.push(options);
        return { id: 'child-1' };
      },
      sendMessage: async (_sessionId, prompt) => {
        sent.push(prompt);
      },
    }));

    const result = await service.messageAgent({
      workspaceId: 'ws',
      parentSessionId: 'parent',
      callerAgentSlug: 'researcher',
      parentPermissionMode: 'ask',
    }, {
      agentSlug: 'reviewer',
      task: 'Review this.',
      sourceSlugs: ['exa'],
      permissionMode: 'safe',
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe('succeeded');
    expect(result.childSessionId).toBe('child-1');
    expect(created[0]).toMatchObject({ hidden: true, permissionMode: 'safe', labels: ['agent-message-depth:1'] });
    expect(created[0]).toMatchObject({
      launchReceipt: {
        injected: {
          skills: ['research'],
          sources: ['exa'],
          contextDocs: [{ slug: 'profile', name: 'User Profile' }],
          memory: {
            user: [{ name: 'user-preferences' }],
            agent: [{ name: 'reviewer-memory' }],
          },
        },
      },
    });
    expect(sent[0]).toContain('Task:\nReview this.');
    expect(sent[0]).toContain('Parent session ID: parent');
    expect(sent[0]).toContain('use send_agent_message with sessionId "parent" and deliveryMode "passive"');
    expect(sent[0]).toContain('Still return the requested final result');
    expect(readAgentMessageReceipt(root, result.receiptId!)?.status).toBe('succeeded');
  });

  test('fails before session create when selected source is unavailable', async () => {
    let created = false;
    const service = new AgentMessageService(deps({
      createSession: async () => {
        created = true;
        return { id: 'child-1' };
      },
      resolveUsableSourceSlugs: () => ({ usable: [], unavailable: ['missing-source'] }),
    }));

    const result = await service.messageAgent({
      workspaceId: 'ws',
      parentPermissionMode: 'ask',
    }, {
      agentSlug: 'reviewer',
      task: 'Review this.',
      sourceSlugs: ['missing-source'],
    });

    expect(created).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.error?.message).toContain('missing-source');
  });

  test('returns timeout result without waiting for stalled child send to drain', async () => {
    let aborted = false;
    const started = Date.now();
    const service = new AgentMessageService(deps({
      sendMessage: async () => {
        await new Promise(() => {});
      },
      abortSession: async () => {
        aborted = true;
      },
    }));

    const result = await service.messageAgent({
      workspaceId: 'ws',
      parentPermissionMode: 'ask',
    }, {
      agentSlug: 'reviewer',
      task: 'Review this.',
      timeoutSeconds: 1,
    });

    expect(aborted).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.status).toBe('timed-out');
    expect(result.error?.code).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(2500);
    expect(readAgentMessageReceipt(root, result.receiptId!)?.status).toBe('timed-out');
  });

  test('validates structured output schema', async () => {
    const service = new AgentMessageService(deps({
      getLastAssistantText: () => '{"verdict":"pass"}',
    }));

    const result = await service.messageAgent({
      workspaceId: 'ws',
      parentPermissionMode: 'ask',
    }, {
      agentSlug: 'reviewer',
      task: 'Return JSON.',
      outputSchema: {
        type: 'object',
        required: ['verdict'],
        properties: {
          verdict: { type: 'string' },
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe('succeeded');
    expect(result.output).toEqual({ verdict: 'pass' });
  });

  test('background delegation returns immediately and completes receipt later', async () => {
    let resolveSend: (() => void) | undefined;
    let sendStarted = false;
    const passiveMessages: string[] = [];
    const passiveMetadata: unknown[] = [];
    const service = new AgentMessageService(deps({
      sendMessage: async () => {
        sendStarted = true;
        await new Promise<void>((resolve) => {
          resolveSend = resolve;
        });
      },
      deliverPassiveMessage: async (_sessionId, message, agentMessage) => {
        passiveMessages.push(message);
        passiveMetadata.push(agentMessage);
        if (message.includes('started')) {
          expect(sendStarted).toBe(false);
        }
      },
    }));

    const started = Date.now();
    const result = await service.messageAgent({
      workspaceId: 'ws',
      parentSessionId: 'parent',
      parentPermissionMode: 'ask',
    }, {
      agentSlug: 'reviewer',
      task: 'Review this in the background.',
      background: true,
    });

    expect(Date.now() - started).toBeLessThan(250);
    expect(result.ok).toBe(true);
    expect(result.status).toBe('running');
    expect(readAgentMessageReceipt(root, result.receiptId!)?.status).toBe('running');
    expect(passiveMessages[0]).toContain('Background agent "reviewer" started');
    expect(passiveMessages[0]).toContain(`receiptId: ${result.receiptId}`);
    expect(passiveMessages[0]).toContain('childSessionId: child-1');
    expect(passiveMetadata[0]).toEqual({
      receiptId: result.receiptId,
      childSessionId: 'child-1',
      targetAgentSlug: 'reviewer',
      status: 'running',
    });

    resolveSend?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(readAgentMessageReceipt(root, result.receiptId!)?.status).toBe('succeeded');
    expect(passiveMessages[1]).toContain('Background agent "reviewer" finished');
    expect(passiveMessages[1]).toContain(`receiptId: ${result.receiptId}`);
    expect(passiveMetadata[1]).toMatchObject({
      receiptId: result.receiptId,
      childSessionId: 'child-1',
      targetAgentSlug: 'reviewer',
      status: 'succeeded',
    });
  });
});
