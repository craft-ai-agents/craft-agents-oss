import { describe, expect, it } from 'bun:test';
import { resolveSearchProvider } from './resolve-provider.ts';
import { SearXNGSearchProvider } from './providers/searxng.ts';

describe('resolveSearchProvider', () => {
  it('always uses SearXNG for deterministic WebSearch results', () => {
    const provider = resolveSearchProvider({
      provider: 'openai',
      credential: { type: 'api_key', key: 'sk-test' },
    });

    expect(provider).toBeInstanceOf(SearXNGSearchProvider);
    expect(provider.name).toBe('SearXNG');
  });

  it('does not switch providers when auth is missing or malformed', () => {
    expect(resolveSearchProvider()).toBeInstanceOf(SearXNGSearchProvider);
    expect(
      resolveSearchProvider({
        provider: 'openai-codex',
        credential: { type: 'api_key', key: 'not-a-jwt' },
      }),
    ).toBeInstanceOf(SearXNGSearchProvider);
  });
});
