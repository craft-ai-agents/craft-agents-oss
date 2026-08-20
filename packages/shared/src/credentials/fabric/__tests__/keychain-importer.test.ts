import { describe, expect, it } from 'bun:test';
import { CredentialRefRegistry } from '@craft-agent/core/platform';
import type { CredentialBackend } from '../../backends/types.ts';
import type { CredentialId, StoredCredential } from '../../types.ts';
import { credentialIdToAccount } from '../../types.ts';
import type { CredentialImporter } from '../types.ts';
import { LocalFileSecretProvider } from '../local-file-provider.ts';
import {
  KeychainImporter,
  type KeychainGet,
  type KeychainList,
} from '../keychain-importer.ts';

const SECRET = 'keychain-super-secret';

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

function createImporter(list?: KeychainList, get?: KeychainGet) {
  const provider = new LocalFileSecretProvider(new MemoryBackend(), new CredentialRefRegistry());
  const importer = new KeychainImporter({
    provider,
    list: list ?? (() => [{ service: 'github.com', account: 'octocat' }]),
    get: get ?? (() => ({ password: SECRET })),
  });
  return { importer, provider };
}

describe('CF-9.5 KeychainImporter', () => {
  it('implements CredentialImporter', () => {
    const typed: CredentialImporter = createImporter().importer;
    expect(typed.id).toBe('macos-keychain');
    expect(typed.sourceKind).toBe('keychain');
  });

  it('discovers service/account metadata without passwords', async () => {
    const { importer } = createImporter();
    const candidates = await importer.discover();
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.locator).toBe('github.com/octocat');
    expect(JSON.stringify(candidates)).not.toContain(SECRET);
    expect(candidates[0]).not.toHaveProperty('password');
  });

  it('does not call get during discover', async () => {
    let gets = 0;
    const { importer } = createImporter(
      () => [{ service: 'gh', account: 'me' }],
      () => {
        gets += 1;
        return { password: SECRET };
      },
    );
    await importer.discover();
    expect(gets).toBe(0);
  });

  it('masks preview and commits a copy without leaking the password', async () => {
    const { importer, provider } = createImporter();
    const [candidate] = await importer.discover();
    if (!candidate) throw new Error('expected candidate');
    const preview = await importer.preview({ candidateId: candidate.id });
    expect(preview.maskedSummary).not.toContain(SECRET);
    const committed = await importer.commit({
      candidateId: candidate.id,
      targetProviderId: 'local-file',
      mode: 'copy',
      workspaceId: 'w',
      requestedBy: 'test',
    });
    const material = await provider.resolveForLease({
      credentialRef: {
        id: committed.credentialRefId,
        kind: 'bearer_token',
        providerId: 'local-file',
        locator: { type: 'keychain', service: 'github.com', account: 'octocat' },
        createdAt: 0,
        updatedAt: 0,
      },
    });
    expect(material.payload.value).toBe(SECRET);
    expect(JSON.stringify(material)).not.toContain(SECRET);
  });

  it('rejects unknown candidates and empty listings', async () => {
    expect(await createImporter(() => []).importer.discover()).toEqual([]);
    const { importer } = createImporter();
    await importer.discover();
    await expect(importer.preview({ candidateId: 'missing' })).rejects.toThrow();
  });
});
