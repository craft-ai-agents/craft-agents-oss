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

export interface GitCredentialHelperQuery {
  readonly helper: string;
  readonly protocol?: string;
  readonly host?: string;
  readonly path?: string;
  readonly username?: string;
}

export interface GitCredentialHelperSecret {
  readonly username?: string;
  readonly password?: string;
}

/** Injected helper fill. The importer never spawns git or a helper process itself. */
export type GitCredentialHelperFill = (
  query: GitCredentialHelperQuery,
) => Promise<GitCredentialHelperSecret> | GitCredentialHelperSecret;

export type GitCredentialHelperRunner = GitCredentialHelperFill;

export interface GitCredentialHelperImporterOptions {
  readonly configText?: string;
  readonly provider: LocalFileSecretProvider;
  readonly fill?: GitCredentialHelperFill;
  readonly runner?: GitCredentialHelperRunner;
}

interface HostMeta {
  readonly locator: string;
  readonly protocol?: string;
  readonly host?: string;
  readonly path?: string;
}

interface ParsedSection {
  url?: string;
  helpers: string[];
  username?: string;
}

interface CandidateRecord {
  readonly candidate: ImportCandidate;
  readonly helper: string;
  readonly meta: HostMeta;
  readonly username?: string;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    return trimmed
      .slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
  return trimmed;
}

function parseCredentialUrl(url: string | undefined): { meta: HostMeta; embeddedSecrets: string[] } {
  if (!url) return { meta: { locator: '*' }, embeddedSecrets: [] };
  const embeddedSecrets: string[] = [];
  try {
    const parsed = new URL(url);
    if (parsed.password) embeddedSecrets.push(parsed.password);
    parsed.password = '';
    parsed.username = '';
    const path = parsed.pathname === '/' ? '' : parsed.pathname;
    const locator = `${parsed.protocol}//${parsed.host}${path}`;
    return {
      meta: {
        locator,
        protocol: parsed.protocol.replace(/:$/, ''),
        host: parsed.host,
        path: path ? path.replace(/^\//, '') : undefined,
      },
      embeddedSecrets,
    };
  } catch {
    const userinfo = url.match(/:\/\/[^/?#]*:([^/?#]*)@/);
    if (userinfo?.[1]) embeddedSecrets.push(decodeURIComponent(userinfo[1]));
    const stripped = url.replace(/:\/\/[^/?#]*:[^/?#]*@/, '://');
    return { meta: { locator: stripped, host: stripped }, embeddedSecrets };
  }
}

function parseIniCredentialConfig(text: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  let current: ParsedSection | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      const inner = sectionMatch[1] ?? '';
      const cred = inner.match(/^credential(?:\s+"(.*)")?$/i);
      if (cred) {
        current = { url: cred[1], helpers: [], username: undefined };
        sections.push(current);
      } else {
        current = null;
      }
      continue;
    }
    if (!current) continue;
    const kv = line.match(/^([^=\s]+)(?:\s*=\s*|\s+)(.*)$/);
    if (!kv) continue;
    const key = (kv[1] ?? '').toLowerCase();
    const value = unquote(kv[2] ?? '');
    if (key === 'helper') {
      if (value === '') current.helpers = [];
      else current.helpers.push(value);
    } else if (key === 'username') {
      current.username = value;
    }
  }
  return sections;
}

const LIST_FIELDS = ['helper', 'username'] as const;

function parseListCredentialConfig(text: string): ParsedSection[] {
  const byUrl = new Map<string, ParsedSection>();
  const sectionFor = (url: string): ParsedSection => {
    const existing = byUrl.get(url);
    if (existing) return existing;
    const created: ParsedSection = { url: url || undefined, helpers: [] };
    byUrl.set(url, created);
    return created;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    if (!line.toLowerCase().startsWith('credential.')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const dotted = line.slice('credential.'.length, eq);
    const value = line.slice(eq + 1);
    let url = '';
    let field = dotted;
    for (const known of LIST_FIELDS) {
      if (dotted.toLowerCase() === known) {
        url = '';
        field = known;
        break;
      }
      const suffix = `.${known}`;
      if (dotted.toLowerCase().endsWith(suffix)) {
        url = dotted.slice(0, dotted.length - suffix.length);
        field = known;
        break;
      }
    }
    const section = sectionFor(url);
    if (field.toLowerCase() === 'helper') {
      if (value === '') section.helpers = [];
      else section.helpers.push(value);
    } else if (field.toLowerCase() === 'username') {
      section.username = value;
    }
  }
  return [...byUrl.values()];
}

function parseGitCredentialConfig(text: string): ParsedSection[] {
  if (/\[credential/i.test(text)) return parseIniCredentialConfig(text);
  if (/^\s*credential\./im.test(text)) return parseListCredentialConfig(text);
  const ini = parseIniCredentialConfig(text);
  return ini.length > 0 ? ini : parseListCredentialConfig(text);
}

function containsSecret(value: unknown, secrets: readonly string[]): boolean {
  if (secrets.length === 0) return false;
  const json = JSON.stringify(value);
  return secrets.some((secret) => secret.length > 0 && json.includes(secret));
}

export class GitCredentialHelperImporter implements CredentialImporter {
  readonly id = 'git-credential-helper';
  readonly sourceKind = 'git-config';
  private readonly candidates = new Map<string, CandidateRecord>();
  private lastCommit: CredentialRefId | undefined;

  constructor(private readonly options: GitCredentialHelperImporterOptions) {}

  async discover(_input?: ImportDiscoveryInput): Promise<ImportCandidate[]> {
    this.candidates.clear();
    const text = this.options.configText ?? '';
    if (!text.trim()) return [];

    const out: ImportCandidate[] = [];
    const embeddedSecrets: string[] = [];
    for (const section of parseGitCredentialConfig(text)) {
      const parsed = parseCredentialUrl(section.url);
      embeddedSecrets.push(...parsed.embeddedSecrets);
      for (const helper of section.helpers) {
        if (!helper) continue;
        const hostLabel = parsed.meta.host ?? parsed.meta.locator;
        const label = section.username
          ? `${section.username} @ ${hostLabel} via ${helper}`
          : `${helper} @ ${hostLabel}`;
        const candidate: ImportCandidate = {
          id: `git:${parsed.meta.locator}:${helper}`,
          sourceId: this.id,
          kind: KIND,
          label,
          conflictKey: `git-credential-helper:${parsed.meta.locator}:${helper}`,
          locator: parsed.meta.locator,
        };
        this.candidates.set(candidate.id, {
          candidate,
          helper,
          meta: parsed.meta,
          username: section.username,
        });
        out.push(candidate);
      }
    }
    if (containsSecret(out, embeddedSecrets)) {
      throw new Error('Import candidate leaked a secret');
    }
    return out;
  }

  async preview(input: { candidateId: string }): Promise<ImportPreview> {
    const found = this.candidates.get(input.candidateId);
    if (!found) throw new Error('Unknown import candidate');
    const secret = await this.readHelperSecret(found);
    const toMask = secret.password ?? '';
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
    if (input.mode === 'copy' && !secret.password) throw new Error('secret_unavailable');
    const username = secret.username ?? found.username;
    const value =
      secret.password != null && secret.password !== ''
        ? username
          ? `${username}:${secret.password}`
          : secret.password
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

  private async readHelperSecret(record: CandidateRecord): Promise<GitCredentialHelperSecret> {
    const fill = this.options.fill ?? this.options.runner;
    if (!fill) return {};
    const result = await fill({
      helper: record.helper,
      protocol: record.meta.protocol,
      host: record.meta.host,
      path: record.meta.path,
      username: record.username,
    });
    return { username: result.username, password: result.password };
  }
}
