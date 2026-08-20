/**
 * Provider-neutral credential metadata contracts (Connection Fabric CF-1).
 *
 * These types intentionally contain no secret payload. Secret material belongs
 * to a provider envelope and is never accepted by the metadata registry.
 */


export type StorageMode = 'reference' | 'copy' | 'mirror' | 'managed' | 'ephemeral';

export type CredentialKind =
  | 'api_key'
  | 'oauth2_token_set'
  | 'bearer_token'
  | 'basic_auth'
  | 'aws_credential_source'
  | 'gcp_adc'
  | 'ssh_agent_identity'
  | 'x509_identity'
  | 'opaque_bundle'
  | 'browser_session';

export type CredentialRefId = `cred_${string}`;

export type ProviderLocator =
  | { type: 'local'; key: string }
  | { type: 'keychain'; service: string; account: string }
  | { type: 'infisical'; projectId: string; environment: string; secretPath: string; secretKey: string }
  | { type: 'opaque'; provider: string; locator: string };

export type CredentialVersionStatus = 'active' | 'superseded' | 'revoked' | 'invalid';

export interface CredentialRef {
  readonly id: CredentialRefId;
  readonly kind: CredentialKind;
  readonly providerId: string;
  readonly locator: ProviderLocator;
  readonly currentVersionId?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface CredentialVersion {
  readonly id: string;
  readonly credentialRefId: CredentialRefId;
  readonly codec: string;
  readonly fingerprint: string;
  readonly providerVersion?: string;
  readonly createdAt: number;
  readonly expiresAt?: number;
  readonly status: CredentialVersionStatus;
}

export interface RegisterCredentialRefInput {
  readonly id?: CredentialRefId;
  readonly kind: CredentialKind;
  readonly providerId: string;
  readonly locator: ProviderLocator;
  readonly currentVersionId?: string;
  readonly now?: number;
}

export interface RegisterCredentialVersionInput {
  readonly id?: string;
  readonly credentialRefId: CredentialRefId;
  readonly codec: string;
  readonly fingerprint: string;
  readonly providerVersion?: string;
  readonly createdAt?: number;
  readonly expiresAt?: number;
  readonly status?: CredentialVersionStatus;
}

export type CredentialRefIdFactory = () => CredentialRefId;

const CREDENTIAL_REF_ID_PATTERN = /^cred_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isCredentialRefId(value: unknown): value is CredentialRefId {
  return typeof value === 'string' && CREDENTIAL_REF_ID_PATTERN.test(value);
}

export function createCredentialRefId(): CredentialRefId {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (!uuid) throw new Error('Secure random UUID is unavailable');
  return `cred_${uuid}`;
}
const CREDENTIAL_KINDS: readonly CredentialKind[] = [
  'api_key',
  'oauth2_token_set',
  'bearer_token',
  'basic_auth',
  'aws_credential_source',
  'gcp_adc',
  'ssh_agent_identity',
  'x509_identity',
  'opaque_bundle',
  'browser_session',
];

const VERSION_STATUSES: readonly CredentialVersionStatus[] = ['active', 'superseded', 'revoked', 'invalid'];
const STORAGE_MODES: readonly StorageMode[] = ['reference', 'copy', 'mirror', 'managed', 'ephemeral'];

export function isCredentialKind(value: unknown): value is CredentialKind {
  return typeof value === 'string' && CREDENTIAL_KINDS.includes(value as CredentialKind);
}

export function isStorageMode(value: unknown): value is StorageMode {
  return typeof value === 'string' && STORAGE_MODES.includes(value as StorageMode);
}

function isVersionStatus(value: unknown): value is CredentialVersionStatus {
  return typeof value === 'string' && VERSION_STATUSES.includes(value as CredentialVersionStatus);
}

const VERSION_FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

const CREDENTIAL_REF_REGISTRIES = new WeakSet<object>();

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid credential metadata: ${field}`);
  }
  return value.trim();
}

function finiteTimestamp(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid credential metadata: ${field}`);
  }
  return value;
}

function assertAllowedFields(value: unknown, allowed: readonly string[], label: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid credential metadata: ${label}`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.includes(key) || Object.getOwnPropertyDescriptor(value, key)?.enumerable !== true) {
      throw new Error(`Invalid credential metadata field: ${String(key)}`);
    }
  }
}
function validateLocator(locator: ProviderLocator): ProviderLocator {
  if (!locator || typeof locator !== 'object' || Array.isArray(locator) || Object.getPrototypeOf(locator) !== Object.prototype) {
    throw new Error('Invalid credential metadata: locator');
  }

  switch (locator.type) {
    case 'local':
      assertAllowedFields(locator, ['type', 'key'], 'locator');
      return { type: 'local', key: nonEmptyString(locator.key, 'locator.key') };
    case 'keychain':
      assertAllowedFields(locator, ['type', 'service', 'account'], 'locator');
      return {
        type: 'keychain',
        service: nonEmptyString(locator.service, 'locator.service'),
        account: nonEmptyString(locator.account, 'locator.account'),
      };
    case 'infisical':
      assertAllowedFields(locator, ['type', 'projectId', 'environment', 'secretPath', 'secretKey'], 'locator');
      return {
        type: 'infisical',
        projectId: nonEmptyString(locator.projectId, 'locator.projectId'),
        environment: nonEmptyString(locator.environment, 'locator.environment'),
        secretPath: nonEmptyString(locator.secretPath, 'locator.secretPath'),
        secretKey: nonEmptyString(locator.secretKey, 'locator.secretKey'),
      };
    case 'opaque':
      assertAllowedFields(locator, ['type', 'provider', 'locator'], 'locator');
      return {
        type: 'opaque',
        provider: nonEmptyString(locator.provider, 'locator.provider'),
        locator: nonEmptyString(locator.locator, 'locator.locator'),
      };
    default:
      throw new Error('Invalid credential metadata: locator.type');
  }
}

function cloneLocator(locator: ProviderLocator): ProviderLocator {
  return { ...locator } as ProviderLocator;
}

function cloneRef(ref: CredentialRef): CredentialRef {
  return { ...ref, locator: cloneLocator(ref.locator) };
}

function cloneVersion(version: CredentialVersion): CredentialVersion {
  return { ...version };
}

/**
 * Metadata-only registry. It cannot accept StoredCredential or envelope data by
 * construction, and its runtime validation rejects malformed metadata.
 */
export class CredentialRefRegistry {
  private readonly refs = new Map<CredentialRefId, CredentialRef>();
  private readonly versions = new Map<string, CredentialVersion>();
  private readonly idFactory: CredentialRefIdFactory;
  private sequence = 0;

  constructor(idFactory: CredentialRefIdFactory = createCredentialRefId) {
    this.idFactory = idFactory;
    CREDENTIAL_REF_REGISTRIES.add(this);
  }

  register(input: RegisterCredentialRefInput): CredentialRef {
    assertAllowedFields(input, ['id', 'kind', 'providerId', 'locator', 'currentVersionId', 'now'], 'ref');
    const id = input.id ?? this.idFactory();
    if (!isCredentialRefId(id)) throw new Error('Invalid credential metadata: id');
    if (this.refs.has(id)) throw new Error(`CredentialRef already exists: ${id}`);
    if (!isCredentialKind(input.kind)) throw new Error('Invalid credential metadata: kind');
    if (input.currentVersionId) {
      const pointed = this.versions.get(input.currentVersionId);
      if (!pointed || pointed.credentialRefId !== id) {
        throw new Error('Invalid credential metadata: currentVersionId');
      }
    }

    const providerId = nonEmptyString(input.providerId, 'providerId');
    const locator = validateLocator(input.locator);
    const now = input.now ?? Date.now();
    const createdAt = finiteTimestamp(now, 'createdAt');
    const ref: CredentialRef = {
      id,
      kind: input.kind,
      providerId,
      locator,
      ...(input.currentVersionId ? { currentVersionId: nonEmptyString(input.currentVersionId, 'currentVersionId') } : {}),
      createdAt,
      updatedAt: createdAt,
    };
    this.refs.set(id, ref);
    return cloneRef(ref);
  }

  get(id: CredentialRefId): CredentialRef | undefined {
    const ref = this.refs.get(id);
    return ref ? cloneRef(ref) : undefined;
  }

  list(): CredentialRef[] {
    return [...this.refs.values()].map(cloneRef);
  }

  updateProvider(id: CredentialRefId, providerId: string, locator: ProviderLocator, now = Date.now()): CredentialRef {
    const current = this.requireRef(id);
    const updated: CredentialRef = {
      ...current,
      providerId: nonEmptyString(providerId, 'providerId'),
      locator: validateLocator(locator),
      updatedAt: finiteTimestamp(now, 'updatedAt'),
    };
    this.refs.set(id, updated);
    return cloneRef(updated);
  }

  registerVersion(input: RegisterCredentialVersionInput): CredentialVersion {
    assertAllowedFields(input, ['id', 'credentialRefId', 'codec', 'fingerprint', 'providerVersion', 'createdAt', 'expiresAt', 'status'], 'version');
    if (input.status !== undefined && !isVersionStatus(input.status)) {
      throw new Error('Invalid credential version status');
    }
    this.requireRef(input.credentialRefId);
    if (typeof input.fingerprint !== 'string' || !VERSION_FINGERPRINT_PATTERN.test(input.fingerprint)) {
      throw new Error('Invalid credential version field: fingerprint');
    }
    const id = input.id ?? `ver_${++this.sequence}`;
    const current = this.versions.get(id);
    if (current) throw new Error(`CredentialVersion already exists: ${id}`);
    const version: CredentialVersion = {
      id: nonEmptyString(id, 'version.id'),
      credentialRefId: input.credentialRefId,
      codec: nonEmptyString(input.codec, 'version.codec'),
      fingerprint: input.fingerprint,
      ...(input.providerVersion ? { providerVersion: nonEmptyString(input.providerVersion, 'version.providerVersion') } : {}),
      createdAt: finiteTimestamp(input.createdAt ?? Date.now(), 'version.createdAt'),
      ...(input.expiresAt !== undefined ? { expiresAt: finiteTimestamp(input.expiresAt, 'version.expiresAt') } : {}),
      status: input.status ?? 'active',
    };
    this.versions.set(version.id, version);
    if (version.status === 'active') this.activateVersion(version, version.createdAt);
    return cloneVersion(version);
  }

  getVersion(id: string): CredentialVersion | undefined {
    const version = this.versions.get(id);
    return version ? cloneVersion(version) : undefined;
  }

  listVersions(credentialRefId: CredentialRefId): CredentialVersion[] {
    this.requireRef(credentialRefId);
    return [...this.versions.values()]
      .filter((version) => version.credentialRefId === credentialRefId)
      .map(cloneVersion);
  }

  setVersionStatus(id: string, status: CredentialVersionStatus): CredentialVersion {
    if (!isVersionStatus(status)) throw new Error('Invalid credential version status');
    const current = this.versions.get(id);
    if (!current) throw new Error(`CredentialVersion not found: ${id}`);
    if ((current.status === 'revoked' || current.status === 'invalid') && status !== current.status) {
      throw new Error('Invalid credential version status');
    }
    const updatedAt = status === 'active' || status === 'revoked' || status === 'invalid' || status === 'superseded'
      ? Date.now()
      : undefined;
    const next = { ...current, status };
    this.versions.set(id, next);
    if (status === 'active') {
      this.activateVersion(next, updatedAt!);
    } else if (status === 'revoked' || status === 'invalid' || status === 'superseded') {
      const ref = this.refs.get(current.credentialRefId);
      if (ref?.currentVersionId === id) {
        this.refs.set(ref.id, { ...ref, currentVersionId: undefined, updatedAt: updatedAt! });
      }
    }
    return cloneVersion(next);
  }

  private activateVersion(version: CredentialVersion, updatedAt: number): void {
    const ref = this.requireRef(version.credentialRefId);
    if (ref.currentVersionId && ref.currentVersionId !== version.id) {
      const previous = this.versions.get(ref.currentVersionId);
      if (previous?.status === 'active') {
        this.versions.set(previous.id, { ...previous, status: 'superseded' });
      }
    }
    this.refs.set(ref.id, { ...ref, currentVersionId: version.id, updatedAt });
  }

  private requireRef(id: CredentialRefId): CredentialRef {
    const ref = this.refs.get(id);
    if (!ref) throw new Error(`CredentialRef not found: ${id}`);
    return ref;
  }
}

export function isCredentialRefRegistry(value: unknown): value is CredentialRefRegistry {
  return typeof value === 'object' && value !== null && CREDENTIAL_REF_REGISTRIES.has(value);
}