import { afterEach, describe, expect, it } from 'bun:test';
import { SearXNGSearchProvider } from './searxng.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function okSearchResponse() {
  return new Response(
    JSON.stringify({
      results: [{ title: 'Result', url: 'https://example.com', content: 'desc' }],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('SearXNGSearchProvider', () => {
  it('uses stable language parameters instead of SearXNG auto language', async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(typeof input === 'string' ? input : input.toString());
      return okSearchResponse();
    }) as typeof fetch;

    const provider = new SearXNGSearchProvider('http://searxng.local');

    await provider.search('LM358DR datasheet', 3);
    await provider.search('云汉 CL21A106KAYNNNE', 3);

    expect(new URL(urls[0]!).searchParams.get('language')).toBe('en');
    expect(new URL(urls[1]!).searchParams.get('language')).toBe('zh-CN');
  });
});
