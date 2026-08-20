import { existsSync } from 'fs';
import { join } from 'path';
import { ensureConfigDir } from './storage.ts';
import { CONFIG_DIR } from './paths.ts';
import { readJsonFileSync, atomicWriteFileSync } from '../utils/files.ts';
import { generateSlug } from '../utils/slug.ts';
import { getCredentialManager } from '../credentials/manager.ts';
import { DEFAULT_SERVER_CONFIG } from './server-config.ts';

/** Default SSH port. */
export const DEFAULT_SSH_PORT = 22;

/** Default craft-agent server port on the remote (mirrors DEFAULT_SERVER_CONFIG.port). */
export const DEFAULT_REMOTE_SERVER_PORT = DEFAULT_SERVER_CONFIG.port;

export interface SshHostConfig {
  /** Stable id / slug for this host. */
  id: string;
  /** Human-friendly label shown in the UI. */
  label: string;
  /** Hostname or IP to connect to (ssh HostName). */
  host: string;
  /** SSH port. Defaults to 22. */
  port: number;
  /** SSH login user. */
  user: string;
  /** Optional path to a private key file (ssh IdentityFile). */
  identityFile?: string;
  /** craft-agent server port on the remote host. Defaults to the server default. */
  remotePort: number;
  /** True when this entry was imported from ~/.ssh/config (read-only suggestion). */
  imported?: boolean;
  /** Last time this record was written. */
  updatedAt?: number;
}

/** A host parsed from ~/.ssh/config, before it is saved as a managed host. */
export interface SshConfigImportSuggestion {
  /** The `Host` alias from ssh config (used as label + slug seed). */
  alias: string;
  host: string;
  port: number;
  user?: string;
  identityFile?: string;
}

const SSH_HOSTS_FILE = join(CONFIG_DIR, 'ssh-hosts.json');

/** On-disk record. `managedToken` is a legacy field migrated to the credential store lazily on first read. */
type StoredSshHost = SshHostConfig & { managedToken?: string };

interface SshHostsFile {
  hosts: StoredSshHost[];
  updatedAt?: number;
}

/** Turn an arbitrary string into a stable, filesystem/url-safe slug. */
export function slugifyHostId(input: string): string {
  return generateSlug(input, 'host');
}

/** Read the raw on-disk records, including any legacy plaintext `managedToken`s. */
function readHostsFile(): StoredSshHost[] {
  try {
    if (!existsSync(SSH_HOSTS_FILE)) return [];
    const raw = readJsonFileSync<SshHostsFile>(SSH_HOSTS_FILE);
    if (!raw || !Array.isArray(raw.hosts)) return [];
    return raw.hosts;
  } catch {
    return [];
  }
}

export function loadSshHosts(): SshHostConfig[] {
  return readHostsFile().map(normalizeHost);
}

function saveSshHosts(hosts: SshHostConfig[]): void {
  // Rescue any not-yet-migrated legacy plaintext tokens into the credential store
  // before the stripped list overwrites the file (see loadManagedToken read-path migration).
  const keep = new Set(hosts.map((h) => h.id));
  for (const record of readHostsFile()) {
    if (record.managedToken && keep.has(record.id)) {
      void getCredentialManager()
        .setSshManagedToken(record.id, record.managedToken)
        .catch(() => {});
    }
  }
  ensureConfigDir();
  const payload: SshHostsFile = { hosts, updatedAt: Date.now() };
  atomicWriteFileSync(SSH_HOSTS_FILE, JSON.stringify(payload, null, 2));
}

function normalizeHost(host: StoredSshHost): SshHostConfig {
  const { managedToken: _legacyToken, ...rest } = host;
  return {
    ...rest,
    port: host.port || DEFAULT_SSH_PORT,
    remotePort: host.remotePort || DEFAULT_REMOTE_SERVER_PORT,
  };
}

/** Ensure a unique id: if `id` is taken, append `-2`, `-3`, ... */
function ensureUniqueId(id: string, existing: SshHostConfig[]): string {
  const taken = new Set(existing.map((h) => h.id));
  if (!taken.has(id)) return id;
  let n = 2;
  while (taken.has(`${id}-${n}`)) n++;
  return `${id}-${n}`;
}

export type SshHostInput = Omit<SshHostConfig, 'id' | 'port' | 'remotePort' | 'updatedAt'> &
  Partial<Pick<SshHostConfig, 'id' | 'port' | 'remotePort'>>;

export function addSshHost(input: SshHostInput): SshHostConfig {
  const hosts = loadSshHosts();
  const baseId = input.id ? slugifyHostId(input.id) : slugifyHostId(input.label || input.host);
  const host: SshHostConfig = normalizeHost({
    ...input,
    id: ensureUniqueId(baseId, hosts),
    port: input.port ?? DEFAULT_SSH_PORT,
    remotePort: input.remotePort ?? DEFAULT_REMOTE_SERVER_PORT,
    updatedAt: Date.now(),
  });
  saveSshHosts([...hosts, host]);
  return host;
}

export function updateSshHost(
  id: string,
  updates: Partial<Omit<SshHostConfig, 'id'>>,
): SshHostConfig | undefined {
  const hosts = loadSshHosts();
  const existing = hosts.find((h) => h.id === id);
  const idx = hosts.findIndex((h) => h.id === id);
  if (idx === -1 || !existing) return undefined;
  const updated = normalizeHost({
    ...existing,
    ...updates,
    id,
    updatedAt: Date.now(),
  });
  hosts[idx] = updated;
  saveSshHosts(hosts);
  return updated;
}

export function deleteSshHost(id: string): boolean {
  const hosts = loadSshHosts();
  const next = hosts.filter((h) => h.id !== id);
  if (next.length === hosts.length) return false;
  saveSshHosts(next);
  // Deleting a host also deletes its managed-server token.
  getCredentialManager().deleteSync({ type: 'ssh_managed_token', hostId: id });
  return true;
}

export function getSshHost(id: string): SshHostConfig | undefined {
  return loadSshHosts().find((h) => h.id === id);
}

export function getSshHostsPath(): string {
  return SSH_HOSTS_FILE;
}

// Managed server auth tokens: the token is a secret, so it lives in the encrypted
// credential store (keyed by host id), never in ssh-hosts.json. Legacy plaintext migrated on read.

/** Migrate all legacy plaintext tokens into the credential store and strip them from the file. */
async function migrateLegacyManagedTokens(records: StoredSshHost[]): Promise<void> {
  const creds = getCredentialManager();
  for (const record of records) {
    if (record.managedToken) {
      await creds.setSshManagedToken(record.id, record.managedToken);
    }
  }
  // Rewrite the file without the token fields (saveSshHosts strips them).
  saveSshHosts(records.map(normalizeHost));
}

/** Get the managed-server auth token for a host, migrating legacy plaintext tokens out of ssh-hosts.json on first read. */
export async function loadManagedToken(hostId: string): Promise<string | undefined> {
  const stored = await getCredentialManager().getSshManagedToken(hostId);
  if (stored) return stored;
  // Lazy migration: legacy files stored the token as a plaintext field.
  const records = readHostsFile();
  const legacy = records.find((h) => h.id === hostId)?.managedToken;
  if (!legacy) return undefined;
  await migrateLegacyManagedTokens(records);
  return legacy;
}

/** Store the managed-server auth token for a host in the credential store. */
export async function storeManagedToken(hostId: string, token: string): Promise<void> {
  await getCredentialManager().setSshManagedToken(hostId, token);
}

/** Delete the managed-server auth token for a host. */
export async function deleteManagedToken(hostId: string): Promise<boolean> {
  return getCredentialManager().deleteSshManagedToken(hostId);
}
