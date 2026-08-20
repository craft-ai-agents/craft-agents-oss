/**
 * File-backed Identity Center store.
 *
 * Path: `{configDir}/identity.json`
 * Secrets are NEVER written here — only Profile / ServiceConnection / Entitlement.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { userInfo } from 'node:os';
import { randomUUID } from 'node:crypto';
import type {
  ConnectServiceInput,
  Entitlement,
  IdentityFile,
  IdentityState,
  Profile,
  ServiceConnection,
  ServiceConnectionStatus,
  UpdateProfileInput,
} from './types.ts';

const FILE_VERSION = 1 as const;
const FILE_NAME = 'identity.json';

function defaultDisplayName(): string {
  try {
    const name = userInfo().username?.trim();
    if (name) return name;
  } catch {
    /* ignore — sandboxed / missing passwd */
  }
  return 'Local User';
}

export function createDefaultProfile(): Profile {
  return {
    id: 'local',
    displayName: defaultDisplayName(),
    mode: 'local',
  };
}

function emptyFile(profile: Profile = createDefaultProfile()): IdentityFile {
  return {
    version: FILE_VERSION,
    profile,
    connections: [],
    entitlements: [],
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseProfile(raw: unknown, fallback: Profile): Profile {
  if (!isObject(raw)) return fallback;
  const id = typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : fallback.id;
  const displayName =
    typeof raw.displayName === 'string' && raw.displayName.trim().length > 0
      ? raw.displayName.trim()
      : fallback.displayName;
  const mode = raw.mode === 'cloud' ? 'cloud' : 'local';
  const avatar = typeof raw.avatar === 'string' ? raw.avatar : undefined;
  return avatar !== undefined ? { id, displayName, mode, avatar } : { id, displayName, mode };
}

const VALID_PROVIDERS = new Set([
  'siyuan-local',
  'siyuan-cloud',
  'github',
  'openai',
  'anthropic',
  'google',
  'slack',
  'custom',
]);

const VALID_STATUSES = new Set<ServiceConnectionStatus>([
  'connected',
  'expired',
  'syncing',
  'error',
  'disconnected',
]);

function parseConnection(raw: unknown): ServiceConnection | null {
  if (!isObject(raw)) return null;
  if (typeof raw.id !== 'string' || raw.id.length === 0) return null;
  if (typeof raw.workspaceId !== 'string' || raw.workspaceId.length === 0) return null;
  if (typeof raw.provider !== 'string' || !VALID_PROVIDERS.has(raw.provider)) return null;
  const status =
    typeof raw.status === 'string' && VALID_STATUSES.has(raw.status as ServiceConnectionStatus)
      ? (raw.status as ServiceConnectionStatus)
      : 'disconnected';
  const connection: ServiceConnection = {
    id: raw.id,
    workspaceId: raw.workspaceId,
    provider: raw.provider as ServiceConnection['provider'],
    status,
  };
  if (typeof raw.accountLabel === 'string') connection.accountLabel = raw.accountLabel;
  if (typeof raw.credentialRef === 'string') connection.credentialRef = raw.credentialRef;
  if (raw.readOnly === true) connection.readOnly = true;
  return connection;
}

function parseEntitlement(raw: unknown): Entitlement | null {
  if (!isObject(raw)) return null;
  if (typeof raw.provider !== 'string' || raw.provider.length === 0) return null;
  if (typeof raw.product !== 'string' || raw.product.length === 0) return null;
  const status =
    raw.status === 'active' || raw.status === 'expired' || raw.status === 'trial'
      ? raw.status
      : 'trial';
  const entitlement: Entitlement = {
    provider: raw.provider,
    product: raw.product,
    status,
  };
  if (typeof raw.expiresAt === 'number' && Number.isFinite(raw.expiresAt)) {
    entitlement.expiresAt = raw.expiresAt;
  }
  return entitlement;
}

function parseFile(raw: unknown): IdentityFile {
  const fallback = emptyFile();
  if (!isObject(raw)) return fallback;
  const profile = parseProfile(raw.profile, fallback.profile);
  const connections = Array.isArray(raw.connections)
    ? raw.connections.map(parseConnection).filter((c): c is ServiceConnection => c !== null)
    : [];
  const entitlements = Array.isArray(raw.entitlements)
    ? raw.entitlements.map(parseEntitlement).filter((e): e is Entitlement => e !== null)
    : [];
  return { version: FILE_VERSION, profile, connections, entitlements };
}

export interface IdentityStoreOptions {
  /** Absolute path to config directory (e.g. CONFIG_DIR). */
  configDir: string;
}

export class IdentityStore {
  readonly filePath: string;
  private data: IdentityFile;

  constructor(options: IdentityStoreOptions) {
    this.filePath = join(options.configDir, FILE_NAME);
    this.data = this.loadFromDisk();
  }

  /** Reload from disk (e.g. after external write). */
  reload(): IdentityState {
    this.data = this.loadFromDisk();
    return this.getState();
  }

  getState(): IdentityState {
    return {
      profile: { ...this.data.profile },
      connections: this.data.connections.map((c) => ({ ...c })),
      entitlements: this.data.entitlements.map((e) => ({ ...e })),
    };
  }

  getProfile(): Profile {
    return { ...this.data.profile };
  }

  updateProfile(input: UpdateProfileInput): Profile {
    const next: Profile = { ...this.data.profile };
    if (typeof input.displayName === 'string') {
      const trimmed = input.displayName.trim();
      if (trimmed.length > 0) next.displayName = trimmed;
    }
    if (input.avatar !== undefined) {
      if (input.avatar === null || input.avatar === '') {
        delete next.avatar;
      } else {
        next.avatar = input.avatar;
      }
    }
    if (input.mode === 'local' || input.mode === 'cloud') {
      next.mode = input.mode;
    }
    this.data = { ...this.data, profile: next };
    this.persist();
    return this.getProfile();
  }

  listConnections(workspaceId?: string): ServiceConnection[] {
    const all = this.data.connections.map((c) => ({ ...c }));
    if (!workspaceId) return all;
    return all.filter((c) => c.workspaceId === workspaceId);
  }

  getConnection(connectionId: string): ServiceConnection | undefined {
    const found = this.data.connections.find((c) => c.id === connectionId);
    return found ? { ...found } : undefined;
  }

  /**
   * Upsert a service connection owned by Identity Center.
   * Does not touch credentials — caller stores secrets via CredentialManager.
   */
  connect(input: ConnectServiceInput): ServiceConnection {
    const id = input.connectionId?.trim() || `svc-${input.provider}-${randomUUID().slice(0, 8)}`;
    const existingIdx = this.data.connections.findIndex((c) => c.id === id);
    const credentialRef =
      input.credentialValue !== undefined && input.credentialValue.length > 0
        ? id
        : existingIdx >= 0
          ? this.data.connections[existingIdx]?.credentialRef
          : undefined;

    const connection: ServiceConnection = {
      id,
      workspaceId: input.workspaceId,
      provider: input.provider,
      status: 'connected',
    };
    if (input.accountLabel !== undefined && input.accountLabel.length > 0) {
      connection.accountLabel = input.accountLabel;
    } else if (existingIdx >= 0 && this.data.connections[existingIdx]?.accountLabel) {
      connection.accountLabel = this.data.connections[existingIdx]!.accountLabel;
    }
    if (credentialRef) connection.credentialRef = credentialRef;

    if (existingIdx >= 0) {
      const next = [...this.data.connections];
      next[existingIdx] = connection;
      this.data = { ...this.data, connections: next };
    } else {
      this.data = { ...this.data, connections: [...this.data.connections, connection] };
    }

    // Default entitlement for siyuan-cloud when connected (no live API in v1).
    if (input.provider === 'siyuan-cloud') {
      this.ensureSiyuanCloudEntitlement('trial');
    }

    this.persist();
    return { ...connection };
  }

  /**
   * Mark a connection disconnected and drop its local metadata link.
   * Credential deletion is the caller's responsibility (identity RPC handler).
   * Returns the prior connection (for credential cleanup) or undefined.
   */
  disconnect(connectionId: string): ServiceConnection | undefined {
    const idx = this.data.connections.findIndex((c) => c.id === connectionId);
    if (idx < 0) return undefined;
    const prior = { ...this.data.connections[idx]! };
    if (prior.readOnly) {
      // LLM reflections are not owned here — refuse.
      return undefined;
    }
    const nextConn: ServiceConnection = {
      ...prior,
      status: 'disconnected',
    };
    delete nextConn.credentialRef;
    const connections = [...this.data.connections];
    connections[idx] = nextConn;
    this.data = { ...this.data, connections };
    this.persist();
    return prior;
  }

  setConnectionStatus(connectionId: string, status: ServiceConnectionStatus): ServiceConnection | undefined {
    const idx = this.data.connections.findIndex((c) => c.id === connectionId);
    if (idx < 0) return undefined;
    const next = [...this.data.connections];
    next[idx] = { ...next[idx]!, status };
    this.data = { ...this.data, connections: next };
    this.persist();
    return { ...next[idx]! };
  }

  replaceDerivedConnections(
    owned: ServiceConnection[],
    derived: ServiceConnection[],
  ): void {
    // Keep only non-derived owned rows, then append derived reflections.
    const kept = owned.filter((c) => !c.readOnly);
    this.data = {
      ...this.data,
      connections: [...kept, ...derived],
    };
    this.persist();
  }

  /**
   * Replace status/fields for owned connections after a refresh pass.
   * `owned` should exclude read-only reflections (those are rebuilt each refresh).
   */
  saveOwnedConnections(owned: ServiceConnection[]): void {
    const reflections = this.data.connections.filter((c) => c.readOnly);
    this.data = {
      ...this.data,
      connections: [...owned.map((c) => ({ ...c })), ...reflections],
    };
    this.persist();
  }

  listEntitlements(): Entitlement[] {
    return this.data.entitlements.map((e) => ({ ...e }));
  }

  upsertEntitlement(entitlement: Entitlement): Entitlement {
    const idx = this.data.entitlements.findIndex(
      (e) => e.provider === entitlement.provider && e.product === entitlement.product,
    );
    const next = [...this.data.entitlements];
    if (idx >= 0) next[idx] = { ...entitlement };
    else next.push({ ...entitlement });
    this.data = { ...this.data, entitlements: next };
    this.persist();
    return { ...entitlement };
  }

  ensureSiyuanCloudEntitlement(status: Entitlement['status'] = 'trial'): Entitlement {
    const existing = this.data.entitlements.find(
      (e) => e.provider === 'siyuan-cloud' && e.product === 'cloud-sync',
    );
    if (existing) return { ...existing };
    return this.upsertEntitlement({
      provider: 'siyuan-cloud',
      product: 'cloud-sync',
      status,
    });
  }

  /**
   * Reset owned connections and entitlements (e.g. auth.LOGOUT / reset app data).
   * Keeps a local profile shell; regenerates default displayName when wiping.
   */
  clear(options: { resetProfile?: boolean } = {}): IdentityState {
    const profile =
      options.resetProfile === false
        ? { ...this.data.profile, mode: 'local' as const }
        : createDefaultProfile();
    this.data = emptyFile(profile);
    this.persist();
    return this.getState();
  }

  private loadFromDisk(): IdentityFile {
    if (!existsSync(this.filePath)) {
      const initial = emptyFile();
      // Persist default profile so cold start is stable across processes.
      this.writeAtomic(initial);
      return initial;
    }
    try {
      const text = readFileSync(this.filePath, 'utf8');
      const json = JSON.parse(text) as unknown;
      return parseFile(json);
    } catch {
      return emptyFile();
    }
  }

  private persist(): void {
    this.writeAtomic(this.data);
  }

  private writeAtomic(data: IdentityFile): void {
    const dir = dirname(this.filePath);
    mkdirSync(dir, { recursive: true });
    // Strip any accidental secret-looking fields — defense in depth.
    const safe: IdentityFile = {
      version: FILE_VERSION,
      profile: { ...data.profile },
      connections: data.connections.map((c) => {
        const copy: ServiceConnection = {
          id: c.id,
          workspaceId: c.workspaceId,
          provider: c.provider,
          status: c.status,
        };
        if (c.accountLabel !== undefined) copy.accountLabel = c.accountLabel;
        if (c.credentialRef !== undefined) copy.credentialRef = c.credentialRef;
        if (c.readOnly === true) copy.readOnly = true;
        return copy;
      }),
      entitlements: data.entitlements.map((e) => {
        const copy: Entitlement = {
          provider: e.provider,
          product: e.product,
          status: e.status,
        };
        if (e.expiresAt !== undefined) copy.expiresAt = e.expiresAt;
        return copy;
      }),
    };
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(safe, null, 2)}\n`, 'utf8');
    renameSync(tmp, this.filePath);
  }
}

/** Singleton keyed by configDir for process-local reuse. */
const stores = new Map<string, IdentityStore>();

export function getIdentityStore(configDir: string): IdentityStore {
  let store = stores.get(configDir);
  if (!store) {
    store = new IdentityStore({ configDir });
    stores.set(configDir, store);
  }
  return store;
}

/** Test helper — drop cached singletons. */
export function resetIdentityStoreCache(): void {
  stores.clear();
}
