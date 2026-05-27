import { describe, expect, it } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpPoolServer } from '../src/mcp/pool-server.ts';
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

async function withMcpClient<T>(
  poolServer: McpPoolServer,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const url = await poolServer.start();
  const client = new Client(
    { name: 'mcp-pool-server-test', version: '1.0.0' },
    { capabilities: {} },
  );
  const transport = new StreamableHTTPClientTransport(new URL(url));

  try {
    await client.connect(transport);
    return await fn(client);
  } finally {
    await client.close().catch(() => {});
    await poolServer.stop();
  }
}

describe('McpPoolServer', () => {
  it('lists only tools from the configured slug filter', async () => {
    const poolServer = new McpPoolServer(new StubPool() as unknown as McpClientPool, {
      slugFilter: ['craft'],
      sessionPath: '/tmp/session-a',
    });

    const result = await withMcpClient(poolServer, client => client.listTools());

    expect(result.tools.map(tool => tool.name)).toEqual(['craft__search']);
  });

  it('forwards sessionPath when calling a tool', async () => {
    const pool = new StubPool();
    const poolServer = new McpPoolServer(pool as unknown as McpClientPool, {
      slugFilter: ['craft'],
      sessionPath: '/tmp/session-b',
    });

    const result = await withMcpClient(poolServer, client => client.callTool({
      name: 'craft__search',
      arguments: { query: 'alpha' },
    }));

    expect(result.content[0]?.text).toBe('ok');
    expect(pool.callToolCalls).toEqual([{
      name: 'mcp__craft__search',
      args: { query: 'alpha' },
      options: { sessionPath: '/tmp/session-b' },
    }]);
  });

  it('preserves dynamic call options while applying the fixed sessionPath', async () => {
    const pool = new StubPool();
    const summarize = async () => 'summary';
    const poolServer = new McpPoolServer(pool as unknown as McpClientPool, {
      sessionPath: '/tmp/session-c',
      getCallToolOptions: () => ({
        sessionPath: '/tmp/stale-session',
        summarize,
      }),
    });

    await withMcpClient(poolServer, client => client.callTool({
      name: 'craft__search',
      arguments: {},
    }));

    expect(pool.callToolCalls[0]?.options).toEqual({
      sessionPath: '/tmp/session-c',
      summarize,
    });
  });
});
