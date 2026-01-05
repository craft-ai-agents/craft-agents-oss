/**
 * Unified Auth State Management
 *
 * Provides a single source of truth for all authentication state:
 * - Craft OAuth (for accessing Craft API and MCP servers)
 * - Billing configuration (craft_credits, api_key, or oauth_token)
 * - Workspace/MCP configuration
 */

import { getCredentialManager } from '../credentials/index.ts';
import { loadStoredConfig, getActiveWorkspace, type AuthType, type Workspace } from '../config/storage.ts';

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
 * Get complete authentication state from all sources (config file + credential store)
 */
export async function getAuthState(): Promise<AuthState> {
  const config = loadStoredConfig();
  const manager = getCredentialManager();

  const craftToken = await manager.getCraftOAuth();
  const apiKey = await manager.getApiKey();
  const claudeOAuth = await manager.getClaudeOAuth();
  const activeWorkspace = getActiveWorkspace();

  // Determine if billing credentials are satisfied based on auth type
  let hasCredentials = false;
  if (config?.authType === 'craft_credits') {
    // Craft Credits just needs Craft OAuth (billing handled by Craft)
    hasCredentials = !!craftToken;
  } else if (config?.authType === 'api_key') {
    hasCredentials = !!apiKey;
  } else if (config?.authType === 'oauth_token') {
    hasCredentials = !!claudeOAuth;
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
  // Craft OAuth is only required for:
  // 1. New users (no workspace) who need to select a space during onboarding
  // 2. Users with craft_credits billing (Craft handles the billing)
  //
  // Users with api_key or oauth_token billing do NOT need Craft auth.
  const needsCraftAuth = !state.craft.hasToken && !state.workspace.hasWorkspace;

  // Reauth is only needed if:
  // - User has craft_credits billing AND token expired AND has a workspace
  // Users with api_key or oauth_token should never see the reauth screen.
  const needsReauth = state.billing.type === 'craft_credits'
    && !state.craft.hasToken
    && state.workspace.hasWorkspace;

  // Need billing config if no billing type is set
  const needsBillingConfig = state.billing.type === null;

  // Need credentials if billing type is set but credentials are missing
  // Note: For craft_credits, hasCredentials depends on Craft token, so if needsReauth is true,
  // needsCredentials would also be true. We handle this by checking needsReauth first in the UI.
  const needsCredentials = state.billing.type !== null && !state.billing.hasCredentials;

  return {
    needsCraftAuth,
    needsReauth,
    needsBillingConfig,
    needsCredentials,
    isFullyConfigured: !needsCraftAuth && !needsReauth && !needsBillingConfig && !needsCredentials,
  };
}
