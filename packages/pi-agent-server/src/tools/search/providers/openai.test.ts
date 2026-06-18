import { afterEach, describe, expect, it } from 'bun:test';
import { ResponsesApiSearchProvider } from './openai.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('ResponsesApiSearchProvider', () => {
  it('calls Responses API with web_search tool and parses URL citations', async () => {
    let calledUrl = '';
    let calledBody: any = null;
    let calledHeaders: Record<string, string> = {};

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = typeof input === 'string' ? input : input.toString();
      calledBody = init?.body ? JSON.parse(String(init.body)) : null;
      const h = init?.headers as Record<string, string> | undefined;
      calledHeaders = h || {};

      return new Response(
        JSON.stringify({
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: 'A text with citations.',
                  annotations: [
                    { type: 'url_citation', url: 'https://a.com', title: 'A' },
                    { type: 'url_citation', url: 'https://a.com', title: 'A duplicate' },
                    { type: 'url_citation', url: 'https://b.com', title: 'B' },
                  ],
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const provider = new ResponsesApiSearchProvider({
      apiBase: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
    });
    const results = await provider.search('craft agent', 5);

    expect(calledUrl).toBe('https://api.openai.com/v1/responses');
    expect(calledBody.model).toBe('gpt-4o-mini');
    expect(calledBody.tools).toEqual([{ type: 'web_search' }]);
    expect(calledHeaders['Authorization']).toBe('Bearer sk-test');

    expect(results).toHaveLength(2);
    expect(results[0]?.url).toBe('https://a.com');
    expect(results[1]?.url).toBe('https://b.com');
  });

  it('uses custom apiBase and model for OpenRouter', async () => {
    let calledUrl = '';
    let calledBody: any = null;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = typeof input === 'string' ? input : input.toString();
      calledBody = init?.body ? JSON.parse(String(init.body)) : null;

      return new Response(
        JSON.stringify({
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: 'Results from OpenRouter.',
                  annotations: [
                    { type: 'url_citation', url: 'https://example.com', title: 'Example' },
                  ],
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const provider = new ResponsesApiSearchProvider({
      apiBase: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-or-test',
      model: 'openai/gpt-4o-mini',
    });

    expect(provider.name).toBe('OpenRouter');

    const results = await provider.search('test', 5);

    expect(calledUrl).toBe('https://openrouter.ai/api/v1/responses');
    expect(calledBody.model).toBe('openai/gpt-4o-mini');
    expect(results).toHaveLength(1);
  });

  it('respects count limit when parsing citations', async () => {
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: 'Top links',
                  annotations: [
                    { type: 'url_citation', url: 'https://1.com', title: '1' },
                    { type: 'url_citation', url: 'https://2.com', title: '2' },
                    { type: 'url_citation', url: 'https://3.com', title: '3' },
                  ],
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const provider = new ResponsesApiSearchProvider({
      apiBase: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
    });
    const results = await provider.search('craft', 2);

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.url)).toEqual(['https://1.com', 'https://2.com']);
  });

  it('falls back to summary result when no citations are present', async () => {
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: 'No citations, but useful summary.' }],
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const provider = new ResponsesApiSearchProvider({
      apiBase: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
    });
    const results = await provider.search('craft', 5);

    expect(results).toHaveLength(1);
    expect(results[0]?.title).toContain('Search results for');
    expect(results[0]?.description).toContain('No citations');
    expect(results[0]?.url).toBe('');
  });

  it('includes extraHeaders in the request', async () => {
    let calledHeaders: Record<string, string> = {};

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      calledHeaders = (init?.headers as Record<string, string>) || {};

      return new Response(
        JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const provider = new ResponsesApiSearchProvider({
      apiBase: 'https://custom.api.com/v1',
      apiKey: 'key',
      extraHeaders: { 'X-Custom': 'value' },
      displayName: 'Custom',
    });

    expect(provider.name).toBe('Custom');
    await provider.search('test', 1);
    expect(calledHeaders['X-Custom']).toBe('value');
  });

  it('derives display name from apiBase', () => {
    const openai = new ResponsesApiSearchProvider({
      apiBase: 'https://api.openai.com/v1',
      apiKey: 'k',
    });
    const openrouter = new ResponsesApiSearchProvider({
      apiBase: 'https://openrouter.ai/api/v1',
      apiKey: 'k',
    });
    const custom = new ResponsesApiSearchProvider({
      apiBase: 'https://my-proxy.com/v1',
      apiKey: 'k',
    });

    expect(openai.name).toBe('OpenAI');
    expect(openrouter.name).toBe('OpenRouter');
    expect(custom.name).toBe('Web Search');
  });
});
