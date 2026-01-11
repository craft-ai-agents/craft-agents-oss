/**
 * Credential Manager
 *
 * Main interface for credential storage. Automatically selects the best
 * available backend and provides convenience methods for common operations.
 *
 * Backend priority:
 *   1. Environment variables (server deployment, read-only)
 *   2. Encrypted file storage (cross-platform, no OS keychain prompts)
 */

import type { CredentialBackend } from './backends/types.ts';
import type { CredentialId, CredentialType, StoredCredential } from './types.ts';
import { SecureStorageBackend } from './backends/secure-storage.ts';
import { EnvironmentBackend } from './backends/env.ts';
import { PortableCredentialBackend, workspaceHasPortableCredentials } from './backends/portable.ts';
import { shouldUsePortableStorage } from './metadata.ts';
import { debug } from '../utils/debug.ts';
import type { CredentialStrategy } from '../workspaces/types.ts';

export class CredentialManager {
  private backends: CredentialBackend[] = [];
  private writeBackend: CredentialBackend | null = null;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  /**
   * Explicitly initialize the credential manager.
   * This is optional - methods auto-initialize via ensureInitialized().
   * Use this for eager initialization at app startup if desired.
   */
  async initialize(): Promise<void> {
    await this.ensureInitialized();
  }

  /**
   * Internal: ensure initialization has completed.
   * Called automatically by all public methods.
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }
    // Prevent race condition with concurrent initialization
    if (this.initPromise) {
      return this.initPromise;
    }

    // Clear promise on failure so initialization can be retried
    this.initPromise = this._doInitialize().catch((err) => {
      this.initPromise = null;
      throw err;
    });
    await this.initPromise;
  }

  private async _doInitialize(): Promise<void> {
    // Register backends in priority order (secure storage + environment)
    const potentialBackends: CredentialBackend[] = [
      new SecureStorageBackend(),
      new EnvironmentBackend(),
    ];

    // Check which backends are available
    for (const backend of potentialBackends) {
      if (await backend.isAvailable()) {
        this.backends.push(backend);
        debug(`[CredentialManager] Backend available: ${backend.name} (priority ${backend.priority})`);
      }
    }

    // Sort by priority (highest first)
    this.backends.sort((a, b) => b.priority - a.priority);

    // Find the first writable backend (not environment)
    this.writeBackend = this.backends.find((b) => b.name !== 'environment') || null;

    if (this.writeBackend) {
      debug(`[CredentialManager] Using write backend: ${this.writeBackend.name}`);
    } else {
      debug(`[CredentialManager] WARNING: No writable backend available.`);
    }

    this.initialized = true;
  }

  /** Get the name of the active write backend */
  getActiveBackendName(): string | null {
    return this.writeBackend?.name || null;
  }

  /**
   * Get a credential by ID, trying all backends.
   * Automatically initializes if needed.
   */
  async get(id: CredentialId): Promise<StoredCredential | null> {
    await this.ensureInitialized();

    for (const backend of this.backends) {
      try {
        const cred = await backend.get(id);
        if (cred) {
          debug(`[CredentialManager] Found ${id.type} in ${backend.name}`);
          return cred;
        }
      } catch (err) {
        debug(`[CredentialManager] Error reading from ${backend.name}:`, err);
      }
    }

    return null;
  }

  /**
   * Set a credential using the write backend.
   * Automatically initializes if needed.
   */
  async set(id: CredentialId, credential: StoredCredential): Promise<void> {
    await this.ensureInitialized();

    if (!this.writeBackend) {
      throw new Error('No writable credential backend available');
    }

    await this.writeBackend.set(id, credential);
    debug(`[CredentialManager] Saved ${id.type} to ${this.writeBackend.name}`);
  }

  /**
   * Delete a credential from all backends.
   * Automatically initializes if needed.
   */
  async delete(id: CredentialId): Promise<boolean> {
    await this.ensureInitialized();

    let deleted = false;
    for (const backend of this.backends) {
      if (backend.name === 'environment') continue;

      try {
        if (await backend.delete(id)) {
          deleted = true;
          debug(`[CredentialManager] Deleted ${id.type} from ${backend.name}`);
        }
      } catch (err) {
        debug(`[CredentialManager] Error deleting from ${backend.name}:`, err);
      }
    }

    return deleted;
  }

  /**
   * List credentials matching a filter.
   * Automatically initializes if needed.
   */
  async list(filter?: Partial<CredentialId>): Promise<CredentialId[]> {
    await this.ensureInitialized();

    const seen = new Set<string>();
    const results: CredentialId[] = [];

    for (const backend of this.backends) {
      try {
        const ids = await backend.list(filter);
        for (const id of ids) {
          const key = JSON.stringify(id);
          if (!seen.has(key)) {
            seen.add(key);
            results.push(id);
          }
        }
      } catch (err) {
        debug(`[CredentialManager] Error listing from ${backend.name}:`, err);
      }
    }

    return results;
  }

  // ============================================================
  // Convenience Methods
  // ============================================================

  /** Get Anthropic API key */
  async getApiKey(): Promise<string | null> {
    const cred = await this.get({ type: 'anthropic_api_key' });
    return cred?.value || null;
  }

  /** Set Anthropic API key */
  async setApiKey(key: string): Promise<void> {
    await this.set({ type: 'anthropic_api_key' }, { value: key });
  }

  /** Get Claude OAuth token */
  async getClaudeOAuth(): Promise<string | null> {
    const cred = await this.get({ type: 'claude_oauth' });
    return cred?.value || null;
  }

  /** Set Claude OAuth token */
  async setClaudeOAuth(token: string): Promise<void> {
    await this.set({ type: 'claude_oauth' }, { value: token });
  }

  /** Get Craft OAuth token */
  async getCraftOAuth(): Promise<string | null> {
    const cred = await this.get({ type: 'craft_oauth' });
    return cred?.value || null;
  }

  /** Set Craft OAuth token */
  async setCraftOAuth(token: string): Promise<void> {
    await this.set({ type: 'craft_oauth' }, { value: token });
  }

  /** Get workspace OAuth credentials */
  async getWorkspaceOAuth(
    workspaceId: string
  ): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
    clientId?: string;
    tokenType?: string;
  } | null> {
    const cred = await this.get({ type: 'workspace_oauth', workspaceId });
    if (!cred) return null;

    return {
      accessToken: cred.value,
      refreshToken: cred.refreshToken,
      expiresAt: cred.expiresAt,
      clientId: cred.clientId,
      tokenType: cred.tokenType,
    };
  }

  /** Set workspace OAuth credentials */
  async setWorkspaceOAuth(
    workspaceId: string,
    credentials: {
      accessToken: string;
      refreshToken?: string;
      expiresAt?: number;
      clientId?: string;
      tokenType?: string;
    }
  ): Promise<void> {
    await this.set(
      { type: 'workspace_oauth', workspaceId },
      {
        value: credentials.accessToken,
        refreshToken: credentials.refreshToken,
        expiresAt: credentials.expiresAt,
        clientId: credentials.clientId,
        tokenType: credentials.tokenType,
      }
    );
  }

  /** Get workspace bearer token */
  async getWorkspaceBearer(workspaceId: string): Promise<string | null> {
    const cred = await this.get({ type: 'workspace_bearer', workspaceId });
    return cred?.value || null;
  }

  /** Set workspace bearer token */
  async setWorkspaceBearer(workspaceId: string, token: string): Promise<void> {
    await this.set({ type: 'workspace_bearer', workspaceId }, { value: token });
  }

  /** Delete all credentials for a workspace */
  async deleteWorkspaceCredentials(workspaceId: string): Promise<void> {
    // Delete workspace-level credentials
    await this.delete({ type: 'workspace_oauth', workspaceId });
    await this.delete({ type: 'workspace_bearer', workspaceId });

    // Delete all source credentials for this workspace
    const allCreds = await this.list({ workspaceId });
    for (const cred of allCreds) {
      await this.delete(cred);
    }
  }

  /** Check if a credential is expired (with 5-minute buffer) */
  isExpired(credential: StoredCredential): boolean {
    if (!credential.expiresAt) return false;
    // Consider expired if within 5 minutes of expiry
    return Date.now() > credential.expiresAt - 5 * 60 * 1000;
  }

  // ============================================================
  // Workspace-Aware Methods (Portable Credentials Support)
  // ============================================================

  /** Cache of portable backends by workspace path */
  private portableBackends = new Map<string, PortableCredentialBackend>();

  /**
   * Get or create a portable credential backend for a workspace.
   * Returns null if no password provided.
   */
  private getPortableBackend(
    workspaceRootPath: string,
    password?: string
  ): PortableCredentialBackend | null {
    if (!password) return null;

    // Check cache
    const cached = this.portableBackends.get(workspaceRootPath);
    if (cached) return cached;

    // Create new backend
    const backend = new PortableCredentialBackend(workspaceRootPath, password);
    this.portableBackends.set(workspaceRootPath, backend);
    return backend;
  }

  /**
   * Clear the cached portable backend for a workspace.
   * Call this when the user logs out or changes password.
   */
  clearPortableBackendCache(workspaceRootPath?: string): void {
    if (workspaceRootPath) {
      this.portableBackends.delete(workspaceRootPath);
    } else {
      this.portableBackends.clear();
    }
  }

  /**
   * Get a credential considering workspace credential strategy.
   *
   * For workspace-scoped credentials (API keys, bearer tokens):
   * - If strategy is 'portable' and password provided, uses workspace portable file
   * - Otherwise falls back to global storage
   *
   * For non-workspace-scoped credentials (OAuth, global keys):
   * - Always uses global storage regardless of strategy
   *
   * @param id - Credential identifier
   * @param options - Workspace context for portable credential support
   */
  async getForWorkspace(
    id: CredentialId,
    options?: {
      workspaceRootPath?: string;
      strategy?: CredentialStrategy;
      password?: string;
    }
  ): Promise<StoredCredential | null> {
    // Check if this credential should use portable storage
    const usePortable =
      options?.strategy === 'portable' &&
      options?.workspaceRootPath &&
      shouldUsePortableStorage(id);

    if (usePortable && options.password) {
      const portableBackend = this.getPortableBackend(
        options.workspaceRootPath!,
        options.password
      );

      if (portableBackend) {
        const cred = await portableBackend.get(id);
        if (cred) {
          debug(`[CredentialManager] Found ${id.type} in portable storage`);
          return cred;
        }
      }
    }

    // Fall back to global storage
    return this.get(id);
  }

  /**
   * Set a credential considering workspace credential strategy.
   *
   * For workspace-scoped credentials (API keys, bearer tokens):
   * - If strategy is 'portable' and password provided, stores in workspace portable file
   * - Otherwise stores in global storage
   *
   * For non-workspace-scoped credentials (OAuth, global keys):
   * - Always uses global storage regardless of strategy
   *
   * @param id - Credential identifier
   * @param credential - Credential value to store
   * @param options - Workspace context for portable credential support
   */
  async setForWorkspace(
    id: CredentialId,
    credential: StoredCredential,
    options?: {
      workspaceRootPath?: string;
      strategy?: CredentialStrategy;
      password?: string;
    }
  ): Promise<void> {
    // Check if this credential should use portable storage
    const usePortable =
      options?.strategy === 'portable' &&
      options?.workspaceRootPath &&
      shouldUsePortableStorage(id);

    if (usePortable && options.password) {
      const portableBackend = this.getPortableBackend(
        options.workspaceRootPath!,
        options.password
      );

      if (portableBackend) {
        await portableBackend.set(id, credential);
        debug(`[CredentialManager] Saved ${id.type} to portable storage`);
        return;
      }
    }

    // Fall back to global storage
    await this.set(id, credential);
  }

  /**
   * Delete a credential considering workspace credential strategy.
   */
  async deleteForWorkspace(
    id: CredentialId,
    options?: {
      workspaceRootPath?: string;
      strategy?: CredentialStrategy;
      password?: string;
    }
  ): Promise<boolean> {
    let deleted = false;

    // Check if this credential should use portable storage
    const usePortable =
      options?.strategy === 'portable' &&
      options?.workspaceRootPath &&
      shouldUsePortableStorage(id);

    if (usePortable && options.password) {
      const portableBackend = this.getPortableBackend(
        options.workspaceRootPath!,
        options.password
      );

      if (portableBackend) {
        deleted = await portableBackend.delete(id);
        if (deleted) {
          debug(`[CredentialManager] Deleted ${id.type} from portable storage`);
        }
      }
    }

    // Also try to delete from global storage (in case it was moved)
    const globalDeleted = await this.delete(id);
    return deleted || globalDeleted;
  }

  /**
   * List credentials in workspace portable storage.
   */
  async listPortableCredentials(
    workspaceRootPath: string,
    password: string,
    filter?: Partial<CredentialId>
  ): Promise<CredentialId[]> {
    const portableBackend = this.getPortableBackend(workspaceRootPath, password);
    if (!portableBackend) return [];

    return portableBackend.list(filter);
  }

  /**
   * Verify a password for a workspace's portable credentials file.
   * Returns true if the password can decrypt the file (or if no file exists yet).
   */
  async verifyPortablePassword(
    workspaceRootPath: string,
    password: string
  ): Promise<boolean> {
    const backend = new PortableCredentialBackend(workspaceRootPath, password);
    return backend.verifyPassword();
  }

  /**
   * Check if a workspace has portable credentials configured.
   * (Has a credentials.enc file in the workspace folder)
   */
  workspaceHasPortableCredentials(workspaceRootPath: string): boolean {
    return workspaceHasPortableCredentials(workspaceRootPath);
  }

  /**
   * Migrate credentials from global storage to workspace portable storage.
   * Useful when user switches from 'local' to 'portable' strategy.
   *
   * @returns Number of credentials migrated
   */
  async migrateToPortable(
    workspaceId: string,
    workspaceRootPath: string,
    password: string
  ): Promise<number> {
    await this.ensureInitialized();

    const portableBackend = this.getPortableBackend(workspaceRootPath, password);
    if (!portableBackend) return 0;

    // Find all workspace-scoped credentials for this workspace
    const allCreds = await this.list({ workspaceId });
    let migrated = 0;

    for (const id of allCreds) {
      // Only migrate credentials that should use portable storage
      if (!shouldUsePortableStorage(id)) continue;

      // Get from global storage
      const cred = await this.get(id);
      if (!cred) continue;

      // Store in portable storage
      await portableBackend.set(id, cred);

      // Delete from global storage
      await this.delete(id);

      migrated++;
      debug(`[CredentialManager] Migrated ${id.type} to portable storage`);
    }

    return migrated;
  }

  /**
   * Migrate credentials from workspace portable storage back to global storage.
   * Useful when user switches from 'portable' to 'local' strategy.
   *
   * @returns Number of credentials migrated
   */
  async migrateFromPortable(
    workspaceRootPath: string,
    password: string
  ): Promise<number> {
    await this.ensureInitialized();

    const portableBackend = this.getPortableBackend(workspaceRootPath, password);
    if (!portableBackend) return 0;

    // List all credentials in portable storage
    const portableCreds = await portableBackend.list();
    let migrated = 0;

    for (const id of portableCreds) {
      // Get from portable storage
      const cred = await portableBackend.get(id);
      if (!cred) continue;

      // Store in global storage
      await this.set(id, cred);

      // Delete from portable storage
      await portableBackend.delete(id);

      migrated++;
      debug(`[CredentialManager] Migrated ${id.type} from portable to global storage`);
    }

    // Clear the portable backend cache
    this.clearPortableBackendCache(workspaceRootPath);

    return migrated;
  }
}

// Singleton instance
let manager: CredentialManager | null = null;

export function getCredentialManager(): CredentialManager {
  if (!manager) {
    manager = new CredentialManager();
  }
  return manager;
}
