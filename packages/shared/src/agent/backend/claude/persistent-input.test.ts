import { describe, it, expect } from 'bun:test';
import { createPushableInputStream, resolveKeepBackgroundTasksAlive } from './persistent-input.ts';

describe('resolveKeepBackgroundTasksAlive', () => {
  it('is ON by default when unset (opt-out; mechanism has landed)', () => {
    expect(resolveKeepBackgroundTasksAlive({})).toBe(true);
  });
  it('is ON for "1"/"true"', () => {
    expect(resolveKeepBackgroundTasksAlive({ CRAFT_KEEP_BG_AGENTS_ALIVE: '1' })).toBe(true);
    expect(resolveKeepBackgroundTasksAlive({ CRAFT_KEEP_BG_AGENTS_ALIVE: 'true' })).toBe(true);
  });
  it('is OFF for "0"/"false" (explicit kill-switch)', () => {
    expect(resolveKeepBackgroundTasksAlive({ CRAFT_KEEP_BG_AGENTS_ALIVE: '0' })).toBe(false);
    expect(resolveKeepBackgroundTasksAlive({ CRAFT_KEEP_BG_AGENTS_ALIVE: 'false' })).toBe(false);
  });
});

/** Collect up to `n` items from an async iterable (or until it ends). */
async function take<T>(it: AsyncIterable<T>, n: number): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) {
    out.push(x);
    if (out.length >= n) break;
  }
  return out;
}

describe('createPushableInputStream', () => {
  it('delivers synchronously-queued items in FIFO order', async () => {
    const s = createPushableInputStream<number>();
    s.push(1);
    s.push(2);
    s.push(3);
    s.end();
    const got: number[] = [];
    for await (const x of s.stream) got.push(x);
    expect(got).toEqual([1, 2, 3]);
  });

  it('wakes a suspended consumer when an item is pushed later', async () => {
    const s = createPushableInputStream<string>();
    const collected = take(s.stream, 2);
    // Consumer is now suspended (nothing queued). Push after a tick.
    await new Promise((r) => setTimeout(r, 5));
    s.push('a');
    await new Promise((r) => setTimeout(r, 5));
    s.push('b');
    expect(await collected).toEqual(['a', 'b']);
  });

  it('end() terminates the consumer loop after draining', async () => {
    const s = createPushableInputStream<number>();
    s.push(10);
    s.end();
    s.push; // no-op reference
    const got: number[] = [];
    for await (const x of s.stream) got.push(x);
    expect(got).toEqual([10]); // the queued item is still delivered, then loop ends
    expect(s.isEnded).toBe(true);
  });

  it('throws on push() after end()', async () => {
    const s = createPushableInputStream<number>();
    s.end();
    expect(() => s.push(1)).toThrow(/after end/);
  });

  it('end() is idempotent', () => {
    const s = createPushableInputStream<number>();
    s.end();
    expect(() => s.end()).not.toThrow();
    expect(s.isEnded).toBe(true);
  });

  it('interleaves push and consume across await points', async () => {
    const s = createPushableInputStream<number>();
    const results: number[] = [];
    const consumer = (async () => {
      for await (const x of s.stream) {
        results.push(x);
        if (results.length >= 3) break;
      }
    })();
    s.push(1);
    await new Promise((r) => setTimeout(r, 1));
    s.push(2);
    await new Promise((r) => setTimeout(r, 1));
    s.push(3);
    await consumer;
    expect(results).toEqual([1, 2, 3]);
  });
});
