/**
 * Secure Storage Backend
 *
 * Stores credentials in an encrypted file at ~/.craft-agent/credentials.enc
 * Uses AES-256-GCM for authenticated encryption.
 *
 * Encryption key is derived from OS-native hardware UUID using PBKDF2:
 * - macOS: IOPlatformUUID (tied to logic board, never changes)
 * - Windows: MachineGuid from registry (set at OS install)
 * - Linux: /var/lib/dbus/machine-id (set at OS install)
 *
 * This is more stable than the previous hostname-based derivation, which could
 * change with network/DHCP. Legacy credentials are auto-migrated on first load.
 *
 * File format:
 *   [Header - 64 bytes]
 *   ├── Magic: "CRAFT01\0" (8 bytes)
 *   ├── Flags: uint32 LE (4 bytes) - reserved for future use
 *   ├── Salt: 32 bytes (PBKDF2 salt)
 *   ├── Reserved: 20 bytes
 *   [Encrypted Payload]
 *   ├── IV: 12 bytes (random per write)
 *   ├── Auth Tag: 16 bytes (GCM authentication)
 *   └── Ciphertext: variable (encrypted JSON)
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
  pbkdf2Sync,
  createHash,
} from 'crypto';
import { execSync } from 'child_process';
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'fs';
import { hostname, userInfo, homedir } from 'os';
import { join, dirname } from 'path';

import type {
  CredentialBackend,
  CredentialMigrationBackend,
  CredentialMigrationRecord,
  CredentialMigrationSnapshot,
} from './types.ts';
import type { CredentialId, StoredCredential } from '../types.ts';
import { credentialIdToAccount, accountToCredentialId } from '../types.ts';
import { CONFIG_DIR } from '../../config/paths.ts';

const CREDENTIALS_FILE_NAME = 'credentials.enc';

// File format constants
const MAGIC_BYTES = Buffer.from('CRAFT01\0');
const HEADER_SIZE = 64;
const MAGIC_SIZE = 8;
const FLAGS_SIZE = 4;
const SALT_SIZE = 32;
const IV_SIZE = 12;
const AUTH_TAG_SIZE = 16;
const KEY_SIZE = 32;

// PBKDF2 iterations (balance security vs startup time)
const PBKDF2_ITERATIONS = 100000;

/**
 * Get stable machine identifier using OS-native hardware UUID.
 * This is far more stable than hostname which can change with network/DHCP.
 * Falls back to username + homedir if hardware UUID unavailable.
 */
function getStableMachineId(): string {
  try {
    if (process.platform === 'darwin') {
      // macOS: IOPlatformUUID - tied to logic board, never changes
      const output = execSync(
        'ioreg -rd1 -c IOPlatformExpertDevice | grep IOPlatformUUID',
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      const match = output.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
      if (match?.[1]) return match[1];
    } else if (process.platform === 'win32') {
      // Windows: MachineGuid from registry - set at OS install
      const output = execSync(
        'reg query HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography /v MachineGuid',
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      const match = output.match(/MachineGuid\s+REG_SZ\s+(\S+)/);
      if (match?.[1]) return match[1];
    } else {
      // Linux: dbus machine-id - set at OS install
      const machineIdPath = '/var/lib/dbus/machine-id';
      const altPath = '/etc/machine-id';
      if (existsSync(machineIdPath)) {
        return readFileSync(machineIdPath, 'utf-8').trim();
      } else if (existsSync(altPath)) {
        return readFileSync(altPath, 'utf-8').trim();
      }
    }
  } catch {
    // Fall through to fallback
  }

  // Fallback: username + homedir (stable enough for most cases)
  return `${userInfo().username}:${homedir()}`;
}

/** Internal credential store structure */
interface CredentialStore {
  version: 1;
  credentials: Record<string, StoredCredential>;
  metadata: {
    createdAt: number;
    updatedAt: number;
  };
}

interface CredentialMigrationManifest {
  migrationId: string;
  createdAt: number;
  sourceChecksum: string;
  state: 'snapshot' | 'applied' | 'rolled_back';
  appliedChecksum?: string;
}

function isCredentialMigrationManifest(value: unknown): value is CredentialMigrationManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (!('migrationId' in value) || !('createdAt' in value) || !('sourceChecksum' in value) || !('state' in value)) {
    return false;
  }
  return (
    typeof value.migrationId === 'string' &&
    typeof value.createdAt === 'number' &&
    typeof value.sourceChecksum === 'string' &&
    (value.state === 'snapshot' || value.state === 'applied' || value.state === 'rolled_back') &&
    (!('appliedChecksum' in value) || typeof value.appliedChecksum === 'string')
  );
}


export class SecureStorageBackend implements CredentialMigrationBackend {
  readonly name = 'secure-storage';
  readonly priority = 100;

  private readonly credentialsDir: string;
  private readonly credentialsFile: string;
  private readonly migrationsDir: string;
  private readonly quarantineDir: string;
  private cachedStore: CredentialStore | null = null;
  private encryptionKey: Buffer | null = null;
  private salt: Buffer | null = null;

  constructor(configDir = CONFIG_DIR) {
    this.credentialsDir = configDir;
    this.credentialsFile = join(configDir, CREDENTIALS_FILE_NAME);
    this.migrationsDir = join(configDir, 'credential-migrations');
    this.quarantineDir = join(configDir, 'credential-quarantine');
  }

  async isAvailable(): Promise<boolean> {
    // File backend is always available - we can always write to filesystem
    return true;
  }

  async get(id: CredentialId): Promise<StoredCredential | null> {
    const store = await this.loadStore();
    if (!store) return null;

    const key = credentialIdToAccount(id);
    return store.credentials[key] || null;
  }

  async set(id: CredentialId, credential: StoredCredential): Promise<void> {
    let store = await this.loadStore();

    if (!store) {
      // Initialize new store
      store = {
        version: 1,
        credentials: {},
        metadata: {
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      };
    }

    const key = credentialIdToAccount(id);
    store.credentials[key] = credential;
    store.metadata.updatedAt = Date.now();

    await this.saveStore(store);
  }

  async delete(id: CredentialId): Promise<boolean> {
    return this.deleteSync(id);
  }

  deleteSync(id: CredentialId): boolean {
    const store = this.loadStoreSync();
    if (!store) return false;

    const key = credentialIdToAccount(id);
    if (!(key in store.credentials)) return false;

    delete store.credentials[key];
    store.metadata.updatedAt = Date.now();

    this.saveStoreSync(store);
    return true;
  }

  async list(filter?: Partial<CredentialId>): Promise<CredentialId[]> {
    const store = await this.loadStore();
    if (!store) return [];

    const ids = Object.keys(store.credentials)
      .map(accountToCredentialId)
      .filter((id): id is CredentialId => id !== null);

    if (!filter) return ids;

    return ids.filter((id) => {
      if (filter.type && id.type !== filter.type) return false;
      if (filter.workspaceId && id.workspaceId !== filter.workspaceId) return false;
      if (filter.name && id.name !== filter.name) return false;
      return true;
    });
  }

  async createMigrationSnapshot(): Promise<CredentialMigrationSnapshot> {
    if (!existsSync(this.credentialsFile)) {
      throw new Error('Credential migration source is unavailable');
    }

    const source = readFileSync(this.credentialsFile);
    const snapshot: CredentialMigrationSnapshot = {
      migrationId: `credential-migration-${randomUUID()}`,
      createdAt: Date.now(),
      sourceChecksum: this.checksum(source),
    };
    const snapshotDir = this.snapshotDir(snapshot.migrationId);
    mkdirSync(this.migrationsDir, { recursive: true, mode: 0o700 });
    chmodSync(this.migrationsDir, 0o700);
    mkdirSync(snapshotDir, { mode: 0o700 });
    this.writePrivateFile(join(snapshotDir, CREDENTIALS_FILE_NAME), source);
    this.writeManifest(snapshotDir, {
      migrationId: snapshot.migrationId,
      createdAt: snapshot.createdAt,
      sourceChecksum: snapshot.sourceChecksum,
      state: 'snapshot',
    });
    return snapshot;
  }

  async applyMigration(
    snapshot: CredentialMigrationSnapshot,
    replacements: readonly CredentialMigrationRecord[],
  ): Promise<void> {
    this.readSnapshot(snapshot);
    if (this.checksum(readFileSync(this.credentialsFile)) !== snapshot.sourceChecksum) {
      throw new Error('Credential migration source changed');
    }

    this.clearCache();
    const store = this.loadStoreSync();
    if (!store) throw new Error('Credential migration source is unavailable');

    const keys = new Set<string>();
    for (const replacement of replacements) {
      const key = credentialIdToAccount(replacement.id);
      if (keys.has(key) || !(key in store.credentials)) {
        throw new Error('Credential migration replacement is invalid');
      }
      keys.add(key);
    }
    if (keys.size === 0) return;

    for (const replacement of replacements) {
      store.credentials[credentialIdToAccount(replacement.id)] = replacement.credential;
    }
    store.metadata.updatedAt = Date.now();
    this.saveStoreSync(store);
    this.setSnapshotState(snapshot, 'applied', this.checksum(readFileSync(this.credentialsFile)));
  }

  async rollbackMigration(snapshot: CredentialMigrationSnapshot): Promise<void> {
    const { backup, manifest } = this.readSnapshot(snapshot);
    if (
      manifest.state !== 'applied' ||
      !manifest.appliedChecksum ||
      !existsSync(this.credentialsFile) ||
      this.checksum(readFileSync(this.credentialsFile)) !== manifest.appliedChecksum
    ) {
      throw new Error('Credential migration source changed');
    }
    this.writePrivateFile(this.credentialsFile, backup);
    this.clearCache();
    this.setSnapshotState(snapshot, 'rolled_back');
  }

  // ============================================================
  // Private Methods
  // ============================================================

  private async loadStore(): Promise<CredentialStore | null> {
    return this.loadStoreSync();
  }

  private loadStoreSync(): CredentialStore | null {
    // Return cached store if available
    if (this.cachedStore) return this.cachedStore;

    if (!existsSync(this.credentialsFile)) return null;

    let fileData: Buffer;
    try {
      fileData = readFileSync(this.credentialsFile);
    } catch {
      return null;
    }

    if (fileData.length < HEADER_SIZE + IV_SIZE + AUTH_TAG_SIZE) {
      this.handleCorruptedFile();
      return null;
    }

    // Validate magic bytes
    if (!fileData.subarray(0, MAGIC_SIZE).equals(MAGIC_BYTES)) {
      this.handleCorruptedFile();
      return null;
    }

    // Parse header
    // const flags = fileData.readUInt32LE(MAGIC_SIZE); // Reserved for future use
    const salt = fileData.subarray(MAGIC_SIZE + FLAGS_SIZE, MAGIC_SIZE + FLAGS_SIZE + SALT_SIZE);
    this.salt = salt;

    // Extract encrypted data
    const encryptedData = fileData.subarray(HEADER_SIZE);

    // Try new stable key first (v2 - hardware UUID based)
    const newKey = this.getEncryptionKey(salt);
    let store = this.tryDecrypt(encryptedData, newKey);

    if (store) {
      this.cachedStore = store;
      return store;
    }

    // Try legacy key for migration (v1 - included hostname)
    // This handles credentials encrypted with old key derivation
    const legacyKey = this.getLegacyEncryptionKey(salt);
    store = this.tryDecrypt(encryptedData, legacyKey);

    if (store) {
      // Migration: re-save with new stable key so future loads use hardware UUID
      this.cachedStore = store;
      this.saveStoreSync(store);
      return store;
    }

    // Both keys failed - file is truly corrupted
    this.handleCorruptedFile();
    return null;
  }

  /**
   * Attempt to decrypt data with given key.
   * Returns parsed store on success, null on failure.
   */
  private tryDecrypt(encryptedData: Buffer, key: Buffer): CredentialStore | null {
    try {
      const iv = encryptedData.subarray(0, IV_SIZE);
      const authTag = encryptedData.subarray(IV_SIZE, IV_SIZE + AUTH_TAG_SIZE);
      const ciphertext = encryptedData.subarray(IV_SIZE + AUTH_TAG_SIZE);

      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return JSON.parse(decrypted.toString('utf8'));
    } catch {
      return null;
    }
  }

  private async saveStore(store: CredentialStore): Promise<void> {
    this.saveStoreSync(store);
  }

  private saveStoreSync(store: CredentialStore): void {
    if (!existsSync(this.credentialsDir)) {
      mkdirSync(this.credentialsDir, { recursive: true, mode: 0o700 });
    }

    // Use existing salt or generate new one
    const salt = this.salt || randomBytes(SALT_SIZE);
    this.salt = salt;

    // Get encryption key
    const key = this.getEncryptionKey(salt);

    // Serialize payload
    const plaintext = Buffer.from(JSON.stringify(store), 'utf8');

    // Generate new IV for each write (critical for GCM security)
    const iv = randomBytes(IV_SIZE);

    // Encrypt
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Build header
    const header = Buffer.alloc(HEADER_SIZE);
    MAGIC_BYTES.copy(header, 0);
    header.writeUInt32LE(0, MAGIC_SIZE); // Flags (reserved)
    salt.copy(header, MAGIC_SIZE + FLAGS_SIZE);

    // Combine all parts
    const fileData = Buffer.concat([header, iv, authTag, ciphertext]);

    this.writePrivateFile(this.credentialsFile, fileData);
    this.cachedStore = store;
  }

  private checksum(value: Buffer): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private snapshotDir(migrationId: string): string {
    if (!/^credential-migration-[0-9a-f-]{36}$/i.test(migrationId)) {
      throw new Error('Credential migration snapshot is invalid');
    }
    return join(this.migrationsDir, migrationId);
  }

  private readSnapshot(snapshot: CredentialMigrationSnapshot): {
    backup: Buffer;
    manifest: CredentialMigrationManifest;
  } {
    const snapshotDir = this.snapshotDir(snapshot.migrationId);
    const manifestPath = join(snapshotDir, 'manifest.json');
    const backupPath = join(snapshotDir, CREDENTIALS_FILE_NAME);
    let manifest: CredentialMigrationManifest;
    try {
      const parsed: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (!isCredentialMigrationManifest(parsed)) throw new Error('invalid manifest');
      manifest = parsed;
    } catch {
      throw new Error('Credential migration snapshot is unavailable');
    }
    if (
      manifest.migrationId !== snapshot.migrationId ||
      manifest.createdAt !== snapshot.createdAt ||
      manifest.sourceChecksum !== snapshot.sourceChecksum
    ) {
      throw new Error('Credential migration snapshot is invalid');
    }
    let backup: Buffer;
    try {
      backup = readFileSync(backupPath);
    } catch {
      throw new Error('Credential migration snapshot is unavailable');
    }
    if (this.checksum(backup) !== snapshot.sourceChecksum) {
      throw new Error('Credential migration snapshot is invalid');
    }
    return { backup, manifest };
  }

  private setSnapshotState(
    snapshot: CredentialMigrationSnapshot,
    state: CredentialMigrationManifest['state'],
    appliedChecksum?: string,
  ): void {
    const { manifest } = this.readSnapshot(snapshot);
    this.writeManifest(this.snapshotDir(snapshot.migrationId), {
      migrationId: snapshot.migrationId,
      createdAt: snapshot.createdAt,
      sourceChecksum: snapshot.sourceChecksum,
      state,
      appliedChecksum: appliedChecksum ?? manifest.appliedChecksum,
    });
  }

  private writeManifest(snapshotDir: string, manifest: CredentialMigrationManifest): void {
    this.writePrivateFile(join(snapshotDir, 'manifest.json'), Buffer.from(JSON.stringify(manifest), 'utf8'));
  }

  private writePrivateFile(path: string, data: Buffer): void {
    const parent = dirname(path);
    mkdirSync(parent, { recursive: true, mode: 0o700 });
    chmodSync(parent, 0o700);
    const temporary = join(parent, `.${randomUUID()}.tmp`);
    const fd = openSync(temporary, 'wx', 0o600);
    try {
      writeFileSync(fd, data);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, path);
    const directoryFd = openSync(parent, 'r');
    try {
      fsyncSync(directoryFd);
    } finally {
      closeSync(directoryFd);
    }
  }

  private getEncryptionKey(salt: Buffer): Buffer {
    if (this.encryptionKey) return this.encryptionKey;

    // New stable machine ID using hardware UUID (v2)
    // This is far more stable than hostname which can change with network/DHCP
    const stableMachineId = createHash('sha256')
      .update(getStableMachineId())
      .update('craft-agent-v2') // Bumped version for new key derivation
      .digest();

    // Derive key using PBKDF2
    this.encryptionKey = pbkdf2Sync(stableMachineId, salt, PBKDF2_ITERATIONS, KEY_SIZE, 'sha256');

    return this.encryptionKey;
  }

  /**
   * Legacy key derivation for migration from v1 (included hostname).
   * Used to decrypt credentials from older versions before re-encrypting with stable key.
   */
  private getLegacyEncryptionKey(salt: Buffer): Buffer {
    const legacyMachineId = createHash('sha256')
      .update(hostname())
      .update(userInfo().username)
      .update(homedir())
      .update('craft-agent-v1')
      .digest();

    return pbkdf2Sync(legacyMachineId, salt, PBKDF2_ITERATIONS, KEY_SIZE, 'sha256');
  }

  private handleCorruptedFile(): void {
    try {
      if (existsSync(this.credentialsFile)) {
        mkdirSync(this.quarantineDir, { recursive: true, mode: 0o700 });
        chmodSync(this.quarantineDir, 0o700);
        renameSync(
          this.credentialsFile,
          join(this.quarantineDir, `credentials-${Date.now()}-${randomUUID()}.enc`),
        );
      }
    } catch {
      // Preserve the original file when quarantine cannot be completed.
    }
    this.cachedStore = null;
    this.encryptionKey = null;
    this.salt = null;
  }

  /** Clear cached data (for testing or forced refresh) */
  clearCache(): void {
    this.cachedStore = null;
    this.encryptionKey = null;
    this.salt = null;
  }
}
