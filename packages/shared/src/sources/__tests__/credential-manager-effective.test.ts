/**
 * Tests for SourceCredentialManager.loadEffective and the workspace-override
 * helpers. Covers the resolution matrix from docs/global-sources/03-credentials.md.
 *
 * The underlying CredentialManager is faked via mock.module so these tests
 * exercise the SourceCredentialManager logic in isolation, without touching
 * the real credential store backend.
 */

import { describe, test, expect, beforeEach, mock } from 'bun:test';
import type { CredentialId, StoredCredential } from '../../credentials/types.ts';

// In-memory fake credential store shared across the module under test.
// Keyed by `${type}::${workspaceId}::${sourceId}` to match the real key shape.
const fakeStore = new Map<string, StoredCredential>();

function keyOf(id: CredentialId): string {
  return `${id.type}::${id.workspaceId ?? ''}::${id.sourceId ?? ''}`;
}

const fakeCredentialManager = {
  get: async (id: CredentialId): Promise<StoredCredential | null> => {
    return fakeStore.get(keyOf(id)) ?? null;
  },
  set: async (id: CredentialId, cred: StoredCredential): Promise<void> => {
    fakeStore.set(keyOf(id), cred);
  },
  delete: async (id: CredentialId): Promise<boolean> => {
    return fakeStore.delete(keyOf(id));
  },
};

mock.module('../../credentials/index.ts', () => ({
  getCredentialManager: () => fakeCredentialManager,
}));

// Imports must come AFTER mock.module so the credential-manager module picks
// up the mocked dependency.
const { SourceCredentialManager } = await import('../credential-manager.ts');
const { GLOBAL_WORKSPACE_ID } = await import('../storage.ts');
import type { LoadedSource, FolderSourceConfig, SourceTier } from '../types.ts';

function makeSource(overrides: {
  workspaceId: string;
  tier: SourceTier;
  slug?: string;
  type?: 'mcp' | 'api';
  authType?: 'oauth' | 'bearer' | 'header';
}): LoadedSource {
  const slug = overrides.slug ?? 'notion';
  const type = overrides.type ?? 'mcp';
  return {
    config: {
      id: 'test-id',
      slug,
      name: 'Notion',
      type,
      enabled: true,
      ...(type === 'mcp'
        ? {
            mcp: {
              url: 'https://mcp.notion.com/',
              authType: overrides.authType === 'bearer' ? 'bearer' : 'oauth',
              transport: 'sse',
            },
          }
        : {
            api: {
              baseUrl: 'https://api.example.test/',
              authType: overrides.authType === 'header' ? 'header' : 'bearer',
              headerName: 'X-API-Key',
            },
          }),
    } as FolderSourceConfig,
    guide: null,
    folderPath: `/tmp/sources/${slug}`,
    workspaceRootPath: '/tmp/ws',
    workspaceId: overrides.workspaceId,
    tier: overrides.tier,
  };
}

describe('SourceCredentialManager.loadEffective', () => {
  let credManager: InstanceType<typeof SourceCredentialManager>;

  beforeEach(() => {
    fakeStore.clear();
    credManager = new SourceCredentialManager();
  });

  test('workspace-tier source returns workspace credential when set', async () => {
    const source = makeSource({ workspaceId: 'ws-A', tier: 'workspace' });
    await fakeCredentialManager.set(
      { type: 'source_oauth', workspaceId: 'ws-A', sourceId: 'notion' },
      { value: 'ws-token' },
    );

    const result = await credManager.loadEffective(source);
    expect(result?.value).toBe('ws-token');
  });

  test('workspace-tier source returns null when no workspace credential (no global fallback)', async () => {
    const source = makeSource({ workspaceId: 'ws-A', tier: 'workspace' });
    // Even if a global record exists, a workspace-tier source must NOT fall back to it.
    await fakeCredentialManager.set(
      { type: 'source_oauth', workspaceId: GLOBAL_WORKSPACE_ID, sourceId: 'notion' },
      { value: 'global-token' },
    );

    const result = await credManager.loadEffective(source);
    expect(result).toBeNull();
  });

  test('global-tier source returns workspace credential when set (workspace wins)', async () => {
    const source = makeSource({ workspaceId: 'ws-A', tier: 'global' });
    await fakeCredentialManager.set(
      { type: 'source_oauth', workspaceId: 'ws-A', sourceId: 'notion' },
      { value: 'ws-token' },
    );
    await fakeCredentialManager.set(
      { type: 'source_oauth', workspaceId: GLOBAL_WORKSPACE_ID, sourceId: 'notion' },
      { value: 'global-token' },
    );

    const result = await credManager.loadEffective(source);
    expect(result?.value).toBe('ws-token');
  });

  test('global-tier source falls back to global credential when no workspace record', async () => {
    const source = makeSource({ workspaceId: 'ws-A', tier: 'global' });
    await fakeCredentialManager.set(
      { type: 'source_oauth', workspaceId: GLOBAL_WORKSPACE_ID, sourceId: 'notion' },
      { value: 'global-token' },
    );

    const result = await credManager.loadEffective(source);
    expect(result?.value).toBe('global-token');
  });

  test('global-tier MCP source preserves bearer fallback inside global fallback', async () => {
    const source = makeSource({ workspaceId: 'ws-A', tier: 'global' });
    await fakeCredentialManager.set(
      { type: 'source_bearer', workspaceId: GLOBAL_WORKSPACE_ID, sourceId: 'notion' },
      { value: 'global-bearer-token' },
    );

    const result = await credManager.loadEffective(source);
    expect(result?.value).toBe('global-bearer-token');
  });

  test('global-tier source with override marker returns null (suppresses global fallback)', async () => {
    const source = makeSource({ workspaceId: 'ws-A', tier: 'global' });
    await fakeCredentialManager.set(
      { type: 'source_oauth', workspaceId: 'ws-A', sourceId: 'notion' },
      { value: null as unknown as string, override: true },
    );
    await fakeCredentialManager.set(
      { type: 'source_oauth', workspaceId: GLOBAL_WORKSPACE_ID, sourceId: 'notion' },
      { value: 'global-token' },
    );

    const result = await credManager.loadEffective(source);
    expect(result).toBeNull();
  });

  test('global-tier source with overridden creds returns the workspace record', async () => {
    const source = makeSource({ workspaceId: 'ws-A', tier: 'global' });
    await fakeCredentialManager.set(
      { type: 'source_oauth', workspaceId: 'ws-A', sourceId: 'notion' },
      { value: 'real-token', override: true },
    );
    await fakeCredentialManager.set(
      { type: 'source_oauth', workspaceId: GLOBAL_WORKSPACE_ID, sourceId: 'notion' },
      { value: 'global-token' },
    );

    const result = await credManager.loadEffective(source);
    expect(result?.value).toBe('real-token');
    expect(result?.override).toBe(true);
  });
});

describe('SourceCredentialManager runtime credential helpers', () => {
  let credManager: InstanceType<typeof SourceCredentialManager>;

  beforeEach(() => {
    fakeStore.clear();
    credManager = new SourceCredentialManager();
  });

  test('getToken uses workspace override before global fallback for activated globals', async () => {
    const source = makeSource({ workspaceId: 'ws-A', tier: 'global' });
    await fakeCredentialManager.set(
      { type: 'source_oauth', workspaceId: 'ws-A', sourceId: 'notion' },
      { value: 'workspace-token' },
    );
    await fakeCredentialManager.set(
      { type: 'source_oauth', workspaceId: GLOBAL_WORKSPACE_ID, sourceId: 'notion' },
      { value: 'global-token' },
    );

    await expect(credManager.getToken(source)).resolves.toBe('workspace-token');
  });

  test('getToken falls back to global credential for activated globals', async () => {
    const source = makeSource({ workspaceId: 'ws-A', tier: 'global' });
    await fakeCredentialManager.set(
      { type: 'source_oauth', workspaceId: GLOBAL_WORKSPACE_ID, sourceId: 'notion' },
      { value: 'global-token' },
    );

    await expect(credManager.getToken(source)).resolves.toBe('global-token');
  });

  test('getApiCredential falls back to global credential for activated global API sources', async () => {
    const source = makeSource({
      workspaceId: 'ws-A',
      tier: 'global',
      slug: 'custom-api',
      type: 'api',
      authType: 'header',
    });
    await fakeCredentialManager.set(
      { type: 'source_apikey', workspaceId: GLOBAL_WORKSPACE_ID, sourceId: 'custom-api' },
      { value: 'global-api-key' },
    );

    await expect(credManager.getApiCredential(source)).resolves.toBe('global-api-key');
  });

  test('getToken honors workspace override marker and suppresses global fallback', async () => {
    const source = makeSource({ workspaceId: 'ws-A', tier: 'global' });
    await fakeCredentialManager.set(
      { type: 'source_oauth', workspaceId: 'ws-A', sourceId: 'notion' },
      { value: null as unknown as string, override: true },
    );
    await fakeCredentialManager.set(
      { type: 'source_oauth', workspaceId: GLOBAL_WORKSPACE_ID, sourceId: 'notion' },
      { value: 'global-token' },
    );

    await expect(credManager.getToken(source)).resolves.toBeNull();
  });
});

describe('SourceCredentialManager.writeOverrideMarker / clearOverride', () => {
  let credManager: InstanceType<typeof SourceCredentialManager>;

  beforeEach(() => {
    fakeStore.clear();
    credManager = new SourceCredentialManager();
  });

  test('writeOverrideMarker rejects on workspace-tier sources', async () => {
    const source = makeSource({ workspaceId: 'ws-A', tier: 'workspace' });
    await expect(credManager.writeOverrideMarker(source)).rejects.toThrow(
      /global tier/i,
    );
  });

  test('writeOverrideMarker writes a suppression record at the workspace key', async () => {
    const source = makeSource({ workspaceId: 'ws-A', tier: 'global' });
    await credManager.writeOverrideMarker(source);

    const stored = await fakeCredentialManager.get({
      type: 'source_oauth',
      workspaceId: 'ws-A',
      sourceId: 'notion',
    });
    expect(stored?.override).toBe(true);
    expect(stored?.value).toBeNull();
  });

  test('clearOverride deletes the workspace record so loadEffective falls back to global', async () => {
    const source = makeSource({ workspaceId: 'ws-A', tier: 'global' });
    await fakeCredentialManager.set(
      { type: 'source_oauth', workspaceId: 'ws-A', sourceId: 'notion' },
      { value: 'work-token', override: true },
    );
    await fakeCredentialManager.set(
      { type: 'source_oauth', workspaceId: GLOBAL_WORKSPACE_ID, sourceId: 'notion' },
      { value: 'global-token' },
    );

    const deleted = await credManager.clearOverride(source);
    expect(deleted).toBe(true);

    const result = await credManager.loadEffective(source);
    expect(result?.value).toBe('global-token');
  });
});
