/**
 * Tests for Codex Config Generator
 *
 * Verifies TOML generation for MCP sources and bridge server configuration.
 */
import { describe, it, expect } from 'bun:test';
import {
  generateCodexConfig,
  generateBridgeConfig,
  getCredentialCachePath,
  type CodexConfigGeneratorOptions,
} from '../config-generator.ts';
import type { LoadedSource } from '../../sources/types.ts';
import type { SdkMcpServerConfig } from '../../agent/backend/types.ts';

// ============================================================
// Test Helpers
// ============================================================

function createMockMcpSource(overrides: Partial<LoadedSource['config']> = {}): LoadedSource {
  return {
    config: {
      id: 'test-mcp-source',
      name: 'Test MCP Source',
      slug: 'test-mcp',
      enabled: true,
      provider: 'test',
      type: 'mcp',
      mcp: {
        transport: 'http',
        url: 'https://mcp.example.com',
      },
      ...overrides,
    },
    guide: null,
    folderPath: '/test/source',
    workspaceRootPath: '/test/workspace',
    workspaceId: 'test-workspace',
  };
}

function createMockApiSource(overrides: Partial<LoadedSource['config']> = {}): LoadedSource {
  return {
    config: {
      id: 'test-api-source',
      name: 'Test API Source',
      slug: 'test-api',
      enabled: true,
      provider: 'test',
      type: 'api',
      isAuthenticated: true,
      api: {
        baseUrl: 'https://api.example.com',
        authType: 'bearer',
      },
      ...overrides,
    },
    guide: { raw: 'API guide content' },
    folderPath: '/test/source',
    workspaceRootPath: '/test/workspace',
    workspaceId: 'test-workspace',
  };
}

function createHttpMcpConfig(url: string): SdkMcpServerConfig {
  return {
    type: 'http',
    url,
    headers: { Authorization: 'Bearer test-token' },
  };
}

function createStdioMcpConfig(command: string, args: string[]): SdkMcpServerConfig {
  return {
    type: 'stdio',
    command,
    args,
    env: { TEST_VAR: 'test-value' },
  };
}

// ============================================================
// Tests
// ============================================================

describe('generateCodexConfig', () => {
  describe('MCP HTTP sources', () => {
    it('should generate TOML for HTTP MCP source', () => {
      const source = createMockMcpSource({ slug: 'my-mcp' });
      const mcpServerConfigs: Record<string, SdkMcpServerConfig> = {
        'my-mcp': createHttpMcpConfig('https://mcp.example.com'),
      };

      const result = generateCodexConfig({
        sources: [source],
        mcpServerConfigs,
      });

      expect(result.mcpSources).toContain('my-mcp');
      expect(result.apiSources).toHaveLength(0);
      expect(result.needsBridge).toBe(false);
      expect(result.toml).toContain('[mcp_servers.my-mcp]');
      expect(result.toml).toContain('url = "https://mcp.example.com"');
      expect(result.toml).toContain('http_headers = { Authorization = "Bearer test-token" }');
    });

    it('should include timeouts in config', () => {
      const source = createMockMcpSource({ slug: 'timed-mcp' });
      const mcpServerConfigs: Record<string, SdkMcpServerConfig> = {
        'timed-mcp': createHttpMcpConfig('https://mcp.example.com'),
      };

      const result = generateCodexConfig({
        sources: [source],
        mcpServerConfigs,
      });

      expect(result.toml).toContain('startup_timeout_sec = 15');
      expect(result.toml).toContain('tool_timeout_sec = 120');
    });
  });

  describe('MCP stdio sources', () => {
    it('should generate TOML for stdio MCP source', () => {
      const source = createMockMcpSource({
        slug: 'stdio-mcp',
        mcp: { transport: 'stdio', command: 'npx', args: ['@test/mcp-server'] },
      });
      const mcpServerConfigs: Record<string, SdkMcpServerConfig> = {
        'stdio-mcp': createStdioMcpConfig('npx', ['@test/mcp-server', '/path']),
      };

      const result = generateCodexConfig({
        sources: [source],
        mcpServerConfigs,
      });

      expect(result.mcpSources).toContain('stdio-mcp');
      expect(result.toml).toContain('[mcp_servers.stdio-mcp]');
      expect(result.toml).toContain('command = "npx"');
      expect(result.toml).toContain('args = ["@test/mcp-server", "/path"]');
      expect(result.toml).toContain('env = { TEST_VAR = "test-value" }');
    });
  });

  describe('API sources (bridge server)', () => {
    it('should track API sources but not generate TOML without bridge config', () => {
      const source = createMockApiSource({ slug: 'my-api' });

      const result = generateCodexConfig({
        sources: [source],
      });

      expect(result.apiSources).toContain('my-api');
      expect(result.mcpSources).toHaveLength(0);
      expect(result.needsBridge).toBe(false);
      // No bridge section without bridgeServerPath
      expect(result.toml).not.toContain('[mcp_servers.api-bridge]');
    });

    it('should generate bridge server section when configured', () => {
      const source = createMockApiSource({ slug: 'my-api' });

      const result = generateCodexConfig({
        sources: [source],
        bridgeServerPath: '/path/to/bridge.js',
        bridgeConfigPath: '/path/to/bridge-config.json',
        sessionPath: '/path/to/session',
        workspaceId: 'workspace-123',
      });

      expect(result.needsBridge).toBe(true);
      expect(result.toml).toContain('[mcp_servers.api-bridge]');
      expect(result.toml).toContain('command = "node"');
      expect(result.toml).toContain('/path/to/bridge.js');
      expect(result.toml).toContain('--config');
      expect(result.toml).toContain('/path/to/bridge-config.json');
      expect(result.toml).toContain('--session');
      expect(result.toml).toContain('/path/to/session');
    });
  });

  describe('mixed sources', () => {
    it('should handle MCP and API sources together', () => {
      const mcpSource = createMockMcpSource({ slug: 'mcp-1' });
      const apiSource = createMockApiSource({ slug: 'api-1' });
      const mcpServerConfigs: Record<string, SdkMcpServerConfig> = {
        'mcp-1': createHttpMcpConfig('https://mcp.example.com'),
      };

      const result = generateCodexConfig({
        sources: [mcpSource, apiSource],
        mcpServerConfigs,
        bridgeServerPath: '/path/to/bridge.js',
        bridgeConfigPath: '/path/to/bridge-config.json',
      });

      expect(result.mcpSources).toContain('mcp-1');
      expect(result.apiSources).toContain('api-1');
      expect(result.needsBridge).toBe(true);
      expect(result.toml).toContain('[mcp_servers.mcp-1]');
      expect(result.toml).toContain('[mcp_servers.api-bridge]');
    });

    it('should skip disabled sources', () => {
      const enabledSource = createMockMcpSource({ slug: 'enabled', enabled: true });
      const disabledSource = createMockMcpSource({ slug: 'disabled', enabled: false });
      const mcpServerConfigs: Record<string, SdkMcpServerConfig> = {
        'enabled': createHttpMcpConfig('https://enabled.example.com'),
        'disabled': createHttpMcpConfig('https://disabled.example.com'),
      };

      const result = generateCodexConfig({
        sources: [enabledSource, disabledSource],
        mcpServerConfigs,
      });

      expect(result.mcpSources).toContain('enabled');
      expect(result.mcpSources).not.toContain('disabled');
      expect(result.toml).toContain('[mcp_servers.enabled]');
      expect(result.toml).not.toContain('[mcp_servers.disabled]');
    });
  });

  describe('TOML escaping', () => {
    it('should escape special characters in strings', () => {
      const source = createMockMcpSource({ slug: 'escaped' });
      const mcpServerConfigs: Record<string, SdkMcpServerConfig> = {
        'escaped': {
          type: 'http',
          url: 'https://example.com/path?key="value"',
          headers: { 'X-Custom': 'line1\nline2' },
        },
      };

      const result = generateCodexConfig({
        sources: [source],
        mcpServerConfigs,
      });

      // Quotes should be escaped
      expect(result.toml).toContain('\\"value\\"');
      // Newlines should be escaped
      expect(result.toml).toContain('\\n');
    });
  });

  describe('header comment', () => {
    it('should include generation comment', () => {
      const result = generateCodexConfig({ sources: [] });

      expect(result.toml).toContain('# Generated by Craft Agent - DO NOT EDIT');
      expect(result.toml).toContain('# Generated at:');
    });
  });
});

describe('generateBridgeConfig', () => {
  it('should generate JSON config for API sources', () => {
    const source = createMockApiSource({
      slug: 'gmail',
      name: 'Gmail',
      api: {
        baseUrl: 'https://gmail.googleapis.com/gmail/v1',
        authType: 'bearer',
      },
    });

    const json = generateBridgeConfig([source]);
    const config = JSON.parse(json);

    expect(config.sources).toHaveLength(1);
    expect(config.sources[0].slug).toBe('gmail');
    expect(config.sources[0].name).toBe('Gmail');
    expect(config.sources[0].baseUrl).toBe('https://gmail.googleapis.com/gmail/v1');
    expect(config.sources[0].authType).toBe('bearer');
    expect(config.sources[0].workspaceId).toBe('test-workspace');
  });

  it('should filter out non-API sources', () => {
    const mcpSource = createMockMcpSource({ slug: 'mcp' });
    const apiSource = createMockApiSource({ slug: 'api' });

    const json = generateBridgeConfig([mcpSource, apiSource]);
    const config = JSON.parse(json);

    expect(config.sources).toHaveLength(1);
    expect(config.sources[0].slug).toBe('api');
  });

  it('should include guide content', () => {
    const source = createMockApiSource({ slug: 'documented' });
    source.guide = { raw: '# API Documentation\n\nUse GET /users' };

    const json = generateBridgeConfig([source]);
    const config = JSON.parse(json);

    expect(config.sources[0].guideRaw).toContain('# API Documentation');
  });
});

describe('getCredentialCachePath', () => {
  it('should return correct path', () => {
    const path = getCredentialCachePath('/home/user/.craft-agent/workspaces/ws-123', 'gmail');
    expect(path).toBe('/home/user/.craft-agent/workspaces/ws-123/sources/gmail/.credential-cache.json');
  });
});

describe('validateSlugForToml', () => {
  const { validateSlugForToml } = require('../config-generator.ts');

  describe('valid slugs', () => {
    it('should accept simple lowercase slugs', () => {
      expect(validateSlugForToml('gmail')).toBe('gmail');
      expect(validateSlugForToml('slack')).toBe('slack');
      expect(validateSlugForToml('linear')).toBe('linear');
    });

    it('should accept slugs with hyphens', () => {
      expect(validateSlugForToml('my-source')).toBe('my-source');
      expect(validateSlugForToml('api-v2')).toBe('api-v2');
      expect(validateSlugForToml('cool-mcp-server')).toBe('cool-mcp-server');
    });

    it('should accept slugs with numbers', () => {
      expect(validateSlugForToml('api2')).toBe('api2');
      expect(validateSlugForToml('v3-service')).toBe('v3-service');
      expect(validateSlugForToml('source123')).toBe('source123');
    });

    it('should accept single character slugs', () => {
      expect(validateSlugForToml('a')).toBe('a');
      expect(validateSlugForToml('z')).toBe('z');
      expect(validateSlugForToml('9')).toBe('9');
    });
  });

  describe('dangerous slugs (TOML injection vectors)', () => {
    it('should reject slugs with dots (creates nested tables)', () => {
      expect(() => validateSlugForToml('com.example')).toThrow(/dangerous characters/);
      expect(() => validateSlugForToml('source.v2')).toThrow(/dangerous characters/);
      expect(() => validateSlugForToml('.hidden')).toThrow(/dangerous characters/);
    });

    it('should reject slugs with brackets (breaks TOML syntax)', () => {
      expect(() => validateSlugForToml('test]')).toThrow(/dangerous characters/);
      expect(() => validateSlugForToml('[bad')).toThrow(/dangerous characters/);
      expect(() => validateSlugForToml('test][inject')).toThrow(/dangerous characters/);
    });

    it('should reject slugs with quotes (escaping attacks)', () => {
      expect(() => validateSlugForToml('test"quote')).toThrow(/dangerous characters/);
      expect(() => validateSlugForToml("test'quote")).toThrow(/dangerous characters/);
    });

    it('should reject slugs with newlines (multi-line injection)', () => {
      expect(() => validateSlugForToml('test\ninjection')).toThrow(/dangerous characters/);
      expect(() => validateSlugForToml('test\rinjection')).toThrow(/dangerous characters/);
    });

    it('should reject slugs with whitespace', () => {
      expect(() => validateSlugForToml('test space')).toThrow(/dangerous characters/);
      expect(() => validateSlugForToml('test\ttab')).toThrow(/dangerous characters/);
    });

    it('should reject slugs with equals sign', () => {
      expect(() => validateSlugForToml('test=value')).toThrow(/dangerous characters/);
    });

    it('should reject slugs with backslash', () => {
      expect(() => validateSlugForToml('test\\escape')).toThrow(/dangerous characters/);
    });
  });

  describe('malformed slugs (pattern validation)', () => {
    it('should reject slugs starting with hyphen', () => {
      expect(() => validateSlugForToml('-start')).toThrow(/expected pattern/);
    });

    it('should reject slugs ending with hyphen', () => {
      expect(() => validateSlugForToml('end-')).toThrow(/expected pattern/);
    });

    it('should reject uppercase slugs', () => {
      expect(() => validateSlugForToml('MySource')).toThrow(/expected pattern/);
      expect(() => validateSlugForToml('ALLCAPS')).toThrow(/expected pattern/);
    });

    it('should reject empty string', () => {
      expect(() => validateSlugForToml('')).toThrow(/expected pattern/);
    });
  });
});

describe('generateCodexConfig warnings', () => {
  describe('missing server config warnings', () => {
    it('should warn when MCP source has no server config', () => {
      const source = createMockMcpSource({ slug: 'no-config' });
      // No mcpServerConfigs provided for this slug

      const result = generateCodexConfig({
        sources: [source],
        mcpServerConfigs: {}, // Empty - no config for 'no-config'
      });

      expect(result.warnings).toHaveLength(1);
      const warning = result.warnings[0]!;
      expect(warning.sourceSlug).toBe('no-config');
      expect(warning.type).toBe('missing_server_config');
      expect(warning.message).toContain('no server config');
    });

    it('should warn for each source missing config', () => {
      const source1 = createMockMcpSource({ slug: 'missing1' });
      const source2 = createMockMcpSource({ slug: 'missing2' });

      const result = generateCodexConfig({
        sources: [source1, source2],
        mcpServerConfigs: {},
      });

      expect(result.warnings).toHaveLength(2);
      expect(result.warnings.map(w => w.sourceSlug)).toContain('missing1');
      expect(result.warnings.map(w => w.sourceSlug)).toContain('missing2');
    });
  });

  describe('bridge not configured warnings', () => {
    it('should warn when API sources exist but bridge is not configured', () => {
      const apiSource = createMockApiSource({ slug: 'gmail' });

      const result = generateCodexConfig({
        sources: [apiSource],
        // No bridgeServerPath or bridgeConfigPath
      });

      expect(result.warnings).toHaveLength(1);
      const warning = result.warnings[0]!;
      expect(warning.sourceSlug).toBe('gmail');
      expect(warning.type).toBe('bridge_not_configured');
    });

    it('should not warn when bridge is properly configured', () => {
      const apiSource = createMockApiSource({ slug: 'gmail' });

      const result = generateCodexConfig({
        sources: [apiSource],
        bridgeServerPath: '/path/to/bridge.js',
        bridgeConfigPath: '/path/to/config.json',
      });

      // No warnings - bridge is configured
      const bridgeWarnings = result.warnings.filter(w => w.type === 'bridge_not_configured');
      expect(bridgeWarnings).toHaveLength(0);
    });
  });

  describe('no warnings for valid configs', () => {
    it('should return empty warnings array for valid setup', () => {
      const source = createMockMcpSource({ slug: 'valid-source' });
      const mcpServerConfigs: Record<string, SdkMcpServerConfig> = {
        'valid-source': createHttpMcpConfig('https://mcp.example.com'),
      };

      const result = generateCodexConfig({
        sources: [source],
        mcpServerConfigs,
      });

      expect(result.warnings).toHaveLength(0);
      expect(result.mcpSources).toContain('valid-source');
    });
  });
});

