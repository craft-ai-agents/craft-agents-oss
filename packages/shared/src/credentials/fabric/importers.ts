import { readFileSync, existsSync } from 'node:fs';
import type { CredentialKind, CredentialRefId, StorageMode } from '@craft-agent/core/platform';
import type { CredentialBackend } from '../backends/types.ts';
import type { CredentialId, StoredCredential } from '../types.ts';
import { credentialIdToAccount } from '../types.ts';
import { credentialPayloadFingerprint } from '../envelope.ts';
import { maskSecret } from './materialization.ts';
import type { LocalFileSecretProvider } from './local-file-provider.ts';
import type {
  CredentialImporter,
  ImportCandidate,
  ImportCommitInput,
  ImportDiscoveryInput,
  ImportPreview,
} from './types.ts';

const SUPPORTED_MODES: readonly StorageMode[] = ['reference', 'copy'];

function kindFromType(type: CredentialId['type']): CredentialKind {
  if (type.includes('oauth')) return 'oauth2_token_set';
  if (type.includes('bearer')) return 'bearer_token';
  if (type === 'llm_iam') return 'aws_credential_source';
  if (type === 'llm_service_account') return 'gcp_adc';
  if (type.includes('basic')) return 'basic_auth';
  return 'api_key';
}

export class CredentialsEncImporter implements CredentialImporter {
  readonly id = 'credentials-enc';
  readonly sourceKind = 'credentials.enc';
  private readonly candidates = new Map<string, { candidate: ImportCandidate; payload: StoredCredential; id: CredentialId }>();
  private lastCommit: CredentialRefId | undefined;

  constructor(
    private readonly backend: CredentialBackend,
    private readonly provider: LocalFileSecretProvider,
  ) {}

  async discover(_input?: ImportDiscoveryInput): Promise<ImportCandidate[]> {
    this.candidates.clear();
    let ids: CredentialId[] = [];
    try {
      ids = await this.backend.list();
    } catch {
      return [];
    }
    const out: ImportCandidate[] = [];
    for (const id of ids) {
      const payload = await this.backend.get(id);
      if (!payload) continue;
      const kind = kindFromType(id.type);
      const candidate: ImportCandidate = {
        id: credentialIdToAccount(id),
        sourceId: this.id,
        kind,
        label: credentialIdToAccount(id),
        conflictKey: credentialIdToAccount(id),
        locator: credentialIdToAccount(id),
        fingerprint: credentialPayloadFingerprint(kind, payload),
      };
      this.candidates.set(candidate.id, { candidate, payload, id });
      out.push(candidate);
    }
    return out;
  }

  async preview(input: { candidateId: string }): Promise<ImportPreview> {
    const found = this.candidates.get(input.candidateId);
    if (!found) throw new Error('Unknown import candidate');
    return {
      candidateId: found.candidate.id,
      inferredKind: found.candidate.kind,
      targetProviderId: this.provider.id,
      proposedMode: 'copy',
      maskedSummary: maskSecret(found.payload.value),
      warnings: [],
    };
  }

  async validate(input: ImportCommitInput): Promise<{ ok: true } | { ok: false; code: string }> {
    if (!this.candidates.has(input.candidateId)) return { ok: false, code: 'unknown_candidate' };
    if (!SUPPORTED_MODES.includes(input.mode)) return { ok: false, code: 'unsupported_mode' };
    return { ok: true };
  }

  async commit(input: ImportCommitInput): Promise<{ credentialRefId: CredentialRefId }> {
    const valid = await this.validate(input);
    if (!valid.ok) throw new Error(valid.code);
    const found = this.candidates.get(input.candidateId);
    if (!found) throw new Error('unknown_candidate');
    const written = await this.provider.write({
      kind: found.candidate.kind,
      locator: { type: 'local', key: found.candidate.conflictKey },
      payload: found.payload,
      copyPayload: input.mode !== 'reference',
    });
    this.lastCommit = written.ref.id;
    return { credentialRefId: written.ref.id };
  }

  async rollback(input?: { credentialRefId?: CredentialRefId }): Promise<void> {
    const id = input?.credentialRefId ?? this.lastCommit;
    if (!id) return;
    await this.provider.revoke({
      credentialRef: {
        id,
        kind: 'api_key',
        providerId: this.provider.id,
        locator: { type: 'local', key: id },
        createdAt: 0,
        updatedAt: 0,
      },
    });
    if (this.lastCommit === id) this.lastCommit = undefined;
  }
}

export class EnvFileImporter implements CredentialImporter {
  readonly id = 'env-file';
  readonly sourceKind = 'dotenv';
  private readonly candidates = new Map<string, { candidate: ImportCandidate; value: string }>();
  private lastCommit: CredentialRefId | undefined;

  constructor(
    private readonly filePath: string,
    private readonly provider: LocalFileSecretProvider,
  ) {}

  async discover(_input?: ImportDiscoveryInput): Promise<ImportCandidate[]> {
    this.candidates.clear();
    if (!existsSync(this.filePath)) return [];
    const text = readFileSync(this.filePath, 'utf8');
    const out: ImportCandidate[] = [];
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const name = line.slice(0, eq).trim();
      const value = line.slice(eq + 1);
      const candidate: ImportCandidate = {
        id: name,
        sourceId: this.id,
        kind: 'api_key',
        label: name,
        conflictKey: `env:${this.filePath}:${name}`,
        locator: name,
      };
      this.candidates.set(name, { candidate, value });
      out.push(candidate);
    }
    return out;
  }

  async preview(input: { candidateId: string }): Promise<ImportPreview> {
    const found = this.candidates.get(input.candidateId);
    if (!found) throw new Error('Unknown import candidate');
    return {
      candidateId: found.candidate.id,
      inferredKind: 'api_key',
      targetProviderId: this.provider.id,
      proposedMode: 'copy',
      maskedSummary: maskSecret(found.value),
      warnings: [],
    };
  }

  async validate(input: ImportCommitInput): Promise<{ ok: true } | { ok: false; code: string }> {
    if (!this.candidates.has(input.candidateId)) return { ok: false, code: 'unknown_candidate' };
    if (!SUPPORTED_MODES.includes(input.mode)) return { ok: false, code: 'unsupported_mode' };
    return { ok: true };
  }

  async commit(input: ImportCommitInput): Promise<{ credentialRefId: CredentialRefId }> {
    const valid = await this.validate(input);
    if (!valid.ok) throw new Error(valid.code);
    const found = this.candidates.get(input.candidateId);
    if (!found) throw new Error('unknown_candidate');
    const written = await this.provider.write({
      kind: 'api_key',
      locator: { type: 'local', key: found.candidate.conflictKey },
      payload: { value: found.value },
    });
    this.lastCommit = written.ref.id;
    return { credentialRefId: written.ref.id };
  }

  async rollback(input?: { credentialRefId?: CredentialRefId }): Promise<void> {
    const id = input?.credentialRefId ?? this.lastCommit;
    if (!id) return;
    await this.provider.revoke({
      credentialRef: {
        id,
        kind: 'api_key',
        providerId: this.provider.id,
        locator: { type: 'local', key: id },
        createdAt: 0,
        updatedAt: 0,
      },
    });
  }
}
