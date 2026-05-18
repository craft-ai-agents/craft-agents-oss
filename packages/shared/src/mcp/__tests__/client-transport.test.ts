import { describe, expect, test } from 'bun:test';
import { CraftMcpClient } from '../client.ts';

describe('CraftMcpClient transport selection', () => {
  test('uses SSE transport for sse MCP sources', async () => {
    const client = new CraftMcpClient({
      transport: 'sse',
      url: 'https://mcp.example.test/sse',
      headers: { Authorization: 'Bearer token' },
    });

    try {
      const transport = (client as unknown as { transport: { constructor: { name: string } } }).transport;
      expect(transport.constructor.name).toBe('SSEClientTransport');
    } finally {
      await client.close();
    }
  });
});
