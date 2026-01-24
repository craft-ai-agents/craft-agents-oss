/**
 * Unified Auth State Management
 *
 * Provides a single source of truth for all authentication state:
 * - Billing configuration (api_key or oauth_token)
 * - Workspace/MCP configuration
 */

import { getCredentialManager } from '../credentials/index.ts';
import { loadStoredConfig, saveConfig, getActiveWorkspace, type AuthType, type Workspace } from '../config/storage.ts';
import { refreshClaudeToken, isTokenExpired, getExistingClaudeCredentials } from './claude-token.ts';
import { debug } from '../utils/debug.ts';

// ============================================
// Types
// ============================================

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
}

// ============================================
// Functions
// ============================================

/**
 * Get and refresh Claude OAuth token if needed
 * This function:
 * 1. Checks if we have a token in our credential store
 * 2. If not, tries to import from Claude CLI keychain
 * 3. If token is expired and we have a refresh token, refreshes it
 * 4. Returns the valid access token
 */
async function getValidClaudeOAuthToken(): Promise<string | null> {
  const manager = getCredentialManager();

  // Try to get credentials from our store
  let creds = await manager.getClaudeOAuthCredentials();

  // If we don't have credentials in our store, try to import from Claude CLI
  if (!creds) {
    // Check if we should skip CLI import due to recent refresh failure
    const config = loadStoredConfig();
    if (config?.skipCliImportUntil && Date.now() < config.skipCliImportUntil) {
      debug('[auth] Skipping CLI credential import due to skipCliImportUntil flag', {
        skipUntil: config.skipCliImportUntil,
        now: Date.now(),
        remainingMs: config.skipCliImportUntil - Date.now(),
      });
      return null;
    }

    const cliCreds = getExistingClaudeCredentials();
    if (cliCreds) {
      debug('[auth] Importing Claude credentials from CLI keychain');
      await manager.setClaudeOAuthCredentials({
        accessToken: cliCreds.accessToken,
        refreshToken: cliCreds.refreshToken,
        expiresAt: cliCreds.expiresAt,
      });
      creds = cliCreds;
    }
  }

  if (!creds) {
    return null;
  }

  // Check if token is expired
  if (isTokenExpired(creds.expiresAt)) {
    debug('[auth] Claude OAuth token expired, attempting refresh');
    debug('[auth] Credentials check:', {
      hasRefreshToken: !!creds.refreshToken,
      refreshTokenLength: creds.refreshToken?.length,
      expiresAt: creds.expiresAt,
      expiresAtDate: creds.expiresAt ? new Date(creds.expiresAt).toISOString() : null,
    });

    // Try to refresh if we have a refresh token
    if (creds.refreshToken) {
      try {
        const refreshed = await refreshClaudeToken(creds.refreshToken);
        debug('[auth] Successfully refreshed Claude OAuth token');

        // Store the new credentials
        await manager.setClaudeOAuthCredentials({
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          expiresAt: refreshed.expiresAt,
        });

        // Clear skipCliImportUntil flag after successful refresh
        const config = loadStoredConfig();
        if (config && config.skipCliImportUntil !== undefined) {
          config.skipCliImportUntil = undefined;
          saveConfig(config);
          debug('[auth] Cleared skipCliImportUntil flag after successful token refresh');
        }

        return refreshed.accessToken;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        debug('[auth] Failed to refresh Claude OAuth token:', {
          message: errorMessage,
          stack: errorStack,
          errorType: error?.constructor?.name,
          errorString: String(error),
        });

        // Check if this is a token mismatch error (400/401 + "refresh token")
        const isTokenMismatch = (errorMessage.includes('400') || errorMessage.includes('401')) &&
          errorMessage.toLowerCase().includes('refresh token');

        if (isTokenMismatch) {
          debug('[auth] Token mismatch detected (old console.anthropic.com token)', {
            status: errorMessage.match(/\d{3}/)?.[0],
            errorMessage,
          });

          // Clear stored credentials
          await manager.delete({ type: 'claude_oauth' });
          debug('[auth] Cleared incompatible credentials and setting skipCliImportUntil flag');

          // Set skipCliImportUntil flag to prevent re-importing incompatible token
          const config = loadStoredConfig();
          if (config) {
            config.skipCliImportUntil = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
            saveConfig(config);
          }
        } else {
          // Other error (network, server, etc.) - just clear credentials, don't set flag
          debug('[auth] Clearing credentials due to refresh failure (non-token-mismatch error)', {
            errorMessage,
          });
          await manager.delete({ type: 'claude_oauth' });
        }

        // Token refresh failed - return null to trigger re-authentication
        return null;
      }
    } else {
      debug('[auth] No refresh token available, cannot refresh expired token');
      return null;
    }
  }

  return creds.accessToken;
}

/**
 * Get complete authentication state from all sources (config file + credential store)
 */
export async function getAuthState(): Promise<AuthState> {
  const config = loadStoredConfig();
  const manager = getCredentialManager();

  const apiKey = await manager.getApiKey();
  const claudeOAuth = await getValidClaudeOAuthToken();
  const activeWorkspace = getActiveWorkspace();

  // Determine if billing credentials are satisfied based on auth type
  let hasCredentials = false;
  if (config?.authType === 'api_key') {
    // Keyless providers (Ollama) are valid when a custom base URL is configured
    hasCredentials = !!apiKey || !!config?.anthropicBaseUrl;
  } else if (config?.authType === 'oauth_token') {
    hasCredentials = !!claudeOAuth;
  }

  return {
    billing: {
      type: config?.authType ?? null,
      hasCredentials,
      apiKey,
      claudeOAuthToken: claudeOAuth,
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
  };
}
