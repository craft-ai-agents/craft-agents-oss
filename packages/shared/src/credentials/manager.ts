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

  /** Get MCP server OAuth credentials for an agent */
  async getMcpOAuth(
    workspaceId: string,
    agentId: string,
    serverName: string
  ): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
    clientId?: string;
  } | null> {
    const cred = await this.get({
      type: 'mcp_oauth',
      workspaceId,
      agentId,
      name: serverName,
    });
    if (!cred) return null;

    return {
      accessToken: cred.value,
      refreshToken: cred.refreshToken,
      expiresAt: cred.expiresAt,
      clientId: cred.clientId,
    };
  }

  /** Set MCP server OAuth credentials for an agent */
  async setMcpOAuth(
    workspaceId: string,
    agentId: string,
    serverName: string,
    credentials: {
      accessToken: string;
      refreshToken?: string;
      expiresAt?: number;
      clientId?: string;
    }
  ): Promise<void> {
    await this.set(
      { type: 'mcp_oauth', workspaceId, agentId, name: serverName },
      {
        value: credentials.accessToken,
        refreshToken: credentials.refreshToken,
        expiresAt: credentials.expiresAt,
        clientId: credentials.clientId,
      }
    );
  }

  /** Get API key for an agent's REST API */
  async getApiKeyForAgent(
    workspaceId: string,
    agentId: string,
    apiName: string
  ): Promise<string | null> {
    const cred = await this.get({
      type: 'api_key',
      workspaceId,
      agentId,
      name: apiName,
    });
    return cred?.value || null;
  }

  /** Set API key for an agent's REST API */
  async setApiKeyForAgent(
    workspaceId: string,
    agentId: string,
    apiName: string,
    apiKey: string
  ): Promise<void> {
    await this.set(
      { type: 'api_key', workspaceId, agentId, name: apiName },
      { value: apiKey }
    );
  }

  /** Delete all credentials for a workspace (including all agent credentials) */
  async deleteWorkspaceCredentials(workspaceId: string): Promise<void> {
    // Delete workspace-level credentials
    await this.delete({ type: 'workspace_oauth', workspaceId });
    await this.delete({ type: 'workspace_bearer', workspaceId });

    // Delete all agent credentials for this workspace
    const allCreds = await this.list({ workspaceId });
    for (const cred of allCreds) {
      await this.delete(cred);
    }
  }

  /**
   * Delete all credentials for an agent.
   * If serverNames/apiNames are provided, only those are deleted.
   * If not provided, finds and deletes ALL credentials for this agent.
   */
  async deleteAgentCredentials(
    workspaceId: string,
    agentId: string,
    serverNames?: string[],
    apiNames?: string[]
  ): Promise<void> {
    // If names provided, delete only those
    if (serverNames && serverNames.length > 0) {
      for (const name of serverNames) {
        await this.delete({ type: 'mcp_oauth', workspaceId, agentId, name });
      }
    }
    if (apiNames && apiNames.length > 0) {
      for (const name of apiNames) {
        await this.delete({ type: 'api_key', workspaceId, agentId, name });
      }
    }

    // If no names provided, find and delete all credentials for this agent
    if (!serverNames && !apiNames) {
      const allCredentials = await this.list({ workspaceId, agentId });
      for (const id of allCredentials) {
        await this.delete(id);
      }
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
