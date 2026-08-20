import type {
  CredentialKind,
  CredentialRef,
  CredentialRefId,
  CredentialVersion,
  ProviderLocator,
  StorageMode,
} from '@craft-agent/core/platform';
import type { StoredCredential } from '../types.ts';

export interface ImportCandidate {
  readonly id: string;
  readonly sourceId: string;
  readonly kind: CredentialKind;
  readonly label: string;
  readonly conflictKey: string;
  readonly locator?: string;
  readonly fingerprint?: string;
  readonly expiresAt?: number;
}

export interface ImportPreview {
  readonly candidateId: string;
  readonly inferredKind: CredentialKind;
  readonly targetProviderId: string;
  readonly proposedMode: StorageMode;
  readonly maskedSummary: string;
  readonly warnings: readonly string[];
}

export interface ImportDiscoveryInput {
  readonly workspaceId?: string;
}

export interface ImportCommitInput {
  readonly candidateId: string;
  readonly targetProviderId: string;
  readonly mode: StorageMode;
  readonly workspaceId: string;
  readonly requestedBy: string;
}

export interface ProviderCredentialMetadata {
  readonly credentialRefId: CredentialRefId;
  readonly kind: CredentialKind;
  readonly fingerprint: string;
  readonly status: 'active' | 'revoked' | 'missing';
}

export interface ProviderMaterialization {
  readonly credentialRefId: CredentialRefId;
  readonly kind: CredentialKind;
  readonly payload: StoredCredential;
}

export interface SecretProvider {
  readonly id: string;
  inspect(ref: CredentialRef): Promise<ProviderCredentialMetadata>;
  resolveForLease(input: { credentialRef: CredentialRef }): Promise<ProviderMaterialization>;
  write(input: {
    kind: CredentialKind;
    locator: ProviderLocator;
    payload: StoredCredential;
  }): Promise<{ ref: CredentialRef; version: CredentialVersion }>;
  revoke(input: { credentialRef: CredentialRef }): Promise<void>;
  health(): Promise<{ status: 'healthy' | 'repair_required' | 'unavailable' }>;
}

export interface CredentialImporter {
  readonly id: string;
  readonly sourceKind: string;
  discover(input?: ImportDiscoveryInput): Promise<ImportCandidate[]>;
  preview(input: { candidateId: string }): Promise<ImportPreview>;
  validate(input: ImportCommitInput): Promise<{ ok: true } | { ok: false; code: string }>;
  commit(input: ImportCommitInput): Promise<{ credentialRefId: CredentialRefId }>;
  rollback(input?: { credentialRefId?: CredentialRefId }): Promise<void>;
}

