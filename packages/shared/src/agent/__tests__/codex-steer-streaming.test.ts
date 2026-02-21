import { describe, it, expect } from 'bun:test';
import { EventEmitter } from 'node:events';

import { CodexAgent } from '../codex-agent.ts';

type AnyObj = Record<string, any>;

function buildHarness(overrides?: Partial<AnyObj>) {
  const client = new EventEmitter() as AnyObj;
  client.isConnected = () => true;

  const enqueued: any[] = [];
  let completed = 0;

  const fakeAgent: AnyObj = {
    client,
    debug: () => {},
    _ephemeralThreadIds: new Set<string>(),
    _startingEphemeralThread: false,
    codexThreadId: 'thread-1',
    currentTurnId: 'turn-new',
    pendingSteerFromTurnId: null,
    staleTurnIds: new Set<string>(),
    inflightItemHandlers: 0,
    turnCompletedPending: false,
    eventQueue: {
      enqueue: (e: any) => enqueued.push(e),
      complete: () => { completed += 1; },
    },
    adapter: {
      adaptTurnStarted: () => [],
      adaptTurnCompleted: () => [{ type: 'complete' }],
      adaptTurnPlanUpdated: () => [],
      adaptItemStarted: () => [],
      adaptItemCompleted: () => [],
      adaptAgentMessageDelta: (n: any) => [{ type: 'text_delta', turnId: n.turnId, delta: n.delta }],
      adaptReasoningDelta: () => [],
      adaptCommandOutputDelta: () => {},
    },
    // callbacks invoked by handlers only for certain events
    handleSessionMcpToolCompletion: () => {},
    detectInactiveSourceToolError: () => null,
    emitHookEvent: () => {},
    prerequisiteManager: { trackReadTool: () => {} },
    onSourceActivationRequest: null,
    currentUserMessage: '',
    ...overrides,
  };

  (CodexAgent.prototype as any).setupClientEventHandlers.call(fakeAgent);

  return { client, enqueued, getCompleted: () => completed, fakeAgent };
}

describe('Codex steer stream continuity', () => {
  it('ignores stale replaced turn completion and keeps active turn lifecycle', () => {
    const { client, enqueued, getCompleted, fakeAgent } = buildHarness();
    fakeAgent.staleTurnIds.add('turn-old');

    client.emit('turn/completed', {
      threadId: 'thread-1',
      turn: { id: 'turn-old', items: [], status: 'interrupted', error: null },
    });

    expect(enqueued).toEqual([]);
    expect(getCompleted()).toBe(0);

    client.emit('turn/completed', {
      threadId: 'thread-1',
      turn: { id: 'turn-new', items: [], status: 'completed', error: null },
    });

    expect(enqueued).toEqual([{ type: 'complete' }]);
    expect(getCompleted()).toBe(1);
  });

  it('ignores turn/completed without turn id during steer transition', () => {
    const { client, enqueued, getCompleted } = buildHarness({
      pendingSteerFromTurnId: 'turn-old',
    });

    client.emit('turn/completed', {
      threadId: 'thread-1',
      turn: null,
    });

    expect(enqueued).toEqual([]);
    expect(getCompleted()).toBe(0);
  });

  it('accepts new-turn deltas while dropping stale-turn deltas', () => {
    const { client, enqueued, fakeAgent } = buildHarness();
    fakeAgent.staleTurnIds.add('turn-old');

    client.emit('item/agentMessage/delta', {
      threadId: 'thread-1',
      turnId: 'turn-old',
      itemId: 'item-1',
      delta: 'old',
    });
    client.emit('item/agentMessage/delta', {
      threadId: 'thread-1',
      turnId: 'turn-new',
      itemId: 'item-2',
      delta: 'new',
    });

    expect(enqueued).toEqual([{ type: 'text_delta', turnId: 'turn-new', delta: 'new' }]);
  });
});
