/**
 * Tests for McpClientPool — config change detection during sync().
 *
 * Verifies that when a source's OAuth token is refreshed, sync() reconnects
 * the source with fresh credentials instead of keeping a stale connection.
 * This was the root cause of MCP connection drops every 30-60 minutes:
 * tokens were refreshed but never applied to existing transports.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { McpClientPool } from '../src/mcp/mcp-pool.ts';
import type { SdkMcpServerConfig } from '../src/agent/backend/types.ts';
import type { PoolClient } from '../src/mcp/client.ts';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

// ============================================================
// Helpers
// ============================================================

const mockTools: Tool[] = [
  {
    name: 'test-tool',
    description: 'A test tool',
    inputSchema: { type: 'object' as const, properties: {} },
  },
];

function makeMockClient(): PoolClient {
  return {
    listTools: async () => mockTools,
    callTool: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
    close: async () => {},
  };
}

function makeBinaryClient(): PoolClient {
  return {
    listTools: async () => mockTools,
    callTool: async (_name, args) => {
      if (args.delayMs) {
        await new Promise(resolve => setTimeout(resolve, Number(args.delayMs)));
      }
      return {
        content: [{
          type: 'image',
          data: Buffer.from(String(args.payload)).toString('base64'),
          mimeType: 'application/octet-stream',
        }],
      };
    },
    close: async () => {},
  };
}

function makeLargeTextClient(): PoolClient {
  return {
    listTools: async () => mockTools,
    callTool: async () => ({
      content: [{ type: 'text', text: 'large response text '.repeat(3_000) }],
    }),
    close: async () => {},
  };
}

function httpConfig(token: string, url = 'https://mcp.example.com'): SdkMcpServerConfig {
  return { type: 'streamable_http', url, headers: { Authorization: `Bearer ${token}` } };
}

function stdioConfig(command: string, args?: string[], env?: Record<string, string>): SdkMcpServerConfig {
  return { type: 'stdio', command, args, env };
}

/**
 * Subclass that intercepts connect/disconnect to avoid real MCP connections
 * while letting sync()'s config-change detection logic run against real state.
 */
class TestablePool extends McpClientPool {
  public connectCalls: Array<{ slug: string; config: SdkMcpServerConfig }> = [];
  public disconnectCalls: string[] = [];

  async connect(slug: string, config: SdkMcpServerConfig): Promise<void> {
    this.connectCalls.push({ slug, config });
    await this.registerClient(slug, makeMockClient());
    this.activeConfigs.set(slug, config);
  }

  async disconnect(slug: string): Promise<void> {
    this.disconnectCalls.push(slug);
    await super.disconnect(slug);
  }

  /** Reset tracking arrays between sync phases within a single test */
  resetTracking(): void {
    this.connectCalls = [];
    this.disconnectCalls = [];
  }
}

class BinaryPool extends McpClientPool {
  async connect(slug: string, config: SdkMcpServerConfig): Promise<void> {
    await this.registerClient(slug, makeBinaryClient());
    this.activeConfigs.set(slug, config);
  }
}

class LargeTextPool extends McpClientPool {
  async connect(slug: string, config: SdkMcpServerConfig): Promise<void> {
    await this.registerClient(slug, makeLargeTextClient());
    this.activeConfigs.set(slug, config);
  }
}

// ============================================================
// Tests
// ============================================================

describe('McpClientPool.sync — config change detection', () => {
  let pool: TestablePool;

  beforeEach(() => {
    pool = new TestablePool();
  });

  it('reconnects when Authorization header changes (token refresh)', async () => {
    await pool.sync({ craft: httpConfig('old-token') });
    expect(pool.isConnected('craft')).toBe(true);
    pool.resetTracking();

    await pool.sync({ craft: httpConfig('new-token') });

    expect(pool.disconnectCalls).toEqual(['craft']);
    expect(pool.connectCalls).toHaveLength(1);
    expect(pool.connectCalls[0].config.headers?.Authorization).toBe('Bearer new-token');
    expect(pool.isConnected('craft')).toBe(true);
  });

  it('does not reconnect when config is unchanged', async () => {
    const config = httpConfig('token-1');
    await pool.sync({ craft: config });
    pool.resetTracking();

    await pool.sync({ craft: config });

    expect(pool.connectCalls).toHaveLength(0);
    expect(pool.disconnectCalls).toHaveLength(0);
  });

  it('reconnects when URL changes', async () => {
    await pool.sync({ craft: httpConfig('token', 'https://old.example.com') });
    pool.resetTracking();

    await pool.sync({ craft: httpConfig('token', 'https://new.example.com') });

    expect(pool.disconnectCalls).toEqual(['craft']);
    expect(pool.connectCalls).toHaveLength(1);
  });

  it('does not reconnect when only non-auth headers change', async () => {
    // Only Authorization and URL should trigger reconnect — other header
    // changes (tracing, versioning) should not cause connection churn.
    const config1: SdkMcpServerConfig = {
      type: 'streamable_http',
      url: 'https://mcp.example.com',
      headers: { Authorization: 'Bearer same', 'X-Request-Id': 'aaa' },
    };
    const config2: SdkMcpServerConfig = {
      type: 'streamable_http',
      url: 'https://mcp.example.com',
      headers: { Authorization: 'Bearer same', 'X-Request-Id': 'bbb' },
    };

    await pool.sync({ craft: config1 });
    pool.resetTracking();

    await pool.sync({ craft: config2 });

    expect(pool.connectCalls).toHaveLength(0);
    expect(pool.disconnectCalls).toHaveLength(0);
  });

  it('reconnects when stdio command changes', async () => {
    await pool.sync({ local: stdioConfig('old-command', ['serve']) });
    pool.resetTracking();

    await pool.sync({ local: stdioConfig('new-command', ['serve']) });

    expect(pool.disconnectCalls).toEqual(['local']);
    expect(pool.connectCalls).toHaveLength(1);
    expect(pool.connectCalls[0].config).toEqual(stdioConfig('new-command', ['serve']));
  });

  it('reconnects when stdio args change', async () => {
    await pool.sync({ local: stdioConfig('node', ['server-v1.mjs']) });
    pool.resetTracking();

    await pool.sync({ local: stdioConfig('node', ['server-v2.mjs']) });

    expect(pool.disconnectCalls).toEqual(['local']);
    expect(pool.connectCalls).toHaveLength(1);
  });

  it('reconnects when stdio env changes', async () => {
    await pool.sync({ local: stdioConfig('node', ['server.mjs'], { FEATURE: 'old' }) });
    pool.resetTracking();

    await pool.sync({ local: stdioConfig('node', ['server.mjs'], { FEATURE: 'new' }) });

    expect(pool.disconnectCalls).toEqual(['local']);
    expect(pool.connectCalls).toHaveLength(1);
  });

  it('disconnects sources removed from config', async () => {
    const config = httpConfig('token');
    await pool.sync({ craft: config, linear: config });
    pool.resetTracking();

    await pool.sync({ craft: config });

    expect(pool.disconnectCalls).toEqual(['linear']);
    expect(pool.isConnected('craft')).toBe(true);
    expect(pool.isConnected('linear')).toBe(false);
  });

  it('handles add + remove + refresh in a single sync', async () => {
    await pool.sync({
      craft: httpConfig('old-craft-token'),
      linear: httpConfig('linear-token', 'https://linear.example.com'),
    });
    pool.resetTracking();

    // craft: token refreshed, linear: removed, github: added
    await pool.sync({
      craft: httpConfig('new-craft-token'),
      github: httpConfig('gh-token', 'https://github.example.com'),
    });

    expect(pool.disconnectCalls).toContain('linear');
    expect(pool.disconnectCalls).toContain('craft');
    expect(pool.connectCalls.find(c => c.slug === 'craft')?.config.headers?.Authorization).toBe('Bearer new-craft-token');
    expect(pool.connectCalls.find(c => c.slug === 'github')).toBeDefined();
    expect(pool.isConnected('craft')).toBe(true);
    expect(pool.isConnected('linear')).toBe(false);
    expect(pool.isConnected('github')).toBe(true);
  });

  it('reports failure when reconnect fails after token refresh', async () => {
    let connectAttempts = 0;
    const failPool = new TestablePool();
    const origConnect = failPool.connect.bind(failPool);
    failPool.connect = async (slug: string, config: SdkMcpServerConfig) => {
      connectAttempts++;
      if (connectAttempts > 1) throw new Error('Server unavailable');
      return origConnect(slug, config);
    };

    await failPool.sync({ craft: httpConfig('old-token') });
    expect(failPool.isConnected('craft')).toBe(true);

    // Token refresh — disconnect succeeds but reconnect throws
    const failures = await failPool.sync({ craft: httpConfig('new-token') });

    expect(failures).toContain('craft');
    expect(failPool.isConnected('craft')).toBe(false);
  });
});

describe('McpClientPool.refreshSource', () => {
  it('force reconnects a source and reports tool count', async () => {
    const pool = new TestablePool();
    await pool.sync({ craft: httpConfig('token') });
    pool.resetTracking();

    const result = await pool.refreshSource('craft', httpConfig('token'));

    expect(result).toEqual({ success: true, sourceSlug: 'craft', toolCount: 1 });
    expect(pool.disconnectCalls).toEqual(['craft']);
    expect(pool.connectCalls).toHaveLength(1);
    expect(pool.isConnected('craft')).toBe(true);
  });

  it('fails closed when reconnect fails', async () => {
    const pool = new TestablePool();
    await pool.sync({ craft: httpConfig('token') });
    pool.connect = async () => {
      throw new Error('Server unavailable');
    };

    const result = await pool.refreshSource('craft', httpConfig('token'));

    expect(result).toEqual({ success: false, sourceSlug: 'craft', error: 'Server unavailable' });
    expect(pool.isConnected('craft')).toBe(false);
    expect(pool.getProxyToolDefs(['craft'])).toEqual([]);
  });
});

describe('McpClientPool.callTool — per-call options', () => {
  it('saves concurrent binary responses to each call sessionPath', async () => {
    const sessionA = mkdtempSync(join(tmpdir(), 'mcp-pool-session-a-'));
    const sessionB = mkdtempSync(join(tmpdir(), 'mcp-pool-session-b-'));
    const pool = new BinaryPool();

    try {
      await pool.sync({ craft: httpConfig('token') });

      await Promise.all([
        pool.callTool('mcp__craft__test-tool', { payload: 'alpha', delayMs: 10 }, { sessionPath: sessionA }),
        pool.callTool('mcp__craft__test-tool', { payload: 'bravo', delayMs: 1 }, { sessionPath: sessionB }),
      ]);

      const filesA = readdirSync(join(sessionA, 'downloads'));
      const filesB = readdirSync(join(sessionB, 'downloads'));

      expect(filesA).toHaveLength(1);
      expect(filesB).toHaveLength(1);
      expect(readFileSync(join(sessionA, 'downloads', filesA[0]!), 'utf8')).toBe('alpha');
      expect(readFileSync(join(sessionB, 'downloads', filesB[0]!), 'utf8')).toBe('bravo');
    } finally {
      rmSync(sessionA, { recursive: true, force: true });
      rmSync(sessionB, { recursive: true, force: true });
    }
  });

  it('uses the per-call summarize callback for large responses', async () => {
    const sessionPath = mkdtempSync(join(tmpdir(), 'mcp-pool-large-response-'));
    const pool = new LargeTextPool();
    const prompts: string[] = [];

    try {
      await pool.sync({ craft: httpConfig('token') });

      const result = await pool.callTool('mcp__craft__test-tool', {}, {
        sessionPath,
        summarize: async (prompt) => {
          prompts.push(prompt);
          return 'mock summary';
        },
      });

      expect(result.isError).toBe(false);
      expect(prompts).toHaveLength(1);
      expect(result.content).toContain('mock summary');
      expect(readdirSync(join(sessionPath, 'long_responses')).length).toBeGreaterThan(0);
    } finally {
      rmSync(sessionPath, { recursive: true, force: true });
    }
  });
});

describe('McpClientPool.sync — tools changed listeners', () => {
  it('notifies all registered listeners except listeners removed before sync', async () => {
    const pool = new TestablePool();
    const calls: string[] = [];
    const first = () => calls.push('first');
    const second = () => calls.push('second');
    const removed = () => calls.push('removed');

    pool.addToolsChangedListener(first);
    pool.addToolsChangedListener(second);
    pool.addToolsChangedListener(removed);
    pool.removeToolsChangedListener(removed);

    await pool.sync({});

    expect(calls).toEqual(['first', 'second']);
  });
});
