/**
 * McpClientPool.ensureConnected: single-source connect/reconnect semantics —
 * connect once, no-op on unchanged config, reconnect on credential change,
 * and the local-MCP gate for stdio configs (same gate sync() applies).
 */

import { describe, test, expect } from 'bun:test';
import { McpClientPool } from '../mcp-pool.ts';
import type { PoolClient } from '../client.ts';
import type { SdkMcpServerConfig } from '../../agent/backend/types.ts';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

class TestPool extends McpClientPool {
  connectCalls: Array<{ slug: string; config: SdkMcpServerConfig }> = [];
  closedSlugs: string[] = [];

  override async connect(slug: string, config: SdkMcpServerConfig): Promise<void> {
    this.connectCalls.push({ slug, config });
    const self = this;
    const fake: PoolClient = {
      listTools: async () => [],
      callTool: async () => ({ content: [] }),
      close: async () => { self.closedSlugs.push(slug); },
    };
    await this.registerClient(slug, fake);
    this.activeConfigs.set(slug, config);
  }
}

function httpConfig(token: string): SdkMcpServerConfig {
  return { type: 'http', url: 'https://mcp.example.test/mcp', headers: { Authorization: `Bearer ${token}` } };
}

describe('McpClientPool.ensureConnected', () => {
  test('connects an absent source once', async () => {
    const pool = new TestPool();
    await pool.ensureConnected('craft', httpConfig('a'));
    expect(pool.connectCalls.length).toBe(1);
    expect(pool.isConnected('craft')).toBe(true);
  });

  test('is a no-op when already connected with an unchanged config', async () => {
    const pool = new TestPool();
    await pool.ensureConnected('craft', httpConfig('a'));
    await pool.ensureConnected('craft', httpConfig('a'));
    expect(pool.connectCalls.length).toBe(1);
    expect(pool.closedSlugs).toEqual([]);
  });

  test('reconnects when the auth header changed (token refresh)', async () => {
    const pool = new TestPool();
    await pool.ensureConnected('craft', httpConfig('a'));
    await pool.ensureConnected('craft', httpConfig('b'));
    expect(pool.connectCalls.length).toBe(2);
    expect(pool.closedSlugs).toEqual(['craft']);
    expect(pool.isConnected('craft')).toBe(true);
  });

  test('does not touch other pool members', async () => {
    const pool = new TestPool();
    await pool.ensureConnected('one', httpConfig('a'));
    await pool.ensureConnected('two', httpConfig('x'));
    await pool.ensureConnected('one', httpConfig('b')); // reconnect 'one' only
    expect(pool.isConnected('two')).toBe(true);
    expect(pool.closedSlugs).toEqual(['one']);
  });

  test('refuses stdio configs when local MCP is disabled for the workspace', async () => {
    const prev = process.env.CRAFT_LOCAL_MCP_ENABLED;
    process.env.CRAFT_LOCAL_MCP_ENABLED = 'false';
    try {
      const pool = new TestPool({ workspaceRootPath: '/tmp/ws-does-not-exist' });
      const stdio: SdkMcpServerConfig = { type: 'stdio', command: 'echo', args: [] };
      await expect(pool.ensureConnected('local', stdio)).rejects.toThrow(/Local MCP is disabled/);
      expect(pool.connectCalls.length).toBe(0);
    } finally {
      if (prev === undefined) delete process.env.CRAFT_LOCAL_MCP_ENABLED;
      else process.env.CRAFT_LOCAL_MCP_ENABLED = prev;
    }
  });
});

// ============================================================
// Proxy name collisions (#1002): two distinct tool names that sanitize to
// the same proxy name must BOTH stay callable, under deterministic names.
// ============================================================

class CollisionPool extends McpClientPool {
  calledOriginalNames: string[] = [];

  async addSource(slug: string, toolNames: string[]): Promise<void> {
    const self = this;
    const tools = toolNames.map((name): Tool => ({
      name,
      description: `Tool ${name}`,
      inputSchema: { type: 'object' as const, properties: {} },
    }));
    const fake: PoolClient = {
      listTools: async () => tools,
      callTool: async (name: string) => {
        self.calledOriginalNames.push(name);
        return { content: [{ type: 'text', text: `ok:${name}` }] };
      },
      close: async () => {},
    };
    await this.registerClient(slug, fake);
  }
}

describe('McpClientPool proxy name collisions (#1002)', () => {
  test('both colliding tools stay registered, the later one suffixed', async () => {
    const pool = new CollisionPool();
    await pool.addSource('src', ['pat.batch', 'pat_batch']);

    const defNames = pool.getProxyToolDefs().map((d) => d.name);
    expect(defNames).toEqual(['mcp__src__pat_batch', 'mcp__src__pat_batch__2']);
    expect(pool.resolveProxyName('src', 'pat.batch')).toBe('mcp__src__pat_batch');
    expect(pool.resolveProxyName('src', 'pat_batch')).toBe('mcp__src__pat_batch__2');
    expect(pool.isProxyTool('mcp__src__pat_batch__2')).toBe(true);
  });

  test('each proxy name dispatches to its own original tool', async () => {
    const pool = new CollisionPool();
    await pool.addSource('src', ['pat.batch', 'pat_batch']);

    const first = await pool.callTool('mcp__src__pat_batch', {});
    const second = await pool.callTool('mcp__src__pat_batch__2', {});
    expect(first.isError).toBe(false);
    expect(second.isError).toBe(false);
    expect(first.content).toContain('pat.batch');
    expect(second.content).toContain('pat_batch');
    expect(pool.calledOriginalNames).toEqual(['pat.batch', 'pat_batch']);
  });

  test('triple collision suffixes in list order', async () => {
    const pool = new CollisionPool();
    await pool.addSource('src', ['a.b', 'a_b', 'a/b']);

    expect(pool.getProxyToolDefs().map((d) => d.name)).toEqual([
      'mcp__src__a_b',
      'mcp__src__a_b__2',
      'mcp__src__a_b__3',
    ]);
  });

  test('a tool literally named like a suffix is disambiguated further, not overwritten', async () => {
    const pool = new CollisionPool();
    await pool.addSource('src', ['a.b', 'a_b', 'a_b__2']);

    expect(pool.resolveProxyName('src', 'a_b__2')).toBe('mcp__src__a_b__2__2');
    const result = await pool.callTool('mcp__src__a_b__2__2', {});
    expect(result.isError).toBe(false);
    expect(pool.calledOriginalNames).toEqual(['a_b__2']);
  });

  test('assignments are deterministic and non-colliding tools keep their plain names', async () => {
    const names = ['createIssue', 'pat.batch', 'pat_batch'];
    const poolA = new CollisionPool();
    await poolA.addSource('src', names);
    const poolB = new CollisionPool();
    await poolB.addSource('src', names);

    expect(poolA.getProxyToolDefs().map((d) => d.name)).toEqual(poolB.getProxyToolDefs().map((d) => d.name));
    expect(poolA.resolveProxyName('src', 'createIssue')).toBe('mcp__src__createIssue');
  });

  test('disconnect frees the assigned names for a clean re-register', async () => {
    const pool = new CollisionPool();
    await pool.addSource('src', ['pat.batch', 'pat_batch']);
    await pool.disconnect('src');
    expect(pool.isProxyTool('mcp__src__pat_batch')).toBe(false);
    expect(pool.isProxyTool('mcp__src__pat_batch__2')).toBe(false);

    await pool.addSource('src', ['pat_batch']);
    expect(pool.resolveProxyName('src', 'pat_batch')).toBe('mcp__src__pat_batch');
  });
});
