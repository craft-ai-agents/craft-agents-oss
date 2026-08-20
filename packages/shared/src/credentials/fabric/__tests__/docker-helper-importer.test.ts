import { describe, expect, it } from 'bun:test';
import { CredentialRefRegistry } from '@craft-agent/core/platform';
import type { CredentialBackend } from '../../backends/types.ts';
import type { CredentialId, StoredCredential } from '../../types.ts';
import { credentialIdToAccount } from '../../types.ts';
import type { CredentialImporter } from '../types.ts';
import { LocalFileSecretProvider } from '../local-file-provider.ts';
import {
  DockerCredentialHelperImporter,
  type DockerCredentialHelperGet,
} from '../docker-helper-importer.ts';

const SECRET = 'dckr_pat_super-secret';
const AUTH_BLOB = Buffer.from(`octocat:${SECRET}`).toString('base64');

const DOCKER_CONFIG = JSON.stringify({
  auths: {
    'https://index.docker.io/v1/': { auth: AUTH_BLOB },
    'ghcr.io': {},
  },
  credsStore: 'desktop',
  credHelpers: {
    'gcr.io': 'gcloud',
  },
}, null, 2);

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

function createImporter(
  configText: string,
  get?: DockerCredentialHelperGet,
): { importer: DockerCredentialHelperImporter; provider: LocalFileSecretProvider } {
  const provider = new LocalFileSecretProvider(new MemoryBackend(), new CredentialRefRegistry());
  const importer = new DockerCredentialHelperImporter({ configText, provider, get });
  return { importer, provider };
}

function leakHaystack(value: unknown): string {
  return JSON.stringify(value);
}

describe('CF-9.2 DockerCredentialHelperImporter', () => {
  it('implements CredentialImporter', () => {
    const { importer } = createImporter(DOCKER_CONFIG);
    const typed: CredentialImporter = importer;
    expect(typed.id).toBe('docker-credential-helper');
    expect(typed.sourceKind).toBe('docker-config');
  });

  it('discovers helper and registry metadata without secrets or auth blobs', async () => {
    const { importer } = createImporter(DOCKER_CONFIG);
    const candidates = await importer.discover();
    expect(candidates.length).toBeGreaterThanOrEqual(3);
    const haystack = leakHaystack(candidates);
    expect(haystack).toContain('index.docker.io');
    expect(haystack).toContain('ghcr.io');
    expect(haystack).toContain('gcr.io');
    expect(haystack).toContain('desktop');
    expect(haystack).toContain('gcloud');
    expect(haystack).not.toContain(SECRET);
    expect(haystack).not.toContain(AUTH_BLOB);
    expect(haystack).not.toContain('"auth"');
    for (const candidate of candidates) {
      expect(candidate.kind).toBe('basic_auth');
      expect(candidate.sourceId).toBe('docker-credential-helper');
      expect(candidate).not.toHaveProperty('Secret');
      expect(candidate).not.toHaveProperty('password');
    }
  });

  it('does not call the helper during discover', async () => {
    let calls = 0;
    const get: DockerCredentialHelperGet = async () => {
      calls += 1;
      return { Username: 'octocat', Secret: SECRET };
    };
    const { importer } = createImporter(DOCKER_CONFIG, get);
    const candidates = await importer.discover();
    expect(calls).toBe(0);
    expect(leakHaystack(candidates)).not.toContain(SECRET);
  });

  it('masks preview and never returns the helper secret', async () => {
    const get: DockerCredentialHelperGet = (query) => {
      expect(query.helper).toBe('desktop');
      expect(query.serverUrl).toContain('docker.io');
      return { Username: 'octocat', Secret: SECRET };
    };
    const { importer } = createImporter(DOCKER_CONFIG, get);
    const candidates = await importer.discover();
    const dockerHub = candidates.find((c) => c.locator?.includes('docker.io'));
    if (!dockerHub) throw new Error('expected docker hub candidate');
    const preview = await importer.preview({ candidateId: dockerHub.id });
    expect(preview.proposedMode).toBe('copy');
    expect(preview.maskedSummary).not.toContain(SECRET);
    expect(preview.maskedSummary.endsWith('cret') || preview.maskedSummary === '****').toBe(true);
    expect(leakHaystack(preview)).not.toContain(SECRET);
  });

  it('commits copy through LocalFileSecretProvider using the injected helper', async () => {
    const get: DockerCredentialHelperGet = () => ({ Username: 'octocat', Secret: SECRET });
    const { importer, provider } = createImporter(DOCKER_CONFIG, get);
    const candidates = await importer.discover();
    const gcr = candidates.find((c) => c.locator === 'gcr.io');
    if (!gcr) throw new Error('expected gcr candidate');
    const committed = await importer.commit({
      candidateId: gcr.id,
      targetProviderId: 'local-file',
      mode: 'copy',
      workspaceId: 'w',
      requestedBy: 'test',
    });
    expect(committed.credentialRefId.startsWith('cred_')).toBe(true);
    const material = await provider.resolveForLease({
      credentialRef: {
        id: committed.credentialRefId,
        kind: 'basic_auth',
        providerId: 'local-file',
        locator: { type: 'local', key: gcr.conflictKey },
        createdAt: 0,
        updatedAt: 0,
      },
    });
    expect(material.payload.value).toContain(SECRET);
    expect(leakHaystack(material)).not.toContain(SECRET);
    await importer.rollback({ credentialRefId: committed.credentialRefId });
  });

  it('rejects unsupported modes, unknown candidates, and empty config', async () => {
    expect(await createImporter('').importer.discover()).toEqual([]);
    expect(await createImporter('{').importer.discover()).toEqual([]);
    const populated = createImporter(DOCKER_CONFIG).importer;
    const [candidate] = await populated.discover();
    if (!candidate) throw new Error('expected candidate');
    expect(
      (
        await populated.validate({
          candidateId: candidate.id,
          targetProviderId: 'local-file',
          mode: 'mirror',
          workspaceId: 'w',
          requestedBy: 'test',
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await populated.validate({
          candidateId: 'missing',
          targetProviderId: 'local-file',
          mode: 'copy',
          workspaceId: 'w',
          requestedBy: 'test',
        })
      ).ok,
    ).toBe(false);
    await expect(populated.preview({ candidateId: 'missing' })).rejects.toThrow();
  });
});
