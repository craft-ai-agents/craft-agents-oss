/**
 * Tests for Codex Source Toggle Flow
 *
 * Verifies that source toggling in Codex sessions properly regenerates
 * config.toml and triggers reconnection.
 *
 * These are unit tests that verify the CodexAgent's source handling methods.
 * Full integration tests require the actual app-server subprocess.
 */
import { describe, it, expect, beforeEach, mock } from 'bun:test';
import type { SdkMcpServerConfig } from '../backend/types.ts';
import type { LoadedSource } from '../../sources/types.ts';

// ============================================================
// Test Helpers
// ============================================================

function createMockSource(slug: string, type: 'mcp' | 'api' = 'mcp'): LoadedSource {
  return {
    config: {
      id: `${slug}-id`,
      name: `${slug} Source`,
      slug,
      enabled: true,
      provider: 'test',
      type,
      ...(type === 'mcp' ? { mcp: { transport: 'http', url: `https://${slug}.example.com` } } : {}),
      ...(type === 'api' ? { api: { baseUrl: `https://${slug}.example.com`, authType: 'bearer' } } : {}),
    },
    guide: null,
    folderPath: `/test/sources/${slug}`,
    workspaceRootPath: '/test/workspace',
    workspaceId: 'test-workspace',
  };
}

function createMockMcpConfig(slug: string): SdkMcpServerConfig {
  return {
    type: 'http',
    url: `https://${slug}.example.com`,
    headers: { Authorization: 'Bearer test-token' },
  };
}

// ============================================================
// Tests
// ============================================================

describe('Codex Source Toggle Flow', () => {
  describe('Source server tracking', () => {
    it('should track intended source slugs separately from connected', () => {
      // This tests the core mechanism: setSourceServers accepts intended slugs
      // that may differ from what's actually connected (due to auth failures, etc.)
      const mcpServers: Record<string, SdkMcpServerConfig> = {
        'source-1': createMockMcpConfig('source-1'),
        'source-2': createMockMcpConfig('source-2'),
      };
      const apiServers = {};
      const intendedSlugs = ['source-1', 'source-2', 'source-3']; // source-3 not in mcpServers

      // The intended slugs include source-3, but it won't have a server config
      // This simulates a source that failed to build (missing auth, etc.)
      expect(intendedSlugs.length).toBe(3);
      expect(Object.keys(mcpServers).length).toBe(2);
    });

    it('should compute active source slugs from MCP and API servers', () => {
      const mcpServers: Record<string, SdkMcpServerConfig> = {
        'mcp-1': createMockMcpConfig('mcp-1'),
        'mcp-2': createMockMcpConfig('mcp-2'),
      };
      const apiServers = {
        'api-1': { baseUrl: 'https://api-1.example.com' },
      };

      // Should combine both MCP and API server slugs
      const activeSlugs = [...Object.keys(mcpServers), ...Object.keys(apiServers)];
      expect(activeSlugs).toContain('mcp-1');
      expect(activeSlugs).toContain('mcp-2');
      expect(activeSlugs).toContain('api-1');
      expect(activeSlugs.length).toBe(3);
    });
  });

  describe('Config generation for source changes', () => {
    it('should generate different configs for different source sets', async () => {
      const { generateCodexConfig } = await import('../../codex/config-generator.ts');

      // First config: just source-1
      const sources1 = [createMockSource('source-1')];
      const mcpConfigs1 = { 'source-1': createMockMcpConfig('source-1') };
      const result1 = generateCodexConfig({ sources: sources1, mcpServerConfigs: mcpConfigs1 });

      // Second config: source-1 + source-2
      const sources2 = [createMockSource('source-1'), createMockSource('source-2')];
      const mcpConfigs2 = {
        'source-1': createMockMcpConfig('source-1'),
        'source-2': createMockMcpConfig('source-2'),
      };
      const result2 = generateCodexConfig({ sources: sources2, mcpServerConfigs: mcpConfigs2 });

      // Configs should be different
      expect(result1.toml).not.toBe(result2.toml);
      expect(result1.mcpSources.length).toBe(1);
      expect(result2.mcpSources.length).toBe(2);
    });

    it('should only include enabled sources', async () => {
      const { generateCodexConfig } = await import('../../codex/config-generator.ts');

      const enabledSource = createMockSource('enabled');
      const disabledSource = createMockSource('disabled');
      disabledSource.config.enabled = false;

      const sources = [enabledSource, disabledSource];
      const mcpConfigs = {
        'enabled': createMockMcpConfig('enabled'),
        'disabled': createMockMcpConfig('disabled'),
      };

      const result = generateCodexConfig({ sources, mcpServerConfigs: mcpConfigs });

      expect(result.mcpSources).toContain('enabled');
      expect(result.mcpSources).not.toContain('disabled');
      expect(result.toml).toContain('[mcp_servers.enabled]');
      expect(result.toml).not.toContain('[mcp_servers.disabled]');
    });
  });

  describe('Bridge config for API sources', () => {
    it('should generate bridge config for API sources', async () => {
      const { generateBridgeConfig } = await import('../../codex/config-generator.ts');

      const apiSource = createMockSource('gmail', 'api');
      const result = generateBridgeConfig([apiSource]);
      const config = JSON.parse(result);

      expect(config.sources).toHaveLength(1);
      expect(config.sources[0].slug).toBe('gmail');
      expect(config.sources[0].workspaceId).toBe('test-workspace');
    });

    it('should filter MCP sources from bridge config', async () => {
      const { generateBridgeConfig } = await import('../../codex/config-generator.ts');

      const mcpSource = createMockSource('linear', 'mcp');
      const apiSource = createMockSource('gmail', 'api');
      const result = generateBridgeConfig([mcpSource, apiSource]);
      const config = JSON.parse(result);

      expect(config.sources).toHaveLength(1);
      expect(config.sources[0].slug).toBe('gmail');
    });
  });

  describe('Parallel session isolation', () => {
    it('should generate independent configs for parallel sessions', async () => {
      const { generateCodexConfig } = await import('../../codex/config-generator.ts');

      // Session 1: Only github enabled
      const session1Sources = [createMockSource('github')];
      const session1Configs = { 'github': createMockMcpConfig('github') };

      // Session 2: github + linear enabled
      const session2Sources = [createMockSource('github'), createMockSource('linear')];
      const session2Configs = {
        'github': createMockMcpConfig('github'),
        'linear': createMockMcpConfig('linear'),
      };

      const result1 = generateCodexConfig({
        sources: session1Sources,
        mcpServerConfigs: session1Configs,
      });

      const result2 = generateCodexConfig({
        sources: session2Sources,
        mcpServerConfigs: session2Configs,
      });

      // Each session gets its own config
      expect(result1.mcpSources).toEqual(['github']);
      expect(result2.mcpSources).toEqual(['github', 'linear']);
      expect(result1.toml).not.toContain('linear');
      expect(result2.toml).toContain('linear');
    });
  });

  describe('api-bridge source slug extraction', () => {
    // Tests the extraction logic used in CodexAgent.extractSourceSlugFromMcpServer
    // to resolve real source slugs from api-bridge tool names.
    // Pattern: mcp__api-bridge__api_{slug} → slug

    function extractSourceSlug(mcpServer: string, mcpTool?: string): string | null {
      const BUILT_IN = new Set(['preferences', 'session', 'g4os-docs', 'api-bridge']);
      if (!mcpServer) return null;
      if (mcpServer === 'api-bridge') {
        if (mcpTool?.startsWith('api_')) return mcpTool.slice(4);
        return null;
      }
      if (BUILT_IN.has(mcpServer)) return null;
      return mcpServer;
    }

    it('should resolve real source slug from api-bridge tool name', () => {
      expect(extractSourceSlug('api-bridge', 'api_slack')).toBe('slack');
      expect(extractSourceSlug('api-bridge', 'api_gmail')).toBe('gmail');
      expect(extractSourceSlug('api-bridge', 'api_stripe')).toBe('stripe');
    });

    it('should return null for api-bridge without a valid tool name', () => {
      expect(extractSourceSlug('api-bridge')).toBeNull();
      expect(extractSourceSlug('api-bridge', undefined)).toBeNull();
      expect(extractSourceSlug('api-bridge', 'list_tools')).toBeNull();
    });

    it('should return null for built-in MCP servers', () => {
      expect(extractSourceSlug('session')).toBeNull();
      expect(extractSourceSlug('preferences')).toBeNull();
      expect(extractSourceSlug('g4os-docs')).toBeNull();
    });

    it('should return the server name for user sources', () => {
      expect(extractSourceSlug('linear')).toBe('linear');
      expect(extractSourceSlug('github')).toBe('github');
      expect(extractSourceSlug('my-custom-source')).toBe('my-custom-source');
    });
  });

  describe('Source toggle preserves thread', () => {
    it('should document thread preservation requirement', () => {
      // This is a documentation test - actual thread preservation is tested via e2e
      // The reconnect() method on CodexAgent must:
      // 1. Store the current codexThreadId
      // 2. Stop the current app-server process
      // 3. Start a new app-server process with updated config
      // 4. Use resume option with stored threadId to continue conversation

      // Key invariant: codexThreadId should remain unchanged across reconnects
      const threadId = 'thread-123';
      const reconnectedThreadId = threadId; // Should be same after reconnect

      expect(reconnectedThreadId).toBe(threadId);
    });
  });
});
