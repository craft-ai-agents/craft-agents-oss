/**
 * Production host runners for Connection Fabric local imports.
 *
 * Importers stay spawn-free; these wrappers own optional process I/O.
 * Tests inject `run` and must never call the production defaults.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type {
  AwsCredentialProcessRun,
  AwsCredentialProcessSecret,
} from './aws-profile-importer.ts';
import type {
  DockerCredentialHelperGet,
  DockerCredentialHelperSecret,
} from './docker-helper-importer.ts';
import type {
  GitCredentialHelperFill,
  GitCredentialHelperQuery,
  GitCredentialHelperSecret,
} from './git-helper-importer.ts';
import type { KeychainGet, KeychainItem, KeychainList } from './keychain-importer.ts';
import type { SshAgentIdentity, SshAgentList } from './ssh-agent-importer.ts';

export interface HostPaths {
  readonly gitConfig: string;
  readonly dockerConfig: string;
  readonly awsCredentials: string;
  readonly awsConfig: string;
  readonly adc: string;
}

/** Safe default paths under $HOME. Never throws. */
export function defaultPaths(): HostPaths {
  let home = '';
  try {
    home = homedir() || '';
  } catch {
    home = '';
  }
  let adcEnv = '';
  try {
    const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (typeof raw === 'string' && raw.length > 0) adcEnv = raw;
  } catch {
    adcEnv = '';
  }
  return {
    gitConfig: join(home, '.gitconfig'),
    dockerConfig: join(home, '.docker', 'config.json'),
    awsCredentials: join(home, '.aws', 'credentials'),
    awsConfig: join(home, '.aws', 'config'),
    adc: adcEnv || join(home, '.config', 'gcloud', 'application_default_credentials.json'),
  };
}

export interface HostProcessResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

/** Injectable low-level spawn. Production defaults use node:child_process.spawn. */
export type HostSpawn = (
  command: string,
  args: readonly string[],
  stdin?: string,
) => Promise<HostProcessResult>;

/** Git credential fill runner: stdin protocol blob → stdout text. */
export type GitRun = (input: { readonly stdin: string }) => Promise<string>;

/** Docker credential helper runner. */
export type DockerRun = (input: {
  readonly helper: string;
  readonly stdin: string;
}) => Promise<string>;

/** Keychain dump runner (stdout of `security dump-keychain`). */
export type KeychainListRun = () => Promise<string>;

/** Keychain password runner (stdout of `security find-generic-password -w`). */
export type KeychainGetRun = (query: KeychainItem) => Promise<string>;

/** `ssh-add -L` runner. */
export type SshListRun = () => Promise<string>;

/** AWS credential_process runner. */
export type AwsProcessRun = (input: { readonly command: string }) => Promise<string>;

async function spawnCapture(
  command: string,
  args: readonly string[],
  stdin?: string,
): Promise<HostProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    });
    child.on('error', (err) => {
      reject(err instanceof Error ? err : new Error('spawn_failed'));
    });
    child.on('close', (code) => {
      resolve({ stdout, stderr, code: code ?? 1 });
    });
    if (stdin != null && stdin !== '') {
      child.stdin?.write(stdin);
    }
    child.stdin?.end();
  });
}

function buildGitCredentialStdin(query: GitCredentialHelperQuery): string {
  const lines: string[] = [];
  if (query.protocol) lines.push(`protocol=${query.protocol}`);
  if (query.host) lines.push(`host=${query.host}`);
  if (query.path) lines.push(`path=${query.path}`);
  if (query.username) lines.push(`username=${query.username}`);
  return `${lines.join('\n')}\n\n`;
}

/** Parse `git credential fill` / helper protocol output. */
export function parseGitCredentialFill(stdout: string): GitCredentialHelperSecret {
  const out: { username?: string; password?: string } = {};
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).toLowerCase();
    const value = line.slice(eq + 1);
    if (key === 'username') out.username = value;
    else if (key === 'password') out.password = value;
  }
  return out;
}

async function defaultGitRun(input: { readonly stdin: string }): Promise<string> {
  const result = await spawnCapture('git', ['credential', 'fill'], input.stdin);
  if (result.code !== 0) throw new Error('git_credential_fill_failed');
  return result.stdout;
}

/**
 * Production git credential fill. Inject `run` in tests — never spawn real git there.
 * Fail-closed to {}. Never embeds password in thrown errors.
 */
export function createGitCredentialFill(run?: GitRun): GitCredentialHelperFill {
  const exec = run ?? defaultGitRun;
  return async (query) => {
    try {
      const stdout = await exec({ stdin: buildGitCredentialStdin(query) });
      if (!stdout || !stdout.trim()) return {};
      return parseGitCredentialFill(stdout);
    } catch {
      return {};
    }
  };
}

/** Parse docker-credential-* `get` JSON. Fail-closed to {}. */
export function parseDockerCredentialGet(stdout: string): DockerCredentialHelperSecret {
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const rec = parsed as Record<string, unknown>;
    const Username = typeof rec.Username === 'string' ? rec.Username : undefined;
    const Secret = typeof rec.Secret === 'string' ? rec.Secret : undefined;
    return { Username, Secret };
  } catch {
    return {};
  }
}

async function defaultDockerRun(input: {
  readonly helper: string;
  readonly stdin: string;
}): Promise<string> {
  const helper = input.helper.replace(/[^A-Za-z0-9._-]/g, '');
  if (!helper) throw new Error('docker_helper_invalid');
  const result = await spawnCapture(`docker-credential-${helper}`, ['get'], `${input.stdin}\n`);
  if (result.code !== 0) throw new Error('docker_credential_get_failed');
  return result.stdout;
}

/** Production docker-credential-* get. Inject `run` in tests. */
export function createDockerCredentialGet(run?: DockerRun): DockerCredentialHelperGet {
  const exec = run ?? defaultDockerRun;
  return async (query) => {
    try {
      if (!query.helper || !query.serverUrl) return {};
      const stdout = await exec({ helper: query.helper, stdin: query.serverUrl });
      if (!stdout || !stdout.trim()) return {};
      return parseDockerCredentialGet(stdout);
    } catch {
      return {};
    }
  };
}

const SVCE_RE = /"svce"<blob>="((?:\\.|[^"\\])*)"/;
const ACCT_RE = /"acct"<blob>="((?:\\.|[^"\\])*)"/;

function unescapeBlob(value: string): string {
  return value.replace(/\\([\\"])/g, '$1');
}

/**
 * Parse `security dump-keychain` text.
 * Extracts only `"svce"<blob>` and `"acct"<blob>` — password fields are dropped.
 */
export function parseKeychainDump(dump: string): KeychainItem[] {
  const items: KeychainItem[] = [];
  let service: string | undefined;
  let account: string | undefined;

  const flush = () => {
    if (service && account) items.push({ service, account });
    service = undefined;
    account = undefined;
  };

  for (const raw of dump.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^keychain:/i.test(line) || /^class:/i.test(line)) {
      flush();
      continue;
    }
    const svce = line.match(SVCE_RE);
    if (svce?.[1] != null) {
      service = unescapeBlob(svce[1]);
      continue;
    }
    const acct = line.match(ACCT_RE);
    if (acct?.[1] != null) {
      account = unescapeBlob(acct[1]);
    }
  }
  flush();
  return items;
}

async function defaultKeychainListRun(): Promise<string> {
  const result = await spawnCapture('security', ['dump-keychain']);
  if (result.code !== 0) throw new Error('keychain_dump_failed');
  return result.stdout;
}

/** Production Keychain list via `security dump-keychain`. Inject `run` in tests. */
export function createKeychainList(run?: KeychainListRun): KeychainList {
  const exec = run ?? defaultKeychainListRun;
  return async () => {
    try {
      const dump = await exec();
      if (!dump || !dump.trim()) return [];
      return parseKeychainDump(dump);
    } catch {
      return [];
    }
  };
}

async function defaultKeychainGetRun(query: KeychainItem): Promise<string> {
  const result = await spawnCapture('security', [
    'find-generic-password',
    '-s',
    query.service,
    '-a',
    query.account,
    '-w',
  ]);
  if (result.code !== 0) throw new Error('keychain_get_failed');
  return result.stdout.replace(/\r?\n$/, '');
}

/** Production Keychain get via `security find-generic-password -w`. Inject `run` in tests. */
export function createKeychainGet(run?: KeychainGetRun): KeychainGet {
  const exec = run ?? defaultKeychainGetRun;
  return async (query) => {
    try {
      if (!query.service || !query.account) return {};
      const password = await exec(query);
      if (!password) return {};
      return { password };
    } catch {
      return {};
    }
  };
}

const SSH_PUBKEY_RE =
  /^(ssh-(?:rsa|ed25519|dss)|ecdsa-sha2-\S+|sk-ssh-\S+|sk-ecdsa-\S+)\s+(\S+)(?:\s+(.*))?$/;

/**
 * Parse `ssh-add -L` public keys into { comment, fingerprint }.
 * Fingerprint is SHA-256 of the public key line (hex). Private key blocks are omitted.
 */
export function parseSshAgentList(text: string): SshAgentIdentity[] {
  const out: SshAgentIdentity[] = [];
  let inPrivateBlock = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^-----BEGIN\s+.*PRIVATE KEY-----/.test(line)) {
      inPrivateBlock = true;
      continue;
    }
    if (/^-----END\s+.*PRIVATE KEY-----/.test(line)) {
      inPrivateBlock = false;
      continue;
    }
    if (inPrivateBlock) continue;
    if (/PRIVATE KEY/i.test(line)) continue;
    const match = line.match(SSH_PUBKEY_RE);
    if (!match) continue;
    const comment = (match[3] ?? '').trim();
    const fingerprint = `SHA256:${createHash('sha256').update(line, 'utf8').digest('hex')}`;
    out.push({ comment, fingerprint });
  }
  return out;
}

async function defaultSshListRun(): Promise<string> {
  const result = await spawnCapture('ssh-add', ['-L']);
  if (result.code !== 0) throw new Error('ssh_add_list_failed');
  return result.stdout;
}

/** Production SSH agent list via `ssh-add -L`. Inject `run` in tests. */
export function createSshAgentList(run?: SshListRun): SshAgentList {
  const exec = run ?? defaultSshListRun;
  return async () => {
    try {
      const text = await exec();
      if (!text || !text.trim()) return [];
      return parseSshAgentList(text);
    } catch {
      return [];
    }
  };
}

/** Parse AWS credential_process JSON. Fail-closed to {}. */
export function parseAwsCredentialProcess(stdout: string): AwsCredentialProcessSecret {
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const rec = parsed as Record<string, unknown>;
    return {
      AccessKeyId: typeof rec.AccessKeyId === 'string' ? rec.AccessKeyId : undefined,
      SecretAccessKey: typeof rec.SecretAccessKey === 'string' ? rec.SecretAccessKey : undefined,
      SessionToken: typeof rec.SessionToken === 'string' ? rec.SessionToken : undefined,
    };
  } catch {
    return {};
  }
}

async function defaultAwsProcessRun(input: { readonly command: string }): Promise<string> {
  const command = input.command.trim();
  if (!command) throw new Error('aws_credential_process_empty');
  const result = await spawnCapture('/bin/sh', ['-c', command]);
  if (result.code !== 0) throw new Error('aws_credential_process_failed');
  return result.stdout;
}

/** Production AWS credential_process runner. Inject `run` in tests. */
export function createAwsCredentialProcessRun(run?: AwsProcessRun): AwsCredentialProcessRun {
  const exec = run ?? defaultAwsProcessRun;
  return async (query) => {
    try {
      if (!query.command) return {};
      const stdout = await exec({ command: query.command });
      if (!stdout || !stdout.trim()) return {};
      return parseAwsCredentialProcess(stdout);
    } catch {
      return {};
    }
  };
}
