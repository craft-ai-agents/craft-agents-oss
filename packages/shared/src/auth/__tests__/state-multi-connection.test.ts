/**
 * getValidClaudeOAuthToken must resolve credentials per connection.
 *
 * Regression: every sign-in also wrote the legacy global `claude_oauth` slot and
 * getValidClaudeOAuthToken(slug) read only that slot, so with two Claude
 * connections both resolved to whichever account signed in last.
 *
 * The credential store and the connection list are passed in, and the token
 * endpoint is a stubbed fetch, so no module is mocked for the rest of the run.
 */
import { afterEach, beforeEach, describe, it, expect, mock, spyOn } from 'bun:test';
import * as storage from '../../config/storage.ts';
import {
  getValidClaudeOAuthToken,
  restoreClaudeOAuthRefreshTokens,
  usesLegacyClaudeOAuthSlot,
  _resetRefreshMutex,
  type ClaudeOAuthConnections,
} from '../state.ts';

type Creds = { accessToken: string; refreshToken?: string; expiresAt?: number; source?: 'native' | 'cli' };

const FAR_FUTURE = Date.now() + 24 * 3600_000;
const PAST = Date.now() - 3600_000;

let perConnection: Record<string, Creds>;
let legacyGlobal: Creds | null;
let legacyWrites: Creds[];
let deletedSlugs: string[];
let connections: ClaudeOAuthConnections;
/** Refresh tokens sent to the token endpoint, and its answer to each (null = invalid_grant). */
let refreshRequests: string[];
let refreshAnswers: Record<string, { access_token: string; refresh_token: string; expires_in: number; account?: { uuid: string } } | null>;

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
  delete: async (id: { type: string }) => {
    if (id.type !== 'claude_oauth') return false;
    legacyGlobal = null;
    return true;
  },
  deleteLlmCredentials: async (slug: string) => {
    deletedSlugs.push(slug);
    delete perConnection[slug];
  },
} as unknown as Parameters<typeof restoreClaudeOAuthRefreshTokens>[0];

const tokenFor = (slug: string) => getValidClaudeOAuthToken(slug, manager, connections);

const realFetch = globalThis.fetch;

beforeEach(() => {
  _resetRefreshMutex();
  perConnection = {
    'claude-max': { accessToken: 'token-A', refreshToken: 'refresh-A', expiresAt: FAR_FUTURE },
    'claude-max-2': { accessToken: 'token-B', refreshToken: 'refresh-B', expiresAt: FAR_FUTURE },
  };
  // The legacy slot holds the account that signed in last (B).
  legacyGlobal = { accessToken: 'token-B', refreshToken: 'refresh-B', expiresAt: FAR_FUTURE, source: 'native' };
  connections = { defaultSlug: 'claude-max', slugs: ['claude-max', 'claude-max-2'] };
  legacyWrites = [];
  deletedSlugs = [];
  refreshRequests = [];
  refreshAnswers = {};
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    const refreshToken = JSON.parse(init?.body ?? '{}').refresh_token as string;
    refreshRequests.push(refreshToken);
    const answer = refreshAnswers[refreshToken];
    return answer
      ? Response.json(answer)
      : Response.json({ error: 'invalid_grant' }, { status: 400 });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  mock.restore();
});

describe('getValidClaudeOAuthToken with multiple Claude connections', () => {
  it('returns each connection its own token even when the legacy slot holds another account', async () => {
    expect((await tokenFor('claude-max')).accessToken).toBe('token-A');
    expect((await tokenFor('claude-max-2')).accessToken).toBe('token-B');
  });

  it('does not fall back to the legacy slot for a non-default connection without credentials', async () => {
    delete perConnection['claude-max-2'];
    expect((await tokenFor('claude-max-2')).accessToken).toBeNull();
  });

  it('falls back to the legacy slot for the default connection (pre-multi-connection installs)', async () => {
    perConnection = {};
    legacyGlobal = { accessToken: 'legacy-A', expiresAt: FAR_FUTURE, source: 'native' };
    expect((await tokenFor('claude-max')).accessToken).toBe('legacy-A');
  });

  it('does not fall back while another Claude connection has its own credentials', async () => {
    // The slot was last written by claude-max-2's sign-in, so it is B's account.
    delete perConnection['claude-max'];
    expect((await tokenFor('claude-max')).accessToken).toBeNull();
  });

  it('refreshes a non-default connection without touching the legacy slot or other connections', async () => {
    perConnection['claude-max-2'] = { accessToken: 'old-B', refreshToken: 'refresh-B', expiresAt: PAST };
    refreshAnswers['refresh-B'] = { access_token: 'new-B', refresh_token: 'new-refresh-B', expires_in: 3600 };

    const result = await tokenFor('claude-max-2');

    expect(result.accessToken).toBe('new-B');
    expect(perConnection['claude-max-2']).toMatchObject({ accessToken: 'new-B', refreshToken: 'new-refresh-B' });
    expect(perConnection['claude-max']?.accessToken).toBe('token-A');
    expect(legacyWrites).toHaveLength(0);
  });

  it('writes the default connection\'s refreshed tokens to its own entry only', async () => {
    perConnection['claude-max'] = { accessToken: 'old-A', refreshToken: 'refresh-A', expiresAt: PAST };
    refreshAnswers['refresh-A'] = { access_token: 'new-A', refresh_token: 'new-refresh-A', expires_in: 3600 };

    expect((await tokenFor('claude-max')).accessToken).toBe('new-A');
    expect(perConnection['claude-max']?.accessToken).toBe('new-A');
    expect(legacyWrites).toHaveLength(0);
  });

  it('writes tokens refreshed from the legacy slot back to it and to the connection', async () => {
    perConnection = {};
    legacyGlobal = { accessToken: 'old-A', refreshToken: 'legacy-refresh-A', expiresAt: PAST, source: 'native' };
    refreshAnswers['legacy-refresh-A'] = { access_token: 'new-A', refresh_token: 'new-refresh-A', expires_in: 3600 };

    expect((await tokenFor('claude-max')).accessToken).toBe('new-A');
    expect(perConnection['claude-max']).toMatchObject({ accessToken: 'new-A', refreshToken: 'new-refresh-A' });
    expect(legacyGlobal).toMatchObject({ accessToken: 'new-A', refreshToken: 'new-refresh-A', source: 'native' });
  });

  it('a failed refresh on a non-default connection signs out only that connection', async () => {
    perConnection['claude-max-2'] = { accessToken: 'old-B', refreshToken: 'refresh-B', expiresAt: PAST };

    const result = await tokenFor('claude-max-2');

    expect(result.accessToken).toBeNull();
    expect(deletedSlugs).toEqual(['claude-max-2']);
    expect(perConnection['claude-max']?.accessToken).toBe('token-A');
    expect(legacyWrites).toHaveLength(0);
  });

  it('a failed refresh on the default connection also empties the legacy slot', async () => {
    perConnection['claude-max'] = { accessToken: 'old-A', refreshToken: 'refresh-A', expiresAt: PAST };

    expect((await tokenFor('claude-max')).accessToken).toBeNull();
    expect(deletedSlugs).toEqual(['claude-max']);
    expect(legacyGlobal).toBeNull();
    expect(perConnection['claude-max-2']?.accessToken).toBe('token-B');
  });

  it('refreshes two connections at once, each with its own refresh token, once per connection', async () => {
    perConnection['claude-max'] = { accessToken: 'old-A', refreshToken: 'refresh-A', expiresAt: PAST };
    perConnection['claude-max-2'] = { accessToken: 'old-B', refreshToken: 'refresh-B', expiresAt: PAST };
    refreshAnswers['refresh-A'] = { access_token: 'new-A', refresh_token: 'new-refresh-A', expires_in: 3600 };
    refreshAnswers['refresh-B'] = { access_token: 'new-B', refresh_token: 'new-refresh-B', expires_in: 3600 };

    const tokens = await Promise.all([tokenFor('claude-max'), tokenFor('claude-max-2'), tokenFor('claude-max')]);

    expect(tokens.map((t) => t.accessToken)).toEqual(['new-A', 'new-B', 'new-A']);
    expect(refreshRequests.sort()).toEqual(['refresh-A', 'refresh-B']);
  });

  it("signs out a connection still holding the account that signed in last", async () => {
    // An earlier version refreshed claude-max from the legacy slot (account B) and stored the
    // result on claude-max as well.
    connections = { ...connections, accountUuids: { 'claude-max': 'account-a', 'claude-max-2': 'account-b' } };
    perConnection['claude-max'] = { accessToken: 'old-B', refreshToken: 'refresh-B-copy', expiresAt: PAST };
    refreshAnswers['refresh-B-copy'] = { access_token: 'new-B', refresh_token: 'new-refresh-B', expires_in: 3600, account: { uuid: 'account-b' } };

    expect(await tokenFor('claude-max')).toEqual({ accessToken: null });
    expect(deletedSlugs).toEqual(['claude-max']);
    expect(perConnection['claude-max-2']?.accessToken).toBe('token-B');
  });

  it("reads each connection's account from its sign-in in config.json", async () => {
    spyOn(storage, 'getDefaultLlmConnection').mockReturnValue('claude-max');
    spyOn(storage, 'getLlmConnections').mockReturnValue([
      { slug: 'claude-max', providerType: 'anthropic', authType: 'oauth', oauthAccountUuid: 'account-a' },
      { slug: 'claude-max-2', providerType: 'anthropic', authType: 'oauth', oauthAccountUuid: 'account-b' },
    ] as any);
    perConnection['claude-max'] = { accessToken: 'old-B', refreshToken: 'refresh-B-copy', expiresAt: PAST };
    refreshAnswers['refresh-B-copy'] = { access_token: 'new-B', refresh_token: 'new-refresh-B', expires_in: 3600, account: { uuid: 'account-b' } };

    expect(await getValidClaudeOAuthToken('claude-max', manager)).toEqual({ accessToken: null });
    expect(deletedSlugs).toEqual(['claude-max']);
  });

  it('gives a caller waiting on the refresh its temporary failure too', async () => {
    perConnection['claude-max-2'] = { accessToken: 'old-B', refreshToken: 'refresh-B', expiresAt: PAST };
    globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
      refreshRequests.push(JSON.parse(init?.body ?? '{}').refresh_token);
      return new Response('Service Unavailable', { status: 503 });
    }) as unknown as typeof fetch;

    const results = await Promise.all([tokenFor('claude-max-2'), tokenFor('claude-max-2')]);

    expect(refreshRequests).toEqual(['refresh-B']);
    for (const result of results) {
      expect(result).toEqual({ accessToken: null, transientRefreshError: 'Token refresh failed: 503 - Service Unavailable' });
    }
    expect(deletedSlugs).toEqual([]);
  });
});

describe('usesLegacyClaudeOAuthSlot', () => {
  it('is true only for the default connection while no other Claude connection has credentials', async () => {
    perConnection = {};
    expect(await usesLegacyClaudeOAuthSlot(manager, 'claude-max', connections)).toBe(true);
    expect(await usesLegacyClaudeOAuthSlot(manager, 'claude-max-2', connections)).toBe(false);

    perConnection['claude-max-2'] = { accessToken: 'token-B' };
    expect(await usesLegacyClaudeOAuthSlot(manager, 'claude-max', connections)).toBe(false);
  });
});

describe('restoreClaudeOAuthRefreshTokens', () => {
  it('gives the connection holding the legacy slot\'s access token its refresh token and expiry', async () => {
    // The connection setup left only the access token on the connection.
    perConnection = { 'claude-max': { accessToken: 'token-A' }, 'claude-max-2': { accessToken: 'token-B' } };
    legacyGlobal = { accessToken: 'token-B', refreshToken: 'refresh-B', expiresAt: FAR_FUTURE, source: 'native' };

    await restoreClaudeOAuthRefreshTokens(manager, connections);

    expect(perConnection['claude-max-2']).toEqual({ accessToken: 'token-B', refreshToken: 'refresh-B', expiresAt: FAR_FUTURE });
    expect(perConnection['claude-max']).toEqual({ accessToken: 'token-A' });
  });

  it('leaves connections that already have a refresh token alone', async () => {
    legacyGlobal = { accessToken: 'token-B', refreshToken: 'other-refresh', expiresAt: PAST };

    await restoreClaudeOAuthRefreshTokens(manager, connections);

    expect(perConnection['claude-max-2']).toEqual({ accessToken: 'token-B', refreshToken: 'refresh-B', expiresAt: FAR_FUTURE });
  });
});
