/**
 * A Microsoft sign-in belongs to the app registration that issued it. The credential
 * manager stores that client ID with the tokens, refreshes with it at the source's
 * tenant, and treats the source as signed out once it is configured for another app
 * (its tokens could neither act as nor be refreshed by the new one).
 */

import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { SourceCredentialManager } from '../credential-manager.ts';
import { getCredentialManager } from '../../credentials/index.ts';
import type { ApiSourceConfig, LoadedSource } from '../types.ts';
import type { StoredCredential } from '../../credentials/types.ts';

const OWN_CLIENT_ID = '11111111-2222-4333-8444-555555555555';
const OTHER_CLIENT_ID = '66666666-7777-4888-9999-000000000000';
const TENANT = 'contoso.onmicrosoft.com';
const TENANT_TOKEN_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`;

function microsoftSource(api: Partial<ApiSourceConfig> = {}): LoadedSource {
  return {
    config: {
      id: 'outlook-id',
      name: 'Outlook',
      slug: 'outlook',
      enabled: true,
      provider: 'microsoft',
      type: 'api',
      isAuthenticated: true,
      api: { baseUrl: 'https://graph.microsoft.com/v1.0/', authType: 'oauth', microsoftService: 'outlook', ...api },
    },
    guide: null,
    folderPath: '/mock/ws-1/sources/outlook',
    workspaceRootPath: '/mock/ws-1',
    workspaceId: 'ws-1',
  } as LoadedSource;
}

const realFetch = globalThis.fetch;
let requests: Array<{ url: string; body: URLSearchParams }> = [];
const restores: Array<() => void> = [];

/** A credential manager whose store holds `stored`; saves and re-auth marks are recorded, not written. */
function setUp(stored: StoredCredential) {
  const credManager = new SourceCredentialManager();
  const saved: StoredCredential[] = [];
  const get = spyOn(getCredentialManager(), 'get').mockResolvedValue(stored);
  const save = spyOn(credManager, 'save').mockImplementation(async (_source, credential) => {
    saved.push(credential);
  });
  const reauth = spyOn(credManager, 'markSourceNeedsReauth').mockImplementation(() => {});
  restores.push(() => { get.mockRestore(); save.mockRestore(); reauth.mockRestore(); });

  requests = [];
  globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    requests.push({ url, body: new URLSearchParams(typeof init?.body === 'string' ? init.body : '') });
    return Response.json({ access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 3600 });
  }) as unknown as typeof fetch;

  return { credManager, saved };
}

afterEach(() => {
  globalThis.fetch = realFetch;
  while (restores.length) restores.pop()!();
});

describe('Microsoft credentials belong to the app registration that issued them', () => {
  it('refreshes with the stored client ID at the source tenant and keeps the client ID', async () => {
    const { credManager, saved } = setUp({ value: 'access-1', refreshToken: 'refresh-1', expiresAt: 0, clientId: OWN_CLIENT_ID });

    const token = await credManager.refresh(microsoftSource({ microsoftOAuthClientId: OWN_CLIENT_ID, microsoftTenantId: TENANT }));

    expect(token).toBe('access-2');
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe(TENANT_TOKEN_URL);
    expect(requests[0]!.body.get('client_id')).toBe(OWN_CLIENT_ID);
    expect(requests[0]!.body.get('refresh_token')).toBe('refresh-1');
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ value: 'access-2', refreshToken: 'refresh-2', clientId: OWN_CLIENT_ID });
  });

  it('matches client IDs regardless of case', async () => {
    const { credManager } = setUp({ value: 'access-1', expiresAt: Date.now() + 3_600_000, clientId: OWN_CLIENT_ID.toUpperCase() });

    expect(await credManager.getToken(microsoftSource({ microsoftOAuthClientId: OWN_CLIENT_ID }))).toBe('access-1');
  });

  it('signs the source out when it gets its own app after signing in with the built-in one', async () => {
    // Stored before client IDs were recorded, or by the built-in app: no clientId.
    const { credManager } = setUp({ value: 'access-1', refreshToken: 'refresh-1', expiresAt: Date.now() + 3_600_000 });
    const source = microsoftSource({ microsoftOAuthClientId: OWN_CLIENT_ID });

    expect(await credManager.load(source)).toBeNull();
    expect(await credManager.getToken(source)).toBeNull();
    expect(await credManager.refresh(source)).toBeNull();
    expect(requests).toHaveLength(0);
  });

  it('signs the source out when its client ID changes or is removed', async () => {
    const { credManager } = setUp({ value: 'access-1', refreshToken: 'refresh-1', expiresAt: Date.now() + 3_600_000, clientId: OWN_CLIENT_ID });

    expect(await credManager.getToken(microsoftSource({ microsoftOAuthClientId: OTHER_CLIENT_ID }))).toBeNull();
    expect(await credManager.getToken(microsoftSource())).toBeNull();
    expect(await credManager.getToken(microsoftSource({ microsoftOAuthClientId: OWN_CLIENT_ID }))).toBe('access-1');
  });

  it('keeps built-in sign-ins from older versions working', async () => {
    const { credManager } = setUp({ value: 'access-1', expiresAt: Date.now() + 3_600_000 });

    expect(await credManager.getToken(microsoftSource())).toBe('access-1');
  });
});
