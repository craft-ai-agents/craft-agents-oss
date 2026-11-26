/**
 * Tests for auth state management
 *
 * These tests verify:
 * - Token refresh returns migration info through function chain (no module-level state)
 * - Setup needs derivation from auth state
 * - Migration detection for legacy CLI tokens
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  getSetupNeeds,
  isDeadRefreshTokenError,
  performTokenRefresh,
  _resetRefreshMutex,
  type AuthState,
  type TokenResult,
  type MigrationInfo,
} from '../state.ts';
import { refreshClaudeToken } from '../claude-token.ts';

// ============================================
// Mock credential manager
// ============================================

type StoredOAuth = { accessToken: string; refreshToken?: string; expiresAt?: number; source?: 'native' | 'cli' };

/** In-memory legacy global slot and per-connection `llm_oauth::<slug>` entries. */
function createMockCredentialManager(legacy: StoredOAuth | null, connections: Record<string, StoredOAuth>) {
  const store = {
    legacy,
    connections,
    deleted: [] as string[],
    getClaudeOAuthCredentials: async () => store.legacy,
    setClaudeOAuthCredentials: async (creds: StoredOAuth) => {
      store.legacy = creds;
    },
    delete: async (id: { type: string }) => {
      if (id.type !== 'claude_oauth') return false;
      store.legacy = null;
      return true;
    },
    getLlmOAuth: async (slug: string) => store.connections[slug] ?? null,
    setLlmOAuth: async (slug: string, creds: StoredOAuth) => {
      store.connections[slug] = creds;
    },
    deleteLlmCredentials: async (slug: string) => {
      store.deleted.push(slug);
      delete store.connections[slug];
    },
  };
  return store;
}

const asManager = (store: ReturnType<typeof createMockCredentialManager>) =>
  store as unknown as Parameters<typeof performTokenRefresh>[0];

/** Answers every fetch (the token endpoint) with `answer`; restored after each test. */
const realFetch = globalThis.fetch;
let answer: () => Response;
function stubTokenEndpoint() {
  globalThis.fetch = (async () => answer()) as unknown as typeof fetch;
}

// ============================================
// getSetupNeeds tests (pure function)
// ============================================

describe('getSetupNeeds', () => {
  describe('billing configuration', () => {
    it('should need billing config when type is null', () => {
      const state: AuthState = {
        billing: {
          type: null,
          hasCredentials: false,
          apiKey: null,
          claudeOAuthToken: null,
        },
        workspace: { hasWorkspace: false, active: null },
      };

      const needs = getSetupNeeds(state);

      expect(needs.needsBillingConfig).toBe(true);
      expect(needs.needsCredentials).toBe(false);
      expect(needs.isFullyConfigured).toBe(false);
    });

    it('should not need billing config when type is set', () => {
      const state: AuthState = {
        billing: {
          type: 'api_key',
          hasCredentials: true,
          apiKey: 'sk-test',
          claudeOAuthToken: null,
        },
        workspace: { hasWorkspace: false, active: null },
      };

      const needs = getSetupNeeds(state);

      expect(needs.needsBillingConfig).toBe(false);
    });
  });

  describe('credentials', () => {
    it('should need credentials when type is set but hasCredentials is false', () => {
      const state: AuthState = {
        billing: {
          type: 'oauth_token',
          hasCredentials: false,
          apiKey: null,
          claudeOAuthToken: null,
        },
        workspace: { hasWorkspace: false, active: null },
      };

      const needs = getSetupNeeds(state);

      expect(needs.needsBillingConfig).toBe(false);
      expect(needs.needsCredentials).toBe(true);
      expect(needs.isFullyConfigured).toBe(false);
    });

    it('should not need credentials when hasCredentials is true', () => {
      const state: AuthState = {
        billing: {
          type: 'oauth_token',
          hasCredentials: true,
          apiKey: null,
          claudeOAuthToken: 'valid-token',
        },
        workspace: { hasWorkspace: false, active: null },
      };

      const needs = getSetupNeeds(state);

      expect(needs.needsCredentials).toBe(false);
      expect(needs.isFullyConfigured).toBe(true);
    });
  });

  describe('migration', () => {
    it('should propagate migration info from auth state', () => {
      const migrationInfo: MigrationInfo = {
        reason: 'legacy_token',
        message: 'Please re-authenticate',
      };

      const state: AuthState = {
        billing: {
          type: 'oauth_token',
          hasCredentials: false,
          apiKey: null,
          claudeOAuthToken: null,
          migrationRequired: migrationInfo,
        },
        workspace: { hasWorkspace: false, active: null },
      };

      const needs = getSetupNeeds(state);

      expect(needs.needsMigration).toEqual(migrationInfo);
      expect(needs.needsMigration?.reason).toBe('legacy_token');
    });

    it('should not have migration info when not present in auth state', () => {
      const state: AuthState = {
        billing: {
          type: 'oauth_token',
          hasCredentials: true,
          apiKey: null,
          claudeOAuthToken: 'valid-token',
        },
        workspace: { hasWorkspace: false, active: null },
      };

      const needs = getSetupNeeds(state);

      expect(needs.needsMigration).toBeUndefined();
    });
  });

  describe('fully configured', () => {
    it('should be fully configured when billing type and credentials are set', () => {
      const state: AuthState = {
        billing: {
          type: 'api_key',
          hasCredentials: true,
          apiKey: 'sk-test',
          claudeOAuthToken: null,
        },
        workspace: { hasWorkspace: true, active: null },
      };

      const needs = getSetupNeeds(state);

      expect(needs.isFullyConfigured).toBe(true);
      expect(needs.needsBillingConfig).toBe(false);
      expect(needs.needsCredentials).toBe(false);
    });
  });
});

// ============================================
// performTokenRefresh tests
// ============================================

describe('performTokenRefresh', () => {
  const signedIn = (): StoredOAuth => ({ accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: 1, source: 'native' });
  const expired = () => Response.json({ error: 'invalid_grant', error_description: 'Refresh token expired' }, { status: 400 });
  const DEFAULT_CONNECTION = { isDefaultConnection: true, fromLegacySlot: false };

  beforeEach(() => {
    _resetRefreshMutex();
    stubTokenEndpoint();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('clears the default connection and empties the legacy slot when the refresh token expired', async () => {
    answer = expired;
    const store = createMockCredentialManager(signedIn(), { 'claude-max': signedIn() });

    const result = await performTokenRefresh(asManager(store), 'old-refresh', 'native', 'claude-max', DEFAULT_CONNECTION);

    expect(result).toEqual({ accessToken: null, migrationRequired: undefined });
    expect(store.legacy).toBeNull();
    expect(store.deleted).toEqual(['claude-max']);
  });

  it('clears only a non-default connection', async () => {
    answer = expired;
    const store = createMockCredentialManager(signedIn(), { 'claude-max': signedIn(), 'claude-work': signedIn() });

    await performTokenRefresh(asManager(store), 'old-refresh', 'native', 'claude-work', {
      isDefaultConnection: false,
      fromLegacySlot: false,
    });

    expect(store.deleted).toEqual(['claude-work']);
    expect(store.legacy).toEqual(signedIn());
    expect(store.connections['claude-max']).toEqual(signedIn());
  });

  it.each([
    ['a 503', () => new Response('Service Unavailable', { status: 503 }), 'Token refresh failed: 503 - Service Unavailable'],
    ['a 429', () => Response.json({ error: 'rate_limit_error' }, { status: 429 }), 'Token refresh failed: 429 - rate_limit_error'],
    ['a network error', (): Response => { throw new TypeError('fetch failed'); }, 'fetch failed'],
  ])('keeps the credentials after %s', async (_failure, respond, refreshError) => {
    answer = respond;
    const store = createMockCredentialManager(signedIn(), { 'claude-max': signedIn() });

    const result = await performTokenRefresh(asManager(store), 'old-refresh', 'native', 'claude-max', DEFAULT_CONNECTION);

    expect(result).toEqual({ accessToken: null, transientRefreshError: refreshError });
    expect(store.deleted).toEqual([]);
    expect(store.legacy).toEqual(signedIn());
    expect(store.connections['claude-max']).toEqual(signedIn());
  });

  it('stores refreshed tokens on the connection, and in the legacy slot only when read from it', async () => {
    answer = () => Response.json({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 });
    const ownEntry = createMockCredentialManager(signedIn(), { 'claude-max': signedIn() });
    const legacySlot = createMockCredentialManager(signedIn(), {});

    expect(await performTokenRefresh(asManager(ownEntry), 'old-refresh', 'native', 'claude-max', DEFAULT_CONNECTION))
      .toEqual({ accessToken: 'new-access' });
    expect(ownEntry.connections['claude-max']).toMatchObject({ accessToken: 'new-access', refreshToken: 'new-refresh' });
    expect(ownEntry.legacy).toEqual(signedIn());

    await performTokenRefresh(asManager(legacySlot), 'old-refresh', 'native', 'claude-max', {
      isDefaultConnection: true,
      fromLegacySlot: true,
    });
    expect(legacySlot.connections['claude-max']).toMatchObject({ accessToken: 'new-access', refreshToken: 'new-refresh' });
    expect(legacySlot.legacy).toMatchObject({ accessToken: 'new-access', refreshToken: 'new-refresh', source: 'native' });
  });

  it("signs out a connection whose refreshed tokens belong to another account", async () => {
    answer = () => Response.json({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600, account: { uuid: 'account-b' } });
    const store = createMockCredentialManager(signedIn(), { 'claude-max': signedIn(), 'claude-work': signedIn() });

    const result = await performTokenRefresh(asManager(store), 'old-refresh', 'native', 'claude-work', {
      isDefaultConnection: false,
      fromLegacySlot: false,
      expectedAccountUuid: 'account-a',
    });

    expect(result).toEqual({ accessToken: null });
    expect(store.deleted).toEqual(['claude-work']);
    expect(store.connections['claude-max']).toEqual(signedIn());
    expect(store.legacy).toEqual(signedIn());
  });

  // From its own entry too: the slot would otherwise hand the default connection the same account.
  it.each([
    ['the legacy slot', true],
    ['its own entry', false],
  ])('empties the legacy slot when the default connection read another account from %s', async (_source, fromLegacySlot) => {
    answer = () => Response.json({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600, account: { uuid: 'account-b' } });
    const store = createMockCredentialManager(signedIn(), fromLegacySlot ? {} : { 'claude-max': signedIn() });

    const result = await performTokenRefresh(asManager(store), 'old-refresh', 'native', 'claude-max', {
      isDefaultConnection: true,
      fromLegacySlot,
      expectedAccountUuid: 'account-a',
    });

    expect(result).toEqual({ accessToken: null });
    expect(store.legacy).toBeNull();
    expect(store.connections['claude-max']).toBeUndefined();
  });

  it.each([
    ['the same account', { account: { uuid: 'account-a' } }, 'account-a'],
    ['a response without the account', {}, 'account-a'],
    ['a connection whose sign-in recorded no account', { account: { uuid: 'account-b' } }, undefined],
  ])('keeps the refreshed tokens for %s', async (_case, identity, expectedAccountUuid) => {
    answer = () => Response.json({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600, ...identity });
    const store = createMockCredentialManager(null, { 'claude-work': signedIn() });

    const result = await performTokenRefresh(asManager(store), 'old-refresh', 'native', 'claude-work', {
      isDefaultConnection: false,
      fromLegacySlot: false,
      expectedAccountUuid,
    });

    expect(result).toEqual({ accessToken: 'new-access' });
    expect(store.connections['claude-work']).toMatchObject({ accessToken: 'new-access', refreshToken: 'new-refresh' });
    expect(store.deleted).toEqual([]);
  });

  it('asks to sign in again when a dead token came from the CLI or an unknown source', async () => {
    answer = () => Response.json({ error: 'invalid_grant' }, { status: 400 });
    const store = createMockCredentialManager({ accessToken: 'cli-access', refreshToken: 'cli-refresh' }, {});

    const result = await performTokenRefresh(asManager(store), 'cli-refresh', undefined, 'claude-max', {
      isDefaultConnection: true,
      fromLegacySlot: true,
    });

    expect(result.accessToken).toBeNull();
    expect(result.migrationRequired?.reason).toBe('legacy_token');
  });
});

describe('refreshClaudeToken error message', () => {
  beforeEach(stubTokenEndpoint);
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it.each([
    ['code and description', '{"error":"invalid_grant","error_description":"Refresh token expired"}', 'invalid_grant: Refresh token expired'],
    ['description alone', '{"error_description":"Refresh token expired"}', 'Refresh token expired'],
    ['code alone', '{"error":"invalid_grant"}', 'invalid_grant'],
    ['raw text without either', 'Bad Request', 'Bad Request'],
  ])('reports the %s', async (_label, body, message) => {
    answer = () => new Response(body, { status: 400 });

    await expect(refreshClaudeToken('old-refresh')).rejects.toThrow(`Token refresh failed: 400 - ${message}`);
  });
});

describe('isDeadRefreshTokenError', () => {
  it.each([
    'Token refresh failed: 400 - Refresh token expired',
    'Token refresh failed: 400 - invalid_grant',
    'Token refresh failed: 400 - invalid_grant: Refresh token expired',
    'Token refresh failed: 400 - Refresh token not found or invalid',
    'invalid_refresh_token',
  ])('clears credentials for %s', (message) => {
    expect(isDeadRefreshTokenError(message)).toBe(true);
  });

  it.each([
    'fetch failed',
    'Token refresh failed: 503 - Service Unavailable',
    'Token refresh failed: 429 - rate_limit_error',
    'Token refresh failed: 502 - invalid_grant',
  ])('keeps credentials for transient failure %s', (message) => {
    expect(isDeadRefreshTokenError(message)).toBe(false);
  });
});

// ============================================
// TokenResult type tests
// ============================================

describe('TokenResult type', () => {
  it('should allow accessToken with no migration', () => {
    const result: TokenResult = {
      accessToken: 'valid-token',
    };

    expect(result.accessToken).toBe('valid-token');
    expect(result.migrationRequired).toBeUndefined();
  });

  it('should allow null accessToken with migration info', () => {
    const result: TokenResult = {
      accessToken: null,
      migrationRequired: {
        reason: 'legacy_token',
        message: 'Migration required',
      },
    };

    expect(result.accessToken).toBeNull();
    expect(result.migrationRequired?.reason).toBe('legacy_token');
  });

  it('should allow null accessToken without migration info', () => {
    const result: TokenResult = {
      accessToken: null,
    };

    expect(result.accessToken).toBeNull();
    expect(result.migrationRequired).toBeUndefined();
  });
});

// ============================================
// Integration: migration flows through to AuthState
// ============================================

describe('migration info flow', () => {
  it('should flow from TokenResult through AuthState to SetupNeeds', () => {
    // 1. Token refresh fails with migration
    const tokenResult: TokenResult = {
      accessToken: null,
      migrationRequired: {
        reason: 'legacy_token',
        message: 'Please sign in again.',
      },
    };

    // 2. Build AuthState using the token result
    const authState: AuthState = {
      billing: {
        type: 'oauth_token',
        hasCredentials: false,
        apiKey: null,
        claudeOAuthToken: tokenResult.accessToken,
        migrationRequired: tokenResult.migrationRequired,
      },
      workspace: { hasWorkspace: true, active: null },
    };

    // 3. Derive setup needs
    const setupNeeds = getSetupNeeds(authState);

    // 4. Migration info should be present throughout
    expect(authState.billing.migrationRequired).toBeDefined();
    expect(setupNeeds.needsMigration).toBeDefined();
    expect(setupNeeds.needsMigration?.reason).toBe('legacy_token');
    expect(setupNeeds.needsCredentials).toBe(true);
    expect(setupNeeds.isFullyConfigured).toBe(false);
  });

  it('should not have migration info when token refresh succeeds', () => {
    // 1. Token refresh succeeds
    const tokenResult: TokenResult = {
      accessToken: 'valid-refreshed-token',
    };

    // 2. Build AuthState
    const authState: AuthState = {
      billing: {
        type: 'oauth_token',
        hasCredentials: true,
        apiKey: null,
        claudeOAuthToken: tokenResult.accessToken,
        migrationRequired: tokenResult.migrationRequired, // undefined
      },
      workspace: { hasWorkspace: true, active: null },
    };

    // 3. Derive setup needs
    const setupNeeds = getSetupNeeds(authState);

    // 4. No migration info
    expect(authState.billing.migrationRequired).toBeUndefined();
    expect(setupNeeds.needsMigration).toBeUndefined();
    expect(setupNeeds.isFullyConfigured).toBe(true);
  });
});

// ============================================
// MigrationInfo type tests
// ============================================

describe('MigrationInfo', () => {
  it('should have reason and message', () => {
    const info: MigrationInfo = {
      reason: 'legacy_token',
      message: 'Your authentication needs to be refreshed.',
    };

    expect(info.reason).toBe('legacy_token');
    expect(info.message).toContain('refreshed');
  });

  it('should only allow legacy_token as reason', () => {
    // TypeScript ensures this at compile time, but we can verify the pattern
    const validInfo: MigrationInfo = {
      reason: 'legacy_token',
      message: 'Test message',
    };

    expect(validInfo.reason).toBe('legacy_token');
  });
});

describe('isDeadRefreshTokenError', () => {
  it.each([
    'Token refresh failed: 400 - Refresh token expired',
    'Token refresh failed: 400 - invalid_grant',
    'Token refresh failed: 400 - Refresh token not found or invalid',
    'invalid_refresh_token',
  ])('clears credentials for %s', (message) => {
    expect(isDeadRefreshTokenError(message)).toBe(true);
  });

  it.each(['fetch failed', 'Token refresh failed: 503 - Service Unavailable'])(
    'keeps credentials for transient failure %s',
    (message) => {
      expect(isDeadRefreshTokenError(message)).toBe(false);
    },
  );
});
