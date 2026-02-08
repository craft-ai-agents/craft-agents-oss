/**
 * Tests for Agent Factory
 *
 * Verifies:
 * - Provider detection from auth type
 * - Backend creation for different providers
 * - LLM connection type mapping
 * - Available providers list
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import {
  detectProvider,
  createBackend,
  createAgent,
  getAvailableProviders,
  isProviderAvailable,
  connectionTypeToProvider,
  connectionAuthTypeToBackendAuthType,
  providerTypeToAgentProvider,
  createBackendFromConnection,
} from '../factory.ts';
import type { BackendConfig } from '../types.ts';
import type { Workspace, LlmConnection } from '../../../config/storage.ts';
import type { SessionConfig as Session } from '../../../sessions/storage.ts';
import { ClaudeAgent } from '../../claude-agent.ts';
import { CodexAgent } from '../../codex-agent.ts';
import { isValidProviderAuthCombination, validateCodexPath } from '../../../config/llm-connections.ts';

// Test helpers
function createTestWorkspace(): Workspace {
  return {
    id: 'test-workspace',
    name: 'Test Workspace',
    rootPath: '/test/workspace',
    createdAt: Date.now(),
  };
}

function createTestSession(): Session {
  return {
    id: 'test-session',
    name: 'Test Session',
    workspaceRootPath: '/test/workspace',
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    permissionMode: 'ask',
  };
}

function createTestConfig(overrides: Partial<BackendConfig> = {}): BackendConfig {
  return {
    provider: 'anthropic',
    workspace: createTestWorkspace(),
    session: createTestSession(),
    isHeadless: true, // Prevent config watchers from starting
    ...overrides,
  };
}

describe('detectProvider', () => {
  describe('Anthropic authentication types', () => {
    it('should return anthropic for api_key', () => {
      expect(detectProvider('api_key')).toBe('anthropic');
    });

    it('should return anthropic for oauth_token', () => {
      expect(detectProvider('oauth_token')).toBe('anthropic');
    });
  });

  describe('Unknown authentication types', () => {
    it('should default to anthropic for unknown types', () => {
      expect(detectProvider('unknown')).toBe('anthropic');
      expect(detectProvider('')).toBe('anthropic');
    });
  });
});

describe('createBackend / createAgent', () => {
  describe('Anthropic provider', () => {
    it('should create ClaudeAgent for anthropic provider', () => {
      const config = createTestConfig({ provider: 'anthropic' });
      const agent = createBackend(config);

      expect(agent).toBeInstanceOf(ClaudeAgent);
    });
  });

  describe('OpenAI provider', () => {
    it('should create CodexAgent for openai provider', () => {
      const config = createTestConfig({ provider: 'openai' });
      const agent = createBackend(config);

      expect(agent).toBeInstanceOf(CodexAgent);
    });
  });

  describe('Unknown provider', () => {
    it('should throw for unknown provider', () => {
      const config = createTestConfig({ provider: 'unknown' as any });

      expect(() => createBackend(config)).toThrow('Unknown provider: unknown');
    });
  });

  describe('createAgent alias', () => {
    it('should be an alias for createBackend', () => {
      expect(createAgent).toBe(createBackend);
    });
  });
});

describe('getAvailableProviders', () => {
  it('should return anthropic and openai', () => {
    const providers = getAvailableProviders();

    expect(providers).toContain('anthropic');
    expect(providers).toContain('openai');
    expect(providers).toHaveLength(2);
  });
});

describe('isProviderAvailable', () => {
  it('should return true for anthropic', () => {
    expect(isProviderAvailable('anthropic')).toBe(true);
  });

  it('should return true for openai', () => {
    expect(isProviderAvailable('openai')).toBe(true);
  });

  it('should return false for unknown provider', () => {
    expect(isProviderAvailable('unknown' as any)).toBe(false);
  });
});

describe('connectionTypeToProvider', () => {
  it('should map anthropic type to anthropic provider', () => {
    expect(connectionTypeToProvider('anthropic')).toBe('anthropic');
  });

  it('should map openai type to openai provider', () => {
    expect(connectionTypeToProvider('openai')).toBe('openai');
  });

  it('should map openai-compat type to openai provider', () => {
    expect(connectionTypeToProvider('openai-compat')).toBe('openai');
  });

  it('should default to anthropic for unknown types', () => {
    expect(connectionTypeToProvider('unknown' as any)).toBe('anthropic');
  });
});

describe('connectionAuthTypeToBackendAuthType (legacy)', () => {
  it('should map api_key to api_key', () => {
    expect(connectionAuthTypeToBackendAuthType('api_key')).toBe('api_key');
  });

  it('should pass through oauth', () => {
    expect(connectionAuthTypeToBackendAuthType('oauth')).toBe('oauth');
  });

  it('should map none to undefined', () => {
    expect(connectionAuthTypeToBackendAuthType('none')).toBeUndefined();
  });
});

describe('providerTypeToAgentProvider', () => {
  describe('Anthropic SDK providers', () => {
    it('should map anthropic to anthropic', () => {
      expect(providerTypeToAgentProvider('anthropic')).toBe('anthropic');
    });

    it('should map anthropic_compat to anthropic', () => {
      expect(providerTypeToAgentProvider('anthropic_compat')).toBe('anthropic');
    });

    it('should map bedrock to anthropic (uses Anthropic SDK)', () => {
      expect(providerTypeToAgentProvider('bedrock')).toBe('anthropic');
    });

    it('should map vertex to anthropic (uses Anthropic SDK)', () => {
      expect(providerTypeToAgentProvider('vertex')).toBe('anthropic');
    });
  });

  describe('OpenAI SDK providers', () => {
    it('should map openai to openai', () => {
      expect(providerTypeToAgentProvider('openai')).toBe('openai');
    });

    it('should map openai_compat to openai', () => {
      expect(providerTypeToAgentProvider('openai_compat')).toBe('openai');
    });
  });
});

// ============================================================
// Provider-Auth Validation Tests
// ============================================================

describe('isValidProviderAuthCombination', () => {
  describe('Anthropic provider', () => {
    it('should accept api_key auth', () => {
      expect(isValidProviderAuthCombination('anthropic', 'api_key')).toBe(true);
    });

    it('should accept oauth auth', () => {
      expect(isValidProviderAuthCombination('anthropic', 'oauth')).toBe(true);
    });

    it('should reject api_key_with_endpoint auth', () => {
      expect(isValidProviderAuthCombination('anthropic', 'api_key_with_endpoint')).toBe(false);
    });

    it('should reject none auth', () => {
      expect(isValidProviderAuthCombination('anthropic', 'none')).toBe(false);
    });
  });

  describe('Anthropic compat provider', () => {
    it('should accept api_key_with_endpoint auth', () => {
      expect(isValidProviderAuthCombination('anthropic_compat', 'api_key_with_endpoint')).toBe(true);
    });

    it('should reject plain api_key auth', () => {
      expect(isValidProviderAuthCombination('anthropic_compat', 'api_key')).toBe(false);
    });
  });

  describe('OpenAI provider', () => {
    it('should accept api_key auth', () => {
      expect(isValidProviderAuthCombination('openai', 'api_key')).toBe(true);
    });

    it('should accept oauth auth', () => {
      expect(isValidProviderAuthCombination('openai', 'oauth')).toBe(true);
    });

    it('should reject none auth', () => {
      expect(isValidProviderAuthCombination('openai', 'none')).toBe(false);
    });
  });

  describe('OpenAI compat provider', () => {
    it('should accept api_key_with_endpoint auth', () => {
      expect(isValidProviderAuthCombination('openai_compat', 'api_key_with_endpoint')).toBe(true);
    });

    it('should accept none auth (for local models like Ollama)', () => {
      expect(isValidProviderAuthCombination('openai_compat', 'none')).toBe(true);
    });
  });

  describe('Bedrock provider', () => {
    it('should accept bearer_token auth', () => {
      expect(isValidProviderAuthCombination('bedrock', 'bearer_token')).toBe(true);
    });

    it('should accept iam_credentials auth', () => {
      expect(isValidProviderAuthCombination('bedrock', 'iam_credentials')).toBe(true);
    });

    it('should accept environment auth', () => {
      expect(isValidProviderAuthCombination('bedrock', 'environment')).toBe(true);
    });
  });

  describe('Vertex provider', () => {
    it('should accept oauth auth', () => {
      expect(isValidProviderAuthCombination('vertex', 'oauth')).toBe(true);
    });

    it('should accept service_account_file auth', () => {
      expect(isValidProviderAuthCombination('vertex', 'service_account_file')).toBe(true);
    });

    it('should accept environment auth', () => {
      expect(isValidProviderAuthCombination('vertex', 'environment')).toBe(true);
    });
  });
});

describe('validateCodexPath', () => {
  // Helper to create a test connection
  function createTestConnection(overrides: Partial<LlmConnection> = {}): LlmConnection {
    return {
      slug: 'test-connection',
      name: 'Test Connection',
      providerType: 'openai',
      authType: 'oauth',
      createdAt: Date.now(),
      ...overrides,
    };
  }

  describe('Non-OpenAI providers', () => {
    it('should always return valid for non-OpenAI providers', () => {
      const connection = createTestConnection({ providerType: 'anthropic' });
      const result = validateCodexPath(connection);
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });

  describe('OpenAI provider without custom path', () => {
    it('should return valid when no codexPath is set (uses PATH)', () => {
      const connection = createTestConnection({ providerType: 'openai', codexPath: undefined });
      const result = validateCodexPath(connection);
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });

  describe('OpenAI provider with non-existent custom path', () => {
    it('should return invalid when codexPath does not exist', () => {
      const connection = createTestConnection({
        providerType: 'openai',
        codexPath: '/non/existent/path/to/codex',
      });
      const result = validateCodexPath(connection);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Codex binary not found');
      expect(result.error).toContain('/non/existent/path/to/codex');
    });
  });
});
