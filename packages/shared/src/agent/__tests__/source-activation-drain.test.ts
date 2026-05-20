import { describe, expect, it } from 'bun:test';
import type { AgentEvent } from '@craft-agent/core/types';
import {
  SourceActivationDrainController,
  type PendingActivationRestart,
} from '../source-activation-drain.ts';

// ============================================================
// Event builders
// ============================================================

function makeToolResult(toolUseId: string, toolName = 'mcp__session__source_test'): AgentEvent {
  return {
    type: 'tool_result',
    toolUseId,
    toolName,
    result: '✓ Source activated — the current turn will auto-restart with tools available',
    isError: false,
    turnId: 'turn-1',
  };
}

function makeTaskBackgrounded(toolUseId: string, taskId: string): AgentEvent {
  return {
    type: 'task_backgrounded',
    toolUseId,
    taskId,
    turnId: 'turn-1',
  };
}

function makeShellBackgrounded(toolUseId: string, shellId: string): AgentEvent {
  return {
    type: 'shell_backgrounded',
    toolUseId,
    shellId,
    turnId: 'turn-1',
  };
}

function makeTextComplete(text: string): AgentEvent {
  return {
    type: 'text_complete',
    text,
    isIntermediate: false,
    turnId: 'turn-2',
  };
}

/**
 * Build a consume function that hands out the given pending restarts in
 * order and returns null after they're exhausted.
 */
function consumeQueue(
  ...records: (PendingActivationRestart | null)[]
): () => PendingActivationRestart | null {
  const queue = [...records];
  return () => queue.shift() ?? null;
}

// ============================================================
// 'batch-boundary' policy (Claude)
// ============================================================

describe('SourceActivationDrainController — batch-boundary policy', () => {
  it('captures first triggering tool_result and short-circuits siblings within batch', () => {
    const drain = new SourceActivationDrainController('batch-boundary');
    const consume = consumeQueue(
      { sourceSlug: 'sourceA', userMessage: 'test sources' },
      null,
      null,
    );

    const batch: AgentEvent[] = [
      makeToolResult('A'),
      makeToolResult('B'),
      makeToolResult('C'),
    ];
    const shortCircuited: string[] = [];
    for (const e of batch) {
      if (drain.observe(e, consume) && e.type === 'tool_result') {
        shortCircuited.push(e.toolUseId);
      }
    }
    expect(shortCircuited).toEqual(['A', 'B', 'C']);

    const fire = drain.shouldFireAtBoundary();
    expect(fire).not.toBeNull();
    expect(fire!.type).toBe('source_activated');
    expect(fire!.sourceSlug).toBe('sourceA');
    expect(fire!.originalMessage).toBe('test sources');
  });

  it('drains across interleaved synthetic events (task_backgrounded, shell_backgrounded)', () => {
    // Regression: extractToolResults can interleave synthetic background
    // events between tool_result events inside ONE adapted SDK batch.
    // The drain must yield (short-circuit) everything until the batch boundary.
    const drain = new SourceActivationDrainController('batch-boundary');
    const consume = consumeQueue(
      { sourceSlug: 'sourceA', userMessage: 'go' },
      null,
      null,
      null,
      null,
    );

    const batch: AgentEvent[] = [
      makeToolResult('A'),                       // capture
      makeTaskBackgrounded('B', 'task-1'),       // synthetic — must drain
      makeToolResult('C'),                       // sibling
      makeShellBackgrounded('D', 'shell-1'),     // synthetic — must drain
      makeToolResult('E'),                       // sibling
    ];
    let shortCircuitedCount = 0;
    for (const e of batch) {
      if (drain.observe(e, consume)) shortCircuitedCount++;
    }
    expect(shortCircuitedCount).toBe(5);

    const fire = drain.shouldFireAtBoundary();
    expect(fire?.sourceSlug).toBe('sourceA');
  });

  it('does not fire when no source_test tool_result triggers capture', () => {
    const drain = new SourceActivationDrainController('batch-boundary');
    const batch: AgentEvent[] = [
      makeToolResult('A', 'Read'),
      makeToolResult('B', 'Bash'),
    ];
    for (const e of batch) {
      const observed = drain.observe(e, () => null);
      expect(observed).toBe(false);
    }
    expect(drain.shouldFireAtBoundary()).toBeNull();
    expect(drain.hasFired).toBe(false);
  });

  it('preserves the first captured slug under racing pending restarts', () => {
    const drain = new SourceActivationDrainController('batch-boundary');
    const consume = consumeQueue(
      { sourceSlug: 'firstWinner', userMessage: 'msg' },
      { sourceSlug: 'secondWinner', userMessage: 'msg' },
    );
    drain.observe(makeToolResult('A'), consume);
    drain.observe(makeToolResult('B'), consume);
    expect(drain.capturedSlug).toBe('firstWinner');
    expect(drain.shouldFireAtBoundary()?.sourceSlug).toBe('firstWinner');
  });

  it('single source_test path still aborts (no single-tool regression)', () => {
    const drain = new SourceActivationDrainController('batch-boundary');
    const consume = consumeQueue({ sourceSlug: 'soloSource', userMessage: 'msg' });

    const captured = drain.observe(makeToolResult('A'), consume);
    expect(captured).toBe(true);
    expect(drain.shouldFireAtBoundary()?.sourceSlug).toBe('soloSource');
  });

  it('is idempotent after firing (no double-firing, no trailing complete)', () => {
    const drain = new SourceActivationDrainController('batch-boundary');
    drain.observe(makeToolResult('A'), () => ({ sourceSlug: 'X', userMessage: 'm' }));

    const first = drain.shouldFireAtBoundary();
    expect(first).not.toBeNull();
    expect(drain.shouldFireAtBoundary()).toBeNull();
    expect(drain.shouldFireBeforeEvent(makeTextComplete('next turn'))).toBeNull();
    expect(drain.hasFired).toBe(true);
  });

  it('shouldFireBeforeEvent never fires under batch-boundary policy', () => {
    const drain = new SourceActivationDrainController('batch-boundary');
    drain.observe(makeToolResult('A'), () => ({ sourceSlug: 'X', userMessage: 'm' }));
    expect(drain.shouldFireBeforeEvent(makeTextComplete('next turn'))).toBeNull();
    // Still pending — boundary check must still fire.
    expect(drain.shouldFireAtBoundary()?.sourceSlug).toBe('X');
  });
});

// ============================================================
// 'fire-on-non-tool-result' policy (Pi)
// ============================================================

describe('SourceActivationDrainController — fire-on-non-tool-result policy', () => {
  it('drains consecutive tool_results, then fires BEFORE first non-tool_result', () => {
    const drain = new SourceActivationDrainController('fire-on-non-tool-result');
    const consume = consumeQueue(
      { sourceSlug: 'sourceA', userMessage: 'go' },
      null,
      null,
    );

    // tool_result A — captures
    expect(drain.shouldFireBeforeEvent(makeToolResult('A'))).toBeNull();
    expect(drain.observe(makeToolResult('A'), consume)).toBe(true);

    // tool_result B — drain
    expect(drain.shouldFireBeforeEvent(makeToolResult('B'))).toBeNull();
    expect(drain.observe(makeToolResult('B'), consume)).toBe(true);

    // tool_result C — drain
    expect(drain.shouldFireBeforeEvent(makeToolResult('C'))).toBeNull();
    expect(drain.observe(makeToolResult('C'), consume)).toBe(true);

    // text_complete — boundary; fires BEFORE yielding
    const fire = drain.shouldFireBeforeEvent(makeTextComplete('starting next turn'));
    expect(fire).not.toBeNull();
    expect(fire!.sourceSlug).toBe('sourceA');
    expect(drain.hasFired).toBe(true);
  });

  it('end-of-stream fallback fires when queue exhausts with captured pending', () => {
    const drain = new SourceActivationDrainController('fire-on-non-tool-result');
    drain.observe(makeToolResult('A'), () => ({ sourceSlug: 'sourceA', userMessage: 'go' }));
    // Pretend the queue drained naturally — no boundary event arrived.
    const fire = drain.shouldFireAtBoundary();
    expect(fire?.sourceSlug).toBe('sourceA');
  });

  it('no capture means no fire — even on non-tool_result event', () => {
    const drain = new SourceActivationDrainController('fire-on-non-tool-result');
    const consume = consumeQueue(null);
    drain.observe(makeToolResult('A', 'Read'), consume);
    expect(drain.shouldFireBeforeEvent(makeTextComplete('hi'))).toBeNull();
    expect(drain.shouldFireAtBoundary()).toBeNull();
  });

  it('is idempotent after firing through shouldFireBeforeEvent', () => {
    const drain = new SourceActivationDrainController('fire-on-non-tool-result');
    drain.observe(makeToolResult('A'), () => ({ sourceSlug: 'X', userMessage: 'm' }));
    const first = drain.shouldFireBeforeEvent(makeTextComplete('next'));
    expect(first).not.toBeNull();
    // Subsequent calls return null
    expect(drain.shouldFireBeforeEvent(makeTextComplete('another'))).toBeNull();
    expect(drain.shouldFireAtBoundary()).toBeNull();
  });
});
