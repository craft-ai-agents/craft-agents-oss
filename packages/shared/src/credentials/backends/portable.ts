/**
 * Portable Credentials Backend
 *
 * Stores workspace-scoped credentials in an encrypted file within the workspace folder.
 * Uses AES-256-GCM encryption with a user-provided password for key derivation.
 *
 * Unlike SecureStorageBackend (machine-bound), this backend creates portable credential
 * files that can be synced across machines via Dropbox, Git, etc.
 *
 * File location: {workspaceRootPath}/credentials.enc
 *
 * File format (same as SecureStorageBackend):
 *   [Header - 64 bytes]
 *   ├── Magic: "CRAFTPW\0" (8 bytes) - different magic to distinguish from machine-bound
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
  pbkdf2Sync,
} from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';

import { expandPath } from '../../utils/paths.ts';
import type { CredentialBackend } from './types.ts';
import type { CredentialId, StoredCredential } from '../types.ts';
import { credentialIdToAccount, accountToCredentialId } from '../types.ts';

// File format constants
const MAGIC_BYTES = Buffer.from('CRAFTPW\0'); // Different magic from machine-bound
const HEADER_SIZE = 64;
const MAGIC_SIZE = 8;
const FLAGS_SIZE = 4;
const SALT_SIZE = 32;
const IV_SIZE = 12;
const AUTH_TAG_SIZE = 16;
const KEY_SIZE = 32;

// PBKDF2 iterations (balance security vs UX)
const PBKDF2_ITERATIONS = 100000;

/** Internal credential store structure */
interface CredentialStore {
  version: 1;
  credentials: Record<string, StoredCredential>;
  metadata: {
    createdAt: number;
    updatedAt: number;
  };
}

/**
 * Portable credential backend using password-based encryption.
 *
 * Usage:
 *   const backend = new PortableCredentialBackend(workspacePath, password);
 *   await backend.set(credentialId, credential);
 *
 * The password must be provided at construction time and is used for all operations.
 * If the password is wrong, get/list operations will return empty results.
 */
export class PortableCredentialBackend implements CredentialBackend {
  readonly name = 'portable';
  readonly priority = 95; // Below secure-storage (100) - only used when explicitly configured

  private cachedStore: CredentialStore | null = null;
  private encryptionKey: Buffer | null = null;
  private salt: Buffer | null = null;
  private decryptionFailed = false;

  constructor(
    workspaceRootPath: string,
    private readonly password: string
  ) {
    // Expand portable paths (e.g., ~/.craft-agent/...) to absolute paths
    this.workspaceRootPath = expandPath(workspaceRootPath);
  }

  private readonly workspaceRootPath: string;

  /** Path to the credentials file within the workspace */
  get credentialsPath(): string {
    return join(this.workspaceRootPath, 'credentials.enc');
  }

  async isAvailable(): Promise<boolean> {
    // Available if file exists OR if we have a password to create one
    return this.password.length > 0;
  }

  /**
   * Check if the credentials file exists (workspace has portable credentials configured)
   */
  hasCredentialsFile(): boolean {
    return existsSync(this.credentialsPath);
  }

  /**
   * Verify that the provided password can access the credentials file.
   *
   * @returns true if:
   *   - No credentials file exists yet (any password is valid for new files)
   *   - The password successfully decrypts an existing file
   * @returns false if:
   *   - A credentials file exists but the password is incorrect
   *
   * Note: For new workspaces without a credentials file, this always returns true
   * because the provided password will be used to create the new encrypted file.
   */
  async verifyPassword(): Promise<boolean> {
    if (!this.hasCredentialsFile()) {
      // No file yet - any password is valid for creating a new file
      return true;
    }

    this.clearCache();
    const store = await this.loadStore();
    return store !== null && !this.decryptionFailed;
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
    const store = await this.loadStore();
    if (!store) return false;

    const key = credentialIdToAccount(id);
    if (!(key in store.credentials)) return false;

    delete store.credentials[key];
    store.metadata.updatedAt = Date.now();

    await this.saveStore(store);
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
      if (filter.agentId && id.agentId !== filter.agentId) return false;
      if (filter.name && id.name !== filter.name) return false;
      return true;
    });
  }

  // ============================================================
  // Private Methods
  // ============================================================

  private async loadStore(): Promise<CredentialStore | null> {
    // Return cached store if available
    if (this.cachedStore) return this.cachedStore;

    if (!existsSync(this.credentialsPath)) return null;

    let fileData: Buffer;
    try {
      fileData = readFileSync(this.credentialsPath);
    } catch {
      return null;
    }

    // Validate minimum size
    if (fileData.length < HEADER_SIZE + IV_SIZE + AUTH_TAG_SIZE) {
      this.decryptionFailed = true;
      return null;
    }

    // Validate magic bytes
    if (!fileData.subarray(0, MAGIC_SIZE).equals(MAGIC_BYTES)) {
      this.decryptionFailed = true;
      return null;
    }

    // Parse header
    const salt = fileData.subarray(MAGIC_SIZE + FLAGS_SIZE, MAGIC_SIZE + FLAGS_SIZE + SALT_SIZE);
    this.salt = salt;

    // Get encryption key from password
    const key = this.getEncryptionKey(salt);

    // Extract encrypted data
    const encryptedData = fileData.subarray(HEADER_SIZE);
    const iv = encryptedData.subarray(0, IV_SIZE);
    const authTag = encryptedData.subarray(IV_SIZE, IV_SIZE + AUTH_TAG_SIZE);
    const ciphertext = encryptedData.subarray(IV_SIZE + AUTH_TAG_SIZE);

    // Decrypt
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);

      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

      this.cachedStore = JSON.parse(decrypted.toString('utf8'));
      this.decryptionFailed = false;
      return this.cachedStore;
    } catch {
      // Decryption failed - wrong password
      this.decryptionFailed = true;
      return null;
    }
  }

  private async saveStore(store: CredentialStore): Promise<void> {
    // Ensure workspace directory exists
    const dir = dirname(this.credentialsPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }

    // Use existing salt or generate new one
    const salt = this.salt || randomBytes(SALT_SIZE);
    this.salt = salt;

    // Get encryption key from password
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

    // Write with restrictive permissions (owner read/write only)
    writeFileSync(this.credentialsPath, fileData, { mode: 0o600 });
    this.cachedStore = store;
    this.decryptionFailed = false;
  }

  private getEncryptionKey(salt: Buffer): Buffer {
    if (this.encryptionKey) return this.encryptionKey;

    // Derive key from user password using PBKDF2
    this.encryptionKey = pbkdf2Sync(
      this.password,
      salt,
      PBKDF2_ITERATIONS,
      KEY_SIZE,
      'sha256'
    );

    return this.encryptionKey;
  }

  /** Clear cached data (for re-verification or testing) */
  clearCache(): void {
    this.cachedStore = null;
    this.encryptionKey = null;
    this.salt = null;
    this.decryptionFailed = false;
  }

  /** Delete the credentials file entirely */
  deleteCredentialsFile(): boolean {
    try {
      if (existsSync(this.credentialsPath)) {
        unlinkSync(this.credentialsPath);
      }
      this.clearCache();
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Check if a workspace has portable credentials configured
 * (i.e., has a credentials.enc file in the workspace folder)
 */
export function workspaceHasPortableCredentials(workspaceRootPath: string): boolean {
  // Expand portable paths before checking filesystem
  const expandedPath = expandPath(workspaceRootPath);
  return existsSync(join(expandedPath, 'credentials.enc'));
}
