/**
 * Creates a `web_search` ToolDefinition backed by the given search provider.
 *
 * The tool name is always `web_search` regardless of the underlying provider,
 * so the model doesn't need to know which backend is used.
 */

import { Type } from '@sinclair/typebox';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { WebSearchProvider, WebSearchResult } from './types.ts';

const schema = Type.Object({
  query: Type.String({ description: 'The search query' }),
  count: Type.Optional(
    Type.Number({
      description: 'Max results (1-10, default 5)',
      minimum: 1,
      maximum: 10,
    }),
  ),
});

function formatResults(query: string, providerName: string, results: WebSearchResult[]) {
  const formatted = results
    .map(
      (r, i) =>
        `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.description}`,
    )
    .join('\n\n');

  return {
    content: [
      {
        type: 'text' as const,
        text: `Search results for "${query}" (via ${providerName}):\n\n${formatted}`,
      },
    ],
    details: {},
  };
}

export function createSearchTool(provider: WebSearchProvider): ToolDefinition<typeof schema> {
  return {
    name: 'web_search',
    label: 'Web Search',
    description:
      'Search the web for current information. Returns titles, URLs, and snippets. Use for current information, documentation lookups, or fact-checking.',
    promptSnippet:
      'Use web_search for up-to-date information, documentation lookups, or fact-checking. Returns titles, URLs, and snippets. Accepts a query string and optional count (1-10).',
    parameters: schema,
    async execute(toolCallId, params) {
      const { query } = params;
      const count = Math.max(1, Math.min(10, params.count ?? 5));

      try {
        const results = await provider.search(query, count);
        return formatResults(query, provider.name, results);
      } catch (err) {
        const primaryMsg = err instanceof Error ? err.message : String(err);
        // 必须 throw:SDK 只在工具抛异常时把 tool_execution_end.isError 置真。
        // 旧版"失败包装成成功返回 + details.isError"导致搜索层瘫痪对 trace 完全
        // 隐形(生产实测 searxng 全灭数周,286 条失败结果记成 success)。
        throw new Error(`Search failed for "${query}": ${primaryMsg}`);
      }
    },
  };
}
