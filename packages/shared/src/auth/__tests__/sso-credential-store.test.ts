import { beforeEach, describe, expect, it } from 'bun:test';
import {
  SSO_CREDENTIAL_ID,
  SsoCredentialStore,
  type SsoSessionIdentity,
} from '../sso-credential-store.ts';
import type { CredentialId, StoredCredential } from '../../credentials/index.ts';
import type { StoredConfig } from '../../config/storage.ts';
import type { SsoSession } from '../mdp-auth-client.ts';

function key(id: CredentialId): string {
  return JSON.stringify(id);
}

function makeSession(overrides: Partial<SsoSession> = {}): SsoSession {
  return {
    token: 'session-token',
    accessToken: 'access-token',
    idToken: 'id-token',
    expiresAt: 1_700_000_000_000,
    employeeId: 'E123',
    ystId: 'YST456',
    department: 'Engineering',
    userName: 'Ada Lovelace',
    ...overrides,
  };
}

function makeConfig(): StoredConfig {
  return {
    workspaces: [],
    activeWorkspaceId: null,
    activeSessionId: null,
  };
}

describe('SsoCredentialStore', () => {
  let credentials: Map<string, StoredCredential>;
  let config: StoredConfig | null;
  let savedConfigs: StoredConfig[];
  let store: SsoCredentialStore;

  beforeEach(() => {
    credentials = new Map();
    config = makeConfig();
    savedConfigs = [];
    store = new SsoCredentialStore({
      credentialManager: {
        get: async (id) => credentials.get(key(id)) ?? null,
        set: async (id, credential) => {
          credentials.set(key(id), credential);
        },
        delete: async (id) => credentials.delete(key(id)),
      },
      loadConfig: () => config,
      saveConfig: (nextConfig) => {
        config = nextConfig;
        savedConfigs.push(nextConfig);
      },
    });
  });

  it('saves sensitive fields to credentials and identity fields to plain config', async () => {
    const session = makeSession();

    await store.save(session);

    expect(credentials.get(key(SSO_CREDENTIAL_ID))).toEqual({
      value: 'session-token',
      accessToken: 'access-token',
      idToken: 'id-token',
    });
    expect(config?.ssoSessionIdentity).toEqual<SsoSessionIdentity>({
      employeeId: 'E123',
      ystId: 'YST456',
      department: 'Engineering',
      userName: 'Ada Lovelace',
      expiresAt: 1_700_000_000_000,
    });
    expect(savedConfigs).toHaveLength(1);
  });

  it('round-trips a saved session identically on load', async () => {
    const session = makeSession();

    await store.save(session);

    await expect(store.load()).resolves.toEqual(session);
  });

  it('returns null when nothing has been saved', async () => {
    expect(await store.load()).toBeNull();
  });

  it('returns null when a required credential field is missing', async () => {
    await store.save(makeSession());
    credentials.set(key(SSO_CREDENTIAL_ID), {
      value: 'session-token',
      idToken: 'id-token',
    });

    expect(await store.load()).toBeNull();
  });

  it('returns null when a required identity field is missing', async () => {
    await store.save(makeSession());
    delete (config?.ssoSessionIdentity as Partial<SsoSessionIdentity> | undefined)?.ystId;

    expect(await store.load()).toBeNull();
  });

  it('clear removes saved SSO state', async () => {
    await store.save(makeSession());

    await store.clear();

    expect(credentials.has(key(SSO_CREDENTIAL_ID))).toBe(false);
    expect(config?.ssoSessionIdentity).toBeUndefined();
    expect(await store.load()).toBeNull();
  });
});
