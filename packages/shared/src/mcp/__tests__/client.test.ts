import { afterEach, describe, expect, it } from 'bun:test';
import { createServer, type Server } from 'node:http';
import { CraftMcpClient } from '../client.ts';

let server: Server | null = null;

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = null;
});

function startStreamableHttpServer() {
  let getCount = 0;
  let postCount = 0;

  server = createServer((req, res) => {
    if (req.method === 'GET') {
      getCount += 1;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(': close immediately\n\n');
      return;
    }

    if (req.method === 'POST') {
      postCount += 1;
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        const payload = JSON.parse(body);
        const messages = Array.isArray(payload) ? payload : [payload];
        const requests = messages.filter((message) => message.id !== undefined);

        if (requests.length === 0) {
          res.writeHead(202, { 'mcp-session-id': 'mock-session' });
          res.end();
          return;
        }

        const responses = requests.map((message) => ({
          jsonrpc: '2.0',
          id: message.id,
          result: message.method === 'initialize'
            ? {
                protocolVersion: '2025-06-18',
                capabilities: { tools: {} },
                serverInfo: { name: 'mock-mcp', version: '1.0.0' },
              }
            : message.method === 'tools/list'
              ? { tools: [] }
              : {},
        }));

        res.writeHead(200, {
          'content-type': 'application/json',
          'mcp-session-id': 'mock-session',
        });
        res.end(JSON.stringify(responses.length === 1 ? responses[0] : responses));
      });
      return;
    }

    res.writeHead(405);
    res.end();
  });

  return new Promise<{
    url: string;
    counts: () => { getCount: number; postCount: number };
  }>((resolve, reject) => {
    server!.on('error', reject);
    server!.listen(0, '127.0.0.1', () => {
      const address = server!.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to bind test server'));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}/mcp`,
        counts: () => ({ getCount, postCount }),
      });
    });
  });
}

describe('CraftMcpClient', () => {
  it('does not open the optional standalone SSE GET channel', async () => {
    const { url, counts } = await startStreamableHttpServer();
    const client = new CraftMcpClient({
      transport: 'streamable_http',
      url,
    });

    await client.connect();
    await new Promise((resolve) => setTimeout(resolve, 100));
    await client.close();

    expect(counts().postCount).toBeGreaterThan(0);
    expect(counts().getCount).toBe(0);
  });
});
