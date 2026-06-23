import { describe, expect, test } from 'bun:test';
import type { SessionToolContext } from '../context.ts';
import { handleSendAgentMessage } from './send-agent-message.ts';

function makeCtx(overrides?: Partial<SessionToolContext>): SessionToolContext {
  return {
    sessionId: 'sender',
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
    getSessionInfo: () => ({ id: 'sender', name: 'Sender' } as ReturnType<NonNullable<SessionToolContext['getSessionInfo']>>),
    ...overrides,
  } as SessionToolContext;
}

describe('send_agent_message handler', () => {
  test('forwards passive delivery mode', async () => {
    const calls: unknown[] = [];
    const result = await handleSendAgentMessage(makeCtx({
      sendAgentMessage: async (...args) => {
        calls.push(args);
      },
    }), {
      sessionId: 'target',
      message: 'Progress update.',
      deliveryMode: 'passive',
    });

    expect(result.isError).toBe(false);
    expect(calls[0]).toEqual([
      'target',
      expect.stringContaining('Progress update.'),
      undefined,
      { deliveryMode: 'passive' },
    ]);
    expect(result.content[0]?.text).toContain('Passive message delivered');
  });

  test('rejects passive delivery with attachments', async () => {
    let called = false;
    const result = await handleSendAgentMessage(makeCtx({
      sendAgentMessage: async () => {
        called = true;
      },
    }), {
      sessionId: 'target',
      message: 'See attached.',
      deliveryMode: 'passive',
      attachments: [{ path: '/tmp/file.txt' }],
    });

    expect(result.isError).toBe(true);
    expect(called).toBe(false);
    expect(result.content[0]?.text).toContain('do not support attachments');
  });
});
