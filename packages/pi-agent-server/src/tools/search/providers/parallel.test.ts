import { afterEach, describe, expect, it } from 'bun:test';
import { version } from '../../../../package.json';
import { ParallelSearchProvider } from './parallel.ts';
import { resolveSearchProvider } from '../resolve-provider.ts';
import { createSearchTool } from '../create-search-tool.ts';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function mockMcp(result: object, observed: Array<{ method: string; headers: Headers; params: any }>) {
  globalThis.fetch = (async (_url: any, init: any) => {
    const request = init?.body ? JSON.parse(init.body) : {};
    observed.push({ method: request.method, headers: new Headers(init?.headers), params: request.params });
    if (request.id === undefined) return new Response(null, { status: 202 });
    let data: any;
    if (request.method === 'initialize') data = { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } };
    else if (request.method === 'tools/list') data = { tools: [{ name: 'web_search', inputSchema: { type: 'object' } }] };
    else data = result;
    return Response.json({ jsonrpc: '2.0', id: request.id, result: data });
  }) as typeof fetch;
}

const results = [
  { title: 'Bun test runner', url: 'https://bun.sh/docs/test', excerpts: ['Run bun test.', 'Supports TypeScript.'] },
  { title: null, url: 'https://bun.sh', excerpts: [] },
];

describe('Parallel native search', () => {
  it('requires explicit selection and preserves automatic routing with credentials', () => {
    const auth = { provider: 'openai', credential: { type: 'api_key', key: 'fixture' } };
    expect(resolveSearchProvider(auth).name).toBe('OpenAI');
    expect(resolveSearchProvider(auth, undefined, 'auto').name).toBe('OpenAI');
    expect(resolveSearchProvider().name).toBe('DuckDuckGo');
    expect(resolveSearchProvider(auth, undefined, 'parallel')).toBeInstanceOf(ParallelSearchProvider);
  });

  for (const structured of [true, false]) {
    it(`maps ${structured ? 'structured' : 'text JSON'} MCP results and identifies every request without auth`, async () => {
      const observed: any[] = [];
      mockMcp(structured ? { content: [], structuredContent: { results } } : { content: [{ type: 'text', text: JSON.stringify({ results }) }] }, observed);
      const provider = resolveSearchProvider(undefined, undefined, 'parallel');
      const mapped = await provider.search('Bun test runner', 1);
      expect(mapped).toEqual([{ title: 'Bun test runner', url: 'https://bun.sh/docs/test', description: 'Run bun test.\n\nSupports TypeScript.' }]);
      expect(observed.map(r => r.method)).toContain('tools/list');
      const call = observed.find(r => r.method === 'tools/call');
      expect(call.params.arguments.search_queries).toEqual(['Bun test runner']);
      expect(call.params.arguments.session_id).toBeString();
      for (const req of observed) {
        expect(req.headers.get('User-Agent')).toBe(`craft-agents/${version}`);
        expect(req.headers.has('Authorization')).toBe(false);
        expect(req.headers.has('x-api-key')).toBe(false);
      }
    });
  }

  it('retains the native tool response and DDG fallback behavior on MCP errors', async () => {
    mockMcp({ isError: true, content: [{ type: 'text', text: 'rate limited' }] }, []);
    const tool = createSearchTool(new ParallelSearchProvider(), { name: 'DuckDuckGo', async search() { return [{ title: 'Fallback', url: 'https://example.com', description: 'fixture' }]; } });
    const result = await tool.execute('test', { query: 'query' }, undefined, undefined, {} as any);
    expect(result.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('automatically fell back to DuckDuckGo') });
  });

  it('rejects malformed entries instead of returning misleading native results', async () => {
    mockMcp({ content: [], structuredContent: { results: [{ url: 1, excerpts: [] }] } }, []);
    await expect(new ParallelSearchProvider().search('query', 5)).rejects.toThrow('invalid search entry');
  });

  it('propagates cancellation without initiating a fallback', async () => {
    const controller = new AbortController();
    let fallbackCalls = 0;
    globalThis.fetch = (async (_url: any, init: any) => {
      controller.abort();
      init.signal.throwIfAborted();
      throw new Error('unreachable');
    }) as typeof fetch;
    const tool = createSearchTool(new ParallelSearchProvider(), { name: 'DuckDuckGo', async search() { fallbackCalls++; return []; } });
    await expect(tool.execute('test', { query: 'query' }, controller.signal, undefined, {} as any)).rejects.toThrow();
    expect(fallbackCalls).toBe(0);
  });
});
