import { describe, it, expect } from 'bun:test';

import { CodexAgent } from '../codex-agent.ts';
import { AbortReason } from '../core/session-lifecycle.ts';

describe('CodexAgent.redirect()', () => {
  it('returns false and falls back to abort when steer preconditions are not met', () => {
    const abortCalls: AbortReason[] = [];
    const fakeAgent: any = {
      _isProcessing: false,
      client: null,
      codexThreadId: null,
      currentTurnId: null,
      forceAbort: (reason: AbortReason) => abortCalls.push(reason),
    };

    const steered = CodexAgent.prototype.redirect.call(fakeAgent, 'new instruction');

    expect(steered).toBe(false);
    expect(abortCalls).toEqual([AbortReason.Redirect]);
  });

  it('starts a replacement turn and returns true when steer is available', async () => {
    const turnStartCalls: any[] = [];
    const queuedEvents: any[] = [];

    const fakeAgent: any = {
      _isProcessing: true,
      codexThreadId: 'thread-1',
      currentTurnId: 'turn-old',
      currentUserMessage: '',
      pendingSteerFromTurnId: null,
      staleTurnIds: new Set<string>(),
      client: {
        isConnected: () => true,
        turnStart: async (params: any) => {
          turnStartCalls.push(params);
          return { turn: { id: 'turn-new' } };
        },
      },
      buildUserInput: (message: string) => [{ type: 'text', text: message }],
      getReasoningEffort: () => 'medium',
      debug: () => {},
      adapter: { startTurn: () => {}, adaptTurnStarted: () => [] },
      eventQueue: { enqueue: (event: any) => queuedEvents.push(event) },
      forceAbort: () => {},
    };

    const steered = CodexAgent.prototype.redirect.call(fakeAgent, 'pivot now');
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(steered).toBe(true);
    expect(turnStartCalls).toHaveLength(1);
    expect(turnStartCalls[0]).toMatchObject({
      threadId: 'thread-1',
      input: [{ type: 'text', text: 'pivot now' }],
      model: null,
    });
    expect(fakeAgent.currentTurnId).toBe('turn-new');
    expect(fakeAgent.currentUserMessage).toBe('pivot now');
    expect(queuedEvents).toEqual([]);
  });

  it('re-queues message when replacement turn start fails', async () => {
    const queuedEvents: any[] = [];

    const fakeAgent: any = {
      _isProcessing: true,
      codexThreadId: 'thread-1',
      currentTurnId: 'turn-old',
      pendingSteerFromTurnId: null,
      staleTurnIds: new Set<string>(),
      client: {
        isConnected: () => true,
        turnStart: async () => {
          throw new Error('turn start failed');
        },
      },
      buildUserInput: (message: string) => [{ type: 'text', text: message }],
      getReasoningEffort: () => 'medium',
      debug: () => {},
      adapter: { startTurn: () => {}, adaptTurnStarted: () => [] },
      eventQueue: { enqueue: (event: any) => queuedEvents.push(event) },
      forceAbort: () => {},
    };

    const steered = CodexAgent.prototype.redirect.call(fakeAgent, 'fallback please');
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(steered).toBe(true);
    expect(queuedEvents).toEqual([{ type: 'steer_undelivered', message: 'fallback please' }]);
  });
});
