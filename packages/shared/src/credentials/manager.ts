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

  /** Get Claude OAuth credentials (with refresh token and expiry) */
  async getClaudeOAuthCredentials(): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
  } | null> {
    const cred = await this.get({ type: 'claude_oauth' });
    if (!cred) return null;

    return {
      accessToken: cred.value,
      refreshToken: cred.refreshToken,
      expiresAt: cred.expiresAt,
    };
  }

  /** Set Claude OAuth credentials (with refresh token and expiry) */
  async setClaudeOAuthCredentials(credentials: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
  }): Promise<void> {
    await this.set({ type: 'claude_oauth' }, {
      value: credentials.accessToken,
      refreshToken: credentials.refreshToken,
      expiresAt: credentials.expiresAt,
    });
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

  // ============================================================
  // WhatsApp Session Methods
  // ============================================================

  /** WhatsApp session data structure */
  private parseWhatsAppSession(value: string): WhatsAppSession | null {
    try {
      return JSON.parse(value) as WhatsAppSession;
    } catch {
      return null;
    }
  }

  /**
   * Store WhatsApp session credentials (Baileys session data)
   *
   * @param workspaceId - Workspace ID
   * @param phoneNumber - Phone number (used as unique identifier)
   * @param session - WhatsApp session object
   */
  async setWhatsAppSession(
    workspaceId: string,
    phoneNumber: string,
    session: WhatsAppSession
  ): Promise<void> {
    await this.set(
      {
        type: 'whatsapp_session',
        workspaceId,
        sourceId: phoneNumber,
      },
      {
        value: JSON.stringify(session),
        expiresAt: session.isExpired ? 0 : undefined,
      }
    );
    debug(`[CredentialManager] Saved WhatsApp session for ${phoneNumber} in workspace ${workspaceId}`);
  }

  /**
   * Get WhatsApp session credentials
   *
   * @param workspaceId - Workspace ID
   * @param phoneNumber - Phone number
   * @returns Session object or null if not found
   */
  async getWhatsAppSession(
    workspaceId: string,
    phoneNumber: string
  ): Promise<WhatsAppSession | null> {
    const cred = await this.get({
      type: 'whatsapp_session',
      workspaceId,
      sourceId: phoneNumber,
    });

    if (!cred?.value) return null;
    return this.parseWhatsAppSession(cred.value);
  }

  /**
   * Delete WhatsApp session credentials (GDPR compliance)
   *
   * @param workspaceId - Workspace ID
   * @param phoneNumber - Phone number
   * @returns True if deleted, false if not found
   */
  async deleteWhatsAppSession(
    workspaceId: string,
    phoneNumber: string
  ): Promise<boolean> {
    const deleted = await this.delete({
      type: 'whatsapp_session',
      workspaceId,
      sourceId: phoneNumber,
    });
    if (deleted) {
      debug(`[CredentialManager] Deleted WhatsApp session for ${phoneNumber} in workspace ${workspaceId}`);
    }
    return deleted;
  }

  /**
   * Get all WhatsApp sessions for a workspace
   *
   * @param workspaceId - Workspace ID
   * @returns Array of session objects
   */
  async getAllWhatsAppSessions(workspaceId: string): Promise<WhatsAppSession[]> {
    const allCreds = await this.list({
      type: 'whatsapp_session',
      workspaceId,
    });

    const sessions: WhatsAppSession[] = [];
    for (const credId of allCreds) {
      const cred = await this.get(credId);
      if (cred?.value) {
        const session = this.parseWhatsAppSession(cred.value);
        if (session) {
          sessions.push(session);
        }
      }
    }

    return sessions;
  }

  // ========================================
  // Telegram Bot Token Management
  // ========================================

  /**
   * Store Telegram bot token
   *
   * @param workspaceId - Workspace ID
   * @param botToken - Telegram bot token from @BotFather
   */
  async setTelegramBotToken(
    workspaceId: string,
    botToken: string
  ): Promise<void> {
    await this.set(
      {
        type: 'telegram_bot_token',
        workspaceId,
        sourceId: 'default', // Only one bot per workspace for now
      },
      {
        value: botToken,
      }
    );
    debug(`[CredentialManager] Saved Telegram bot token for workspace ${workspaceId}`);
  }

  /**
   * Get Telegram bot token
   *
   * @param workspaceId - Workspace ID
   * @returns Bot token or null if not found
   */
  async getTelegramBotToken(
    workspaceId: string
  ): Promise<string | null> {
    const cred = await this.get({
      type: 'telegram_bot_token',
      workspaceId,
      sourceId: 'default',
    });

    return cred?.value || null;
  }

  /**
   * Delete Telegram bot token (GDPR compliance)
   *
   * @param workspaceId - Workspace ID
   * @returns True if deleted, false if not found
   */
  async deleteTelegramBotToken(
    workspaceId: string
  ): Promise<boolean> {
    const deleted = await this.delete({
      type: 'telegram_bot_token',
      workspaceId,
      sourceId: 'default',
    });
    if (deleted) {
      debug(`[CredentialManager] Deleted Telegram bot token for workspace ${workspaceId}`);
    }
    return deleted;
  }
}

/**
 * WhatsApp session data stored in credentials
 */
export interface WhatsAppSession {
  /** User's JID as provided by Baileys */
  jid: string;
  /** Push name (display name) from Baileys */
  pushName: string;
  /** Full Baileys session state (opaque from storage perspective) */
  sessionData: unknown;
  /** Timestamp when session was created (milliseconds since epoch) */
  createdAt: number;
  /** Timestamp when user last connected (milliseconds since epoch) */
  connectedAt: number;
  /** Whether session has expired and needs re-authentication */
  isExpired: boolean;
}

// Singleton instance
let manager: CredentialManager | null = null;

export function getCredentialManager(): CredentialManager {
  if (!manager) {
    manager = new CredentialManager();
  }
  return manager;
}
