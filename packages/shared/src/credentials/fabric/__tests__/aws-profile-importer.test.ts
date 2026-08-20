import { describe, expect, it } from 'bun:test';
import { CredentialRefRegistry } from '@craft-agent/core/platform';
import type { CredentialBackend } from '../../backends/types.ts';
import type { CredentialId, StoredCredential } from '../../types.ts';
import { credentialIdToAccount } from '../../types.ts';
import type { CredentialImporter } from '../types.ts';
import { LocalFileSecretProvider } from '../local-file-provider.ts';
import {
  AwsSharedProfileImporter,
  type AwsCredentialProcessRun,
} from '../aws-profile-importer.ts';

const SECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
const PROCESS_SECRET = 'process-super-secret-key';
const ACCESS_KEY = 'AKIAIOSFODNN7EXAMPLE';

const CREDENTIALS = `[default]
aws_access_key_id = ${ACCESS_KEY}
aws_secret_access_key = ${SECRET}

[ci]
aws_access_key_id = AKIA_CI_EXAMPLE
aws_secret_access_key = ci-super-secret
`;

const CONFIG = `[default]
region = us-east-1
[profile vault]
credential_process = aws-vault exec ci --json
region = eu-west-1
`;

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

function createImporter(
  credentialsText: string,
  configText: string,
  run?: AwsCredentialProcessRun,
) {
  const provider = new LocalFileSecretProvider(new MemoryBackend(), new CredentialRefRegistry());
  const importer = new AwsSharedProfileImporter({ credentialsText, configText, provider, run });
  return { importer, provider };
}

function leakHaystack(value: unknown): string {
  return JSON.stringify(value);
}

describe('CF-9.4 AwsSharedProfileImporter', () => {
  it('implements CredentialImporter', () => {
    const { importer } = createImporter(CREDENTIALS, CONFIG);
    const typed: CredentialImporter = importer;
    expect(typed.id).toBe('aws-shared-profile');
    expect(typed.sourceKind).toBe('aws-config');
  });

  it('discovers profile and process metadata without secrets or access keys', async () => {
    const { importer } = createImporter(CREDENTIALS, CONFIG);
    const candidates = await importer.discover();
    const haystack = leakHaystack(candidates);
    expect(candidates.some((c) => c.locator === 'default')).toBe(true);
    expect(candidates.some((c) => c.locator === 'ci')).toBe(true);
    expect(candidates.some((c) => c.locator === 'vault')).toBe(true);
    expect(haystack).toContain('aws-vault');
    expect(haystack).not.toContain(SECRET);
    expect(haystack).not.toContain('ci-super-secret');
    expect(haystack).not.toContain(ACCESS_KEY);
    expect(haystack).not.toContain('AKIA_CI_EXAMPLE');
    for (const candidate of candidates) {
      expect(candidate.kind).toBe('aws_credential_source');
      expect(candidate.sourceId).toBe('aws-shared-profile');
      expect(candidate).not.toHaveProperty('aws_secret_access_key');
      expect(candidate).not.toHaveProperty('SecretAccessKey');
    }
  });

  it('does not invoke credential_process during discover', async () => {
    let calls = 0;
    const run: AwsCredentialProcessRun = async () => {
      calls += 1;
      return { AccessKeyId: 'ASIA', SecretAccessKey: PROCESS_SECRET };
    };
    const { importer } = createImporter(CREDENTIALS, CONFIG, run);
    const candidates = await importer.discover();
    expect(calls).toBe(0);
    expect(leakHaystack(candidates)).not.toContain(PROCESS_SECRET);
  });

  it('masks preview for static and process profiles', async () => {
    const run: AwsCredentialProcessRun = (query) => {
      expect(query.profile).toBe('vault');
      expect(query.command).toContain('aws-vault');
      return { AccessKeyId: 'ASIAEXAMPLE', SecretAccessKey: PROCESS_SECRET };
    };
    const { importer } = createImporter(CREDENTIALS, CONFIG, run);
    const candidates = await importer.discover();
    const def = candidates.find((c) => c.locator === 'default');
    const vault = candidates.find((c) => c.locator === 'vault');
    if (!def || !vault) throw new Error('expected default and vault');
    const staticPreview = await importer.preview({ candidateId: def.id });
    expect(staticPreview.maskedSummary).not.toContain(SECRET);
    expect(leakHaystack(staticPreview)).not.toContain(SECRET);
    const processPreview = await importer.preview({ candidateId: vault.id });
    expect(processPreview.maskedSummary).not.toContain(PROCESS_SECRET);
    expect(leakHaystack(processPreview)).not.toContain(PROCESS_SECRET);
  });

  it('commits copy through LocalFileSecretProvider using injected process output', async () => {
    const run: AwsCredentialProcessRun = () => ({
      AccessKeyId: 'ASIAEXAMPLE',
      SecretAccessKey: PROCESS_SECRET,
      SessionToken: 'session-token',
    });
    const { importer, provider } = createImporter(CREDENTIALS, CONFIG, run);
    const candidates = await importer.discover();
    const vault = candidates.find((c) => c.locator === 'vault');
    if (!vault) throw new Error('expected vault');
    const committed = await importer.commit({
      candidateId: vault.id,
      targetProviderId: 'local-file',
      mode: 'copy',
      workspaceId: 'w',
      requestedBy: 'test',
    });
    expect(committed.credentialRefId.startsWith('cred_')).toBe(true);
    const material = await provider.resolveForLease({
      credentialRef: {
        id: committed.credentialRefId,
        kind: 'aws_credential_source',
        providerId: 'local-file',
        locator: { type: 'local', key: vault.conflictKey },
        createdAt: 0,
        updatedAt: 0,
      },
    });
    expect(material.payload.value).toContain(PROCESS_SECRET);
    expect(leakHaystack(material)).not.toContain(PROCESS_SECRET);
    await importer.rollback({ credentialRefId: committed.credentialRefId });
  });

  it('rejects unsupported modes, unknown candidates, and empty config', async () => {
    expect(await createImporter('', '').importer.discover()).toEqual([]);
    const populated = createImporter(CREDENTIALS, CONFIG).importer;
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
