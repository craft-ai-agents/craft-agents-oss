/**
 * Both Microsoft sign-in paths (prepareOAuth, used by the app, and authenticate) choose the
 * scopes the same way: the source's microsoftScopes, else its service, explicit or inferred
 * from the base URL. A source with neither, or with a service that doesn't exist, gets an
 * error that names the valid values instead of a sign-in for other scopes.
 */

import { describe, expect, it } from 'bun:test';
import { SourceCredentialManager } from '../credential-manager.ts';
import { MICROSOFT_SCOPES_RULE, type MicrosoftService } from '../../auth/microsoft-oauth.ts';
import type { ApiSourceConfig, LoadedSource } from '../types.ts';

const OWN_CLIENT_ID = '11111111-2222-4333-8444-555555555555';
const CALLBACK_URL = 'http://localhost:6477/callback';

function graphSource(api: Partial<ApiSourceConfig>): LoadedSource {
  return {
    config: {
      id: 'graph-id',
      name: 'Graph',
      slug: 'graph',
      enabled: true,
      provider: 'microsoft',
      type: 'api',
      // Its own app, so the sign-in doesn't depend on the build's MICROSOFT_OAUTH_CLIENT_ID
      api: { baseUrl: 'https://graph.microsoft.com/v1.0/', authType: 'oauth', microsoftOAuthClientId: OWN_CLIENT_ID, ...api },
    },
    guide: null,
    folderPath: '/mock/ws-1/sources/graph',
    workspaceRootPath: '/mock/ws-1',
    workspaceId: 'ws-1',
  } as LoadedSource;
}

async function signInScopes(api: Partial<ApiSourceConfig>): Promise<string[]> {
  const flow = await new SourceCredentialManager().prepareOAuth(graphSource(api), { callbackUrl: CALLBACK_URL });
  return new URL(flow.authUrl).searchParams.get('scope')!.split(' ');
}

describe('Microsoft sign-in scopes', () => {
  it('requests microsoftScopes alone, without a service', async () => {
    expect(await signInScopes({ microsoftScopes: ['https://graph.microsoft.com/Tasks.ReadWrite'] })).toEqual([
      'https://graph.microsoft.com/Tasks.ReadWrite',
      'https://graph.microsoft.com/User.Read',
      'offline_access',
    ]);
  });

  it('requests the scopes of the configured service, or of the one the base URL names', async () => {
    expect(await signInScopes({ microsoftService: 'microsoft-calendar' })).toContain('https://graph.microsoft.com/Calendars.ReadWrite');
    expect(await signInScopes({ baseUrl: 'https://graph.microsoft.com/v1.0/me/drive' })).toContain('https://graph.microsoft.com/Files.ReadWrite');
  });

  it('refuses a service that does not exist instead of signing in for Outlook', async () => {
    await expect(signInScopes({ microsoftService: 'calendar' as string as MicrosoftService }))
      .rejects.toThrow(`Unknown microsoftService 'calendar'. ${MICROSOFT_SCOPES_RULE}`);
  });

  it('asks for a service or scopes when neither is known, with the same message on both paths', async () => {
    const message = `Cannot determine Microsoft service for source 'graph'. ${MICROSOFT_SCOPES_RULE}`;
    const source = graphSource({});
    const credManager = new SourceCredentialManager();

    await expect(credManager.prepareOAuth(source, { callbackUrl: CALLBACK_URL })).rejects.toThrow(message);
    expect(await credManager.authenticate(source, { onStatus: () => {}, onError: () => {} }))
      .toEqual({ success: false, error: message });
  });
});
