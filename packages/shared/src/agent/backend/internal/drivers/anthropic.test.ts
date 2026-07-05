import { afterEach, describe, expect, it } from 'bun:test';
import { anthropicDriver } from './anthropic.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('anthropicDriver.fetchModels', () => {
  it('filters deprecated Opus models from live startup refresh and prefers Opus 4.8 as default', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      data: [
        { id: 'claude-opus-4-6', display_name: 'Claude Opus 4.6', created_at: '2026-01-01T00:00:00Z', type: 'model' },
        { id: 'claude-opus-4-8', display_name: 'Claude Opus 4.8', created_at: '2026-05-01T00:00:00Z', type: 'model' },
        { id: 'claude-opus-4-7', display_name: 'Claude Opus 4.7', created_at: '2026-04-01T00:00:00Z', type: 'model' },
        { id: 'claude-opus-4-5-20251101', display_name: 'Claude Opus 4.5', created_at: '2025-11-01T00:00:00Z', type: 'model' },
        { id: 'claude-sonnet-4-6', display_name: 'Claude Sonnet 4.6', created_at: '2026-01-01T00:00:00Z', type: 'model' },
      ],
      has_more: false,
      first_id: 'claude-opus-4-6',
      last_id: 'claude-sonnet-4-6',
    }), { status: 200 })) as unknown as typeof fetch;

    const result = await anthropicDriver.fetchModels!({
      connection: {
        slug: 'anthropic',
        name: 'Anthropic',
        providerType: 'anthropic',
        authType: 'api_key',
        createdAt: Date.now(),
      } as any,
      credentials: { apiKey: 'sk-ant-test' },
      hostRuntime: {} as any,
      resolvedPaths: {} as any,
      timeoutMs: 30_000,
    });

    expect(result.serverDefault).toBe('claude-opus-4-8');
    expect(result.models.map(m => m.id)).toEqual([
      'claude-opus-4-8',
      'claude-opus-4-7',
      'claude-sonnet-4-6',
    ]);
    expect(result.models[0]!.name).toBe('Opus 4.8');
    expect(result.models[0]!.contextWindow).toBe(1_000_000);
  });
});
