/**
 * Credential Manager
 *
 * Main interface for credential storage. Uses encrypted file storage
 * for cross-platform compatibility without OS keychain prompts.
 */

import type { CredentialBackend } from './backends/types.ts';
import type { CredentialId, CredentialType, StoredCredential } from './types.ts';
import { SecureStorageBackend } from './backends/secure-storage.ts';
import { debug } from '../utils/debug.ts';

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
    const potentialBackends: CredentialBackend[] = [
      new SecureStorageBackend(),
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

    // Use the first available backend for writing
    this.writeBackend = this.backends[0] || null;

    if (this.writeBackend) {
      debug(`[CredentialManager] Using backend: ${this.writeBackend.name}`);
    } else {
      debug(`[CredentialManager] WARNING: No backend available.`);
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

  /** Get Claude OAuth credentials (with refresh token, expiry, and source) */
  async getClaudeOAuthCredentials(): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
    /** Where the token came from: 'native' (our OAuth), 'cli' (Claude CLI import), or undefined (unknown) */
    source?: 'native' | 'cli';
  } | null> {
    const cred = await this.get({ type: 'claude_oauth' });
    if (!cred) return null;

    return {
      accessToken: cred.value,
      refreshToken: cred.refreshToken,
      expiresAt: cred.expiresAt,
      source: cred.source as 'native' | 'cli' | undefined,
    };
  }

  /** Set Claude OAuth credentials (with refresh token, expiry, and source) */
  async setClaudeOAuthCredentials(credentials: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
    /** Where the token came from: 'native' (our OAuth), 'cli' (Claude CLI import) */
    source?: 'native' | 'cli';
  }): Promise<void> {
    await this.set({ type: 'claude_oauth' }, {
      value: credentials.accessToken,
      refreshToken: credentials.refreshToken,
      expiresAt: credentials.expiresAt,
      source: credentials.source,
    });
  }

  /** Get workspace MCP OAuth credentials */
  async getWorkspaceOAuth(workspaceId: string): Promise<{
    accessToken: string;
    tokenType?: string;
    clientId?: string;
  } | null> {
    const cred = await this.get({ type: 'workspace_oauth', workspaceId });
    if (!cred) return null;
    return {
      accessToken: cred.value,
      tokenType: cred.tokenType,
      clientId: cred.clientId,
    };
  }

  /** Set workspace MCP OAuth credentials */
  async setWorkspaceOAuth(workspaceId: string, credentials: {
    accessToken: string;
    tokenType?: string;
    clientId?: string;
  }): Promise<void> {
    await this.set(
      { type: 'workspace_oauth', workspaceId },
      {
        value: credentials.accessToken,
        tokenType: credentials.tokenType,
        clientId: credentials.clientId,
      }
    );
  }

  /** Delete all credentials for a workspace (source credentials) */
  async deleteWorkspaceCredentials(workspaceId: string): Promise<void> {
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
}

// Singleton instance
let manager: CredentialManager | null = null;

export function getCredentialManager(): CredentialManager {
  if (!manager) {
    manager = new CredentialManager();
  }
  return manager;
}
