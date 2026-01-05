/**
 * SourceCredentialManager
 *
 * Unified credential management for sources. Consolidates credential CRUD,
 * credential ID resolution, expiry checking, and OAuth flows.
 *
 * This replaces scattered credential logic across:
 * - SourceService.getSourceToken()
 * - SourceService.getApiCredential()
 * - SourceService.getCredentialId()
 * - session-scoped-tools OAuth triggers
 * - IPC handlers for credential storage
 */

import type { LoadedSource } from './types.ts';
import type { CredentialId, StoredCredential } from '../credentials/types.ts';
import { getCredentialManager } from '../credentials/index.ts';
import { CraftOAuth, getMcpBaseUrl, type OAuthCallbacks, type OAuthTokens } from '../auth/oauth.ts';
import { startGmailOAuth, refreshGmailToken, type GmailOAuthResult } from '../auth/gmail-oauth.ts';
import { debug } from '../utils/debug.ts';

/**
 * Result of authentication attempt
 */
export interface AuthResult {
  success: boolean;
  error?: string;
  /** For Gmail OAuth, includes user's email */
  email?: string;
}

/**
 * API credential types (string for simple auth, object for basic auth)
 */
export type ApiCredential = string | BasicAuthCredential;

export interface BasicAuthCredential {
  username: string;
  password: string;
}

/**
 * SourceCredentialManager - unified credential operations for sources
 *
 * Usage:
 * ```typescript
 * const credManager = new SourceCredentialManager();
 *
 * // Save credentials
 * await credManager.save(source, { value: 'token123' });
 *
 * // Load credentials
 * const cred = await credManager.load(source);
 *
 * // Run OAuth flow
 * const result = await credManager.authenticate(source, {
 *   onStatus: (msg) => console.log(msg),
 *   onError: (err) => console.error(err),
 * });
 * ```
 */
export class SourceCredentialManager {
  // ============================================================
  // Core CRUD Operations
  // ============================================================

  /**
   * Save credential for a source
   */
  async save(source: LoadedSource, credential: StoredCredential): Promise<void> {
    const credentialId = this.getCredentialId(source);
    const manager = getCredentialManager();
    await manager.set(credentialId, credential);
    debug(`[SourceCredentialManager] Saved ${credentialId.type} for ${source.config.slug}`);
  }

  /**
   * Load credential for a source
   *
   * For MCP sources, tries both OAuth and bearer credentials as fallback
   * (credentials may have been stored via different auth modes)
   */
  async load(source: LoadedSource): Promise<StoredCredential | null> {
    const manager = getCredentialManager();

    // For MCP sources, try both OAuth and bearer credentials
    // (stdio transport doesn't need credentials)
    if (source.config.type === 'mcp' && source.config.mcp?.transport !== 'stdio' && source.config.mcp?.authType !== 'none') {
      return this.loadMcpCredential(source);
    }

    // For other sources, use the credential ID based on authType
    const credentialId = this.getCredentialId(source);
    const cred = await manager.get(credentialId);

    if (cred) {
      debug(`[SourceCredentialManager] Found ${credentialId.type} for ${source.config.slug}`);
    }

    return cred;
  }

  /**
   * Load MCP credential with fallback (OAuth -> bearer)
   */
  private async loadMcpCredential(source: LoadedSource): Promise<StoredCredential | null> {
    const manager = getCredentialManager();
    const baseId = {
      workspaceId: source.workspaceId,
      sourceId: source.config.slug,
      ...(source.agentSlug && { agentId: source.agentSlug }),
    };

    // Try OAuth first
    const oauthType = source.agentSlug ? 'agent_source_oauth' : 'source_oauth';
    const oauthCreds = await manager.get({ type: oauthType, ...baseId } as CredentialId);
    if (oauthCreds?.value) {
      debug(`[SourceCredentialManager] Found ${oauthType} for ${source.config.slug}`);
      return oauthCreds;
    }

    // Fall back to bearer
    const bearerType = source.agentSlug ? 'agent_source_bearer' : 'source_bearer';
    const bearerCreds = await manager.get({ type: bearerType, ...baseId } as CredentialId);
    if (bearerCreds?.value) {
      debug(`[SourceCredentialManager] Found ${bearerType} for ${source.config.slug}`);
      return bearerCreds;
    }

    debug(`[SourceCredentialManager] No credential found for MCP source ${source.config.slug}`);
    return null;
  }

  /**
   * Delete credential for a source
   */
  async delete(source: LoadedSource): Promise<boolean> {
    const credentialId = this.getCredentialId(source);
    const manager = getCredentialManager();
    const deleted = await manager.delete(credentialId);
    if (deleted) {
      debug(`[SourceCredentialManager] Deleted ${credentialId.type} for ${source.config.slug}`);
    }
    return deleted;
  }

  /**
   * Get token value for a source (convenience method)
   * Returns null if no credential exists or if expired
   */
  async getToken(source: LoadedSource): Promise<string | null> {
    const cred = await this.load(source);
    if (!cred?.value) return null;

    // Check expiry
    if (this.isExpired(cred)) {
      debug(`[SourceCredentialManager] Token expired for ${source.config.slug}`);
      return null;
    }

    return cred.value;
  }

  /**
   * Get API credential for a source (handles basic auth JSON parsing)
   */
  async getApiCredential(source: LoadedSource): Promise<ApiCredential | null> {
    const cred = await this.load(source);
    if (!cred?.value) return null;

    // Check for basic auth (JSON with username/password)
    if (source.config.api?.authType === 'basic') {
      try {
        const parsed = JSON.parse(cred.value);
        if (parsed.username && parsed.password) {
          return parsed as BasicAuthCredential;
        }
      } catch {
        // Not JSON, treat as regular credential
      }
    }

    return cred.value;
  }

  // ============================================================
  // Credential ID Resolution
  // ============================================================

  /**
   * Get the credential ID for a source
   *
   * Determines the correct credential type based on:
   * - Source type (mcp, api, local)
   * - Auth type (oauth, bearer, header, etc.)
   * - Scope (workspace vs agent)
   */
  getCredentialId(source: LoadedSource): CredentialId {
    const mcp = source.config.mcp;
    const api = source.config.api;

    let type: CredentialId['type'];

    if (source.agentSlug) {
      // Agent-scoped source
      type = this.getAgentCredentialType(source);

      return {
        type,
        workspaceId: source.workspaceId,
        agentId: source.agentSlug,
        sourceId: source.config.slug,
      };
    }

    // Workspace-scoped source
    if (source.config.type === 'mcp') {
      type = mcp?.authType === 'bearer' ? 'source_bearer' : 'source_oauth';
    } else if (source.config.type === 'api') {
      // Gmail always uses OAuth
      if (source.config.provider === 'gmail') {
        type = 'source_oauth';
      } else if (api?.authType === 'oauth') {
        type = 'source_oauth';
      } else if (api?.authType === 'bearer') {
        type = 'source_bearer';
      } else if (api?.authType === 'basic') {
        type = 'source_basic';
      } else {
        // header, query, or other → stored as apikey
        type = 'source_apikey';
      }
    } else {
      type = 'source_oauth';
    }

    return {
      type,
      workspaceId: source.workspaceId,
      sourceId: source.config.slug,
    };
  }

  /**
   * Get credential type for agent-scoped source
   */
  private getAgentCredentialType(source: LoadedSource): CredentialId['type'] {
    const mcp = source.config.mcp;
    const api = source.config.api;

    if (source.config.type === 'mcp') {
      return mcp?.authType === 'bearer' ? 'agent_source_bearer' : 'agent_source_oauth';
    }

    if (source.config.type === 'api') {
      if (api?.authType === 'oauth') {
        return 'agent_source_oauth';
      } else if (api?.authType === 'bearer') {
        return 'agent_source_bearer';
      } else if (api?.authType === 'basic') {
        return 'agent_source_basic';
      } else {
        return 'agent_source_apikey';
      }
    }

    return 'agent_source_oauth';
  }

  // ============================================================
  // Expiry Checking
  // ============================================================

  /**
   * Check if a credential is expired
   */
  isExpired(credential: StoredCredential): boolean {
    if (!credential.expiresAt) return false;
    return Date.now() > credential.expiresAt;
  }

  /**
   * Check if a credential needs refresh (within 5 min of expiry)
   */
  needsRefresh(credential: StoredCredential): boolean {
    if (!credential.expiresAt) return false;
    const fiveMinutes = 5 * 60 * 1000;
    return Date.now() > credential.expiresAt - fiveMinutes;
  }

  /**
   * Check if source has valid (non-expired) credentials
   */
  async hasValidCredentials(source: LoadedSource): Promise<boolean> {
    const token = await this.getToken(source);
    return token !== null;
  }

  // ============================================================
  // OAuth Authentication
  // ============================================================

  /**
   * Authenticate source via OAuth
   *
   * Handles both MCP OAuth and Gmail OAuth flows.
   * On success, credentials are automatically saved.
   */
  async authenticate(
    source: LoadedSource,
    callbacks?: OAuthCallbacks
  ): Promise<AuthResult> {
    const defaultCallbacks: OAuthCallbacks = {
      onStatus: (msg) => debug(`[SourceCredentialManager] ${msg}`),
      onError: (err) => debug(`[SourceCredentialManager] Error: ${err}`),
    };
    const cb = callbacks || defaultCallbacks;

    // Gmail has its own OAuth flow
    if (source.config.provider === 'gmail') {
      return this.authenticateGmail(source, cb);
    }

    // MCP OAuth flow
    if (source.config.type === 'mcp' && source.config.mcp?.authType === 'oauth') {
      return this.authenticateMcp(source, cb);
    }

    // API OAuth flow (non-Gmail)
    if (source.config.type === 'api' && source.config.api?.authType === 'oauth') {
      // For non-Gmail APIs, we'd need the API's OAuth config
      // This is a placeholder - specific APIs need custom handling
      return {
        success: false,
        error: 'OAuth for this API type is not yet implemented',
      };
    }

    return {
      success: false,
      error: `Source ${source.config.slug} does not use OAuth authentication`,
    };
  }

  /**
   * Authenticate MCP source via OAuth
   */
  private async authenticateMcp(
    source: LoadedSource,
    callbacks: OAuthCallbacks
  ): Promise<AuthResult> {
    if (!source.config.mcp?.url) {
      return { success: false, error: 'MCP URL not configured' };
    }

    try {
      const oauth = new CraftOAuth(
        { mcpBaseUrl: getMcpBaseUrl(source.config.mcp.url) },
        callbacks
      );

      const { tokens, clientId } = await oauth.authenticate();

      // Save the credentials
      await this.save(source, {
        value: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        clientId,
        tokenType: tokens.tokenType,
      });

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      callbacks.onError(message);
      return { success: false, error: message };
    }
  }

  /**
   * Authenticate Gmail source via Google OAuth
   */
  private async authenticateGmail(
    source: LoadedSource,
    callbacks: OAuthCallbacks
  ): Promise<AuthResult> {
    try {
      callbacks.onStatus('Starting Gmail OAuth flow...');

      const result: GmailOAuthResult = await startGmailOAuth('electron');

      if (!result.success) {
        return { success: false, error: result.error || 'Gmail OAuth failed' };
      }

      // Save the credentials
      await this.save(source, {
        value: result.accessToken!,
        refreshToken: result.refreshToken,
        expiresAt: result.expiresAt,
      });

      callbacks.onStatus('Gmail authentication successful');
      return { success: true, email: result.email };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      callbacks.onError(message);
      return { success: false, error: message };
    }
  }

  /**
   * Refresh token for a source
   *
   * Returns the new access token, or null if refresh fails.
   * On success, credentials are automatically updated.
   */
  async refresh(source: LoadedSource): Promise<string | null> {
    const cred = await this.load(source);
    if (!cred?.refreshToken) {
      debug(`[SourceCredentialManager] No refresh token for ${source.config.slug}`);
      return null;
    }

    // Gmail refresh
    if (source.config.provider === 'gmail') {
      return this.refreshGmail(source, cred);
    }

    // MCP refresh
    if (source.config.type === 'mcp' && source.config.mcp?.url) {
      return this.refreshMcp(source, cred);
    }

    return null;
  }

  /**
   * Refresh Gmail token
   */
  private async refreshGmail(
    source: LoadedSource,
    cred: StoredCredential
  ): Promise<string | null> {
    try {
      const result = await refreshGmailToken(cred.refreshToken!);

      // Update stored credentials
      await this.save(source, {
        ...cred,
        value: result.accessToken,
        expiresAt: result.expiresAt,
      });

      debug(`[SourceCredentialManager] Refreshed Gmail token for ${source.config.slug}`);
      return result.accessToken;
    } catch (error) {
      debug(`[SourceCredentialManager] Gmail token refresh failed:`, error);
      return null;
    }
  }

  /**
   * Refresh MCP OAuth token
   */
  private async refreshMcp(
    source: LoadedSource,
    cred: StoredCredential
  ): Promise<string | null> {
    if (!cred.clientId) {
      debug(`[SourceCredentialManager] No clientId for MCP token refresh`);
      return null;
    }

    try {
      // Only HTTP/SSE transport can refresh tokens - stdio doesn't use OAuth
      if (!source.config.mcp?.url) {
        debug(`[SourceCredentialManager] No URL for MCP token refresh (stdio transport?)`);
        return null;
      }

      const oauth = new CraftOAuth(
        { mcpBaseUrl: getMcpBaseUrl(source.config.mcp.url) },
        {
          onStatus: () => {},
          onError: () => {},
        }
      );

      const tokens = await oauth.refreshAccessToken(cred.refreshToken!, cred.clientId);

      // Update stored credentials
      await this.save(source, {
        ...cred,
        value: tokens.accessToken,
        refreshToken: tokens.refreshToken || cred.refreshToken,
        expiresAt: tokens.expiresAt,
      });

      debug(`[SourceCredentialManager] Refreshed MCP token for ${source.config.slug}`);
      return tokens.accessToken;
    } catch (error) {
      debug(`[SourceCredentialManager] MCP token refresh failed:`, error);
      return null;
    }
  }
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Get sources that need authentication
 * Returns enabled sources that require auth but aren't yet authenticated
 */
export function getSourcesNeedingAuth(sources: LoadedSource[]): LoadedSource[] {
  return sources.filter((source) => {
    if (!source.config.enabled) return false;

    const mcp = source.config.mcp;
    const api = source.config.api;

    // MCP sources with oauth/bearer auth (stdio transport never needs auth)
    if (source.config.type === 'mcp' && mcp) {
      if (mcp.transport === 'stdio') {
        // Stdio sources run locally and don't need authentication
        return false;
      }
      if (mcp.authType !== 'none' && !source.config.isAuthenticated) {
        return true;
      }
    }

    // API sources with auth requirements
    if (source.config.type === 'api' && api) {
      if (api.authType !== 'none' && api.authType !== undefined && !source.config.isAuthenticated) {
        return true;
      }
    }

    return false;
  });
}

// Singleton instance
let instance: SourceCredentialManager | null = null;

/**
 * Get shared SourceCredentialManager instance
 */
export function getSourceCredentialManager(): SourceCredentialManager {
  if (!instance) {
    instance = new SourceCredentialManager();
  }
  return instance;
}
