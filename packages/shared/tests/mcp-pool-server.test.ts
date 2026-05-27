import { describe, expect, it } from 'bun:test';
import { McpPoolServer } from '../src/mcp/pool-server.ts';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { McpClientPool, McpClientPoolCallOptions, McpToolResult, ProxyToolDef } from '../src/mcp/mcp-pool.ts';

class StubPool {
  callToolCalls: Array<{
    name: string;
    args: Record<string, unknown>;
    options?: McpClientPoolCallOptions;
  }> = [];

  getProxyToolDefs(slugs?: string[]): ProxyToolDef[] {
    const allDefs: ProxyToolDef[] = [
      {
        name: 'mcp__craft__search',
        description: 'Search Craft',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'mcp__linear__list_issues',
        description: 'List Linear issues',
        inputSchema: { type: 'object', properties: {} },
      },
    ];

    if (!slugs) return allDefs;
    return allDefs.filter(def => slugs.includes(def.name.split('__')[1] ?? ''));
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    options?: McpClientPoolCallOptions,
  ): Promise<McpToolResult> {
    this.callToolCalls.push({ name, args, options });
    return { content: 'ok', isError: false };
  }
}

function createMcpServer(poolServer: McpPoolServer): Server {
  return (poolServer as unknown as { createMcpServer(): Server }).createMcpServer();
}

async function callHandler(server: Server, method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const handlers = (server as unknown as {
    _requestHandlers: Map<string, (request: { method: string; params: Record<string, unknown> }) => Promise<unknown>>;
  })._requestHandlers;
  const handler = handlers.get(method);
  if (!handler) throw new Error(`Missing MCP handler for ${method}`);
  return handler({ method, params });
}

describe('McpPoolServer', () => {
  it('lists only tools from the configured slug filter', async () => {
    const poolServer = new McpPoolServer(new StubPool() as unknown as McpClientPool, {
      slugFilter: ['craft'],
      sessionPath: '/tmp/session-a',
    });

    const result = await callHandler(createMcpServer(poolServer), 'tools/list') as {
      tools: Array<{ name: string }>;
    };

    expect(result.tools.map(tool => tool.name)).toEqual(['craft__search']);
  });

  it('forwards sessionPath when calling a tool', async () => {
    const pool = new StubPool();
    const poolServer = new McpPoolServer(pool as unknown as McpClientPool, {
      slugFilter: ['craft'],
      sessionPath: '/tmp/session-b',
    });

    const result = await callHandler(createMcpServer(poolServer), 'tools/call', {
      name: 'craft__search',
      arguments: { query: 'alpha' },
    }) as {
      content: Array<{ type: string; text: string }>;
    };

    expect(result.content[0]?.text).toBe('ok');
    expect(pool.callToolCalls).toEqual([{
      name: 'mcp__craft__search',
      args: { query: 'alpha' },
      options: { sessionPath: '/tmp/session-b' },
    }]);
  });
});
