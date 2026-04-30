import { createHash } from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import { PollService } from './poll-service.ts';
import type { AutomationMatcher } from './types.ts';
import type { PollUrlPayload } from './event-bus.ts';

/**
 * Build a controllable mock fetch that walks through a queue of fixed responses.
 * Each call shifts the next response off the queue. If the queue is exhausted,
 * the last response is repeated.
 */
function makeQueuedFetch(responses: Array<{ status: number; body?: string; headers?: Record<string, string> }>) {
  const q = [...responses];
  let lastUrl = '';
  const calls: Array<{ url: string; method: string }> = [];

  const impl = async (input: any, init?: any): Promise<Response> => {
    const url = String(input);
    lastUrl = url;
    calls.push({ url, method: init?.method ?? 'GET' });

    const next = q.length > 0 ? q.shift()! : { status: 200, body: '', headers: {} };
    return new Response(next.body ?? '', {
      status: next.status,
      headers: next.headers ?? {},
    });
  };

  return {
    impl: impl as unknown as typeof fetch,
    get lastUrl() { return lastUrl; },
    get calls() { return calls; },
  };
}

describe('PollService', () => {
  test('first poll establishes baseline (does not fire)', async () => {
    const events: PollUrlPayload[] = [];
    const fetcher = makeQueuedFetch([{ status: 200, body: 'hello' }]);

    const svc = new PollService({
      workspaceId: 'ws-1',
      onEvent: (p) => { events.push(p); },
      fetchImpl: fetcher.impl,
    });

    const matcher: AutomationMatcher = {
      id: 'p1',
      pollUrl: 'https://example.com/api',
      pollIntervalSec: 9999, // long enough we control timing manually
      actions: [{ type: 'prompt', prompt: 'noop' }],
    };

    svc.applyMatchers([matcher]);
    // Run one poll manually instead of waiting for the staggered initial timer
    await svc.runOnce('p1');

    expect(fetcher.calls).toHaveLength(1);
    expect(events).toHaveLength(0); // First poll = baseline only
    svc.dispose();
  });

  test('fires only when fingerprint changes', async () => {
    const events: PollUrlPayload[] = [];
    const fetcher = makeQueuedFetch([
      { status: 200, body: 'first' },   // baseline
      { status: 200, body: 'first' },   // unchanged — should NOT fire
      { status: 200, body: 'second' },  // changed — should fire
      { status: 200, body: 'second' },  // unchanged again — should NOT fire
    ]);

    const svc = new PollService({
      workspaceId: 'ws-1',
      onEvent: (p) => { events.push(p); },
      fetchImpl: fetcher.impl,
    });

    svc.applyMatchers([{
      id: 'p1',
      pollUrl: 'https://example.com/api',
      pollIntervalSec: 9999,
      actions: [{ type: 'prompt', prompt: 'noop' }],
    }]);

    await svc.runOnce('p1'); // baseline
    await svc.runOnce('p1'); // unchanged
    await svc.runOnce('p1'); // changed
    await svc.runOnce('p1'); // unchanged

    expect(events).toHaveLength(1);
    expect(events[0]!.fingerprintKind).toBe('body');
    expect(events[0]!.body).toBe('second');
    svc.dispose();
  });

  test('emits per-matcher event with matcherId', async () => {
    const events: PollUrlPayload[] = [];
    const fetcher = makeQueuedFetch([
      { status: 200, body: 'a' },
      { status: 200, body: 'b' },
    ]);
    const svc = new PollService({
      workspaceId: 'ws-1',
      onEvent: (p) => { events.push(p); },
      fetchImpl: fetcher.impl,
    });

    svc.applyMatchers([{
      id: 'route-test',
      pollUrl: 'https://example.com/api',
      pollIntervalSec: 9999,
      actions: [{ type: 'prompt', prompt: 'noop' }],
    }]);

    await svc.runOnce('route-test'); // baseline
    await svc.runOnce('route-test'); // changed → fires

    expect(events).toHaveLength(1);
    expect(events[0]!.matcherId).toBe('route-test');
    expect(events[0]!.url).toBe('https://example.com/api');
    svc.dispose();
  });

  test('etag fingerprint mode', async () => {
    const events: PollUrlPayload[] = [];
    const fetcher = makeQueuedFetch([
      { status: 200, body: 'irrelevant', headers: { etag: '"v1"' } },
      { status: 200, body: 'different', headers: { etag: '"v1"' } }, // body changed but etag same → no fire
      { status: 200, body: 'different', headers: { etag: '"v2"' } }, // etag changed → fires
    ]);

    const svc = new PollService({
      workspaceId: 'ws-1',
      onEvent: (p) => { events.push(p); },
      fetchImpl: fetcher.impl,
    });

    svc.applyMatchers([{
      id: 'p',
      pollUrl: 'https://example.com/api',
      pollIntervalSec: 9999,
      pollFingerprint: 'etag',
      actions: [{ type: 'prompt', prompt: 'noop' }],
    }]);

    await svc.runOnce('p');
    await svc.runOnce('p');
    await svc.runOnce('p');

    expect(events).toHaveLength(1);
    expect(events[0]!.fingerprintKind).toBe('etag');
    expect(events[0]!.fingerprint).toBe('"v2"');
    expect(events[0]!.previousFingerprint).toBe('"v1"');
    svc.dispose();
  });

  test('etag fingerprint mode does not read the response body', async () => {
    let bodyRead = false;
    const events: PollUrlPayload[] = [];
    const fetcher = {
      impl: (async () => ({
        status: 200,
        headers: new Headers({ etag: '"v1"' }),
        get body() {
          bodyRead = true;
          throw new Error('body should not be read');
        },
        text: async () => {
          bodyRead = true;
          throw new Error('text should not be read');
        },
      })) as unknown as typeof fetch,
    };

    const svc = new PollService({
      workspaceId: 'ws-1',
      onEvent: (p) => { events.push(p); },
      fetchImpl: fetcher.impl,
      emitOnFirstPoll: true,
    });

    svc.applyMatchers([{
      id: 'p',
      pollUrl: 'https://example.com/api',
      pollIntervalSec: 9999,
      pollFingerprint: 'etag',
      actions: [{ type: 'prompt', prompt: 'noop' }],
    }]);

    await svc.runOnce('p');

    expect(bodyRead).toBe(false);
    expect(events).toHaveLength(1);
    expect(events[0]!.fingerprint).toBe('"v1"');
    expect(events[0]!.body).toBeNull();
    svc.dispose();
  });

  test('status fingerprint mode fires on status transitions', async () => {
    const events: PollUrlPayload[] = [];
    const fetcher = makeQueuedFetch([
      { status: 200 }, // baseline
      { status: 200 }, // no change
      { status: 503 }, // changed → fires
      { status: 200 }, // changed back → fires
    ]);

    const svc = new PollService({
      workspaceId: 'ws-1',
      onEvent: (p) => { events.push(p); },
      fetchImpl: fetcher.impl,
    });

    svc.applyMatchers([{
      id: 'p',
      pollUrl: 'https://example.com',
      pollIntervalSec: 9999,
      pollFingerprint: 'status',
      actions: [{ type: 'prompt', prompt: 'noop' }],
    }]);

    await svc.runOnce('p');
    await svc.runOnce('p');
    await svc.runOnce('p');
    await svc.runOnce('p');

    expect(events).toHaveLength(2);
    expect(events[0]!.fingerprint).toBe('503');
    expect(events[1]!.fingerprint).toBe('200');
    svc.dispose();
  });

  test('body fingerprint reads a bounded response body', async () => {
    const bigBody = 'a'.repeat(1024 * 1024) + 'b'.repeat(1024 * 1024);
    const events: PollUrlPayload[] = [];
    const fetcher = makeQueuedFetch([{ status: 200, body: bigBody }]);

    const svc = new PollService({
      workspaceId: 'ws-1',
      onEvent: (p) => { events.push(p); },
      fetchImpl: fetcher.impl,
      emitOnFirstPoll: true,
    });

    svc.applyMatchers([{
      id: 'p',
      pollUrl: 'https://example.com/huge',
      pollIntervalSec: 9999,
      pollFingerprint: 'body',
      actions: [{ type: 'prompt', prompt: 'noop' }],
    }]);

    await svc.runOnce('p');

    const expectedBoundedBody = 'a'.repeat(1024 * 1024);
    expect(events).toHaveLength(1);
    expect(events[0]!.fingerprint).toBe(
      createHash('sha256').update(expectedBoundedBody, 'utf8').digest('hex'),
    );
    expect(events[0]!.body).toBe('a'.repeat(4096));
    svc.dispose();
  });

  test('expands $VAR in URL', async () => {
    process.env['CRAFT_POLL_TEST_HOST'] = 'api.example.com';
    const fetcher = makeQueuedFetch([
      { status: 200, body: 'a' },
      { status: 200, body: 'b' },
    ]);
    const events: PollUrlPayload[] = [];
    const svc = new PollService({
      workspaceId: 'ws-1',
      onEvent: (p) => { events.push(p); },
      fetchImpl: fetcher.impl,
    });

    svc.applyMatchers([{
      id: 'p',
      pollUrl: 'https://${CRAFT_POLL_TEST_HOST}/path',
      pollIntervalSec: 9999,
      actions: [{ type: 'prompt', prompt: 'noop' }],
    }]);

    await svc.runOnce('p');
    await svc.runOnce('p');

    expect(fetcher.calls[0]!.url).toBe('https://api.example.com/path');
    expect(events).toHaveLength(1);
    delete process.env['CRAFT_POLL_TEST_HOST'];
    svc.dispose();
  });

  test('skips matcher with invalid URL after expansion', async () => {
    const fetcher = makeQueuedFetch([{ status: 200, body: '' }]);
    const events: PollUrlPayload[] = [];
    const svc = new PollService({
      workspaceId: 'ws-1',
      onEvent: (p) => { events.push(p); },
      fetchImpl: fetcher.impl,
    });

    svc.applyMatchers([{
      id: 'p',
      pollUrl: 'ftp://example.com', // not http(s)
      pollIntervalSec: 9999,
      actions: [{ type: 'prompt', prompt: 'noop' }],
    }]);

    await svc.runOnce('p');
    expect(fetcher.calls).toHaveLength(0); // never even attempted
    expect(events).toHaveLength(0);
    svc.dispose();
  });

  test('removed matcher is no longer polled', async () => {
    const fetcher = makeQueuedFetch([
      { status: 200, body: 'a' },
      { status: 200, body: 'b' },
    ]);
    const events: PollUrlPayload[] = [];
    const svc = new PollService({
      workspaceId: 'ws-1',
      onEvent: (p) => { events.push(p); },
      fetchImpl: fetcher.impl,
    });

    svc.applyMatchers([{
      id: 'will-go-away',
      pollUrl: 'https://example.com',
      pollIntervalSec: 9999,
      actions: [{ type: 'prompt', prompt: 'noop' }],
    }]);

    await svc.runOnce('will-go-away'); // baseline

    // Reload with empty matcher set
    svc.applyMatchers([]);

    // Try to run the removed matcher — should be a no-op
    await svc.runOnce('will-go-away');

    expect(fetcher.calls).toHaveLength(1); // Only the baseline
    expect(events).toHaveLength(0);
    svc.dispose();
  });

  test('emitOnFirstPoll override fires the baseline poll (test convenience)', async () => {
    const fetcher = makeQueuedFetch([{ status: 200, body: 'x' }]);
    const events: PollUrlPayload[] = [];
    const svc = new PollService({
      workspaceId: 'ws-1',
      onEvent: (p) => { events.push(p); },
      fetchImpl: fetcher.impl,
      emitOnFirstPoll: true,
    });

    svc.applyMatchers([{
      id: 'p',
      pollUrl: 'https://example.com',
      pollIntervalSec: 9999,
      actions: [{ type: 'prompt', prompt: 'noop' }],
    }]);

    await svc.runOnce('p');

    expect(events).toHaveLength(1);
    expect(events[0]!.previousFingerprint).toBeNull();
    svc.dispose();
  });
});
