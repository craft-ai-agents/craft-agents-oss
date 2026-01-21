/**
 * Unified Auth State Management
 *
 * Provides a single source of truth for all authentication state:
 * - Craft OAuth (for accessing Craft API and MCP servers)
 * - Billing configuration (api_key or oauth_token)
 * - Workspace/MCP configuration
 */

import { getCredentialManager } from '../credentials/index.ts';
import { loadStoredConfig, getActiveWorkspace, type AuthType, type Workspace } from '../config/storage.ts';
import { refreshClaudeToken, isTokenExpired, getExistingClaudeCredentials } from './claude-token.ts';
import { debug } from '../utils/debug.ts';

// ============================================
// Types
// ============================================

export interface AuthState {
  /** Craft platform authentication (for accessing Craft API and MCP) */
  craft: {
    hasToken: boolean;
    token: string | null;
  };

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
    /** Anthropic auth token (if using custom auth type) */
    authToken: string | null;
  };

  /** Workspace/MCP configuration */
  workspace: {
    hasWorkspace: boolean;
    active: Workspace | null;
  };
}

export interface SetupNeeds {
  /** No Craft token AND no workspace → show full onboarding (new user) */
  needsCraftAuth: boolean;
  /** Has workspace but token expired/missing → show simple re-login screen */
  needsReauth: boolean;
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

        return refreshed.accessToken;
      } catch (error) {
        debug('[auth] Failed to refresh Claude OAuth token:', error);
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

  const craftToken = await manager.getCraftOAuth();
  const apiKey = await manager.getApiKey();
  const claudeOAuth = await getValidClaudeOAuthToken();
  const authToken = await manager.get({ type: 'anthropic_auth_token' });
  const activeWorkspace = getActiveWorkspace();

  // Determine if billing credentials are satisfied based on auth type
  let hasCredentials = false;
  if (config?.authType === 'api_key') {
    hasCredentials = !!apiKey;
  } else if (config?.authType === 'oauth_token') {
    hasCredentials = !!claudeOAuth;
  } else if (config?.authType === 'custom') {
    hasCredentials = !!authToken?.value;
  }

  return {
    craft: {
      hasToken: !!craftToken,
      token: craftToken,
    },
    billing: {
      type: config?.authType ?? null,
      hasCredentials,
      apiKey,
      claudeOAuthToken: claudeOAuth,
      authToken: authToken?.value ?? null,
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
  // Craft OAuth is only required for new users (no workspace) who need to select a space during onboarding
  const needsCraftAuth = !state.craft.hasToken && !state.workspace.hasWorkspace;

  // Reauth is not needed for api_key or oauth_token billing
  const needsReauth = false;

  // Need billing config if no billing type is set
  const needsBillingConfig = state.billing.type === null;

  // Need credentials if billing type is set but credentials are missing
  const needsCredentials = state.billing.type !== null && !state.billing.hasCredentials;

  return {
    needsCraftAuth,
    needsReauth,
    needsBillingConfig,
    needsCredentials,
    isFullyConfigured: !needsCraftAuth && !needsReauth && !needsBillingConfig && !needsCredentials,
  };
}
