import { describe, expect, it } from 'bun:test';
import type { SsoSession } from '../mdp-auth-client.ts';
import { getSsoSessionState, refreshStoredSsoSession } from '../sso-session-state.ts';

function makeSession(overrides: Partial<SsoSession> = {}): SsoSession {
  return {
    token: 'stored-session-token',
    accessToken: 'stored-access-token',
    idToken: 'stored-id-token',
    expiresAt: 2_000,
    employeeId: 'E123',
    ystId: 'YST456',
    department: 'Engineering',
    userName: 'Ada Lovelace',
    ...overrides,
  };
}

describe('getSsoSessionState', () => {
  it('returns authenticated public identity for a non-expired stored session', async () => {
    const refreshedTokens: string[] = [];

    const result = await getSsoSessionState({
      credentialStore: {
        load: async () => makeSession({ expiresAt: 2_000 }),
        save: async () => {},
        clear: async () => {},
      },
      authClient: {
        refresh: async () => {
          refreshedTokens.push('unexpected');
          return makeSession();
        },
      },
      now: () => 1_000,
    });

    expect(result).toEqual({
      authenticated: true,
      userName: 'Ada Lovelace',
      department: 'Engineering',
    });
    expect('token' in result).toBe(false);
    expect('accessToken' in result).toBe(false);
    expect('idToken' in result).toBe(false);
    expect(refreshedTokens).toEqual([]);
  });

  it('returns unauthenticated when no stored session exists', async () => {
    let cleared = false;

    const result = await getSsoSessionState({
      credentialStore: {
        load: async () => null,
        save: async () => {},
        clear: async () => {
          cleared = true;
        },
      },
      authClient: {
        refresh: async () => {
          throw new Error('refresh should not be called');
        },
      },
      now: () => 1_000,
    });

    expect(result).toEqual({ authenticated: false });
    expect(cleared).toBe(false);
  });

  it('refreshes an expired stored session and saves the replacement', async () => {
    const savedSessions: SsoSession[] = [];
    const refreshedSession = makeSession({
      token: 'new-session-token',
      accessToken: 'new-access-token',
      idToken: 'new-id-token',
      expiresAt: 5_000,
      department: 'Product',
      userName: 'Grace Hopper',
    });

    const result = await getSsoSessionState({
      credentialStore: {
        load: async () => makeSession({ token: 'refreshable-token', expiresAt: 1_000 }),
        save: async (session) => {
          savedSessions.push(session);
        },
        clear: async () => {},
      },
      authClient: {
        refresh: async (token) => {
          expect(token).toBe('refreshable-token');
          return refreshedSession;
        },
      },
      now: () => 2_000,
    });

    expect(result).toEqual({
      authenticated: true,
      userName: 'Grace Hopper',
      department: 'Product',
    });
    expect(savedSessions).toEqual([refreshedSession]);
  });

  it('clears the stored session when refresh fails', async () => {
    let cleared = false;

    const result = await getSsoSessionState({
      credentialStore: {
        load: async () => makeSession({ expiresAt: 1_000 }),
        save: async () => {
          throw new Error('save should not be called');
        },
        clear: async () => {
          cleared = true;
        },
      },
      authClient: {
        refresh: async () => {
          throw new Error('refresh failed');
        },
      },
      now: () => 2_000,
    });

    expect(result).toEqual({ authenticated: false });
    expect(cleared).toBe(true);
  });
});

describe('refreshStoredSsoSession', () => {
  it('refreshes with the stored token and returns success without exposing raw tokens', async () => {
    const refreshedSession = makeSession({
      token: 'new-session-token',
      accessToken: 'new-access-token',
      idToken: 'new-id-token',
      userName: 'Katherine Johnson',
    });

    const result = await refreshStoredSsoSession({
      credentialStore: {
        load: async () => makeSession({ token: 'stored-refresh-token' }),
        save: async (session) => {
          expect(session).toEqual(refreshedSession);
        },
        clear: async () => {},
      },
      authClient: {
        refresh: async (token) => {
          expect(token).toBe('stored-refresh-token');
          return refreshedSession;
        },
      },
    });

    expect(result).toEqual({
      authenticated: true,
      userName: 'Katherine Johnson',
      department: 'Engineering',
    });
    expect('token' in result).toBe(false);
  });
});
