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

import {
  inferGoogleServiceFromUrl,
  inferSlackServiceFromUrl,
  inferMicrosoftServiceFromUrl,
  isApiOAuthProvider,
  type LoadedSource,
  type GoogleService,
  type SlackService,
  type MicrosoftService,
} from './types.ts';
import type { CredentialId, StoredCredential } from '../credentials/types.ts';
import { getCredentialManager } from '../credentials/index.ts';
import { CraftOAuth, getMcpBaseUrl, type OAuthCallbacks, type OAuthTokens } from '../auth/oauth.ts';
import {
  startGoogleOAuth,
  refreshGoogleToken,
  type GoogleOAuthResult,
  type GoogleOAuthOptions,
} from '../auth/google-oauth.ts';
import {
  startSlackOAuth,
  refreshSlackToken,
  type SlackOAuthResult,
  type SlackOAuthOptions,
} from '../auth/slack-oauth.ts';
import {
  startMicrosoftOAuth,
  refreshMicrosoftToken,
  type MicrosoftOAuthResult,
  type MicrosoftOAuthOptions,
} from '../auth/microsoft-oauth.ts';
import { debug } from '../utils/debug.ts';
import { markSourceAuthenticated, loadSourceConfig, saveSourceConfig } from './storage.ts';

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
  // Track in-flight refresh promises to prevent concurrent refreshes for the same source
  // This prevents race conditions (especially important for Microsoft which rotates refresh tokens)
  private pendingRefreshes = new Map<string, Promise<string | null>>();

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
    };

    // Try OAuth first
    const oauthCreds = await manager.get({ type: 'source_oauth', ...baseId });
    if (oauthCreds?.value) {
      debug(`[SourceCredentialManager] Found source_oauth for ${source.config.slug}`);
      return oauthCreds;
    }

    // Fall back to bearer
    const bearerCreds = await manager.get({ type: 'source_bearer', ...baseId });
    if (bearerCreds?.value) {
      debug(`[SourceCredentialManager] Found source_bearer for ${source.config.slug}`);
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
   */
  getCredentialId(source: LoadedSource): CredentialId {
    const mcp = source.config.mcp;
    const api = source.config.api;

    let type: CredentialId['type'];

    if (source.config.type === 'mcp') {
      type = mcp?.authType === 'bearer' ? 'source_bearer' : 'source_oauth';
    } else if (source.config.type === 'api') {
      // OAuth providers (Google/Slack/Microsoft) store credentials as source_oauth.
      // This separates HOW we get credentials (OAuth flow) from HOW we send them (Bearer header).
      if (isApiOAuthProvider(source.config.provider)) {
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
   * Mark a source as needing re-authentication.
   * Called when token is missing/expired or token refresh fails.
   * Updates config.json so the UI shows "needs auth" and the agent gets proper context.
   */
  markSourceNeedsReauth(source: LoadedSource, errorMessage: string): void {
    try {
      const config = loadSourceConfig(source.workspaceRootPath, source.config.slug);
      if (config) {
        config.isAuthenticated = false;
        config.connectionStatus = 'needs_auth';
        config.connectionError = errorMessage;
        saveSourceConfig(source.workspaceRootPath, config);
        debug(`[SourceCredentialManager] Marked ${source.config.slug} as needing re-auth: ${errorMessage}`);
      }
    } catch (error) {
      debug(`[SourceCredentialManager] Failed to mark ${source.config.slug} as needing re-auth:`, error);
    }
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

    // Google APIs use Google OAuth
    if (source.config.provider === 'google') {
      return this.authenticateGoogle(source, cb);
    }

    // Slack APIs use Slack OAuth
    if (source.config.provider === 'slack') {
      return this.authenticateSlack(source, cb);
    }

    // Microsoft APIs use Microsoft OAuth
    if (source.config.provider === 'microsoft') {
      return this.authenticateMicrosoft(source, cb);
    }

    // MCP OAuth flow
    if (source.config.type === 'mcp' && source.config.mcp?.authType === 'oauth') {
      return this.authenticateMcp(source, cb);
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

      // Mark source as authenticated in config.json
      markSourceAuthenticated(source.workspaceRootPath, source.config.slug);

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      callbacks.onError(message);
      return { success: false, error: message };
    }
  }

  /**
   * Authenticate Google API source via Google OAuth
   *
   * Supports multiple Google services (Gmail, Calendar, Drive) via:
   * - provider: "google" with googleService field
   * - provider: "google" with custom googleScopes
   * - Inferred from baseUrl (e.g., gmail.googleapis.com → gmail)
   */
  private async authenticateGoogle(
    source: LoadedSource,
    callbacks: OAuthCallbacks
  ): Promise<AuthResult> {
    try {
      // Determine service/scopes from config
      const api = source.config.api;
      let service: GoogleService | undefined;
      let scopes: string[] | undefined;

      if (api?.googleScopes && api.googleScopes.length > 0) {
        // Custom scopes take precedence
        scopes = api.googleScopes;
      } else if (api?.googleService) {
        // Use predefined service scopes
        service = api.googleService;
      } else {
        // Infer from baseUrl
        service = inferGoogleServiceFromUrl(api?.baseUrl);
        if (!service) {
          return {
            success: false,
            error: `Cannot determine Google service for source '${source.config.slug}'. Set googleService ('gmail', 'calendar', or 'drive') in api config.`,
          };
        }
      }

      const serviceName = service || 'Google API';
      callbacks.onStatus(`Starting ${serviceName} OAuth flow...`);

      const options: GoogleOAuthOptions = {
        service,
        scopes,
        appType: 'electron',
        // Pass user-provided OAuth credentials from source config (if available)
        clientId: api?.googleOAuthClientId,
        clientSecret: api?.googleOAuthClientSecret,
      };

      const result: GoogleOAuthResult = await startGoogleOAuth(options);

      if (!result.success) {
        return { success: false, error: result.error || 'Google OAuth failed' };
      }

      // Save the credentials (including clientId/clientSecret for token refresh)
      await this.save(source, {
        value: result.accessToken!,
        refreshToken: result.refreshToken,
        expiresAt: result.expiresAt,
        clientId: result.clientId,
        clientSecret: result.clientSecret,
      });

      // Mark source as authenticated in config.json
      markSourceAuthenticated(source.workspaceRootPath, source.config.slug);

      callbacks.onStatus(`${serviceName} authentication successful`);
      return { success: true, email: result.email };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      callbacks.onError(message);
      return { success: false, error: message };
    }
  }

  /**
   * Authenticate Slack API source via Slack OAuth
   *
   * Supports multiple Slack services via:
   * - provider: "slack" with slackService field
   * - provider: "slack" with custom slackBotScopes/slackUserScopes
   * - Inferred from baseUrl (slack.com → full)
   */
  private async authenticateSlack(
    source: LoadedSource,
    callbacks: OAuthCallbacks
  ): Promise<AuthResult> {
    try {
      // Determine service/scopes from config
      const api = source.config.api;
      let service: SlackService | undefined;
      let userScopes: string[] | undefined;

      if (api?.slackUserScopes && api.slackUserScopes.length > 0) {
        // Custom scopes take precedence
        userScopes = api.slackUserScopes;
      } else if (api?.slackService) {
        // Use predefined service scopes
        service = api.slackService;
      } else {
        // Infer from baseUrl (defaults to 'full')
        service = inferSlackServiceFromUrl(api?.baseUrl) || 'full';
      }

      const serviceName = service ? `Slack ${service}` : 'Slack';
      callbacks.onStatus(`Starting ${serviceName} OAuth flow...`);

      const options: SlackOAuthOptions = {
        service,
        userScopes,
        appType: 'electron',
      };

      const result: SlackOAuthResult = await startSlackOAuth(options);

      if (!result.success) {
        return { success: false, error: result.error || 'Slack OAuth failed' };
      }

      // Save the credentials
      await this.save(source, {
        value: result.accessToken!,
        refreshToken: result.refreshToken,
        expiresAt: result.expiresAt,
      });

      // Mark source as authenticated in config.json
      markSourceAuthenticated(source.workspaceRootPath, source.config.slug);

      callbacks.onStatus(`${serviceName} authentication successful`);
      // Use teamName as the identifier (similar to email for Google)
      return { success: true, email: result.teamName };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      callbacks.onError(message);
      return { success: false, error: message };
    }
  }

  /**
   * Authenticate Microsoft API source via Microsoft OAuth
   *
   * Supports multiple Microsoft services (Outlook, OneDrive, Calendar, Teams) via:
   * - provider: "microsoft" with microsoftService field
   * - provider: "microsoft" with custom microsoftScopes
   * - Inferred from baseUrl (e.g., graph.microsoft.com → outlook)
   */
  private async authenticateMicrosoft(
    source: LoadedSource,
    callbacks: OAuthCallbacks
  ): Promise<AuthResult> {
    try {
      // Determine service/scopes from config
      const api = source.config.api;
      let service: MicrosoftService | undefined;
      let scopes: string[] | undefined;

      if (api?.microsoftScopes && api.microsoftScopes.length > 0) {
        // Custom scopes take precedence
        scopes = api.microsoftScopes;
      } else if (api?.microsoftService) {
        // Use predefined service scopes
        service = api.microsoftService;
      } else {
        // Infer from baseUrl
        service = inferMicrosoftServiceFromUrl(api?.baseUrl);
        if (!service) {
          return {
            success: false,
            error: `Cannot determine Microsoft service for source '${source.config.slug}'. Set microsoftService ('outlook', 'calendar', 'onedrive', 'teams', or 'sharepoint') in api config.`,
          };
        }
      }

      const serviceName = service || 'Microsoft API';
      callbacks.onStatus(`Starting ${serviceName} OAuth flow...`);

      const options: MicrosoftOAuthOptions = {
        service,
        scopes,
        appType: 'electron',
      };

      const result: MicrosoftOAuthResult = await startMicrosoftOAuth(options);

      if (!result.success) {
        return { success: false, error: result.error || 'Microsoft OAuth failed' };
      }

      // Save the credentials
      await this.save(source, {
        value: result.accessToken!,
        refreshToken: result.refreshToken,
        expiresAt: result.expiresAt,
      });

      // Mark source as authenticated in config.json
      markSourceAuthenticated(source.workspaceRootPath, source.config.slug);

      callbacks.onStatus(`${serviceName} authentication successful`);
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
   *
   * Uses promise deduplication to prevent concurrent refresh requests for the same source.
   * This is important because:
   * - Multiple API calls may hit refresh simultaneously when token is expiring
   * - Microsoft rotates refresh tokens, so concurrent refreshes could cause token invalidation
   */
  async refresh(source: LoadedSource): Promise<string | null> {
    const key = source.config.slug;

    // Return existing refresh promise if one is in progress
    const pending = this.pendingRefreshes.get(key);
    if (pending) {
      debug(`[SourceCredentialManager] Reusing pending refresh for ${key}`);
      return pending;
    }

    // Create and track new refresh promise
    const refreshPromise = this.doRefresh(source).finally(() => {
      this.pendingRefreshes.delete(key);
    });

    this.pendingRefreshes.set(key, refreshPromise);
    return refreshPromise;
  }

  /**
   * Internal refresh implementation
   */
  private async doRefresh(source: LoadedSource): Promise<string | null> {
    const cred = await this.load(source);
    if (!cred?.refreshToken) {
      debug(`[SourceCredentialManager] No refresh token for ${source.config.slug}`);
      return null;
    }

    // Google API refresh
    if (source.config.provider === 'google') {
      return this.refreshGoogle(source, cred);
    }

    // Slack API refresh
    if (source.config.provider === 'slack') {
      return this.refreshSlack(source, cred);
    }

    // Microsoft API refresh
    if (source.config.provider === 'microsoft') {
      return this.refreshMicrosoft(source, cred);
    }

    // MCP refresh
    if (source.config.type === 'mcp' && source.config.mcp?.url) {
      return this.refreshMcp(source, cred);
    }

    return null;
  }

  /**
   * Refresh Google OAuth token
   */
  private async refreshGoogle(
    source: LoadedSource,
    cred: StoredCredential
  ): Promise<string | null> {
    try {
      // Pass stored credentials (or fall back to env vars via undefined)
      const result = await refreshGoogleToken(
        cred.refreshToken!,
        cred.clientId,
        cred.clientSecret
      );

      // Update stored credentials
      await this.save(source, {
        ...cred,
        value: result.accessToken,
        expiresAt: result.expiresAt,
      });

      debug(`[SourceCredentialManager] Refreshed Google token for ${source.config.slug}`);
      return result.accessToken;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      debug(`[SourceCredentialManager] Google token refresh failed:`, error);
      this.markSourceNeedsReauth(source, `Token refresh failed: ${errorMsg}`);
      return null;
    }
  }

  /**
   * Refresh Slack OAuth token
   */
  private async refreshSlack(
    source: LoadedSource,
    cred: StoredCredential
  ): Promise<string | null> {
    try {
      const result = await refreshSlackToken(cred.refreshToken!, cred.clientId);

      // Update stored credentials
      await this.save(source, {
        ...cred,
        value: result.accessToken,
        expiresAt: result.expiresAt,
      });

      debug(`[SourceCredentialManager] Refreshed Slack token for ${source.config.slug}`);
      return result.accessToken;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      debug(`[SourceCredentialManager] Slack token refresh failed:`, error);
      this.markSourceNeedsReauth(source, `Token refresh failed: ${errorMsg}`);
      return null;
    }
  }

  /**
   * Refresh Microsoft OAuth token
   */
  private async refreshMicrosoft(
    source: LoadedSource,
    cred: StoredCredential
  ): Promise<string | null> {
    try {
      const result = await refreshMicrosoftToken(cred.refreshToken!);

      // Update stored credentials (Microsoft may rotate refresh tokens)
      await this.save(source, {
        ...cred,
        value: result.accessToken,
        refreshToken: result.refreshToken || cred.refreshToken,
        expiresAt: result.expiresAt,
      });

      debug(`[SourceCredentialManager] Refreshed Microsoft token for ${source.config.slug}`);
      return result.accessToken;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      debug(`[SourceCredentialManager] Microsoft token refresh failed:`, error);
      this.markSourceNeedsReauth(source, `Token refresh failed: ${errorMsg}`);
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
      this.markSourceNeedsReauth(source, 'Missing clientId for token refresh');
      return null;
    }

    try {
      // Only HTTP/SSE transport can refresh tokens - stdio doesn't use OAuth
      if (!source.config.mcp?.url) {
        // This is expected for stdio transport - not an error
        debug(`[SourceCredentialManager] No URL for MCP token refresh (stdio transport)`);
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
      const errorMsg = error instanceof Error ? error.message : String(error);
      debug(`[SourceCredentialManager] MCP token refresh failed:`, error);
      this.markSourceNeedsReauth(source, `Token refresh failed: ${errorMsg}`);
      return null;
    }
  }
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Check if a single source needs authentication.
 * Returns true if the source requires auth but isn't yet authenticated.
 *
 * This correctly handles:
 * - MCP sources with authType: "none" → never needs auth
 * - MCP sources with stdio transport → never needs auth (runs locally)
 * - MCP sources with oauth/bearer → needs auth if not authenticated
 * - API sources with authType: "none" → never needs auth
 * - API sources with bearer/basic/header/query auth → needs auth if not authenticated
 */
export function sourceNeedsAuthentication(source: LoadedSource): boolean {
  const mcp = source.config.mcp;
  const api = source.config.api;

  // MCP sources with oauth/bearer auth (stdio transport never needs auth)
  if (source.config.type === 'mcp' && mcp) {
    if (mcp.transport === 'stdio') {
      // Stdio sources run locally and don't need authentication
      return false;
    }
    // Only require auth if authType is explicitly set to 'oauth' or 'bearer'
    // Undefined or 'none' means no authentication required
    if (mcp.authType && mcp.authType !== 'none' && !source.config.isAuthenticated) {
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
}

/**
 * Get sources that need authentication
 * Returns enabled sources that require auth but aren't yet authenticated
 */
export function getSourcesNeedingAuth(sources: LoadedSource[]): LoadedSource[] {
  return sources.filter((source) => {
    if (!source.config.enabled) return false;
    return sourceNeedsAuthentication(source);
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
