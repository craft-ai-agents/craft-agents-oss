import { describe, expect, it } from 'bun:test';
import { createSearchTool } from './create-search-tool.ts';
import type { WebSearchProvider } from './types.ts';

describe('createSearchTool', () => {
  it('keeps canonical tool identity', () => {
    const provider: WebSearchProvider = {
      name: 'Mock',
      async search() {
        return [];
      },
    };

    const tool = createSearchTool(provider);

    expect(tool.name).toBe('web_search');
    expect(tool.label).toBe('Web Search');
    expect(tool.description).toContain('Search the web');
  });

  it('clamps count to [1, 10] and formats results', async () => {
    let capturedCount = 0;
    const provider: WebSearchProvider = {
      name: 'MockProvider',
      async search(query, count) {
        capturedCount = count;
        return [{ title: `Result for ${query}`, url: 'https://example.com', description: 'desc' }];
      },
    };

    const tool = createSearchTool(provider);
    const result = await tool.execute('tool-1', { query: 'craft', count: 99 });

    expect(capturedCount).toBe(10);
    expect(result.details?.isError).toBeUndefined();
    expect(result.content[0]?.type).toBe('text');
    expect((result.content[0] as any).text).toContain('(via MockProvider)');
  });

  it('marks provider failures as errors without fallback', async () => {
    const provider: WebSearchProvider = {
      name: 'SearXNG',
      async search() {
        throw new Error('searxng unavailable');
      },
    };

    const tool = createSearchTool(provider);
    const result = await tool.execute('tool-2', { query: 'craft', count: 5 });

    expect(result.details?.isError).toBe(true);
    expect((result.content[0] as any).text).toBe(
      'Search failed for "craft": searxng unavailable',
    );
  });
});
