import type { CredentialKind, CredentialRefId, StorageMode } from '@craft-agent/core/platform';
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
const KIND: CredentialKind = 'gcp_adc';

export interface GoogleAdcImporterOptions {
  readonly provider: LocalFileSecretProvider;
  readonly credentialsText: string;
}

interface AdcRecord {
  readonly type?: string;
  readonly projectId?: string;
  readonly clientEmail?: string;
  readonly privateKey?: string;
}

export class GoogleAdcImporter implements CredentialImporter {
  readonly id = 'google-adc';
  readonly sourceKind = 'adc';
  private readonly candidates = new Map<string, { candidate: ImportCandidate; record: AdcRecord }>();
  private lastCommit: CredentialRefId | undefined;

  constructor(private readonly options: GoogleAdcImporterOptions) {}

  async discover(_input?: ImportDiscoveryInput): Promise<ImportCandidate[]> {
    this.candidates.clear();
    const record = parseAdc(this.options.credentialsText);
    if (!record?.clientEmail) return [];
    const candidate: ImportCandidate = {
      id: `adc:${record.clientEmail}`,
      sourceId: this.id,
      kind: KIND,
      label: `${record.type ?? 'adc'} ${record.projectId ?? ''}`.trim(),
      conflictKey: `google-adc:${record.clientEmail}`,
      locator: record.clientEmail,
    };
    this.candidates.set(candidate.id, { candidate, record });
    return [candidate];
  }

  async preview(input: { candidateId: string }): Promise<ImportPreview> {
    const found = this.candidates.get(input.candidateId);
    if (!found) throw new Error('Unknown import candidate');
    const key = found.record.privateKey ?? '';
    const preview: ImportPreview = {
      candidateId: found.candidate.id,
      inferredKind: KIND,
      targetProviderId: this.options.provider.id,
      proposedMode: 'copy',
      maskedSummary: key ? maskSecret(key) : '****',
      warnings: key ? [] : ['helper_secret_unavailable'],
    };
    if (key && JSON.stringify(preview).includes(key)) {
      throw new Error('Import candidate leaked a secret');
    }
    return preview;
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
    if (input.mode === 'copy' && !found.record.privateKey) throw new Error('secret_unavailable');
    const written = await this.options.provider.write({
      kind: KIND,
      locator: { type: 'local', key: found.candidate.conflictKey },
      payload: { value: found.record.privateKey ?? found.candidate.conflictKey },
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

function parseAdc(text: string): AdcRecord | null {
  if (!text.trim()) return null;
  try {
    const raw = JSON.parse(text) as Record<string, unknown>;
    return {
      type: typeof raw.type === 'string' ? raw.type : undefined,
      projectId: typeof raw.project_id === 'string' ? raw.project_id : undefined,
      clientEmail: typeof raw.client_email === 'string' ? raw.client_email : undefined,
      privateKey: typeof raw.private_key === 'string' ? raw.private_key : undefined,
    };
  } catch {
    return null;
  }
}
