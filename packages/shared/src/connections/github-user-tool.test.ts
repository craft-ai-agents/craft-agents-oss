import { afterEach, describe, expect, it } from 'bun:test';
import { CredentialRefRegistry } from '@craft-agent/core/platform';
import type { CredentialBackend } from '../credentials/backends/types.ts';
import type { CredentialId, StoredCredential } from '../credentials/types.ts';
import { credentialIdToAccount } from '../credentials/types.ts';
import {
  createProviderMaterialization,
  InProcessCredentialBroker,
  LocalFileSecretProvider,
} from '../credentials/index.ts';
import {
  executeGithubUserTool,
  getGithubUserToolHost,
  performGithubUser,
  setGithubUserToolHost,
  type GithubUserConnection,
  type GithubUserFetch,
} from './github-user-tool.ts';

class MemoryBackend implements CredentialBackend {
  readonly name = 'memory';
  readonly priority = 1;
  readonly store = new Map<string, StoredCredential>();
  async isAvailable(): Promise<boolean> { return true; }
  async get(id: CredentialId): Promise<StoredCredential | null> {
    return this.store.get(credentialIdToAccount(id)) ?? null;
  }
  async set(id: CredentialId, credential: StoredCredential): Promise<void> {
    this.store.set(credentialIdToAccount(id), credential);
  }
  async delete(id: CredentialId): Promise<boolean> {
    return this.store.delete(credentialIdToAccount(id));
  }
  async list(): Promise<CredentialId[]> { return []; }
}

afterEach(() => {
  setGithubUserToolHost(undefined);
});

describe('github_user tool', () => {
  it('throws github_tool_unavailable when host is missing', async () => {
    expect(getGithubUserToolHost()).toBeUndefined();
    await expect(executeGithubUserTool({
      workspaceId: 'ws',
      connectionId: 'conn',
    })).rejects.toThrow('github_tool_unavailable');
  });

  it('returns only { login } via broker.perform and never leaks the token', async () => {
    const registry = new CredentialRefRegistry();
    const provider = new LocalFileSecretProvider(new MemoryBackend(), registry);
    const written = await provider.write({
      kind: 'bearer_token',
      locator: { type: 'local', key: 'github/default' },
      payload: { value: 'super-secret-token' },
    });

    const connection: GithubUserConnection = {
      id: 'conn_github',
      workspaceId: 'ws_a',
      integrationId: 'github',
      credentialRefId: written.ref.id,
    };

    const broker = new InProcessCredentialBroker(provider, (id) => registry.get(id));
    broker.grant({
      workspaceId: 'ws_a',
      consumerId: 'agent-github',
      credentialRefId: written.ref.id,
      actions: ['github.api'],
      resources: ['github:user'],
    });

    const seenAuth: string[] = [];
    const fetchImpl: GithubUserFetch = async (url, init) => {
      expect(url).toBe('https://api.github.com/user');
      seenAuth.push(init?.headers?.Authorization ?? '');
      return new Response(JSON.stringify({ login: 'octocat', email: 'hidden@example.com' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    setGithubUserToolHost({
      getKernel: () => ({
        getConnection: async () => connection,
      }),
      getBroker: () => broker,
      getProvider: () => provider,
      fetchImpl,
    });

    const result = await executeGithubUserTool({
      workspaceId: 'ws_a',
      connectionId: 'conn_github',
      consumerId: 'agent-github',
    });

    expect(result).toEqual({ login: 'octocat' });
    expect(Object.keys(result)).toEqual(['login']);
    expect(seenAuth[0]).toBe('Bearer super-secret-token');
    expect(JSON.stringify(result)).not.toContain('super-secret-token');
    expect(result).not.toHaveProperty('value');
    expect(result).not.toHaveProperty('token');
  });

  it('rejects non-github connections', async () => {
    const registry = new CredentialRefRegistry();
    const provider = new LocalFileSecretProvider(new MemoryBackend(), registry);
    const written = await provider.write({
      kind: 'bearer_token',
      locator: { type: 'local', key: 'other/default' },
      payload: { value: 'super-secret-token' },
    });
    const broker = new InProcessCredentialBroker(provider, (id) => registry.get(id));

    setGithubUserToolHost({
      getKernel: () => ({
        getConnection: async () => ({
          id: 'conn_other',
          workspaceId: 'ws_a',
          integrationId: 'slack',
          credentialRefId: written.ref.id,
        }),
      }),
      getBroker: () => broker,
      getProvider: () => provider,
      fetchImpl: async () => new Response('{}'),
    });

    await expect(executeGithubUserTool({
      workspaceId: 'ws_a',
      connectionId: 'conn_other',
    })).rejects.toThrow('unsupported_integration');
  });

  it('performGithubUser returns login only', async () => {
    const materialization = createProviderMaterialization(
      'cred_test' as never,
      'bearer_token',
      { value: 'tok' },
    );
    const result = await performGithubUser(materialization, async (_url, init) => {
      expect(init?.headers?.Authorization).toBe('Bearer tok');
      return new Response(JSON.stringify({ login: 'hubot' }));
    });
    expect(result).toEqual({ login: 'hubot' });
    expect(JSON.stringify(result)).not.toContain('tok');
  });
});
