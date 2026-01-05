/**
 * Auth Types (Browser-safe)
 *
 * Pure type definitions for authentication state.
 * No runtime dependencies - safe for browser bundling.
 */

import type { AuthType, Workspace } from '../config/types.ts';

/**
 * Unified authentication state
 */
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

/**
 * What setup steps are needed
 */
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
