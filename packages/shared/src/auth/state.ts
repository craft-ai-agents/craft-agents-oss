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
import { loadStoredConfig, getActiveWorkspace, type AuthType, type Workspace } from '../config/storage.ts';
import { refreshClaudeToken, isTokenExpired } from './claude-token.ts';
import { debug } from '../utils/debug.ts';
import type { AuthState, SetupNeeds, MigrationInfo } from './types.ts';

// ============================================
// Types
// ============================================

/** Result of token validation/refresh operations */
export interface TokenResult {
  accessToken: string | null;
  migrationRequired?: MigrationInfo;
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
  originalSource: 'native' | 'cli' | undefined
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
      await manager.setClaudeOAuthCredentials({
        accessToken: '',
        refreshToken: undefined,
        expiresAt: undefined,
      });
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
export async function getValidClaudeOAuthToken(): Promise<TokenResult> {
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
      refreshInProgress = performTokenRefresh(manager, creds.refreshToken, creds.source);

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
 */
export async function getAuthState(): Promise<AuthState> {
  // Bedrock auth is configured entirely via environment variables — no config file or credentials needed
  if (process.env.CLAUDE_CODE_USE_BEDROCK === '1') {
    const activeWorkspace = getActiveWorkspace();
    return {
      billing: {
        type: 'bedrock',
        hasCredentials: true,
        apiKey: null,
        claudeOAuthToken: null,
      },
      workspace: {
        hasWorkspace: !!activeWorkspace,
        active: activeWorkspace,
      },
    };
  }

  const config = loadStoredConfig();
  const manager = getCredentialManager();

  const apiKey = await manager.getApiKey();
  const tokenResult = await getValidClaudeOAuthToken();
  const activeWorkspace = getActiveWorkspace();

  // Determine if billing credentials are satisfied based on auth type
  let hasCredentials = false;
  if (config?.authType === 'api_key') {
    // Keyless providers (Ollama) are valid when a custom base URL is configured
    hasCredentials = !!apiKey || !!config?.anthropicBaseUrl;
  } else if (config?.authType === 'oauth_token') {
    hasCredentials = !!tokenResult.accessToken;
  }

  return {
    billing: {
      type: config?.authType ?? null,
      hasCredentials,
      apiKey,
      claudeOAuthToken: tokenResult.accessToken,
      migrationRequired: tokenResult.migrationRequired,
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
