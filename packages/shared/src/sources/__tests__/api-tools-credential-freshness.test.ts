/**
 * Regression test: per-request credential resolution for API tools.
 *
 * Bug: bearer/header/basic/query auth API sources captured the credential as a
 * static string at tool creation time. After a user updated the credential
 * (e.g. via source_credential_prompt), the in-process tool kept sending the
 * stale token, causing 401s until session restart.
 *
 * Fix: when the credential is supplied as a getter function, createApiTool
 * already calls it before every request (api-tools.ts:231-233). The wiring
 * change in server-builder + SessionManager routes non-OAuth API sources
 * through a getter that reads the latest credential from the vault.
 *
 * This test pins the contract: a credential getter is invoked on every call
 * and the freshest value is used to build request headers.
 */

import { describe, test, expect } from 'bun:test';
import { createApiTool } from '../api-tools.ts';
import type { ApiConfig } from '../types.ts';

interface MinimalTool {
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

function makeBearerConfig(): ApiConfig {
  return {
    name: 'test-bearer',
    baseUrl: 'https://example.test/',
    auth: { type: 'bearer', authScheme: 'Bearer' },
  };
}

function captureFetch(): {
  restore: () => void;
  lastHeaders: () => Record<string, string> | null;
  callCount: () => number;
} {
  const originalFetch = globalThis.fetch;
  let lastHeaders: Record<string, string> | null = null;
  let calls = 0;

  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    calls += 1;
    lastHeaders = (init?.headers as Record<string, string>) ?? {};
    return new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  return {
    restore: () => {
      globalThis.fetch = originalFetch;
    },
    lastHeaders: () => lastHeaders,
    callCount: () => calls,
  };
}

describe('createApiTool: credential freshness', () => {
  test('bearer auth — getter is called on every request, latest value wins', async () => {
    let currentToken = 'token-A';
    const getter = async () => currentToken;
    const tool = createApiTool(makeBearerConfig(), getter) as unknown as MinimalTool;

    const f = captureFetch();
    try {
      await tool.handler({ path: '/ping', method: 'GET' });
      expect(f.lastHeaders()?.['Authorization']).toBe('Bearer token-A');

      // Simulate a credential update in the vault (e.g. source_credential_prompt)
      currentToken = 'token-B';

      await tool.handler({ path: '/ping', method: 'GET' });
      expect(f.lastHeaders()?.['Authorization']).toBe('Bearer token-B');

      // Sanity: the getter resolves on every call, not once at creation
      expect(f.callCount()).toBe(2);
    } finally {
      f.restore();
    }
  });

  test('bearer auth — static string credential is captured for the tool lifetime', async () => {
    // This documents the legacy behavior the fix targets: passing a string
    // (not a getter) freezes the credential. Callers that route through
    // SessionManager now provide a getter, but the static path is still
    // supported as a fallback for tests / direct invocations.
    const tool = createApiTool(makeBearerConfig(), 'static-token') as unknown as MinimalTool;

    const f = captureFetch();
    try {
      await tool.handler({ path: '/ping', method: 'GET' });
      expect(f.lastHeaders()?.['Authorization']).toBe('Bearer static-token');

      await tool.handler({ path: '/ping', method: 'GET' });
      // Same value — confirms the captured-string contract for the fallback path
      expect(f.lastHeaders()?.['Authorization']).toBe('Bearer static-token');
    } finally {
      f.restore();
    }
  });

  test('header auth — getter resolves fresh credential per request', async () => {
    let currentKey = 'key-A';
    const getter = async () => currentKey;
    const config: ApiConfig = {
      name: 'test-header',
      baseUrl: 'https://example.test/',
      auth: { type: 'header', headerName: 'X-API-Key' },
    };
    const tool = createApiTool(config, getter) as unknown as MinimalTool;

    const f = captureFetch();
    try {
      await tool.handler({ path: '/ping', method: 'GET' });
      expect(f.lastHeaders()?.['X-API-Key']).toBe('key-A');

      currentKey = 'key-B';

      await tool.handler({ path: '/ping', method: 'GET' });
      expect(f.lastHeaders()?.['X-API-Key']).toBe('key-B');
    } finally {
      f.restore();
    }
  });
});
