import { beforeEach, describe, expect, it, mock } from 'bun:test';

import { OAUTH_RELAY_CALLBACK_URL, isOAuthRelayState } from '../../auth/oauth-relay.ts';
import { SourceCredentialManager } from '../credential-manager.ts';
import type { LoadedSource, FolderSourceConfig } from '../types.ts';

function createApiSource(overrides: Partial<FolderSourceConfig> = {}): LoadedSource {
  return {
    config: {
      id: 'test-id',
      slug: 'gmail-test',
      name: 'Gmail Test',
      type: 'api',
      provider: 'google',
      enabled: true,
      api: {
        baseUrl: 'https://gmail.googleapis.com/',
        authType: 'bearer',
        googleService: 'gmail',
        googleOAuthClientId: 'test-client-id',
        googleOAuthClientSecret: 'test-client-secret',
      },
      ...overrides,
    } as FolderSourceConfig,
    guide: null,
    folderPath: '/tmp/test/sources/gmail-test',
    workspaceRootPath: '/tmp/test',
    workspaceId: 'test-workspace',
  };
}

function createMcpSource(overrides: Partial<FolderSourceConfig> = {}): LoadedSource {
  return {
    config: {
      id: 'test-mcp-id',
      slug: 'mcp-test',
      name: 'MCP Test',
      type: 'mcp',
      enabled: true,
      mcp: {
        transport: 'http',
        url: 'https://example.com/mcp',
      },
      ...overrides,
    } as FolderSourceConfig,
    guide: null,
    folderPath: '/tmp/test/sources/mcp-test',
    workspaceRootPath: '/tmp/test',
    workspaceId: 'test-workspace',
  };
}

describe('SourceCredentialManager.prepareOAuth relay wrapping', () => {
  const credManager = new SourceCredentialManager();

  beforeEach(() => {
    globalThis.fetch = mock((input: string | URL | Request) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      if (url === 'https://example.com/.well-known/oauth-authorization-server') {
        return Promise.resolve(Response.json({
          authorization_endpoint: 'https://example.com/oauth/authorize',
          token_endpoint: 'https://example.com/oauth/token',
        }));
      }
      return Promise.resolve(new Response('Not Found', { status: 404 }));
    }) as unknown as typeof fetch;
  });

  it('uses the provided WebUI redirect URI when no Runner relay is configured', async () => {
    const result = await credManager.prepareOAuth(createApiSource(), {
      callbackUrl: 'https://runner.example/api/oauth/callback',
    });

    expect(OAUTH_RELAY_CALLBACK_URL).toBe('');
    expect(result.redirectUri).toBe('https://runner.example/api/oauth/callback');
    expect(result.state).toBeTruthy();

    const authUrl = new URL(result.authUrl);
    expect(authUrl.searchParams.get('redirect_uri')).toBe('https://runner.example/api/oauth/callback');

    const state = authUrl.searchParams.get('state');
    expect(state).toBeTruthy();
    expect(isOAuthRelayState(state!)).toBe(false);
  });

  it('uses the provided desktop callback URL when no Runner relay is configured', async () => {
    const result = await credManager.prepareOAuth(createApiSource(), {
      callbackUrl: 'http://localhost:6477/callback',
    });

    expect(OAUTH_RELAY_CALLBACK_URL).toBe('');
    expect(result.redirectUri).toBe('http://localhost:6477/callback');
    expect(result.state).toBeTruthy();

    const authUrl = new URL(result.authUrl);
    expect(authUrl.searchParams.get('redirect_uri')).toBe('http://localhost:6477/callback');

    const state = authUrl.searchParams.get('state');
    expect(state).toBeTruthy();
    expect(isOAuthRelayState(state!)).toBe(false);
  });

  it('passes the provided redirect URI into MCP prepare-time metadata flow when no Runner relay is configured', async () => {
    const result = await credManager.prepareOAuth(createMcpSource(), {
      callbackUrl: 'https://runner.example/api/oauth/callback',
    });

    expect(OAUTH_RELAY_CALLBACK_URL).toBe('');
    expect(result.redirectUri).toBe('https://runner.example/api/oauth/callback');

    const authUrl = new URL(result.authUrl);
    expect(authUrl.origin + authUrl.pathname).toBe('https://example.com/oauth/authorize');
    expect(authUrl.searchParams.get('redirect_uri')).toBe('https://runner.example/api/oauth/callback');

    const state = authUrl.searchParams.get('state');
    expect(state).toBeTruthy();
    expect(isOAuthRelayState(state!)).toBe(false);
  });
});
