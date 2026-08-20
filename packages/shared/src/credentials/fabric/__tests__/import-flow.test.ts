import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialRefRegistry } from '@craft-agent/core/platform';
import type { CredentialBackend } from '../../backends/types.ts';
import type { CredentialId, StoredCredential } from '../../types.ts';
import { credentialIdToAccount } from '../../types.ts';
import { LocalFileSecretProvider } from '../local-file-provider.ts';
import { CredentialsEncImporter, EnvFileImporter } from '../importers.ts';

class MemoryBackend implements CredentialBackend {
  readonly name = 'memory';
  readonly priority = 1;
  readonly store = new Map<string, StoredCredential>();

  async isAvailable(): Promise<boolean> {
    return true;
  }
  async get(id: CredentialId): Promise<StoredCredential | null> {
    return this.store.get(credentialIdToAccount(id)) ?? null;
  }
  async set(id: CredentialId, credential: StoredCredential): Promise<void> {
    this.store.set(credentialIdToAccount(id), credential);
  }
  async delete(id: CredentialId): Promise<boolean> {
    return this.store.delete(credentialIdToAccount(id));
  }
  async list(): Promise<CredentialId[]> {
    return [...this.store.keys()].map((key) => {
      const [type, workspaceId, sourceId] = key.split('::');
      return { type: type as CredentialId['type'], workspaceId, sourceId };
    });
  }
}

describe('CF-3 local import flow', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('discovers enc metadata without leaking the secret', async () => {
    const backend = new MemoryBackend();
    const id: CredentialId = { type: 'source_bearer', workspaceId: 'w', sourceId: 's' };
    await backend.set(id, { value: 'super-secret' });
    const importer = new CredentialsEncImporter(backend, new LocalFileSecretProvider(backend, new CredentialRefRegistry()));
    const candidates = await importer.discover();
    expect(candidates).toHaveLength(1);
    expect(JSON.stringify(candidates)).not.toContain('super-secret');
  });

  it('discovers env names only and masks preview', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cf3-env-'));
    dirs.push(dir);
    const envPath = join(dir, '.env');
    writeFileSync(envPath, 'GH_TOKEN=super-secret\nNOTE=$UNEXPANDED\nbroken\n');
    const backend = new MemoryBackend();
    const importer = new EnvFileImporter(envPath, new LocalFileSecretProvider(backend, new CredentialRefRegistry()));
    const candidates = await importer.discover();
    expect(candidates.map((c) => c.label).sort()).toEqual(['GH_TOKEN', 'NOTE']);
    expect(JSON.stringify(candidates)).not.toContain('super-secret');
    const preview = await importer.preview({ candidateId: 'GH_TOKEN' });
    expect(preview.maskedSummary).not.toContain('super-secret');
    expect(preview.maskedSummary.endsWith('cret') || preview.maskedSummary === '****').toBe(true);
    expect(await importer.discover()).toHaveLength(2);
    expect((await importer.validate({
      candidateId: 'GH_TOKEN',
      targetProviderId: 'local-file',
      mode: 'mirror',
      workspaceId: 'w',
      requestedBy: 'test',
    })).ok).toBe(false);
  });

  it('commits a copy, reuses fingerprint, and rolls back without deleting source', async () => {
    const source = new MemoryBackend();
    const dest = new MemoryBackend();
    const id: CredentialId = { type: 'source_bearer', workspaceId: 'w', sourceId: 's' };
    await source.set(id, { value: 'super-secret' });
    const provider = new LocalFileSecretProvider(dest, new CredentialRefRegistry());
    const importer = new CredentialsEncImporter(source, provider);
    const [candidate] = await importer.discover();
    if (!candidate) throw new Error('expected candidate');
    const first = await importer.commit({
      candidateId: candidate.id,
      targetProviderId: 'local-file',
      mode: 'copy',
      workspaceId: 'w',
      requestedBy: 'test',
    });
    const second = await importer.commit({
      candidateId: candidate.id,
      targetProviderId: 'local-file',
      mode: 'copy',
      workspaceId: 'w',
      requestedBy: 'test',
    });
    expect(second.credentialRefId).toBe(first.credentialRefId);
    const material = await provider.resolveForLease({
      credentialRef: {
        id: first.credentialRefId,
        kind: 'bearer_token',
        providerId: 'local-file',
        locator: { type: 'local', key: candidate.conflictKey },
        createdAt: 0,
        updatedAt: 0,
      },
    });
    expect(material.payload.value).toBe('super-secret');
    expect(JSON.stringify(material)).not.toContain('super-secret');
    await importer.rollback({ credentialRefId: first.credentialRefId });
    expect(await source.get(id)).toEqual({ value: 'super-secret' });
    const inspected = await provider.inspect({
      id: first.credentialRefId,
      kind: 'bearer_token',
      providerId: 'local-file',
      locator: { type: 'local', key: candidate.conflictKey },
      createdAt: 0,
      updatedAt: 0,
    });
    expect(inspected.status).toBe('missing');
  });

  it('returns no env candidates when the file is missing', async () => {
    const importer = new EnvFileImporter(
      join(tmpdir(), 'cf3-missing.env'),
      new LocalFileSecretProvider(new MemoryBackend(), new CredentialRefRegistry()),
    );
    expect(await importer.discover()).toEqual([]);
    await importer.rollback();
  });
});
