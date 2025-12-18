/**
 * Unified Auth State Management
 *
 * Provides a single source of truth for all authentication state:
 * - Craft OAuth (for accessing Craft API and MCP servers)
 * - Billing configuration (craft_credits, api_key, or oauth_token)
 * - Workspace/MCP configuration
 */

import { getCredentialManager } from '../credentials/index.ts';
import { loadStoredConfig, getActiveWorkspace, checkWorkspaceAuthStatus, type AuthType, type Workspace, type WorkspaceAuthStatus } from '../config/storage.ts';

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
    /** MCP authentication status for the active workspace */
    mcpAuth?: WorkspaceAuthStatus;
  };
}

export interface SetupNeeds {
  /** No Craft token or workspace → show craft-login + space selection */
  needsCraftAuth: boolean;
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

  // Get MCP auth status for active workspace
  let mcpAuth: WorkspaceAuthStatus | undefined;
  if (activeWorkspace) {
    mcpAuth = await checkWorkspaceAuthStatus(activeWorkspace.id);
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
      mcpAuth,
    },
  };
}

/**
 * Derive what setup steps are needed based on current auth state
 */
export function getSetupNeeds(state: AuthState): SetupNeeds {
  // Need Craft auth if missing token OR missing workspace
  const needsCraftAuth = !state.craft.hasToken || !state.workspace.hasWorkspace;

  // Need billing config if no billing type is set
  const needsBillingConfig = state.billing.type === null;

  // Need credentials if billing type is set but credentials are missing
  const needsCredentials = state.billing.type !== null && !state.billing.hasCredentials;

  return {
    needsCraftAuth,
    needsBillingConfig,
    needsCredentials,
    isFullyConfigured: !needsCraftAuth && !needsBillingConfig && !needsCredentials,
  };
}
