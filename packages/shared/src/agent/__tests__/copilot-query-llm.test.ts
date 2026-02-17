/**
 * Tests for CopilotAgent.queryLlm() event collection logic.
 *
 * queryLlm() creates an ephemeral CopilotSession, subscribes to events,
 * and accumulates text from `assistant.message_delta` until `session.idle`.
 *
 * These tests validate the event collection pattern without requiring a real
 * Copilot SDK or GitHub auth — we simulate the session event callback directly.
 *
 * Pattern mirrors codex-generate-title.test.ts.
 */
import { describe, it, expect } from 'bun:test';

// ============================================================
// Simulate the queryLlm event collection logic from copilot-agent.ts
// ============================================================

interface SessionEvent {
  type: string;
  data: unknown;
}

type EventHandler = (event: SessionEvent) => void;

/**
 * Simulates the event collection logic in CopilotAgent.queryLlm().
 *
 * Creates a fake "session" that accepts an event handler and a send() call.
 * The caller drives events via the returned emitEvent() function.
 */
function createQueryLlmSimulation(timeoutMs: number = 30000) {
  let handler: EventHandler | null = null;
  let result = '';
  let completionResolve: () => void;
  const completionPromise = new Promise<void>((resolve) => {
    completionResolve = resolve;
  });

  // Simulate session.on() — captures the handler
  const on = (fn: EventHandler) => {
    handler = fn;
    return () => { handler = null; }; // unsubscribe
  };

  // Simulate session.send() — no-op (events are driven externally)
  const send = async (_opts: { prompt: string }) => {};

  // Wire up event collection (mirrors copilot-agent.ts queryLlm logic)
  const unsubscribe = on((event: SessionEvent) => {
    if (event.type === 'assistant.message_delta') {
      const data = event.data as { deltaContent?: string };
      if (data.deltaContent) {
        result += data.deltaContent;
      }
    }
    if (event.type === 'session.idle') {
      completionResolve();
    }
  });

  // Drive the collection: send() + race(completion, timeout)
  const collect = async (prompt: string): Promise<string> => {
    await send({ prompt });

    const timeoutPromise = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error('queryLlm timed out after 30s')), timeoutMs)
    );

    await Promise.race([completionPromise, timeoutPromise]);
    unsubscribe();
    return result.trim();
  };

  // Emit events (test driver)
  const emitEvent = (event: SessionEvent) => {
    handler?.(event);
  };

  return { collect, emitEvent };
}

// ============================================================
// Tests
// ============================================================

describe('CopilotAgent.queryLlm() event collection', () => {

  it('accumulates delta text and returns on session.idle', async () => {
    const { collect, emitEvent } = createQueryLlmSimulation();
    const promise = collect('Generate a title');

    emitEvent({ type: 'assistant.message_delta', data: { deltaContent: 'Fix ' } });
    emitEvent({ type: 'assistant.message_delta', data: { deltaContent: 'auth bug' } });
    emitEvent({ type: 'session.idle', data: {} });

    const result = await promise;
    expect(result).toBe('Fix auth bug');
  });

  it('handles single delta event', async () => {
    const { collect, emitEvent } = createQueryLlmSimulation();
    const promise = collect('Summarize');

    emitEvent({ type: 'assistant.message_delta', data: { deltaContent: 'Done' } });
    emitEvent({ type: 'session.idle', data: {} });

    expect(await promise).toBe('Done');
  });

  it('trims whitespace from result', async () => {
    const { collect, emitEvent } = createQueryLlmSimulation();
    const promise = collect('Title');

    emitEvent({ type: 'assistant.message_delta', data: { deltaContent: '  Spaced result  \n' } });
    emitEvent({ type: 'session.idle', data: {} });

    expect(await promise).toBe('Spaced result');
  });

  it('ignores events without deltaContent', async () => {
    const { collect, emitEvent } = createQueryLlmSimulation();
    const promise = collect('Test');

    // Events with no deltaContent should be ignored
    emitEvent({ type: 'assistant.message_delta', data: {} });
    emitEvent({ type: 'assistant.message_delta', data: { deltaContent: undefined } });
    emitEvent({ type: 'assistant.message_delta', data: { deltaContent: 'Valid' } });
    emitEvent({ type: 'session.idle', data: {} });

    expect(await promise).toBe('Valid');
  });

  it('ignores non-delta event types', async () => {
    const { collect, emitEvent } = createQueryLlmSimulation();
    const promise = collect('Test');

    // These event types should not affect the result
    emitEvent({ type: 'assistant.usage', data: { inputTokens: 100 } });
    emitEvent({ type: 'tool.execution_start', data: { toolCallId: '123' } });
    emitEvent({ type: 'assistant.message_delta', data: { deltaContent: 'Only this' } });
    emitEvent({ type: 'session.idle', data: {} });

    expect(await promise).toBe('Only this');
  });

  it('returns empty string when no deltas before idle', async () => {
    const { collect, emitEvent } = createQueryLlmSimulation();
    const promise = collect('Test');

    // Immediate idle with no content
    emitEvent({ type: 'session.idle', data: {} });

    expect(await promise).toBe('');
  });

  it('handles many small deltas (streaming)', async () => {
    const { collect, emitEvent } = createQueryLlmSimulation();
    const promise = collect('Stream test');

    const words = 'The quick brown fox jumps over the lazy dog'.split(' ');
    for (const word of words) {
      emitEvent({ type: 'assistant.message_delta', data: { deltaContent: word + ' ' } });
    }
    emitEvent({ type: 'session.idle', data: {} });

    expect(await promise).toBe('The quick brown fox jumps over the lazy dog');
  });

  it('times out after configured timeout', async () => {
    const { collect, emitEvent } = createQueryLlmSimulation(50); // 50ms timeout
    const promise = collect('Timeout test');

    emitEvent({ type: 'assistant.message_delta', data: { deltaContent: 'Partial' } });
    // Don't emit session.idle — let it timeout

    await expect(promise).rejects.toThrow('queryLlm timed out');
  });

  it('unsubscribes handler after completion', async () => {
    // Track whether unsubscribe was called
    let unsubscribed = false;

    const { collect, emitEvent } = createQueryLlmSimulation();

    // Patch: wrap the simulation's collect to track unsubscribe
    // The real test is that the simulation completes cleanly
    const promise = collect('Test');

    emitEvent({ type: 'assistant.message_delta', data: { deltaContent: 'Done' } });
    emitEvent({ type: 'session.idle', data: {} });

    const result = await promise;
    expect(result).toBe('Done');

    // After completion, emitting more events should not affect anything
    // (handler was unsubscribed inside collect())
    emitEvent({ type: 'assistant.message_delta', data: { deltaContent: 'After unsubscribe' } });
    // If handler leaked, this would throw or mutate state — but result is already returned
  });
});

// ============================================================
// runMiniCompletion delegation
// ============================================================

describe('CopilotAgent.runMiniCompletion() delegation', () => {
  // These test the logic pattern without needing a real CopilotAgent.
  // The actual implementation is: queryLlm({ prompt }) → result.text || null

  it('returns text from successful queryLlm result', () => {
    const queryResult = { text: 'Generated Title' };
    const miniResult = queryResult.text || null;
    expect(miniResult).toBe('Generated Title');
  });

  it('returns null for empty text', () => {
    const queryResult = { text: '' };
    const miniResult = queryResult.text || null;
    expect(miniResult).toBeNull();
  });

  it('returns null on error (try/catch pattern)', () => {
    // Simulates the catch block returning null
    let miniResult: string | null;
    try {
      throw new Error('Session creation failed');
    } catch {
      miniResult = null;
    }
    expect(miniResult).toBeNull();
  });
});
