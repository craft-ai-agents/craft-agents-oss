/**
 * getValidClaudeOAuthToken must resolve credentials per connection.
 *
 * Regression: every sign-in also wrote the legacy global `claude_oauth` slot and
 * getValidClaudeOAuthToken(slug) read only that slot, so with two Claude
 * connections both resolved to whichever account signed in last.
 */
import { describe, it, expect, beforeEach, mock } from 'bun:test';

type Creds = { accessToken: string; refreshToken?: string; expiresAt?: number; source?: 'native' | 'cli' };

const FAR_FUTURE = Date.now() + 24 * 3600_000;
const PAST = Date.now() - 3600_000;

let perConnection: Record<string, Creds>;
let legacyGlobal: Creds | null;
let defaultSlug: string | null;
let refreshed: { accessToken: string; refreshToken: string; expiresAt: number } | null;
let legacyWrites: Creds[];
let deletedSlugs: string[];

const manager = {
  getLlmOAuth: async (slug: string) => perConnection[slug] ?? null,
  setLlmOAuth: async (slug: string, c: Creds) => {
    perConnection[slug] = c;
  },
  getClaudeOAuthCredentials: async () => legacyGlobal,
  setClaudeOAuthCredentials: async (c: Creds) => {
    legacyWrites.push(c);
    legacyGlobal = c;
  },
  deleteLlmCredentials: async (slug: string) => {
    deletedSlugs.push(slug);
    delete perConnection[slug];
  },
};

mock.module('../../credentials/index.ts', () => ({ getCredentialManager: () => manager }));
mock.module('../../config/storage.ts', () => ({
  loadStoredConfig: () => ({}),
  getActiveWorkspace: () => null,
  getDefaultLlmConnection: () => defaultSlug,
  getLlmConnection: () => null,
}));
mock.module('../claude-token.ts', () => ({
  isTokenExpired: (expiresAt?: number) => expiresAt !== undefined && expiresAt < Date.now(),
  refreshClaudeToken: async () => {
    if (!refreshed) throw new Error('invalid_grant');
    return refreshed;
  },
}));

const { getValidClaudeOAuthToken, _resetRefreshMutex } = await import('../state.ts');

beforeEach(() => {
  _resetRefreshMutex();
  perConnection = {
    'claude-max': { accessToken: 'token-A', refreshToken: 'refresh-A', expiresAt: FAR_FUTURE },
    'claude-max-2': { accessToken: 'token-B', refreshToken: 'refresh-B', expiresAt: FAR_FUTURE },
  };
  // The legacy slot holds the account that signed in last (B).
  legacyGlobal = { accessToken: 'token-B', refreshToken: 'refresh-B', expiresAt: FAR_FUTURE, source: 'native' };
  defaultSlug = 'claude-max';
  refreshed = null;
  legacyWrites = [];
  deletedSlugs = [];
});

describe('getValidClaudeOAuthToken with multiple Claude connections', () => {
  it('returns each connection its own token even when the legacy slot holds another account', async () => {
    expect((await getValidClaudeOAuthToken('claude-max')).accessToken).toBe('token-A');
    expect((await getValidClaudeOAuthToken('claude-max-2')).accessToken).toBe('token-B');
  });

  it('does not fall back to the legacy slot for a non-default connection without credentials', async () => {
    delete perConnection['claude-max-2'];
    expect((await getValidClaudeOAuthToken('claude-max-2')).accessToken).toBeNull();
  });

  it('falls back to the legacy slot for the default connection (pre-multi-connection installs)', async () => {
    delete perConnection['claude-max'];
    legacyGlobal = { accessToken: 'legacy-A', expiresAt: FAR_FUTURE, source: 'native' };
    expect((await getValidClaudeOAuthToken('claude-max')).accessToken).toBe('legacy-A');
  });

  it('refreshes a non-default connection without touching the legacy slot or other connections', async () => {
    perConnection['claude-max-2'] = { accessToken: 'old-B', refreshToken: 'refresh-B', expiresAt: PAST };
    refreshed = { accessToken: 'new-B', refreshToken: 'new-refresh-B', expiresAt: FAR_FUTURE };

    const result = await getValidClaudeOAuthToken('claude-max-2');

    expect(result.accessToken).toBe('new-B');
    expect(perConnection['claude-max-2']?.accessToken).toBe('new-B');
    expect(perConnection['claude-max']?.accessToken).toBe('token-A');
    expect(legacyWrites).toHaveLength(0);
  });

  it('keeps the legacy slot in sync when the default connection refreshes', async () => {
    perConnection['claude-max'] = { accessToken: 'old-A', refreshToken: 'refresh-A', expiresAt: PAST };
    refreshed = { accessToken: 'new-A', refreshToken: 'new-refresh-A', expiresAt: FAR_FUTURE };

    const result = await getValidClaudeOAuthToken('claude-max');

    expect(result.accessToken).toBe('new-A');
    expect(legacyWrites).toHaveLength(1);
    expect(legacyWrites[0]?.accessToken).toBe('new-A');
  });

  it('a failed refresh on a non-default connection signs out only that connection', async () => {
    perConnection['claude-max-2'] = { accessToken: 'old-B', refreshToken: 'refresh-B', expiresAt: PAST };
    refreshed = null; // refreshClaudeToken throws invalid_grant

    const result = await getValidClaudeOAuthToken('claude-max-2');

    expect(result.accessToken).toBeNull();
    expect(deletedSlugs).toEqual(['claude-max-2']);
    expect(perConnection['claude-max']?.accessToken).toBe('token-A');
    expect(legacyWrites).toHaveLength(0);
  });
});
