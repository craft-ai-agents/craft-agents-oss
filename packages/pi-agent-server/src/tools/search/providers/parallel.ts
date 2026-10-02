/** Free, keyless Parallel Search MCP adapter for the native web_search tool. */
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { version } from '../../../../package.json';
import type { WebSearchProvider, WebSearchResult } from '../types.ts';

const ENDPOINT = 'https://search.parallel.ai/mcp';
const USER_AGENT = `craft-agents/${version}`;

function parseResults(data: unknown, count: number): WebSearchResult[] {
  if (!data || typeof data !== 'object' || !('results' in data) || !Array.isArray(data.results)) {
    throw new Error('Parallel Search MCP returned an invalid result');
  }
  return data.results.slice(0, count).map((item: unknown) => {
    if (!item || typeof item !== 'object' || !('url' in item) || typeof item.url !== 'string' ||
        !('excerpts' in item) || !Array.isArray(item.excerpts) ||
        !item.excerpts.every((text: unknown) => typeof text === 'string')) {
      throw new Error('Parallel Search MCP returned an invalid search entry');
    }
    return {
      title: 'title' in item && typeof item.title === 'string' ? item.title : item.url,
      url: item.url,
      description: item.excerpts.join('\n\n'),
    };
  });
}

export class ParallelSearchProvider implements WebSearchProvider {
  name = 'Parallel';

  // Shared across adapter instances because the runtime resolves providers per call.
  // The UUID identifies this application process without exposing a saved session ID.
  private static readonly sessionId = randomUUID();

  async search(query: string, count: number, signal?: AbortSignal): Promise<WebSearchResult[]> {
    const deadline = AbortSignal.timeout(30_000);
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
    combined.throwIfAborted();
    const client = new Client({ name: 'craft-agents', version });
    const transport = new StreamableHTTPClientTransport(new URL(ENDPOINT), {
      // Always attach identification and the same deadline, including discovery and SSE.
      // No auth provider or ambient Parallel key is consulted.
      fetch: (url, init) => {
        const headers = new Headers(init?.headers);
        headers.set('User-Agent', USER_AGENT);
        const requestSignal = init?.signal
          ? AbortSignal.any([combined, init.signal]) : combined;
        return fetch(url, { ...init, headers, signal: requestSignal });
      },
    });
    try {
      await client.connect(transport);
      const tools = await client.listTools({}, { signal: combined });
      if (!tools.tools.some(tool => tool.name === 'web_search')) {
        throw new Error('Parallel Search MCP does not expose web_search');
      }
      const result = await client.callTool({
        name: 'web_search',
        arguments: { objective: query, search_queries: [query], session_id: ParallelSearchProvider.sessionId },
      }, undefined, { signal: combined });
      if (result.isError) throw new Error('Parallel Search MCP search failed');
      if (result.structuredContent) return parseResults(result.structuredContent, count);
      // MCP also permits JSON encoded in a text content block.
      const content = result.content as Array<{ type: string; text?: string }>;
      const text = content.find(block => block.type === 'text' && block.text)?.text;
      if (!text) throw new Error('Parallel Search MCP returned no search content');
      return parseResults(JSON.parse(text), count);
    } finally {
      await client.close();
    }
  }
}
