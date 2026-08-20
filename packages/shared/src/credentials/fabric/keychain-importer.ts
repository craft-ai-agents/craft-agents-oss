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
const KIND: CredentialKind = 'bearer_token';

export interface KeychainItem {
  readonly service: string;
  readonly account: string;
}

export type KeychainList = () => Promise<readonly KeychainItem[]> | readonly KeychainItem[];
export type KeychainGet = (
  query: KeychainItem,
) => Promise<{ readonly password?: string }> | { readonly password?: string };

export interface KeychainImporterOptions {
  readonly provider: LocalFileSecretProvider;
  readonly list: KeychainList;
  readonly get: KeychainGet;
}

export class KeychainImporter implements CredentialImporter {
  readonly id = 'macos-keychain';
  readonly sourceKind = 'keychain';
  private readonly candidates = new Map<string, ImportCandidate>();
  private lastCommit: CredentialRefId | undefined;

  constructor(private readonly options: KeychainImporterOptions) {}

  async discover(_input?: ImportDiscoveryInput): Promise<ImportCandidate[]> {
    this.candidates.clear();
    const items = await this.options.list();
    const out: ImportCandidate[] = [];
    for (const item of items) {
      const candidate: ImportCandidate = {
        id: `keychain:${item.service}:${item.account}`,
        sourceId: this.id,
        kind: KIND,
        label: `${item.service} / ${item.account}`,
        conflictKey: `keychain:${item.service}:${item.account}`,
        locator: `${item.service}/${item.account}`,
      };
      this.candidates.set(candidate.id, candidate);
      out.push(candidate);
    }
    return out;
  }

  async preview(input: { candidateId: string }): Promise<ImportPreview> {
    const candidate = this.candidates.get(input.candidateId);
    if (!candidate) throw new Error('Unknown import candidate');
    const [service, account] = splitLocator(candidate.locator ?? '');
    const material = await this.options.get({ service, account });
    const password = material.password ?? '';
    const preview: ImportPreview = {
      candidateId: candidate.id,
      inferredKind: KIND,
      targetProviderId: this.options.provider.id,
      proposedMode: 'copy',
      maskedSummary: password ? maskSecret(password) : '****',
      warnings: password ? [] : ['helper_secret_unavailable'],
    };
    if (password && JSON.stringify(preview).includes(password)) {
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
    const candidate = this.candidates.get(input.candidateId);
    if (!candidate) throw new Error('unknown_candidate');
    const [service, account] = splitLocator(candidate.locator ?? '');
    const material = await this.options.get({ service, account });
    if (input.mode === 'copy' && !material.password) throw new Error('secret_unavailable');
    const written = await this.options.provider.write({
      kind: KIND,
      locator: { type: 'keychain', service, account },
      payload: { value: material.password ?? candidate.conflictKey },
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
        locator: { type: 'keychain', service: 'unknown', account: 'unknown' },
        createdAt: 0,
        updatedAt: 0,
      },
    });
    if (this.lastCommit === id) this.lastCommit = undefined;
  }
}

function splitLocator(locator: string): [string, string] {
  const slash = locator.indexOf('/');
  if (slash <= 0) return [locator, locator];
  return [locator.slice(0, slash), locator.slice(slash + 1)];
}
