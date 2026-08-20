import {
  CredentialRefRegistry,
  isCredentialRefId,
  type CredentialKind,
  type CredentialRef,
  type ProviderLocator,
} from '@craft-agent/core/platform';
import type { CredentialBackend } from '../backends/types.ts';
import type { CredentialId, StoredCredential } from '../types.ts';
import { credentialPayloadFingerprint } from '../envelope.ts';
import { createProviderMaterialization } from './materialization.ts';
import type { ProviderCredentialMetadata, ProviderMaterialization, SecretProvider } from './types.ts';

export class LocalFileSecretProvider implements SecretProvider {
  readonly id = 'local-file';
  private readonly copies = new Map<string, { id: CredentialId; payload: StoredCredential; kind: CredentialKind }>();
  private readonly byConflict = new Map<string, CredentialRef>();

  constructor(
    private readonly backend: CredentialBackend,
    private readonly registry: CredentialRefRegistry,
  ) {}

  async health(): Promise<{ status: 'healthy' | 'repair_required' | 'unavailable' }> {
    try {
      if (!(await this.backend.isAvailable())) return { status: 'unavailable' };
      return { status: 'healthy' };
    } catch {
      return { status: 'unavailable' };
    }
  }

  async write(input: {
    kind: CredentialKind;
    locator: ProviderLocator;
    payload: StoredCredential;
    copyPayload?: boolean;
  }): Promise<{ ref: CredentialRef; version: import('@craft-agent/core/platform').CredentialVersion }> {
    const conflictKey = input.locator.type === 'local' ? input.locator.key : JSON.stringify(input.locator);
    const fingerprint = credentialPayloadFingerprint(input.kind, input.payload);
    const existing = this.byConflict.get(`${conflictKey}:${fingerprint}`);
    if (existing) {
      const version = this.registry.listVersions(existing.id)[0];
      if (version) return { ref: existing, version };
    }
    const ref = this.registry.register({
      kind: input.kind,
      providerId: this.id,
      locator: input.locator,
    });
    const version = this.registry.registerVersion({
      credentialRefId: ref.id,
      codec: 'stored-credential/v1',
      fingerprint,
    });
    if (input.copyPayload !== false) {
      const id: CredentialId = { type: 'source_apikey', workspaceId: 'fabric', sourceId: ref.id };
      await this.backend.set(id, input.payload);
      this.copies.set(ref.id, { id, payload: input.payload, kind: input.kind });
    }
    this.byConflict.set(`${conflictKey}:${fingerprint}`, ref);
    return { ref, version };
  }

  async inspect(ref: CredentialRef): Promise<ProviderCredentialMetadata> {
    const copy = this.copies.get(ref.id);
    if (!copy) {
      return { credentialRefId: ref.id, kind: ref.kind, fingerprint: '', status: 'missing' };
    }
    return {
      credentialRefId: ref.id,
      kind: copy.kind,
      fingerprint: credentialPayloadFingerprint(copy.kind, copy.payload),
      status: 'active',
    };
  }

  async resolveForLease(input: { credentialRef: CredentialRef }): Promise<ProviderMaterialization> {
    const copy = this.copies.get(input.credentialRef.id);
    if (!copy) throw new Error('Provider materialization missing');
    return createProviderMaterialization(input.credentialRef.id, copy.kind, copy.payload);
  }

  async dropCopy(ref: CredentialRef): Promise<void> {
    const copy = this.copies.get(ref.id);
    if (!copy) return;
    await this.backend.delete(copy.id);
    this.copies.delete(ref.id);
  }

  async revoke(input: { credentialRef: CredentialRef }): Promise<void> {
    const copy = this.copies.get(input.credentialRef.id);
    if (!copy) return;
    await this.backend.delete(copy.id);
    this.copies.delete(input.credentialRef.id);
    if (input.credentialRef.currentVersionId) {
      this.registry.setVersionStatus(input.credentialRef.currentVersionId, 'revoked');
    }
  }
}

export function assertCredentialRefId(id: string): asserts id is import('@craft-agent/core/platform').CredentialRefId {
  if (!isCredentialRefId(id)) throw new Error('Invalid credential metadata: id');
}
