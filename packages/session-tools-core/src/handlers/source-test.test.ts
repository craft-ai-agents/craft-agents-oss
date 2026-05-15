import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { handleSourceTest } from './source-test.ts';
import type { SessionToolContext } from '../context.ts';
import type { SourceConfig } from '../types.ts';

type ActivateResult = Awaited<
  ReturnType<NonNullable<SessionToolContext['activateSourceInSession']>>
>;

interface CtxOverrides {
  activateSourceInSession?: (slug: string) => Promise<ActivateResult>;
  validateStdioMcpConnection?: SessionToolContext['validateStdioMcpConnection'];
  validateMcpConnection?: SessionToolContext['validateMcpConnection'];
  credentialManager?: SessionToolContext['credentialManager'];
}

function createCtx(workspacePath: string, overrides: CtxOverrides = {}): SessionToolContext {
  const saved: { last?: SourceConfig } = {};
  const ctx = {
    sessionId: 'test-session',
    workspacePath,
    get sourcesPath() {
      return join(workspacePath, 'sources');
    },
    get skillsPath() {
      return join(workspacePath, 'skills');
    },
    plansFolderPath: join(workspacePath, 'plans'),
    callbacks: {
      onPlanSubmitted: () => {},
      onAuthRequest: () => {},
    },
    fs: {
      exists: (path: string) => existsSync(path),
      readFile: (path: string) => readFileSync(path, 'utf-8'),
      readFileBuffer: (path: string) => readFileSync(path),
      writeFile: (path: string, content: string) => writeFileSync(path, content),
      isDirectory: (path: string) => existsSync(path) && statSync(path).isDirectory(),
      readdir: (path: string) => readdirSync(path),
      stat: (path: string) => {
        const s = statSync(path);
        return { size: s.size, isDirectory: () => s.isDirectory() };
      },
    },
    loadSourceConfig: (slug: string) => {
      const configPath = join(workspacePath, 'sources', slug, 'config.json');
      if (!existsSync(configPath)) return null;
      return JSON.parse(readFileSync(configPath, 'utf-8')) as SourceConfig;
    },
    saveSourceConfig: (source: SourceConfig) => {
      saved.last = source;
      const configPath = join(workspacePath, 'sources', source.slug, 'config.json');
      writeFileSync(configPath, JSON.stringify(source, null, 2));
    },
    // Stub the MCP validator so connection tests don't hit the network.
    validateStdioMcpConnection: overrides.validateStdioMcpConnection,
    validateMcpConnection: overrides.validateMcpConnection,
    credentialManager: overrides.credentialManager,
    activateSourceInSession: overrides.activateSourceInSession,
  } as unknown as SessionToolContext;
  // Expose saved for assertions (test-only — not on real ctx).
  (ctx as unknown as { _saved: typeof saved })._saved = saved;
  return ctx;
}

function writeSource(
  workspacePath: string,
  slug: string,
  overrides: Partial<SourceConfig> = {}
): void {
  const sourcePath = join(workspacePath, 'sources', slug);
  mkdirSync(sourcePath, { recursive: true });
  const config: SourceConfig = {
    id: slug,
    slug,
    name: `Test ${slug}`,
    enabled: true,
    provider: 'test',
    type: 'mcp',
    tagline: 'A test source',
    icon: '🧪',
    mcp: {
      transport: 'stdio',
      command: 'echo',
      args: ['ok'],
    },
    ...overrides,
  } as SourceConfig;
  writeFileSync(join(sourcePath, 'config.json'), JSON.stringify(config, null, 2));
  writeFileSync(
    join(sourcePath, 'guide.md'),
    '# Guide\n\nThis is a longer guide with more than fifty words so the validator does not warn about the guide being too short for the readability criteria the tool enforces when evaluating source completeness for this test suite which is only here to exercise the auto-enable flow and not the completeness check.'
  );
}

function stubMcpOk(): NonNullable<SessionToolContext['validateStdioMcpConnection']> {
  return async () => ({
    success: true,
    toolCount: 1,
    toolNames: ['dummy'],
    serverName: 'stub',
    serverVersion: '0.0.0',
  });
}

function stubMcpFail(): NonNullable<SessionToolContext['validateStdioMcpConnection']> {
  return async () => ({ success: false, error: 'boom' });
}

describe('source_test auto-enable', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'source-test-auto-enable-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('flips enabled: false → true and calls activation callback on clean run', async () => {
    writeSource(tempDir, 'craft-kb', { enabled: false });

    let activated: string | null = null as string | null;
    const ctx = createCtx(tempDir, {
      validateStdioMcpConnection: stubMcpOk(),
      activateSourceInSession: async (slug) => {
        activated = slug;
        return { ok: true, availability: 'next-turn' };
      },
    });

    const result = await handleSourceTest(ctx, { sourceSlug: 'craft-kb' });

    const text = result.content[0]?.text ?? '';
    expect(text).toContain('Source auto-enabled in config');
    expect(text).toContain('turn will auto-restart');
    expect(activated).toBe('craft-kb');

    const persisted = JSON.parse(
      readFileSync(join(tempDir, 'sources', 'craft-kb', 'config.json'), 'utf-8')
    ) as SourceConfig;
    expect(persisted.enabled).toBe(true);
  });

  it('already-enabled source still calls activation callback (session may be stale)', async () => {
    writeSource(tempDir, 'craft-kb', { enabled: true });

    let activated: string | null = null as string | null;
    const ctx = createCtx(tempDir, {
      validateStdioMcpConnection: stubMcpOk(),
      activateSourceInSession: async (slug) => {
        activated = slug;
        return { ok: true, availability: 'next-turn' };
      },
    });

    const result = await handleSourceTest(ctx, { sourceSlug: 'craft-kb' });
    const text = result.content[0]?.text ?? '';

    // No "auto-enabled in config" line because enabled was already true.
    expect(text).not.toContain('auto-enabled in config');
    expect(activated).toBe('craft-kb');
    expect(text).toContain('turn will auto-restart');
  });

  it('autoEnable: false skips both the flag flip and the activation callback', async () => {
    writeSource(tempDir, 'craft-kb', { enabled: false });

    let activated = false;
    const ctx = createCtx(tempDir, {
      validateStdioMcpConnection: stubMcpOk(),
      activateSourceInSession: async () => {
        activated = true;
        return { ok: true };
      },
    });

    await handleSourceTest(ctx, { sourceSlug: 'craft-kb', autoEnable: false });

    expect(activated).toBe(false);
    const persisted = JSON.parse(
      readFileSync(join(tempDir, 'sources', 'craft-kb', 'config.json'), 'utf-8')
    ) as SourceConfig;
    // saveSourceConfig still runs (metadata update), but enabled flag must remain false.
    expect(persisted.enabled).toBe(false);
  });

  it('validation errors skip auto-enable entirely (even when autoEnable is default)', async () => {
    writeSource(tempDir, 'broken', { enabled: false });

    let activated = false;
    const ctx = createCtx(tempDir, {
      validateStdioMcpConnection: stubMcpFail(),
      activateSourceInSession: async () => {
        activated = true;
        return { ok: true };
      },
    });

    const result = await handleSourceTest(ctx, { sourceSlug: 'broken' });
    const text = result.content[0]?.text ?? '';

    expect(result.isError).toBe(true);
    expect(activated).toBe(false);
    expect(text).not.toContain('auto-enabled in config');

    const persisted = JSON.parse(
      readFileSync(join(tempDir, 'sources', 'broken', 'config.json'), 'utf-8')
    ) as SourceConfig;
    expect(persisted.enabled).toBe(false);
  });

  it('without activateSourceInSession, flag flip still happens with restart hint', async () => {
    writeSource(tempDir, 'craft-kb', { enabled: false });

    const ctx = createCtx(tempDir, {
      validateStdioMcpConnection: stubMcpOk(),
      // activateSourceInSession intentionally undefined
    });

    const result = await handleSourceTest(ctx, { sourceSlug: 'craft-kb' });
    const text = result.content[0]?.text ?? '';

    expect(text).toContain('auto-enabled in config');
    expect(text).toContain('Restart session to load tools');

    const persisted = JSON.parse(
      readFileSync(join(tempDir, 'sources', 'craft-kb', 'config.json'), 'utf-8')
    ) as SourceConfig;
    expect(persisted.enabled).toBe(true);
  });

  it('activation failure shows warning but still persists enabled flag', async () => {
    writeSource(tempDir, 'craft-kb', { enabled: false });

    const ctx = createCtx(tempDir, {
      validateStdioMcpConnection: stubMcpOk(),
      activateSourceInSession: async () => ({ ok: false, reason: 'build failed' }),
    });

    const result = await handleSourceTest(ctx, { sourceSlug: 'craft-kb' });
    const text = result.content[0]?.text ?? '';

    expect(text).toContain('session activation failed: build failed');

    const persisted = JSON.parse(
      readFileSync(join(tempDir, 'sources', 'craft-kb', 'config.json'), 'utf-8')
    ) as SourceConfig;
    expect(persisted.enabled).toBe(true);
  });

  it('successful activation reports a single auto-restart message (backend-agnostic)', async () => {
    writeSource(tempDir, 'craft-kb', { enabled: true });

    const ctx = createCtx(tempDir, {
      validateStdioMcpConnection: stubMcpOk(),
      activateSourceInSession: async () => ({ ok: true, availability: 'next-turn' }),
    });

    const result = await handleSourceTest(ctx, { sourceSlug: 'craft-kb' });
    const text = result.content[0]?.text ?? '';

    // Both backends route through the same source_activated + auto_retry machinery
    // now, so the user-visible message is one line — no Claude vs Pi branching.
    expect(text).toContain('turn will auto-restart');
    expect(text).not.toContain('tools available now');
    expect(text).not.toContain('available on your next message');
  });
});

// ============================================================
// API connection-branch coverage (regression for #683)
// ============================================================
//
// These tests exercise the built-in fetch-based connection probe and the
// auto-enable gate that depends on its result. They drive global fetch via
// a swap-in stub so no network IO happens.

interface FetchCall {
  url: string;
  init?: RequestInit;
}

function installFetchStub(
  responder: (call: FetchCall) => Response | Promise<Response>
): { calls: FetchCall[]; restore: () => void } {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : String(input);
    const call: FetchCall = { url, init };
    calls.push(call);
    return responder(call);
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function writeApiSource(
  workspacePath: string,
  slug: string,
  overrides: Partial<SourceConfig> = {}
): void {
  const sourcePath = join(workspacePath, 'sources', slug);
  mkdirSync(sourcePath, { recursive: true });
  const config: SourceConfig = {
    id: slug,
    slug,
    name: slug,
    enabled: false,
    provider: 'test',
    type: 'api',
    tagline: 'A test API source',
    icon: '🧪',
    api: {
      baseUrl: 'https://api.example.test',
      authType: 'none',
    },
    ...overrides,
  } as SourceConfig;
  writeFileSync(join(sourcePath, 'config.json'), JSON.stringify(config, null, 2));
  writeFileSync(
    join(sourcePath, 'guide.md'),
    '# Guide\n\nThis is a longer guide with more than fifty words so the validator does not warn about the guide being too short for the readability criteria the tool enforces when evaluating source completeness for this test suite which is only here to exercise the connection-branch behavior.'
  );
}

describe('source_test API connection branches', () => {
  let tempDir: string;
  let restoreFetch: () => void = () => {};

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'source-test-api-conn-'));
  });

  afterEach(() => {
    restoreFetch();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('200 → connected, source auto-enabled, activation called', async () => {
    writeApiSource(tempDir, 'good-api');
    ({ restore: restoreFetch } = installFetchStub(() => new Response(null, { status: 200 })));

    let activated: string | null = null as string | null;
    const ctx = createCtx(tempDir, {
      activateSourceInSession: async (slug) => {
        activated = slug;
        return { ok: true, availability: 'next-turn' };
      },
    });

    const result = await handleSourceTest(ctx, { sourceSlug: 'good-api' });
    const text = result.content[0]?.text ?? '';

    expect(text).toContain('Validation passed');
    expect(text).not.toContain('Skipping activation');
    expect(activated).toBe('good-api');

    const persisted = JSON.parse(
      readFileSync(join(tempDir, 'sources', 'good-api', 'config.json'), 'utf-8')
    ) as SourceConfig;
    expect(persisted.enabled).toBe(true);
    expect(persisted.connectionStatus).toBe('connected');
  });

  it('500 → disconnected, NOT auto-enabled, activation NOT called', async () => {
    writeApiSource(tempDir, 'flaky-api');
    ({ restore: restoreFetch } = installFetchStub(() => new Response(null, { status: 500 })));

    let activated = false;
    const ctx = createCtx(tempDir, {
      activateSourceInSession: async () => {
        activated = true;
        return { ok: true };
      },
    });

    const result = await handleSourceTest(ctx, { sourceSlug: 'flaky-api' });
    const text = result.content[0]?.text ?? '';

    // The summary line must not be "✓ Validation passed" alone — it must be
    // the warnings variant, because the probe got a non-2xx the probe couldn't
    // classify as healthy.
    expect(text).toContain('Validation passed with warnings');
    expect(text).toContain('API returned 500');
    expect(text).toContain('Skipping activation');

    expect(activated).toBe(false);

    const persisted = JSON.parse(
      readFileSync(join(tempDir, 'sources', 'flaky-api', 'config.json'), 'utf-8')
    ) as SourceConfig;
    // The enabled flag must not be flipped on a failed probe.
    expect(persisted.enabled).toBe(false);
    expect(persisted.connectionStatus).toBe('disconnected');
  });

  it('404 → disconnected, NOT auto-enabled, activation NOT called', async () => {
    writeApiSource(tempDir, 'wrong-path-api');
    ({ restore: restoreFetch } = installFetchStub(() => new Response(null, { status: 404 })));

    let activated = false;
    const ctx = createCtx(tempDir, {
      activateSourceInSession: async () => {
        activated = true;
        return { ok: true };
      },
    });

    const result = await handleSourceTest(ctx, { sourceSlug: 'wrong-path-api' });
    const text = result.content[0]?.text ?? '';

    expect(text).toContain('Validation passed with warnings');
    expect(text).toContain('API returned 404');
    expect(text).toContain('Skipping activation');
    expect(activated).toBe(false);
  });

  it('401 → connected (auth-required), auto-enabled (refresh path runs)', async () => {
    // 401 from an unauthenticated probe is mapped to "reachable, needs auth".
    // The token-refresh case in checkAuthStatus relies on this — gating on
    // connectionStatus must not break it.
    writeApiSource(tempDir, 'auth-needed-api');
    ({ restore: restoreFetch } = installFetchStub(() => new Response(null, { status: 401 })));

    let activated: string | null = null as string | null;
    const ctx = createCtx(tempDir, {
      activateSourceInSession: async (slug) => {
        activated = slug;
        return { ok: true, availability: 'next-turn' };
      },
    });

    const result = await handleSourceTest(ctx, { sourceSlug: 'auth-needed-api' });
    const text = result.content[0]?.text ?? '';

    expect(text).not.toContain('Skipping activation');
    expect(activated).toBe('auth-needed-api');

    const persisted = JSON.parse(
      readFileSync(join(tempDir, 'sources', 'auth-needed-api', 'config.json'), 'utf-8')
    ) as SourceConfig;
    expect(persisted.enabled).toBe(true);
    expect(persisted.connectionStatus).toBe('connected');
  });

  it('basic probe honors testEndpoint.method (no HEAD→GET fallback dance)', async () => {
    // Regression for the HEAD→GET-on-405 fallback that silently passed POST-only
    // endpoints. With a configured method, the basic probe must call it directly.
    writeApiSource(tempDir, 'post-only-api', {
      api: {
        baseUrl: 'https://api.example.test',
        authType: 'none',
        testEndpoint: { method: 'POST', path: '/v1/things' },
      },
    } as Partial<SourceConfig>);

    let stub: ReturnType<typeof installFetchStub>;
    stub = installFetchStub(() => new Response(null, { status: 200 }));
    restoreFetch = stub.restore;

    await handleSourceTest(ctx_for(tempDir), { sourceSlug: 'post-only-api' });

    expect(stub.calls.length).toBe(1);
    expect(stub.calls[0]?.init?.method).toBe('POST');
    expect(stub.calls[0]?.url).toBe('https://api.example.test/v1/things');
  });
});

// Tiny helper to build a no-callback ctx for tests that don't care about activation.
function ctx_for(workspacePath: string) {
  return createCtx(workspacePath, {
    activateSourceInSession: async () => ({ ok: true }),
  });
}

// ============================================================
// HTTP MCP probe — credential resolution (regression for #720)
// ============================================================
//
// The probe must forward the same auth token the live runtime would resolve:
// - cached token first
// - refresh fallback only on miss
// - works for `oauth` AND `bearer` whose token lives in the credential store
// - existing `headerNames` flow still merges credential headers, accessToken
//   stays undefined (regression guard).

type ValidateMcpCall = Parameters<NonNullable<SessionToolContext['validateMcpConnection']>>[0];

function writeHttpMcpSource(
  workspacePath: string,
  slug: string,
  overrides: Partial<SourceConfig> = {}
): void {
  const sourcePath = join(workspacePath, 'sources', slug);
  mkdirSync(sourcePath, { recursive: true });
  const config: SourceConfig = {
    id: slug,
    slug,
    name: slug,
    enabled: true,
    provider: 'test',
    type: 'mcp',
    tagline: 'A test HTTP MCP source',
    icon: '🧪',
    mcp: {
      transport: 'http',
      url: 'https://mcp.example.test',
      authType: 'oauth',
    },
    ...overrides,
  } as SourceConfig;
  writeFileSync(join(sourcePath, 'config.json'), JSON.stringify(config, null, 2));
  writeFileSync(
    join(sourcePath, 'guide.md'),
    '# Guide\n\nThis is a longer guide with more than fifty words so the validator does not warn about the guide being too short for the readability criteria the tool enforces when evaluating source completeness for this test suite which is only here to exercise the probe credential resolution behavior.'
  );
}

interface CredManagerStub {
  manager: NonNullable<SessionToolContext['credentialManager']>;
  getTokenCalls: number;
  refreshCalls: number;
}

function makeCredentialManager({
  cachedToken,
  refreshedToken,
}: {
  cachedToken?: string | null;
  refreshedToken?: string | null;
}): CredManagerStub {
  const stub: CredManagerStub = {
    manager: {
      hasValidCredentials: async () => Boolean(cachedToken),
      getToken: async () => {
        stub.getTokenCalls += 1;
        return cachedToken ?? null;
      },
      refresh: async () => {
        stub.refreshCalls += 1;
        return refreshedToken ?? null;
      },
    },
    getTokenCalls: 0,
    refreshCalls: 0,
  };
  return stub;
}

describe('source_test HTTP MCP probe credential forwarding (regression for #720)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'source-test-mcp-cred-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('OAuth MCP with cached token forwards accessToken to the probe (no refresh)', async () => {
    writeHttpMcpSource(tempDir, 'oauth-cached', {
      mcp: {
        transport: 'http',
        url: 'https://mcp.example.test',
        authType: 'oauth',
      },
    } as Partial<SourceConfig>);

    const cred = makeCredentialManager({ cachedToken: 'cached-tok' });
    const calls: ValidateMcpCall[] = [];
    const ctx = createCtx(tempDir, {
      credentialManager: cred.manager,
      validateMcpConnection: async (config) => {
        calls.push(config);
        return { success: true, toolCount: 2 };
      },
    });

    const result = await handleSourceTest(ctx, { sourceSlug: 'oauth-cached', autoEnable: false });

    expect(result.isError).toBeFalsy();
    expect(calls.length).toBe(1);
    expect(calls[0]?.accessToken).toBe('cached-tok');
    expect(cred.getTokenCalls).toBe(1);
    expect(cred.refreshCalls).toBe(0);

    const persisted = JSON.parse(
      readFileSync(join(tempDir, 'sources', 'oauth-cached', 'config.json'), 'utf-8')
    ) as SourceConfig;
    expect(persisted.connectionStatus).toBe('connected');
  });

  it('OAuth MCP without cached token falls back to refresh and forwards the fresh token', async () => {
    writeHttpMcpSource(tempDir, 'oauth-refresh', {
      mcp: {
        transport: 'http',
        url: 'https://mcp.example.test',
        authType: 'oauth',
      },
    } as Partial<SourceConfig>);

    const cred = makeCredentialManager({ cachedToken: null, refreshedToken: 'fresh-tok' });
    const calls: ValidateMcpCall[] = [];
    const ctx = createCtx(tempDir, {
      credentialManager: cred.manager,
      validateMcpConnection: async (config) => {
        calls.push(config);
        return { success: true };
      },
    });

    await handleSourceTest(ctx, { sourceSlug: 'oauth-refresh', autoEnable: false });

    expect(calls.length).toBe(1);
    expect(calls[0]?.accessToken).toBe('fresh-tok');
    expect(cred.getTokenCalls).toBe(1);
    expect(cred.refreshCalls).toBe(1);
  });

  it('Bearer MCP without headerNames forwards accessToken (defense-in-depth)', async () => {
    writeHttpMcpSource(tempDir, 'bearer-cached', {
      mcp: {
        transport: 'http',
        url: 'https://mcp.example.test',
        authType: 'bearer',
      },
    } as Partial<SourceConfig>);

    const cred = makeCredentialManager({ cachedToken: 'bearer-tok' });
    const calls: ValidateMcpCall[] = [];
    const ctx = createCtx(tempDir, {
      credentialManager: cred.manager,
      validateMcpConnection: async (config) => {
        calls.push(config);
        return { success: true };
      },
    });

    await handleSourceTest(ctx, { sourceSlug: 'bearer-cached', autoEnable: false });

    expect(calls.length).toBe(1);
    expect(calls[0]?.accessToken).toBe('bearer-tok');
    expect(cred.getTokenCalls).toBe(1);
    expect(cred.refreshCalls).toBe(0);
  });

  it('headerNames flow still merges credential headers, accessToken stays undefined', async () => {
    // Multi-header credential — credential value is a JSON object keyed by header name.
    writeHttpMcpSource(tempDir, 'header-style', {
      mcp: {
        transport: 'http',
        url: 'https://mcp.example.test',
        headerNames: ['X-Api-Key'],
      },
    } as Partial<SourceConfig>);

    const cred = makeCredentialManager({ cachedToken: JSON.stringify({ 'X-Api-Key': 'k1' }) });
    const calls: ValidateMcpCall[] = [];
    const ctx = createCtx(tempDir, {
      credentialManager: cred.manager,
      validateMcpConnection: async (config) => {
        calls.push(config);
        return { success: true };
      },
    });

    await handleSourceTest(ctx, { sourceSlug: 'header-style', autoEnable: false });

    expect(calls.length).toBe(1);
    expect(calls[0]?.headers).toEqual({ 'X-Api-Key': 'k1' });
    expect(calls[0]?.accessToken).toBeUndefined();
    expect(cred.refreshCalls).toBe(0);
  });
});
