import { describe, expect, test } from 'bun:test';
import type { SessionToolContext } from '../context.ts';
import { handleMessageAgent } from './message-agent.ts';

function makeCtx(overrides?: Partial<SessionToolContext>): SessionToolContext {
  return {
    sessionId: 'parent',
    workspacePath: '/tmp/ws',
    get sourcesPath() { return '/tmp/ws/sources'; },
    get skillsPath() { return '/tmp/ws/skills'; },
    plansFolderPath: '/tmp/ws/plans',
    callbacks: {
      onPlanSubmitted: () => {},
      onAuthRequest: () => {},
    },
    fs: {} as SessionToolContext['fs'],
    loadSourceConfig: () => null,
    ...overrides,
  } as SessionToolContext;
}

describe('message_agent handler', () => {
  test('errors when capability is unavailable', async () => {
    const result = await handleMessageAgent(makeCtx(), {
      agentSlug: 'reviewer',
      task: 'Review this.',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('not available');
  });

  test('returns structured service result', async () => {
    const result = await handleMessageAgent(makeCtx({
      messageAgent: async (input) => ({
        ok: true,
        status: 'succeeded',
        receiptId: 'r1',
        childSessionId: 's2',
        agentSlug: input.agentSlug,
        output: 'Looks good.',
        summary: 'Looks good.',
        toolUseCount: 0,
        toolNames: [],
        durationMs: 12,
      }),
    }), {
      agentSlug: 'reviewer',
      task: 'Review this.',
    });

    expect(result.isError).toBe(false);
    expect(result.structuredContent?.receiptId).toBe('r1');
    expect(result.content[0]?.text).toContain('completed');
  });

  test('returns model-visible error text for failed service result', async () => {
    const result = await handleMessageAgent(makeCtx({
      messageAgent: async (input) => ({
        ok: false,
        status: 'timed-out',
        receiptId: 'r2',
        childSessionId: 's3',
        agentSlug: input.agentSlug,
        toolUseCount: 0,
        toolNames: [],
        durationMs: 12,
        error: { code: 'timeout', message: 'Delegated agent timed out.' },
      }),
    }), {
      agentSlug: 'reviewer',
      task: 'Review this.',
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent?.receiptId).toBe('r2');
    expect(result.content[0]?.text.startsWith('[ERROR]')).toBe(true);
    expect(result.content[0]?.text).toContain('timeout');
  });

  test('reports background start as success', async () => {
    const result = await handleMessageAgent(makeCtx({
      messageAgent: async (input) => ({
        ok: true,
        status: 'running',
        receiptId: 'r3',
        childSessionId: 's4',
        agentSlug: input.agentSlug,
        toolUseCount: 0,
        toolNames: [],
        durationMs: 2,
      }),
    }), {
      agentSlug: 'reviewer',
      task: 'Review this.',
      background: true,
    });

    expect(result.isError).toBe(false);
    expect(result.structuredContent?.status).toBe('running');
    expect(result.content[0]?.text).toContain('started delegated task in the background');
  });
});
