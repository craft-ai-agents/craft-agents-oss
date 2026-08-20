import { describe, expect, it } from 'bun:test';
import { CredentialRefRegistry } from '@craft-agent/core/platform';
import type { CredentialBackend } from '../../backends/types.ts';
import type { CredentialId, StoredCredential } from '../../types.ts';
import { credentialIdToAccount } from '../../types.ts';
import type { CredentialImporter } from '../types.ts';
import { LocalFileSecretProvider } from '../local-file-provider.ts';
import { SshAgentImporter, type SshAgentList } from '../ssh-agent-importer.ts';

const PRIVATE = '-----BEGIN OPENSSH PRIVATE KEY-----\\nsuper-secret-ssh\\n-----END OPENSSH PRIVATE KEY-----';

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

function createImporter(list?: SshAgentList) {
  const provider = new LocalFileSecretProvider(new MemoryBackend(), new CredentialRefRegistry());
  const importer = new SshAgentImporter({
    provider,
    list: list ?? (() => [{ comment: 'git@github.com', fingerprint: 'SHA256:abcd1234' }]),
  });
  return { importer, provider };
}

describe('CF-9.7 SshAgentImporter', () => {
  it('implements CredentialImporter', () => {
    const typed: CredentialImporter = createImporter().importer;
    expect(typed.id).toBe('ssh-agent');
    expect(typed.sourceKind).toBe('ssh-agent');
  });

  it('discovers comment and fingerprint without private key material', async () => {
    let calls = 0;
    const { importer } = createImporter(() => {
      calls += 1;
      return [{ comment: 'git@github.com', fingerprint: 'SHA256:abcd1234', privateKey: PRIVATE }];
    });
    const candidates = await importer.discover();
    expect(calls).toBe(1);
    expect(candidates[0]?.kind).toBe('ssh_agent_identity');
    expect(candidates[0]?.locator).toBe('SHA256:abcd1234');
    expect(JSON.stringify(candidates)).toContain('git@github.com');
    expect(JSON.stringify(candidates)).not.toContain('super-secret-ssh');
    expect(candidates[0]).not.toHaveProperty('privateKey');
  });

  it('previews a masked fingerprint and commits a reference handle', async () => {
    const { importer, provider } = createImporter();
    const [candidate] = await importer.discover();
    if (!candidate) throw new Error('expected candidate');
    const preview = await importer.preview({ candidateId: candidate.id });
    expect(preview.maskedSummary).toContain('SHA256');
    expect(preview.proposedMode).toBe('reference');
    const committed = await importer.commit({
      candidateId: candidate.id,
      targetProviderId: 'local-file',
      mode: 'reference',
      workspaceId: 'w',
      requestedBy: 'test',
    });
    const inspect = await provider.inspect({
      id: committed.credentialRefId,
      kind: 'ssh_agent_identity',
      providerId: 'local-file',
      locator: { type: 'local', key: candidate.conflictKey },
      createdAt: 0,
      updatedAt: 0,
    });
    expect(inspect.status === 'missing' || inspect.status === 'active').toBe(true);
    expect(JSON.stringify(inspect)).not.toContain('super-secret-ssh');
  });

  it('returns nothing when the agent lists no identities', async () => {
    expect(await createImporter(() => []).importer.discover()).toEqual([]);
  });
});
