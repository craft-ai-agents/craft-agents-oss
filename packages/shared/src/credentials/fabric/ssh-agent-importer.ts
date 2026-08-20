import type { CredentialKind, CredentialRefId, StorageMode } from '@craft-agent/core/platform';
import type { LocalFileSecretProvider } from './local-file-provider.ts';
import type {
  CredentialImporter,
  ImportCandidate,
  ImportCommitInput,
  ImportDiscoveryInput,
  ImportPreview,
} from './types.ts';

const SUPPORTED_MODES: readonly StorageMode[] = ['reference', 'copy'];
const KIND: CredentialKind = 'ssh_agent_identity';

export interface SshAgentIdentity {
  readonly comment: string;
  readonly fingerprint: string;
  readonly privateKey?: string;
}

export type SshAgentList = () => Promise<readonly SshAgentIdentity[]> | readonly SshAgentIdentity[];

export interface SshAgentImporterOptions {
  readonly provider: LocalFileSecretProvider;
  readonly list: SshAgentList;
}

export class SshAgentImporter implements CredentialImporter {
  readonly id = 'ssh-agent';
  readonly sourceKind = 'ssh-agent';
  private readonly candidates = new Map<string, ImportCandidate>();
  private lastCommit: CredentialRefId | undefined;

  constructor(private readonly options: SshAgentImporterOptions) {}

  async discover(_input?: ImportDiscoveryInput): Promise<ImportCandidate[]> {
    this.candidates.clear();
    const identities = await this.options.list();
    const out: ImportCandidate[] = [];
    for (const identity of identities) {
      const candidate: ImportCandidate = {
        id: `ssh:${identity.fingerprint}`,
        sourceId: this.id,
        kind: KIND,
        label: identity.comment || identity.fingerprint,
        conflictKey: `ssh-agent:${identity.fingerprint}`,
        locator: identity.fingerprint,
      };
      this.candidates.set(candidate.id, candidate);
      out.push(candidate);
    }
    return out;
  }

  async preview(input: { candidateId: string }): Promise<ImportPreview> {
    const candidate = this.candidates.get(input.candidateId);
    if (!candidate) throw new Error('Unknown import candidate');
    return {
      candidateId: candidate.id,
      inferredKind: KIND,
      targetProviderId: this.options.provider.id,
      proposedMode: 'reference',
      maskedSummary: candidate.locator ?? '****',
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
    const candidate = this.candidates.get(input.candidateId);
    if (!candidate) throw new Error('unknown_candidate');
    const written = await this.options.provider.write({
      kind: KIND,
      locator: { type: 'local', key: candidate.conflictKey },
      payload: { value: candidate.locator ?? candidate.conflictKey },
      copyPayload: input.mode !== 'reference',
    });
    this.lastCommit = written.ref.id;
    return { credentialRefId: written.ref.id };
  }

  async rollback(input?: { credentialRefId?: CredentialRefId }): Promise<void> {
    const id = input?.credentialRefId ?? this.lastCommit;
    if (!id) return;
    await this.options.provider.revoke({
      credentialRef: {
        id,
        kind: KIND,
        providerId: this.options.provider.id,
        locator: { type: 'local', key: id },
        createdAt: 0,
        updatedAt: 0,
      },
    });
    if (this.lastCommit === id) this.lastCommit = undefined;
  }
}
