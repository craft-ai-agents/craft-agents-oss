/**
 * A Microsoft source can sign in with its own Entra app registration
 * (api.microsoftOAuthClientId / api.microsoftTenantId) instead of the built-in one.
 * The client ID and the tenant must reach every request: the authorize URL, the code
 * exchange and the refresh.
 */

import { afterEach, describe, expect, it, mock } from 'bun:test';
import {
  MICROSOFT_SCOPES_RULE,
  exchangeMicrosoftOAuth,
  getMicrosoftScopes,
  isMicrosoftOAuthConfigured,
  isMicrosoftService,
  microsoftCredentialMatchesSource,
  prepareMicrosoftOAuth,
  refreshMicrosoftToken,
  type MicrosoftService,
} from '../microsoft-oauth.ts';
import { isValidMicrosoftClientId, isValidMicrosoftTenant, microsoftAuthority } from '../microsoft-authority.ts';

const OWN_CLIENT_ID = '11111111-2222-4333-8444-555555555555';
const TENANT = 'contoso.onmicrosoft.com';
const TENANT_TOKEN_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`;
const RELAY = 'https://thecraftagents.com/auth/callback';

const realFetch = globalThis.fetch;
let requests: Array<{ url: string; body: URLSearchParams }> = [];

function mockFetch(respond: (url: string) => Response): void {
  requests = [];
  globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    requests.push({ url, body: new URLSearchParams(typeof init?.body === 'string' ? init.body : '') });
    return respond(url);
  }) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('microsoftAuthority', () => {
  it('uses common by default', () => {
    expect(microsoftAuthority()).toEqual({
      tenant: 'common',
      authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    });
    expect(microsoftAuthority('  ').tenant).toBe('common');
  });

  it('builds the endpoints of a tenant', () => {
    expect(microsoftAuthority(` ${TENANT} `)).toEqual({
      tenant: TENANT,
      authorizeUrl: `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`,
      tokenUrl: TENANT_TOKEN_URL,
    });
  });

  it('accepts tenant IDs, domains and the well-known tenants', () => {
    for (const tenant of ['72f988bf-86f1-41af-91ab-2d7cd011db47', 'contoso.com', TENANT, 'common', 'organizations', 'consumers']) {
      expect(isValidMicrosoftTenant(tenant)).toBe(true);
    }
  });

  it('refuses tenants that could change the URL', () => {
    for (const tenant of ['evil.example/x', 'a b', 'x?y=1', 'x#y', '../common', 'user@contoso.com', '-contoso', 'contoso.']) {
      expect(isValidMicrosoftTenant(tenant)).toBe(false);
      expect(() => microsoftAuthority(tenant)).toThrow('Invalid Microsoft tenant');
    }
  });
});

describe('isValidMicrosoftClientId', () => {
  it('accepts a GUID and refuses anything else', () => {
    expect(isValidMicrosoftClientId(OWN_CLIENT_ID)).toBe(true);
    expect(isValidMicrosoftClientId(OWN_CLIENT_ID.toUpperCase())).toBe(true);
    expect(isValidMicrosoftClientId('my-app')).toBe(false);
    expect(isValidMicrosoftClientId(`{${OWN_CLIENT_ID}}`)).toBe(false);
    expect(isValidMicrosoftClientId('')).toBe(false);
  });
});

describe('getMicrosoftScopes', () => {
  it('requests custom scopes first, plus the ones every sign-in needs', () => {
    expect(getMicrosoftScopes({ scopes: ['https://graph.microsoft.com/Tasks.ReadWrite'] })).toEqual([
      'https://graph.microsoft.com/Tasks.ReadWrite',
      'https://graph.microsoft.com/User.Read',
      'offline_access',
    ]);
  });

  it("requests a service's predefined scopes", () => {
    expect(isMicrosoftService('microsoft-calendar')).toBe(true);
    expect(getMicrosoftScopes({ service: 'microsoft-calendar' })).toContain('https://graph.microsoft.com/Calendars.ReadWrite');
  });

  it('refuses a service without predefined scopes instead of signing in for Outlook', () => {
    // 'calendar' is what the old error text suggested; the others are Object.prototype keys
    for (const service of ['calendar', 'constructor', 'toString']) {
      expect(isMicrosoftService(service)).toBe(false);
      expect(() => getMicrosoftScopes({ service: service as MicrosoftService })).toThrow(`Unknown microsoftService '${service}'`);
    }
    expect(() => prepareMicrosoftOAuth({ service: 'calendar' as string as MicrosoftService, callbackUrl: RELAY, clientId: OWN_CLIENT_ID }))
      .toThrow(MICROSOFT_SCOPES_RULE);
  });

  it('names every service in the rule', () => {
    expect(MICROSOFT_SCOPES_RULE).toBe(
      "Set microsoftService ('outlook', 'microsoft-calendar', 'onedrive', 'teams', or 'sharepoint') or microsoftScopes in api config.",
    );
  });
});

describe('prepareMicrosoftOAuth with the source app registration', () => {
  it('signs in with the source client ID at its tenant', () => {
    const flow = prepareMicrosoftOAuth({ service: 'outlook', callbackUrl: RELAY, clientId: OWN_CLIENT_ID, tenantId: TENANT });

    const authUrl = new URL(flow.authUrl);
    expect(authUrl.origin + authUrl.pathname).toBe(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`);
    expect(authUrl.searchParams.get('client_id')).toBe(OWN_CLIENT_ID);
    expect(authUrl.searchParams.get('redirect_uri')).toBe(RELAY);
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');
    // The account picker, not a forced consent screen (which defeats admin consent)
    expect(authUrl.searchParams.get('prompt')).toBe('select_account');
    expect(authUrl.searchParams.get('scope')).toContain('offline_access');
    expect(flow).toMatchObject({ clientId: OWN_CLIENT_ID, tokenEndpoint: TENANT_TOKEN_URL, provider: 'microsoft' });
    expect(flow.clientSecret).toBeUndefined();
  });

  it('uses common without a tenant and trims the configured values', () => {
    const flow = prepareMicrosoftOAuth({ service: 'onedrive', callbackUrl: RELAY, clientId: `  ${OWN_CLIENT_ID}  `, tenantId: ' ' });

    expect(new URL(flow.authUrl).pathname).toBe('/common/oauth2/v2.0/authorize');
    expect(new URL(flow.authUrl).searchParams.get('client_id')).toBe(OWN_CLIENT_ID);
    expect(flow.tokenEndpoint).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/token');
  });

  it('refuses a malformed client ID or tenant before the browser opens', () => {
    expect(() => prepareMicrosoftOAuth({ callbackUrl: RELAY, clientId: 'not-a-guid' })).toThrow('Invalid microsoftOAuthClientId');
    expect(() => prepareMicrosoftOAuth({ callbackUrl: RELAY, clientId: OWN_CLIENT_ID, tenantId: 'evil.example/x' }))
      .toThrow('Invalid Microsoft tenant');
  });

  it('counts a source client ID as configured', () => {
    expect(isMicrosoftOAuthConfigured(OWN_CLIENT_ID)).toBe(true);
  });

  it.skipIf(Boolean(process.env.MICROSOFT_OAUTH_CLIENT_ID))('asks for a client ID when the build has no built-in app', () => {
    expect(isMicrosoftOAuthConfigured()).toBe(false);
    expect(isMicrosoftOAuthConfigured('  ')).toBe(false);
    expect(() => prepareMicrosoftOAuth({ callbackUrl: RELAY })).toThrow('microsoftOAuthClientId');
  });
});

describe('exchangeMicrosoftOAuth', () => {
  const params = {
    code: 'code-1',
    codeVerifier: 'verifier-1',
    redirectUri: RELAY,
    clientId: OWN_CLIENT_ID,
    tokenEndpoint: TENANT_TOKEN_URL,
  };

  it('redeems the code with the prepared client at the prepared token endpoint, without a secret', async () => {
    mockFetch((url) => url === TENANT_TOKEN_URL
      ? Response.json({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600 })
      : Response.json({ mail: 'person@contoso.com' }));

    const result = await exchangeMicrosoftOAuth(params);

    expect(result).toMatchObject({
      success: true,
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      email: 'person@contoso.com',
      oauthClientId: OWN_CLIENT_ID,
    });
    const tokenRequest = requests.find(r => r.url === TENANT_TOKEN_URL)!;
    expect(tokenRequest.body.get('client_id')).toBe(OWN_CLIENT_ID);
    expect(tokenRequest.body.get('code_verifier')).toBe('verifier-1');
    expect(tokenRequest.body.get('redirect_uri')).toBe(RELAY);
    expect(tokenRequest.body.get('client_secret')).toBeNull();
  });

  it("reports Microsoft's reason without the trace and correlation IDs", async () => {
    mockFetch(() => Response.json({
      error: 'invalid_client',
      error_description: "AADSTS7000218: The request body must contain the following parameter: 'client_assertion' or 'client_secret'.\r\nTrace ID: 0000\r\nCorrelation ID: 1111\r\nTimestamp: 2026-11-25 14:00:00Z",
    }, { status: 401 }));

    const result = await exchangeMicrosoftOAuth(params);

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      "Token exchange failed: invalid_client: AADSTS7000218: The request body must contain the following parameter: 'client_assertion' or 'client_secret'.",
    );
  });
});

describe('refreshMicrosoftToken', () => {
  it('refreshes with the issuing client at the source tenant', async () => {
    mockFetch(() => Response.json({ access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 3600 }));

    const result = await refreshMicrosoftToken('refresh-1', { clientId: OWN_CLIENT_ID, tenantId: TENANT });

    expect(result.accessToken).toBe('access-2');
    expect(result.refreshToken).toBe('refresh-2');
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe(TENANT_TOKEN_URL);
    expect(requests[0]!.body.get('client_id')).toBe(OWN_CLIENT_ID);
    expect(requests[0]!.body.get('grant_type')).toBe('refresh_token');
    expect(requests[0]!.body.get('refresh_token')).toBe('refresh-1');
  });

  it('refreshes through common without a tenant', async () => {
    mockFetch(() => Response.json({ access_token: 'access-2', expires_in: 3600 }));

    await refreshMicrosoftToken('refresh-1', { clientId: OWN_CLIENT_ID });

    expect(requests[0]!.url).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/token');
  });

  it("keeps Microsoft's reason when the refresh is refused", async () => {
    mockFetch(() => Response.json({
      error: 'invalid_grant',
      error_description: 'AADSTS700082: The refresh token has expired due to inactivity. Trace ID: 0000 Correlation ID: 1111 Timestamp: 2026-11-25',
    }, { status: 400 }));

    await expect(refreshMicrosoftToken('refresh-1', { clientId: OWN_CLIENT_ID })).rejects.toThrow(
      'Failed to refresh Microsoft token: invalid_grant: AADSTS700082: The refresh token has expired due to inactivity.',
    );
  });

  it('reports the HTTP status when the error body is not JSON', async () => {
    mockFetch(() => new Response('Service Unavailable', { status: 503 }));

    await expect(refreshMicrosoftToken('refresh-1', { clientId: OWN_CLIENT_ID })).rejects.toThrow(
      'Failed to refresh Microsoft token: HTTP 503',
    );
  });
});

describe('microsoftCredentialMatchesSource', () => {
  const OTHER_CLIENT_ID = '66666666-7777-4888-9999-000000000000';

  it('matches tokens of the app the source signs in with, regardless of case', () => {
    expect(microsoftCredentialMatchesSource(OWN_CLIENT_ID, OWN_CLIENT_ID)).toBe(true);
    expect(microsoftCredentialMatchesSource(OWN_CLIENT_ID.toUpperCase(), ` ${OWN_CLIENT_ID} `)).toBe(true);
  });

  it('treats tokens without a recorded client ID as the built-in app', () => {
    expect(microsoftCredentialMatchesSource(undefined, undefined)).toBe(true);
    expect(microsoftCredentialMatchesSource(undefined, OWN_CLIENT_ID)).toBe(false);
  });

  it('refuses tokens of another app', () => {
    expect(microsoftCredentialMatchesSource(OWN_CLIENT_ID, OTHER_CLIENT_ID)).toBe(false);
    expect(microsoftCredentialMatchesSource(OWN_CLIENT_ID, undefined)).toBe(false);
  });
});
