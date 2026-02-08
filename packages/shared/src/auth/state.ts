/**
 * Unified Auth State Management
 *
 * Provides a single source of truth for all authentication state:
 * - Billing configuration (api_key or oauth_token)
 * - Workspace/MCP configuration
 *
 * MIGRATION NOTE (v0.3.0+):
 * We no longer support tokens from Claude CLI / Claude Desktop.
 * Users with legacy tokens will be prompted to re-authenticate using
 * our native OAuth flow. This is a one-time migration.
 */

import { getCredentialManager } from '../credentials/index.ts';
import {
  loadStoredConfig,
  getActiveWorkspace,
  getDefaultLlmConnection,
  getLlmConnection,
  type AuthType,
  type Workspace,
} from '../config/storage.ts';
import { refreshClaudeToken, isTokenExpired } from './claude-token.ts';
import { debug } from '../utils/debug.ts';

// ============================================
// Types
// ============================================

/** Migration info when user needs to re-authenticate */
export interface MigrationInfo {
  reason: 'legacy_token';
  message: string;
}

/** Result of token validation/refresh operations */
export interface TokenResult {
  accessToken: string | null;
  migrationRequired?: MigrationInfo;
}

export interface AuthState {
  /** Claude API billing configuration */
  billing: {
    /** Configured billing type, or null if not yet configured */
    type: AuthType | null;
    /** True if we have the required credentials for the configured billing type */
    hasCredentials: boolean;
    /** Anthropic API key (if using api_key auth type) */
    apiKey: string | null;
    /** Claude Max OAuth token (if using oauth_token auth type) */
    claudeOAuthToken: string | null;
    /** Migration info if user needs to re-authenticate */
    migrationRequired?: MigrationInfo;
  };

  /** Workspace/MCP configuration */
  workspace: {
    hasWorkspace: boolean;
    active: Workspace | null;
  };
}

export interface SetupNeeds {
  /** No billing type configured → show billing picker */
  needsBillingConfig: boolean;
  /** Billing type set but missing credentials → show credential entry */
  needsCredentials: boolean;
  /** Everything complete → go straight to App */
  isFullyConfigured: boolean;
  /** User has legacy tokens that need migration */
  needsMigration?: MigrationInfo;
}

// ============================================
// Token Refresh Mutex
// ============================================

// Mutex to prevent concurrent token refresh attempts
// When a refresh is in progress, other callers wait for it to complete
let refreshInProgress: Promise<TokenResult> | null = null;

/**
 * Perform the actual token refresh (internal, called only when holding mutex)
 * Returns TokenResult with accessToken and optional migrationRequired info
 */
export async function performTokenRefresh(
  manager: ReturnType<typeof getCredentialManager>,
  refreshToken: string,
  originalSource: 'native' | 'cli' | undefined,
  connectionSlug: string
): Promise<TokenResult> {
  try {
    const refreshed = await refreshClaudeToken(refreshToken);

    // Format expiry time for logging
    const expiresAtDate = refreshed.expiresAt ? new Date(refreshed.expiresAt).toISOString() : 'never';
    debug(`[auth] Successfully refreshed Claude OAuth token (expires: ${expiresAtDate})`);

    // Store the new credentials
    // If refresh succeeded with our native endpoint, mark as 'native'
    // (successful refresh proves compatibility with our OAuth system)
    await manager.setClaudeOAuthCredentials({
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      expiresAt: refreshed.expiresAt,
      source: 'native',
    });

    // Also save to LLM connection (dual-write for backwards compatibility)
    // This ensures both legacy and modern auth paths have the refreshed token
    await manager.setLlmOAuth(connectionSlug, {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      expiresAt: refreshed.expiresAt,
    });

    return { accessToken: refreshed.accessToken };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    debug('[auth] Failed to refresh Claude OAuth token:', errorMessage);

    // Only clear credentials for specific OAuth errors that indicate the token is truly invalid
    // Be conservative - don't clear for network errors, timeouts, or unknown errors
    const isIncompatibleToken =
      errorMessage.includes('invalid_grant') ||
      errorMessage.includes('Refresh token not found or invalid') ||
      errorMessage.includes('invalid_refresh_token');

    let migrationRequired: MigrationInfo | undefined;

    if (isIncompatibleToken) {
      // Token refresh failed - could be legacy CLI token or expired/revoked
      debug('[auth] Token refresh failed - credentials will be cleared');

      // Check if this was from CLI based on stored source
      const isFromCLI = originalSource === 'cli' || !originalSource;
      if (isFromCLI) {
        debug('[auth] Token was from CLI or unknown source - migration required');
        migrationRequired = {
          reason: 'legacy_token',
          message:
            'Your Claude authentication needs to be refreshed. ' +
            'Please sign in again.',
        };
      }

      // Clear the incompatible credentials to force fresh authentication
      // Clear from both legacy and LLM connection locations
      await manager.setClaudeOAuthCredentials({
        accessToken: '',
        refreshToken: undefined,
        expiresAt: undefined,
      });

      // Also clear from LLM connection (dual-clear for consistency)
      await manager.deleteLlmCredentials(connectionSlug);
    }

    // Token refresh failed - return null token with optional migration info
    return { accessToken: null, migrationRequired };
  }
}

// ============================================
// Functions
// ============================================

/**
 * Get and refresh Claude OAuth token if needed
 *
 * This function:
 * 1. Checks if we have a token in our credential store
 * 2. Detects legacy tokens (from Claude CLI) and triggers migration
 * 3. If token is expired and we have a refresh token, refreshes it
 * 4. Returns TokenResult with valid access token and optional migration info
 *
 * MUTEX: Only one refresh can happen at a time. If a refresh is already
 * in progress, other callers wait for it and then re-read credentials.
 *
 * MIGRATION (v0.3.0+):
 * - We NO LONGER import tokens from Claude CLI keychain
 * - Legacy tokens are detected and cleared, prompting re-authentication
 */
export async function getValidClaudeOAuthToken(connectionSlug: string): Promise<TokenResult> {
  const manager = getCredentialManager();

  // Try to get credentials from our store
  const creds = await manager.getClaudeOAuthCredentials();

  if (!creds || !creds.accessToken) {
    return { accessToken: null };
  }

  // Check if token is expired or about to expire
  if (isTokenExpired(creds.expiresAt)) {
    const expiresAtDate = creds.expiresAt ? new Date(creds.expiresAt).toISOString() : 'unknown';
    debug(`[auth] Claude OAuth token expired (was: ${expiresAtDate}), attempting refresh`);

    // Try to refresh if we have a refresh token
    if (creds.refreshToken) {
      // Check if a refresh is already in progress
      if (refreshInProgress) {
        debug('[auth] Token refresh already in progress, waiting...');
        try {
          await refreshInProgress;
        } catch {
          // Ignore errors from the other refresh attempt
        }
        // Re-read credentials after waiting (they may have been updated)
        const updatedCreds = await manager.getClaudeOAuthCredentials();
        if (updatedCreds?.accessToken && !isTokenExpired(updatedCreds.expiresAt)) {
          const expiresAtDate = updatedCreds.expiresAt ? new Date(updatedCreds.expiresAt).toISOString() : 'never';
          debug(`[auth] Got refreshed token from concurrent refresh (expires: ${expiresAtDate})`);
          return { accessToken: updatedCreds.accessToken };
        }
        // If still no valid token, return null (the other refresh may have failed)
        debug('[auth] Concurrent refresh did not produce valid token');
        return { accessToken: null };
      }

      // Start the refresh and set the mutex
      debug('[auth] Starting token refresh (holding mutex)');
      refreshInProgress = performTokenRefresh(manager, creds.refreshToken, creds.source, connectionSlug);

      try {
        const result = await refreshInProgress;
        return result;
      } finally {
        // Release the mutex
        refreshInProgress = null;
      }
    } else {
      debug('[auth] No refresh token available, cannot refresh expired token');
      return { accessToken: null };
    }
  }

  return { accessToken: creds.accessToken };
}

/**
 * Get complete authentication state from all sources (config file + credential store)
 *
 * Uses LLM connections as the source of truth for auth type and credentials.
 * Falls back to legacy global credentials for backwards compatibility.
 */
export async function getAuthState(): Promise<AuthState> {
  const config = loadStoredConfig();
  const manager = getCredentialManager();
  const activeWorkspace = getActiveWorkspace();

  // Get the default LLM connection to determine auth type
  const defaultConnectionSlug = getDefaultLlmConnection();
  const connection = defaultConnectionSlug ? getLlmConnection(defaultConnectionSlug) : null;

  // Determine auth type from connection (no legacy fallback - migration ensures all users have connections)
  let effectiveAuthType: AuthType | null = null;
  if (connection) {
    // Map connection authType to legacy AuthType format for backwards compatibility
    // New auth types (api_key, api_key_with_endpoint, bearer_token) map to 'api_key'
    // OAuth maps to 'oauth_token'
    if (connection.authType === 'api_key' || connection.authType === 'api_key_with_endpoint' || connection.authType === 'bearer_token') {
      effectiveAuthType = 'api_key';
    } else if (connection.authType === 'oauth') {
      effectiveAuthType = 'oauth_token';
    }
    // Other auth types (iam_credentials, service_account_file, environment, none) don't map to legacy types
  }
  // No fallback to legacy config.authType - if no connection, return unauthenticated state

  // Check credentials based on the effective auth type and connection
  let hasCredentials = false;
  let apiKey: string | null = null;
  let claudeOAuthToken: string | null = null;
  let migrationRequired: MigrationInfo | undefined;

  if (connection && defaultConnectionSlug) {
    // Use LLM connection credentials
    // Pass providerType for OAuth routing (OpenAI OAuth needs idToken)
    hasCredentials = await manager.hasLlmCredentials(defaultConnectionSlug, connection.authType, connection.providerType);

    if (connection.authType === 'api_key' || connection.authType === 'api_key_with_endpoint' || connection.authType === 'bearer_token') {
      apiKey = await manager.getLlmApiKey(defaultConnectionSlug);
      // Keyless providers (Ollama) are valid when a custom base URL is configured
      if (!apiKey && connection.baseUrl) {
        hasCredentials = true;
      }
    } else if (connection.authType === 'oauth') {
      const llmOAuth = await manager.getLlmOAuth(defaultConnectionSlug);
      if (llmOAuth?.accessToken) {
        claudeOAuthToken = llmOAuth.accessToken;
      }
    }
    // Other auth types (iam_credentials, service_account_file, environment, none) are handled by hasLlmCredentials
    // OpenAI OAuth credentials are handled separately by CodexAgent
  } else {
    // No connection configured - credentials not available
    // Legacy migration should have created a default connection
    hasCredentials = false;
  }

  return {
    billing: {
      type: effectiveAuthType,
      hasCredentials,
      apiKey,
      claudeOAuthToken,
      migrationRequired,
    },
    workspace: {
      hasWorkspace: !!activeWorkspace,
      active: activeWorkspace,
    },
  };
}

/**
 * Derive what setup steps are needed based on current auth state
 */
export function getSetupNeeds(state: AuthState): SetupNeeds {
  // Need billing config if no billing type is set
  const needsBillingConfig = state.billing.type === null;

  // Need credentials if billing type is set but credentials are missing
  const needsCredentials = state.billing.type !== null && !state.billing.hasCredentials;

  return {
    needsBillingConfig,
    needsCredentials,
    isFullyConfigured: !needsBillingConfig && !needsCredentials,
    needsMigration: state.billing.migrationRequired,
  };
}

// ============================================
// Test helpers (exported for testing only)
// ============================================

/**
 * Reset the refresh mutex (for testing only)
 * This allows tests to start with a clean state
 */
export function _resetRefreshMutex(): void {
  refreshInProgress = null;
}
