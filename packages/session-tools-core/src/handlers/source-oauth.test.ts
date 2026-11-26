import { describe, it, expect } from 'bun:test';
import {
  handleSourceOAuthTrigger,
  handleGoogleOAuthTrigger,
  handleSlackOAuthTrigger,
  handleMicrosoftOAuthTrigger,
} from './source-oauth.ts';
import type { SessionToolContext, CredentialManagerInterface } from '../context.ts';
import type { AuthRequest, MicrosoftService, SourceConfig } from '../types.ts';

/** A service that doesn't exist; the old error text suggested it. */
const UNKNOWN_SERVICE = 'calendar' as string as MicrosoftService;

const SOURCES: Record<string, SourceConfig> = {
  gmail: {
    id: 'gmail', name: 'Gmail', slug: 'gmail', enabled: true, provider: 'google', type: 'api',
    isAuthenticated: true,
    api: { baseUrl: 'https://gmail.googleapis.com', authType: 'oauth', googleService: 'gmail' },
  } as SourceConfig,
  slack: {
    id: 'slack', name: 'Slack', slug: 'slack', enabled: true, provider: 'slack', type: 'api',
    isAuthenticated: true,
    api: { baseUrl: 'https://slack.com/api', authType: 'oauth' },
  } as SourceConfig,
  outlook: {
    id: 'outlook', name: 'Outlook', slug: 'outlook', enabled: true, provider: 'microsoft', type: 'api',
    isAuthenticated: true,
    api: { baseUrl: 'https://graph.microsoft.com', authType: 'oauth', microsoftService: 'outlook' },
  } as SourceConfig,
  'outlook-own-app': {
    id: 'outlook-own-app', name: 'Outlook (own app)', slug: 'outlook-own-app', enabled: true, provider: 'microsoft', type: 'api',
    isAuthenticated: false,
    api: {
      baseUrl: 'https://graph.microsoft.com', authType: 'oauth', microsoftService: 'outlook',
      microsoftOAuthClientId: '11111111-2222-4333-8444-555555555555', microsoftTenantId: 'contoso.onmicrosoft.com',
    },
  } as SourceConfig,
  'graph-custom': {
    id: 'graph-custom', name: 'Graph (custom scopes)', slug: 'graph-custom', enabled: true, provider: 'microsoft', type: 'api',
    isAuthenticated: false,
    api: { baseUrl: 'https://graph.microsoft.com/v1.0/', authType: 'oauth', microsoftScopes: ['https://graph.microsoft.com/Tasks.ReadWrite'] },
  } as SourceConfig,
  'graph-unknown': {
    id: 'graph-unknown', name: 'Graph (no service)', slug: 'graph-unknown', enabled: true, provider: 'microsoft', type: 'api',
    isAuthenticated: false,
    api: { baseUrl: 'https://graph.microsoft.com/v1.0/', authType: 'oauth' },
  } as SourceConfig,
  'graph-typo': {
    id: 'graph-typo', name: 'Graph (unknown service)', slug: 'graph-typo', enabled: true, provider: 'microsoft', type: 'api',
    isAuthenticated: false,
    api: { baseUrl: 'https://graph.microsoft.com/v1.0/', authType: 'oauth', microsoftService: UNKNOWN_SERVICE },
  } as SourceConfig,
  'graph-typo-scopes': {
    id: 'graph-typo-scopes', name: 'Graph (unknown service, scopes)', slug: 'graph-typo-scopes', enabled: true, provider: 'microsoft', type: 'api',
    isAuthenticated: false,
    api: {
      baseUrl: 'https://graph.microsoft.com/v1.0/', authType: 'oauth', microsoftService: UNKNOWN_SERVICE,
      microsoftScopes: ['https://graph.microsoft.com/Calendars.Read'],
    },
  } as SourceConfig,
  linear: {
    id: 'linear', name: 'Linear', slug: 'linear', enabled: true, provider: 'linear', type: 'mcp',
    isAuthenticated: true,
    mcp: { url: 'https://mcp.linear.app', authType: 'oauth' },
  } as SourceConfig,
};

function createCtx(opts: {
  token?: string | null;
  refreshed?: string | null;
  isAuthenticated?: boolean;
}): { ctx: SessionToolContext; authRequests: AuthRequest[]; calls: string[] } {
  const authRequests: AuthRequest[] = [];
  const calls: string[] = [];
  const credentialManager: CredentialManagerInterface = {
    hasValidCredentials: async () => !!opts.token,
    getToken: async (source) => { calls.push(`getToken:${source.workspaceId}:${source.config.slug}`); return opts.token ?? null; },
    refresh: async (source) => { calls.push(`refresh:${source.workspaceId}:${source.config.slug}`); return opts.refreshed ?? null; },
  };
  const ctx = {
    sessionId: 'session-1',
    workspacePath: '/workspaces/ws-1',
    loadSourceConfig: (slug: string) => {
      const config = SOURCES[slug];
      return config ? { ...config, isAuthenticated: opts.isAuthenticated ?? config.isAuthenticated } : null;
    },
    credentialManager,
    callbacks: { onAuthRequest: (request: AuthRequest) => authRequests.push(request) },
  } as unknown as SessionToolContext;
  return { ctx, authRequests, calls };
}

const text = (result: { content: Array<{ text: string }> }) => result.content[0]!.text;

const PROVIDER_TRIGGERS = [
  { name: 'Google', handler: handleGoogleOAuthTrigger, slug: 'gmail', type: 'oauth-google' },
  { name: 'Slack', handler: handleSlackOAuthTrigger, slug: 'slack', type: 'oauth-slack' },
  { name: 'Microsoft', handler: handleMicrosoftOAuthTrigger, slug: 'outlook', type: 'oauth-microsoft' },
] as const;

describe('provider OAuth triggers refresh before asking the user to sign in', () => {
  for (const { name, handler, slug, type } of PROVIDER_TRIGGERS) {
    it(`${name}: a valid token needs no sign-in`, async () => {
      const { ctx, authRequests, calls } = createCtx({ token: 'still-valid' });
      const result = await handler(ctx, { sourceSlug: slug });

      expect(text(result)).toBe(`Source '${slug}' is already authenticated.`);
      expect(authRequests).toHaveLength(0);
      expect(calls).toEqual([`getToken:ws-1:${slug}`]);
    });

    it(`${name}: an expired token that refreshes needs no sign-in card`, async () => {
      const { ctx, authRequests, calls } = createCtx({ token: null, refreshed: 'fresh-token' });
      const result = await handler(ctx, { sourceSlug: slug });

      expect(result.isError).toBe(false);
      expect(text(result)).toContain('refreshed successfully');
      expect(authRequests).toHaveLength(0);
      expect(calls).toEqual([`getToken:ws-1:${slug}`, `refresh:ws-1:${slug}`]);
    });

    it(`${name}: a failed refresh asks the user to sign in`, async () => {
      const { ctx, authRequests } = createCtx({ token: null, refreshed: null });
      const result = await handler(ctx, { sourceSlug: slug });

      expect(text(result)).toContain('requested');
      expect(authRequests).toHaveLength(1);
      expect(authRequests[0]).toMatchObject({ type, sourceSlug: slug, sessionId: 'session-1' });
    });

    it(`${name}: a source that needs auth skips the refresh and asks to sign in`, async () => {
      const { ctx, authRequests, calls } = createCtx({ isAuthenticated: false, refreshed: 'would-refresh' });
      await handler(ctx, { sourceSlug: slug });

      expect(calls).toEqual([]);
      expect(authRequests).toHaveLength(1);
    });
  }

  it('MCP: still refreshes before asking to sign in', async () => {
    const refreshed = createCtx({ refreshed: 'fresh-token' });
    expect(text(await handleSourceOAuthTrigger(refreshed.ctx, { sourceSlug: 'linear' }))).toContain('refreshed successfully');
    expect(refreshed.authRequests).toHaveLength(0);

    const failed = createCtx({ refreshed: null });
    await handleSourceOAuthTrigger(failed.ctx, { sourceSlug: 'linear' });
    expect(failed.calls).toEqual(['refresh:ws-1:linear']);
    expect(failed.authRequests[0]).toMatchObject({ type: 'oauth', sourceSlug: 'linear' });
  });
});

describe('Microsoft trigger: app registration', () => {
  /** A build without the built-in Microsoft app: only a source's own client ID counts. */
  function withoutBuiltInApp(ctx: SessionToolContext): string[] {
    const checked: string[] = [];
    (ctx as { isMicrosoftOAuthConfigured?: (clientId?: string) => boolean }).isMicrosoftOAuthConfigured = (clientId) => {
      checked.push(clientId ?? '(none)');
      return Boolean(clientId);
    };
    return checked;
  }

  it('explains how to bring an app registration when the build has none', async () => {
    const { ctx, authRequests, calls } = createCtx({ isAuthenticated: false });
    withoutBuiltInApp(ctx);

    const result = await handleMicrosoftOAuthTrigger(ctx, { sourceSlug: 'outlook' });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('"microsoftOAuthClientId"');
    expect(text(result)).toContain('Mobile and desktop applications');
    expect(text(result)).toContain('https://thecraftagents.com/auth/callback');
    expect(authRequests).toHaveLength(0);
    expect(calls).toEqual([]);
  });

  it("signs in with the source's own client ID", async () => {
    const { ctx, authRequests } = createCtx({});
    const checked = withoutBuiltInApp(ctx);

    const result = await handleMicrosoftOAuthTrigger(ctx, { sourceSlug: 'outlook-own-app' });

    expect(result.isError).toBe(false);
    expect(checked).toEqual(['11111111-2222-4333-8444-555555555555']);
    expect(authRequests).toHaveLength(1);
    expect(authRequests[0]).toMatchObject({ type: 'oauth-microsoft', sourceSlug: 'outlook-own-app', service: 'outlook' });
  });
});

describe('Microsoft trigger: service or scopes', () => {
  it('signs in a source that sets only microsoftScopes', async () => {
    const { ctx, authRequests } = createCtx({});

    const result = await handleMicrosoftOAuthTrigger(ctx, { sourceSlug: 'graph-custom' });

    expect(result.isError).toBe(false);
    expect(authRequests).toHaveLength(1);
    expect(authRequests[0]).toMatchObject({ type: 'oauth-microsoft', sourceSlug: 'graph-custom' });
  });

  it('asks for a valid service or scopes when neither is set', async () => {
    const { ctx, authRequests } = createCtx({});

    const result = await handleMicrosoftOAuthTrigger(ctx, { sourceSlug: 'graph-unknown' });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("'microsoft-calendar'");
    expect(text(result)).toContain('microsoftScopes');
    expect(authRequests).toHaveLength(0);
  });

  it('refuses a microsoftService that does not exist, naming the valid ones', async () => {
    const { ctx, authRequests } = createCtx({});

    const result = await handleMicrosoftOAuthTrigger(ctx, { sourceSlug: 'graph-typo' });

    expect(result.isError).toBe(true);
    expect(text(result)).toBe(
      "[ERROR] Unknown microsoftService 'calendar' for source 'graph-typo'. Set microsoftService ('outlook', 'microsoft-calendar', 'onedrive', 'teams', or 'sharepoint') or microsoftScopes in api config.",
    );
    expect(authRequests).toHaveLength(0);
  });

  it('lets microsoftScopes win over a service that does not exist, as the sign-in does', async () => {
    const { ctx, authRequests } = createCtx({});

    const result = await handleMicrosoftOAuthTrigger(ctx, { sourceSlug: 'graph-typo-scopes' });

    expect(result.isError).toBe(false);
    expect(authRequests).toHaveLength(1);
    expect(authRequests[0]).toMatchObject({ type: 'oauth-microsoft', sourceSlug: 'graph-typo-scopes' });
    expect((authRequests[0] as { service?: string }).service).toBeUndefined();
  });
});
