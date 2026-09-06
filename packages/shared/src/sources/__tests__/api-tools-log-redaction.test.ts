/**
 * Adversarial log test: a query-auth source's credential must never reach the
 * debug log. executeApiRequest logs "{method} {url}" under CRAFT_DEBUG, and
 * for `auth.type === 'query'` buildUrl embeds the live credential in that URL
 * (`?api_key=…`) — this test captures the real stderr sink and asserts the
 * secret is absent, so reverting the redaction at the call site fails here.
 */

import { describe, test, expect } from 'bun:test';
import { executeApiRequest } from '../api-tools.ts';
import type { ApiConfig } from '../types.ts';
import { disableDebug, enableDebug } from '../../utils/debug.ts';

const SECRET = 'sk-live-9f8e7d6c5b4a-topsecret';

function captureStderr(): { restore: () => void; text: () => string } {
  const original = process.stderr.write.bind(process.stderr);
  let captured = '';
  process.stderr.write = ((chunk: string | Uint8Array) => {
    captured += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
    return true;
  }) as typeof process.stderr.write;
  return {
    restore: () => {
      process.stderr.write = original;
    },
    text: () => captured,
  };
}

function stubFetch(): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: string, _init?: RequestInit) =>
    new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

describe('executeApiRequest debug log', () => {
  test('query-auth credential and GET param values never appear; path and param names do', async () => {
    const config: ApiConfig = {
      name: 'query-auth-source',
      baseUrl: 'https://api.example.test',
      auth: { type: 'query', queryParam: 'api_key' },
    };

    const restoreFetch = stubFetch();
    const stderr = captureStderr();
    enableDebug();
    try {
      await executeApiRequest(config, SECRET, {
        path: '/v1/search',
        method: 'GET',
        params: { q: 'quarterly revenue' },
      });
    } finally {
      disableDebug();
      stderr.restore();
      restoreFetch();
    }

    const logged = stderr.text();
    // The line is still useful for debugging…
    expect(logged).toContain('GET https://api.example.test/v1/search');
    expect(logged).toContain('api_key=[REDACTED]');
    expect(logged).toContain('q=[REDACTED]');
    // …but carries no values: neither the credential nor GET param contents.
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain('quarterly');
  });
});
