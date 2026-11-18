import { afterEach, describe, expect, it, mock } from 'bun:test';
import { piDriver } from './pi.ts';
import type { DriverTestConnectionArgs } from '../driver-types.ts';

function baseTestArgs(overrides: Partial<DriverTestConnectionArgs> = {}): DriverTestConnectionArgs {
  return {
    provider: 'pi',
    apiKey: 'test-key',
    model: 'custom-model',
    timeoutMs: 5000,
    hostRuntime: {} as any,
    resolvedPaths: {} as any,
    ...overrides,
  };
}

describe('piDriver.buildRuntime custom endpoint models', () => {
  it('preserves explicit per-model supportsImages values', () => {
    const runtime = piDriver.buildRuntime({
      context: {
        provider: 'pi',
        authType: 'api_key',
        resolvedModel: 'vision-model',
        capabilities: { needsHttpPoolServer: false },
        connection: {
          slug: 'custom-endpoint',
          name: 'Custom Endpoint',
          providerType: 'pi',
          authType: 'api_key',
          baseUrl: 'http://127.0.0.1:11111/v1',
          customEndpoint: { api: 'anthropic-messages', supportsImages: true },
          models: [
            { id: 'vision-model', contextWindow: 262_144, supportsImages: true },
            { id: 'text-only-model', supportsImages: false },
            { id: 'plain-model' },
          ],
          createdAt: Date.now(),
        } as any,
      },
      coreConfig: {} as any,
      hostRuntime: {} as any,
      resolvedPaths: {
        piServerPath: '/tmp/pi-agent-server.js',
        interceptorBundlePath: '/tmp/interceptor.cjs',
        nodeRuntimePath: '/usr/bin/node',
      },
    });

    expect(runtime.customModels).toEqual([
      { id: 'vision-model', contextWindow: 262_144, supportsImages: true },
      { id: 'text-only-model', supportsImages: false },
      'plain-model',
    ]);
  });
});

describe('piDriver.testConnection for custom endpoints', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('runs the fast HTTP test for an OpenAI-compatible custom endpoint instead of falling back to the subprocess path', async () => {
    let requestedUrl: string | undefined;
    let requestedHeaders: Record<string, string> | undefined;
    globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
      requestedUrl = url;
      requestedHeaders = init?.headers as Record<string, string>;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await piDriver.testConnection!(baseTestArgs({
      model: 'custom-endpoint-model',
      baseUrl: 'https://api.example.com/v1',
      connection: {
        providerType: 'pi',
        piAuthProvider: 'openai',
        customEndpoint: { api: 'openai-completions' },
      } as any,
    }));

    // A non-null result means the driver handled it directly via HTTP — it did NOT
    // return null (which would fall through to factory.ts's full subprocess spawn).
    expect(result).toEqual({ success: true });
    expect(requestedUrl).toBe('https://api.example.com/v1/chat/completions');
    expect(requestedHeaders?.authorization).toBe('Bearer test-key');
  });

  it('does not double up the /v1 suffix when the base URL already ends in /v1 (Anthropic-compatible)', async () => {
    let requestedUrl: string | undefined;
    globalThis.fetch = mock(async (url: string) => {
      requestedUrl = url;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await piDriver.testConnection!(baseTestArgs({
      model: 'custom-endpoint-model',
      baseUrl: 'https://api.example.com/v1',
      connection: {
        providerType: 'pi',
        piAuthProvider: 'anthropic',
        customEndpoint: { api: 'anthropic-messages' },
      } as any,
    }));

    expect(result).toEqual({ success: true });
    expect(requestedUrl).toBe('https://api.example.com/v1/messages');
  });

  it('appends /v1 when the base URL does not already include it', async () => {
    let requestedUrl: string | undefined;
    globalThis.fetch = mock(async (url: string) => {
      requestedUrl = url;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;

    await piDriver.testConnection!(baseTestArgs({
      model: 'custom-endpoint-model',
      baseUrl: 'https://api.example.com',
      connection: {
        providerType: 'pi',
        piAuthProvider: 'anthropic',
        customEndpoint: { api: 'anthropic-messages' },
      } as any,
    }));

    expect(requestedUrl).toBe('https://api.example.com/v1/messages');
  });

  it('falls back to the subprocess path (returns null) when there is no provider hint', async () => {
    const result = await piDriver.testConnection!(baseTestArgs({ connection: undefined }));
    expect(result).toBeNull();
  });
});
