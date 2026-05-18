import { describe, expect, test } from 'bun:test';
import { CraftMcpClient } from '../client.ts';
import { resolveMcpValidationTransport } from '../validation.ts';

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

describe('MCP validation transport selection', () => {
  test('passes through SSE transport for validation probes', () => {
    expect(resolveMcpValidationTransport({ mcpTransport: 'sse' })).toBe('sse');
    expect(resolveMcpValidationTransport({})).toBe('http');
    expect(resolveMcpValidationTransport({ mcpTransport: 'stdio' })).toBe('http');
  });
});
