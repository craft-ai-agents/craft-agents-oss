/**
 * Tests for the shared async utilities: mapWithConcurrency and withTimeout.
 * withTimeout's timeout/cleanup semantics are covered by agent/__tests__/with-timeout.test.ts;
 * here we assert the util's own home and the concurrency primitive.
 */
import { describe, it, expect } from 'bun:test';
import { mapWithConcurrency, withTimeout } from '../async.ts';
import { withTimeout as withTimeoutFromLlmTool } from '../../agent/llm-tool.ts';

describe('mapWithConcurrency()', () => {
  it('preserves input order regardless of completion order', async () => {
    const items = [40, 10, 30, 0, 20];
    const result = await mapWithConcurrency(items, 2, async (ms, i) => {
      await new Promise(r => setTimeout(r, ms));
      return `${i}:${ms}`;
    });
    expect(result).toEqual(['0:40', '1:10', '2:30', '3:0', '4:20']);
  });

  it('never exceeds the concurrency limit in flight', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(r => setTimeout(r, 5));
      inFlight--;
      return null;
    });
    expect(maxInFlight).toBeLessThanOrEqual(4);
    expect(maxInFlight).toBeGreaterThan(1); // actually ran concurrently
  });

  it('returns an empty array for empty input without invoking fn', async () => {
    let called = false;
    const result = await mapWithConcurrency([], 8, async () => { called = true; return 1; });
    expect(result).toEqual([]);
    expect(called).toBe(false);
  });

  it('handles limit larger than the item count', async () => {
    const result = await mapWithConcurrency([1, 2, 3], 100, async (n) => n * 2);
    expect(result).toEqual([2, 4, 6]);
  });
});

describe('withTimeout() home', () => {
  it('is the same implementation re-exported from agent/llm-tool', () => {
    // llm-tool re-exports withTimeout from utils/async; guards the single-home invariant.
    expect(withTimeoutFromLlmTool).toBe(withTimeout);
  });

  it('resolves a fast promise', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000, 'nope')).resolves.toBe('ok');
  });
});
