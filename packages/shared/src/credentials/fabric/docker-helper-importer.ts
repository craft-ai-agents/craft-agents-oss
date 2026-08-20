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
const KIND: CredentialKind = 'basic_auth';
const DEFAULT_DOCKER_HUB = 'https://index.docker.io/v1/';

export interface DockerCredentialHelperQuery {
  readonly helper: string;
  readonly serverUrl: string;
}

export interface DockerCredentialHelperSecret {
  readonly Username?: string;
  readonly Secret?: string;
}

/** Injected helper get. The importer never spawns docker-credential-* itself. */
export type DockerCredentialHelperGet = (
  query: DockerCredentialHelperQuery,
) => Promise<DockerCredentialHelperSecret> | DockerCredentialHelperSecret;

export interface DockerCredentialHelperImporterOptions {
  readonly configText?: string;
  readonly provider: LocalFileSecretProvider;
  readonly get?: DockerCredentialHelperGet;
}

interface CandidateRecord {
  readonly candidate: ImportCandidate;
  readonly helper: string;
  readonly serverUrl: string;
}

function parseDockerConfig(text: string): {
  registries: Map<string, string>;
  leaked: string[];
} | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const rec = parsed as Record<string, unknown>;
  const leaked: string[] = [];
  const registries = new Map<string, string>();

  const credHelpers = rec.credHelpers;
  if (credHelpers && typeof credHelpers === 'object' && !Array.isArray(credHelpers)) {
    for (const [registry, helper] of Object.entries(credHelpers as Record<string, unknown>)) {
      if (typeof helper === 'string' && helper && registry) {
        registries.set(registry, helper);
      }
    }
  }

  const auths = rec.auths;
  const authKeys: string[] = [];
  if (auths && typeof auths === 'object' && !Array.isArray(auths)) {
    for (const [registry, entry] of Object.entries(auths as Record<string, unknown>)) {
      if (registry) authKeys.push(registry);
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        const auth = (entry as Record<string, unknown>).auth;
        if (typeof auth === 'string' && auth.length > 0) leaked.push(auth);
      }
    }
  }

  const credsStore = rec.credsStore;
  if (typeof credsStore === 'string' && credsStore) {
    const keys = authKeys.length > 0 ? authKeys : [DEFAULT_DOCKER_HUB];
    for (const key of keys) {
      if (!registries.has(key)) registries.set(key, credsStore);
    }
  }

  return { registries, leaked };
}

function containsSecret(value: unknown, secrets: readonly string[]): boolean {
  if (secrets.length === 0) return false;
  const json = JSON.stringify(value);
  return secrets.some((secret) => secret.length > 0 && json.includes(secret));
}

export class DockerCredentialHelperImporter implements CredentialImporter {
  readonly id = 'docker-credential-helper';
  readonly sourceKind = 'docker-config';
  private readonly candidates = new Map<string, CandidateRecord>();
  private lastCommit: CredentialRefId | undefined;

  constructor(private readonly options: DockerCredentialHelperImporterOptions) {}

  async discover(_input?: ImportDiscoveryInput): Promise<ImportCandidate[]> {
    this.candidates.clear();
    const text = this.options.configText ?? '';
    if (!text.trim()) return [];
    const parsed = parseDockerConfig(text);
    if (!parsed) return [];

    const out: ImportCandidate[] = [];
    for (const [serverUrl, helper] of parsed.registries) {
      const candidate: ImportCandidate = {
        id: `docker:${serverUrl}:${helper}`,
        sourceId: this.id,
        kind: KIND,
        label: `${helper} @ ${serverUrl}`,
        conflictKey: `docker-credential-helper:${serverUrl}:${helper}`,
        locator: serverUrl,
      };
      this.candidates.set(candidate.id, { candidate, helper, serverUrl });
      out.push(candidate);
    }
    if (containsSecret(out, parsed.leaked)) {
      throw new Error('Import candidate leaked a secret');
    }
    return out;
  }

  async preview(input: { candidateId: string }): Promise<ImportPreview> {
    const found = this.candidates.get(input.candidateId);
    if (!found) throw new Error('Unknown import candidate');
    const secret = await this.readHelperSecret(found);
    const toMask = secret.Secret ?? '';
    return {
      candidateId: found.candidate.id,
      inferredKind: KIND,
      targetProviderId: this.options.provider.id,
      proposedMode: 'copy',
      maskedSummary: toMask ? maskSecret(toMask) : '****',
      warnings: toMask ? [] : ['helper_secret_unavailable'],
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
    const secret = await this.readHelperSecret(found);
    if (input.mode === 'copy' && !secret.Secret) throw new Error('secret_unavailable');
    const username = secret.Username;
    const value =
      secret.Secret != null && secret.Secret !== ''
        ? username
          ? `${username}:${secret.Secret}`
          : secret.Secret
        : found.candidate.conflictKey;
    const written = await this.options.provider.write({
      kind: KIND,
      locator: { type: 'local', key: found.candidate.conflictKey },
      payload: { value },
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

  private async readHelperSecret(record: CandidateRecord): Promise<DockerCredentialHelperSecret> {
    if (!this.options.get) return {};
    const result = await this.options.get({
      helper: record.helper,
      serverUrl: record.serverUrl,
    });
    return { Username: result.Username, Secret: result.Secret };
  }
}
