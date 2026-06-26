/**
 * SearXNG search provider — self-hosted privacy metasearch engine.
 *
 * Aggregates Google, Bing, DDG, Wikipedia etc. behind a single JSON API.
 * Requires `SEARXNG_URL` env var pointing to the SearXNG instance base URL,
 * e.g. `http://searxng:8080`.
 *
 * SearXNG must be configured to proxy outgoing requests through mihomo,
 * otherwise Google/Bing are unreachable from a domestic server.
 */

import type { WebSearchProvider, WebSearchResult } from '../types.ts';

function searchLanguage(query: string) {
  return /[\u3400-\u9fff]/u.test(query) ? 'zh-CN' : 'en';
}

export class SearXNGSearchProvider implements WebSearchProvider {
  name = 'SearXNG';

  constructor(private baseUrl: string) {}

  async search(query: string, count: number): Promise<WebSearchResult[]> {
    const url = `${this.baseUrl}/search?${new URLSearchParams({
      q: query,
      format: 'json',
      categories: 'general',
      language: searchLanguage(query),
    }).toString()}`;

    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new Error(`SearXNG returned HTTP ${response.status}`);
    }

    const data = (await response.json()) as {
      results?: Array<{ title?: string; url?: string; content?: string; engine?: string }>;
    };

    if (!data.results?.length) {
      throw new Error(`SearXNG returned no results for "${query}"`);
    }

    return data.results.slice(0, count).map((r) => ({
      title: r.title || r.url || 'Untitled',
      url: r.url || '',
      description: (r.content || '').replace(/\s+/g, ' ').trim().slice(0, 300),
    }));
  }
}
