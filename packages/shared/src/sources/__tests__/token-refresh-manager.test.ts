import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { TokenRefreshManager, createTokenGetter } from '../token-refresh-manager.ts';
import type { LoadedSource } from '../types.ts';
import type { SourceCredentialManager } from '../credential-manager.ts';

// Mock source factory
function createMockSource(overrides: Partial<LoadedSource['config']> = {}): LoadedSource {
  return {
    config: {
      id: 'test-id',
      name: 'Test Source',
      slug: 'test-source',
      enabled: true,
      type: 'mcp',
      mcp: {
        url: 'https://test.example.com/mcp',
        authType: 'oauth',
      },
      isAuthenticated: true,
      ...overrides,
    },
    folderPath: '/test/path',
  };
}

// Mock credential manager factory
function createMockCredManager(options: {
  loadResult?: { value: string; expiresAt?: number } | null;
  isExpired?: boolean;
  needsRefresh?: boolean;
  refreshResult?: string | null;
  refreshError?: Error;
} = {}): SourceCredentialManager {
  return {
    load: mock(() => Promise.resolve(options.loadResult ?? null)),
    isExpired: mock(() => options.isExpired ?? false),
    needsRefresh: mock(() => options.needsRefresh ?? false),
    refresh: mock(() => {
      if (options.refreshError) {
        return Promise.reject(options.refreshError);
      }
      // Use explicit undefined check to allow null as a valid result
      return Promise.resolve(options.refreshResult !== undefined ? options.refreshResult : 'new-token');
    }),
    markSourceNeedsReauth: mock(() => {}),
  } as unknown as SourceCredentialManager;
}

describe('TokenRefreshManager', () => {
  describe('constructor', () => {
    test('creates instance with default options', () => {
      const credManager = createMockCredManager();
      const manager = new TokenRefreshManager(credManager);
      expect(manager).toBeDefined();
    });

    test('accepts custom cooldown period', () => {
      const credManager = createMockCredManager();
      const manager = new TokenRefreshManager(credManager, { cooldownMs: 1000 });
      expect(manager).toBeDefined();
    });
  });

  describe('isInCooldown', () => {
    test('returns false for unknown source', () => {
      const credManager = createMockCredManager();
      const manager = new TokenRefreshManager(credManager);
      expect(manager.isInCooldown('unknown-source')).toBe(false);
    });

    test('returns true after failed refresh within cooldown', async () => {
      const credManager = createMockCredManager({
        loadResult: { value: 'token' },
        isExpired: true,
        refreshResult: null, // Simulate failed refresh
      });
      const manager = new TokenRefreshManager(credManager, { cooldownMs: 60000 });
      const source = createMockSource({ slug: 'test-source' });

      // Trigger a failed refresh
      await manager.ensureFreshToken(source);

      expect(manager.isInCooldown('test-source')).toBe(true);
    });

    test('returns false after cooldown expires', async () => {
      const credManager = createMockCredManager({
        loadResult: { value: 'token' },
        isExpired: true,
        refreshResult: null,
      });
      // Use very short cooldown for testing
      const manager = new TokenRefreshManager(credManager, { cooldownMs: 1 });
      const source = createMockSource({ slug: 'test-source' });

      await manager.ensureFreshToken(source);

      // Wait for cooldown to expire
      await new Promise(resolve => setTimeout(resolve, 5));

      expect(manager.isInCooldown('test-source')).toBe(false);
    });
  });

  describe('reset', () => {
    test('clears all rate limiting state', async () => {
      const credManager = createMockCredManager({
        loadResult: { value: 'token' },
        isExpired: true,
        refreshResult: null,
      });
      const manager = new TokenRefreshManager(credManager, { cooldownMs: 60000 });
      const source = createMockSource({ slug: 'test-source' });

      await manager.ensureFreshToken(source);
      expect(manager.isInCooldown('test-source')).toBe(true);

      manager.reset();
      expect(manager.isInCooldown('test-source')).toBe(false);
    });
  });

  describe('needsRefresh', () => {
    test('returns false when credential manager returns null', async () => {
      const credManager = createMockCredManager({ loadResult: null });
      const manager = new TokenRefreshManager(credManager);
      const source = createMockSource();

      const result = await manager.needsRefresh(source);
      expect(result).toBe(false);
    });

    test('returns true when token is expired', async () => {
      const credManager = createMockCredManager({
        loadResult: { value: 'token' },
        isExpired: true,
      });
      const manager = new TokenRefreshManager(credManager);
      const source = createMockSource();

      const result = await manager.needsRefresh(source);
      expect(result).toBe(true);
    });

    test('returns true when token needs refresh (within 5 min)', async () => {
      const credManager = createMockCredManager({
        loadResult: { value: 'token' },
        needsRefresh: true,
      });
      const manager = new TokenRefreshManager(credManager);
      const source = createMockSource();

      const result = await manager.needsRefresh(source);
      expect(result).toBe(true);
    });

    test('returns false when token is valid', async () => {
      const credManager = createMockCredManager({
        loadResult: { value: 'token' },
        isExpired: false,
        needsRefresh: false,
      });
      const manager = new TokenRefreshManager(credManager);
      const source = createMockSource();

      const result = await manager.needsRefresh(source);
      expect(result).toBe(false);
    });
  });

  describe('ensureFreshToken', () => {
    test('returns cached token when still valid', async () => {
      const credManager = createMockCredManager({
        loadResult: { value: 'cached-token' },
        isExpired: false,
        needsRefresh: false,
      });
      const manager = new TokenRefreshManager(credManager);
      const source = createMockSource();

      const result = await manager.ensureFreshToken(source);

      expect(result.success).toBe(true);
      expect(result.token).toBe('cached-token');
      expect(credManager.refresh).not.toHaveBeenCalled();
    });

    test('refreshes token when expired', async () => {
      const credManager = createMockCredManager({
        loadResult: { value: 'old-token' },
        isExpired: true,
        refreshResult: 'new-token',
      });
      const manager = new TokenRefreshManager(credManager);
      const source = createMockSource();

      const result = await manager.ensureFreshToken(source);

      expect(result.success).toBe(true);
      expect(result.token).toBe('new-token');
      expect(credManager.refresh).toHaveBeenCalled();
    });

    test('returns rate limited result when in cooldown', async () => {
      const credManager = createMockCredManager({
        loadResult: { value: 'token' },
        isExpired: true,
        refreshResult: null, // Failed refresh
      });
      const manager = new TokenRefreshManager(credManager, { cooldownMs: 60000 });
      const source = createMockSource({ slug: 'test-source' });

      // First call fails
      await manager.ensureFreshToken(source);

      // Second call should be rate limited
      const result = await manager.ensureFreshToken(source);

      expect(result.success).toBe(false);
      expect(result.rateLimited).toBe(true);
    });

    test('handles refresh error', async () => {
      const credManager = createMockCredManager({
        loadResult: { value: 'token' },
        isExpired: true,
        refreshError: new Error('Network error'),
      });
      const manager = new TokenRefreshManager(credManager);
      const source = createMockSource();

      const result = await manager.ensureFreshToken(source);

      expect(result.success).toBe(false);
      expect(result.reason).toBe('Network error');
      expect(credManager.markSourceNeedsReauth).toHaveBeenCalled();
    });

    test('clears cooldown on successful refresh after failure', async () => {
      let refreshAttempt = 0;
      const credManager = {
        ...createMockCredManager(),
        load: mock(() => Promise.resolve({ value: 'token' })),
        isExpired: mock(() => true),
        needsRefresh: mock(() => false),
        refresh: mock(() => {
          refreshAttempt++;
          if (refreshAttempt === 1) {
            return Promise.resolve(null); // First attempt fails
          }
          return Promise.resolve('new-token'); // Second attempt succeeds
        }),
        markSourceNeedsReauth: mock(() => {}),
      } as unknown as SourceCredentialManager;

      const manager = new TokenRefreshManager(credManager, { cooldownMs: 1 });
      const source = createMockSource({ slug: 'test-source' });

      // First call fails
      await manager.ensureFreshToken(source);
      expect(manager.isInCooldown('test-source')).toBe(true);

      // Wait for cooldown
      await new Promise(resolve => setTimeout(resolve, 5));

      // Second call succeeds
      const result = await manager.ensureFreshToken(source);
      expect(result.success).toBe(true);
      expect(manager.isInCooldown('test-source')).toBe(false);
    });
  });

  describe('getSourcesNeedingRefresh', () => {
    test('filters to MCP OAuth sources only', async () => {
      const credManager = createMockCredManager({
        loadResult: { value: 'token' },
        isExpired: true,
      });
      const manager = new TokenRefreshManager(credManager);

      const sources = [
        createMockSource({ slug: 'mcp-oauth', type: 'mcp', mcp: { url: 'test', authType: 'oauth' } }),
        createMockSource({ slug: 'mcp-bearer', type: 'mcp', mcp: { url: 'test', authType: 'bearer' } }),
        createMockSource({ slug: 'api-source', type: 'api' }),
      ];

      const result = await manager.getSourcesNeedingRefresh(sources);

      expect(result.length).toBe(1);
      expect(result[0].config.slug).toBe('mcp-oauth');
    });

    test('excludes sources in cooldown', async () => {
      const credManager = createMockCredManager({
        loadResult: { value: 'token' },
        isExpired: true,
        refreshResult: null,
      });
      const manager = new TokenRefreshManager(credManager, { cooldownMs: 60000 });

      const source1 = createMockSource({ slug: 'source-1' });
      const source2 = createMockSource({ slug: 'source-2' });

      // Fail refresh for source-1 to put it in cooldown
      await manager.ensureFreshToken(source1);

      const result = await manager.getSourcesNeedingRefresh([source1, source2]);

      expect(result.length).toBe(1);
      expect(result[0].config.slug).toBe('source-2');
    });

    test('excludes unauthenticated sources', async () => {
      const credManager = createMockCredManager({
        loadResult: { value: 'token' },
        isExpired: true,
      });
      const manager = new TokenRefreshManager(credManager);

      const sources = [
        createMockSource({ slug: 'authenticated', isAuthenticated: true }),
        createMockSource({ slug: 'unauthenticated', isAuthenticated: false }),
      ];

      const result = await manager.getSourcesNeedingRefresh(sources);

      expect(result.length).toBe(1);
      expect(result[0].config.slug).toBe('authenticated');
    });
  });

  describe('refreshSources', () => {
    test('refreshes multiple sources in parallel', async () => {
      const credManager = createMockCredManager({
        loadResult: { value: 'token' },
        isExpired: true,
        refreshResult: 'new-token',
      });
      const manager = new TokenRefreshManager(credManager);

      const sources = [
        createMockSource({ slug: 'source-1' }),
        createMockSource({ slug: 'source-2' }),
      ];

      const { refreshed, failed } = await manager.refreshSources(sources);

      expect(refreshed.length).toBe(2);
      expect(failed.length).toBe(0);
    });

    test('separates successful and failed refreshes', async () => {
      let callCount = 0;
      const credManager = {
        ...createMockCredManager(),
        load: mock(() => Promise.resolve({ value: 'token' })),
        isExpired: mock(() => true),
        needsRefresh: mock(() => false),
        refresh: mock(() => {
          callCount++;
          if (callCount === 1) {
            return Promise.resolve('new-token');
          }
          return Promise.resolve(null); // Second call fails
        }),
        markSourceNeedsReauth: mock(() => {}),
      } as unknown as SourceCredentialManager;

      const manager = new TokenRefreshManager(credManager);

      const sources = [
        createMockSource({ slug: 'source-1' }),
        createMockSource({ slug: 'source-2' }),
      ];

      const { refreshed, failed } = await manager.refreshSources(sources);

      expect(refreshed.length).toBe(1);
      expect(failed.length).toBe(1);
      expect(failed[0].source.config.slug).toBe('source-2');
    });
  });
});

describe('createTokenGetter', () => {
  test('returns function that gets fresh token', async () => {
    const credManager = createMockCredManager({
      loadResult: { value: 'token' },
      isExpired: false,
      needsRefresh: false,
    });
    const manager = new TokenRefreshManager(credManager);
    const source = createMockSource();

    const getter = createTokenGetter(manager, source);
    const token = await getter();

    expect(token).toBe('token');
  });

  test('throws when refresh fails', async () => {
    const credManager = createMockCredManager({
      loadResult: { value: 'token' },
      isExpired: true,
      refreshResult: null,
    });
    const manager = new TokenRefreshManager(credManager);
    const source = createMockSource();

    const getter = createTokenGetter(manager, source);

    await expect(getter()).rejects.toThrow();
  });
});
