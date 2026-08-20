import { describe, expect, it } from 'bun:test';
import { CredentialRefRegistry } from '@craft-agent/core/platform';
import type { CredentialBackend } from '../../backends/types.ts';
import type { CredentialId, StoredCredential } from '../../types.ts';
import { credentialIdToAccount } from '../../types.ts';
import type { CredentialImporter } from '../types.ts';
import { LocalFileSecretProvider } from '../local-file-provider.ts';
import { GoogleAdcImporter } from '../adc-importer.ts';

const PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\\nsuper-secret-adc\\n-----END PRIVATE KEY-----\\n';

const ADC = JSON.stringify({
  type: 'service_account',
  project_id: 'demo-proj',
  private_key_id: 'abc123',
  private_key: PRIVATE_KEY,
  client_email: 'bot@demo-proj.iam.gserviceaccount.com',
  client_id: '1234567890',
});

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

function createImporter(text = ADC) {
  const provider = new LocalFileSecretProvider(new MemoryBackend(), new CredentialRefRegistry());
  return { importer: new GoogleAdcImporter({ provider, credentialsText: text }), provider };
}

describe('CF-9.6 GoogleAdcImporter', () => {
  it('implements CredentialImporter', () => {
    const typed: CredentialImporter = createImporter().importer;
    expect(typed.id).toBe('google-adc');
    expect(typed.sourceKind).toBe('adc');
  });

  it('discovers email and project without the private key', async () => {
    const { importer } = createImporter();
    const candidates = await importer.discover();
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.kind).toBe('gcp_adc');
    expect(candidates[0]?.locator).toBe('bot@demo-proj.iam.gserviceaccount.com');
    expect(JSON.stringify(candidates)).toContain('demo-proj');
    expect(JSON.stringify(candidates)).not.toContain('super-secret-adc');
    expect(candidates[0]).not.toHaveProperty('private_key');
  });

  it('masks preview and commits a copy without leaking the private key', async () => {
    const { importer, provider } = createImporter();
    const [candidate] = await importer.discover();
    if (!candidate) throw new Error('expected candidate');
    const preview = await importer.preview({ candidateId: candidate.id });
    expect(preview.maskedSummary).not.toContain('super-secret-adc');
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
        kind: 'gcp_adc',
        providerId: 'local-file',
        locator: { type: 'local', key: candidate.conflictKey },
        createdAt: 0,
        updatedAt: 0,
      },
    });
    expect(material.payload.value).toContain('super-secret-adc');
    expect(JSON.stringify(material)).not.toContain('super-secret-adc');
  });

  it('returns nothing for empty or malformed ADC JSON', async () => {
    expect(await createImporter('').importer.discover()).toEqual([]);
    expect(await createImporter('{').importer.discover()).toEqual([]);
  });
});
