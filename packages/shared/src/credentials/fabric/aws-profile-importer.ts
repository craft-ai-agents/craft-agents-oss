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
const KIND: CredentialKind = 'aws_credential_source';

export interface AwsCredentialProcessQuery {
  readonly profile: string;
  readonly command: string;
}

export interface AwsCredentialProcessSecret {
  readonly AccessKeyId?: string;
  readonly SecretAccessKey?: string;
  readonly SessionToken?: string;
}

/** Injected credential_process. The importer never spawns a process itself. */
export type AwsCredentialProcessRun = (
  query: AwsCredentialProcessQuery,
) => Promise<AwsCredentialProcessSecret> | AwsCredentialProcessSecret;

export interface AwsSharedProfileImporterOptions {
  readonly credentialsText?: string;
  readonly configText?: string;
  readonly provider: LocalFileSecretProvider;
  readonly run?: AwsCredentialProcessRun;
}

interface ProfileRecord {
  readonly name: string;
  readonly credentialProcess?: string;
  readonly region?: string;
  readonly accessKeyId?: string;
  readonly secretAccessKey?: string;
  readonly sessionToken?: string;
}

interface CandidateRecord {
  readonly candidate: ImportCandidate;
  readonly profile: ProfileRecord;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseIni(text: string): Map<string, Record<string, string>> {
  const sections = new Map<string, Record<string, string>>();
  let current: string | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) {
      const inner = (header[1] ?? '').trim();
      const profile = inner.match(/^profile\s+(.+)$/i);
      current = profile ? profile[1].trim() : inner;
      if (!sections.has(current)) sections.set(current, {});
      continue;
    }
    if (!current) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    const value = unquote(line.slice(eq + 1));
    const rec = sections.get(current);
    if (rec) rec[key] = value;
  }
  return sections;
}

function mergeProfiles(credentialsText: string, configText: string): {
  profiles: Map<string, ProfileRecord>;
  leaked: string[];
} {
  const leaked: string[] = [];
  const profiles = new Map<string, ProfileRecord>();
  const creds = parseIni(credentialsText);
  const config = parseIni(configText);

  const names = new Set([...creds.keys(), ...config.keys()]);
  for (const name of names) {
    if (!name) continue;
    const cred = creds.get(name) ?? {};
    const cfg = config.get(name) ?? {};
    const accessKeyId = cred.aws_access_key_id;
    const secretAccessKey = cred.aws_secret_access_key;
    const sessionToken = cred.aws_session_token;
    if (accessKeyId) leaked.push(accessKeyId);
    if (secretAccessKey) leaked.push(secretAccessKey);
    if (sessionToken) leaked.push(sessionToken);
    const credentialProcess = cfg.credential_process;
    if (!credentialProcess && !secretAccessKey && !accessKeyId) continue;
    profiles.set(name, {
      name,
      credentialProcess,
      region: cfg.region ?? cred.region,
      accessKeyId,
      secretAccessKey,
      sessionToken,
    });
  }
  return { profiles, leaked };
}

function containsSecret(value: unknown, secrets: readonly string[]): boolean {
  if (secrets.length === 0) return false;
  const json = JSON.stringify(value);
  return secrets.some((secret) => secret.length > 0 && json.includes(secret));
}

export class AwsSharedProfileImporter implements CredentialImporter {
  readonly id = 'aws-shared-profile';
  readonly sourceKind = 'aws-config';
  private readonly candidates = new Map<string, CandidateRecord>();
  private lastCommit: CredentialRefId | undefined;
  private leaked: string[] = [];

  constructor(private readonly options: AwsSharedProfileImporterOptions) {}

  async discover(_input?: ImportDiscoveryInput): Promise<ImportCandidate[]> {
    this.candidates.clear();
    const credentialsText = this.options.credentialsText ?? '';
    const configText = this.options.configText ?? '';
    if (!credentialsText.trim() && !configText.trim()) return [];
    const merged = mergeProfiles(credentialsText, configText);
    this.leaked = merged.leaked;
    const out: ImportCandidate[] = [];
    for (const profile of merged.profiles.values()) {
      const via = profile.credentialProcess
        ? `via ${profile.credentialProcess}`
        : 'static';
      const candidate: ImportCandidate = {
        id: `aws:${profile.name}`,
        sourceId: this.id,
        kind: KIND,
        label: `aws profile ${profile.name} ${via}`,
        conflictKey: `aws-shared-profile:${profile.name}`,
        locator: profile.name,
      };
      this.candidates.set(candidate.id, { candidate, profile });
      out.push(candidate);
    }
    if (containsSecret(out, merged.leaked)) {
      throw new Error('Import candidate leaked a secret');
    }
    return out;
  }

  async preview(input: { candidateId: string }): Promise<ImportPreview> {
    const found = this.candidates.get(input.candidateId);
    if (!found) throw new Error('Unknown import candidate');
    const material = await this.readSecret(found.profile);
    const toMask = material.SecretAccessKey ?? '';
    const preview: ImportPreview = {
      candidateId: found.candidate.id,
      inferredKind: KIND,
      targetProviderId: this.options.provider.id,
      proposedMode: 'copy',
      maskedSummary: toMask ? maskSecret(toMask) : '****',
      warnings: toMask ? [] : ['helper_secret_unavailable'],
    };
    if (toMask && JSON.stringify(preview).includes(toMask)) {
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
    const material = await this.readSecret(found.profile);
    if (input.mode === 'copy' && !material.SecretAccessKey) throw new Error('secret_unavailable');
    const value = material.SecretAccessKey ?? found.candidate.conflictKey;
    const accessKeyId = material.AccessKeyId ?? 'unknown';
    const written = await this.options.provider.write({
      kind: KIND,
      locator: { type: 'local', key: found.candidate.conflictKey },
      payload: {
        value,
        awsAccessKeyId: accessKeyId,
        ...(found.profile.region ? { awsRegion: found.profile.region } : {}),
        ...(material.SessionToken ? { awsSessionToken: material.SessionToken } : {}),
      },
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

  private async readSecret(profile: ProfileRecord): Promise<AwsCredentialProcessSecret> {
    if (profile.credentialProcess) {
      if (!this.options.run) return {};
      const result = await this.options.run({
        profile: profile.name,
        command: profile.credentialProcess,
      });
      return {
        AccessKeyId: result.AccessKeyId,
        SecretAccessKey: result.SecretAccessKey,
        SessionToken: result.SessionToken,
      };
    }
    return {
      AccessKeyId: profile.accessKeyId,
      SecretAccessKey: profile.secretAccessKey,
      SessionToken: profile.sessionToken,
    };
  }
}
