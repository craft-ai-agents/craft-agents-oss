import { describe, it, expect } from 'bun:test';
import { handleSendAgentMessage } from './send-agent-message.ts';
import type { SessionToolContext, SendAgentMessageResult } from '../context.ts';

function createCtx(
  result: SendAgentMessageResult,
  opts?: { name?: string },
): { ctx: SessionToolContext; calls: Array<{ sessionId: string; message: string }> } {
  const calls: Array<{ sessionId: string; message: string }> = [];
  const ctx = {
    sessionId: 'sender-1',
    getSessionInfo: () => (opts?.name ? ({ name: opts.name } as never) : null),
    sendAgentMessage: async (sessionId: string, message: string) => {
      calls.push({ sessionId, message });
      return result;
    },
  } as unknown as SessionToolContext;
  return { ctx, calls };
}

describe('handleSendAgentMessage delivery ack', () => {
  it('reports a delivered ack when the target was idle', async () => {
    const { ctx } = createCtx({ delivery: 'delivered', targetBusy: false });
    const res = await handleSendAgentMessage(ctx, { sessionId: 'target-9', message: 'hi' });
    expect(res.isError).toBeFalsy();
    expect(JSON.stringify(res)).toContain('delivered');
  });

  it('reports a queued (busy) ack when the target was mid-turn', async () => {
    const { ctx } = createCtx({ delivery: 'queued', targetBusy: true });
    const res = await handleSendAgentMessage(ctx, { sessionId: 'target-9', message: 'status?' });
    expect(res.isError).toBeFalsy();
    const text = JSON.stringify(res);
    expect(text).toContain('queued');
    // Must warn the sender not to assume the message was read yet.
    expect(text.toLowerCase()).toContain('do not assume it was read');
  });

  it('wraps the message with a sender envelope', async () => {
    const { ctx, calls } = createCtx({ delivery: 'delivered', targetBusy: false }, { name: 'Monitor' });
    await handleSendAgentMessage(ctx, { sessionId: 'target-9', message: 'ping' });
    expect(calls).toHaveLength(1);
    expect(calls[0].message).toContain('sender-1');
    expect(calls[0].message).toContain('ping');
  });

  it('rejects a self-send', async () => {
    const { ctx } = createCtx({ delivery: 'delivered', targetBusy: false });
    const res = await handleSendAgentMessage(ctx, { sessionId: 'sender-1', message: 'loop' });
    expect(res.isError).toBe(true);
  });
});
