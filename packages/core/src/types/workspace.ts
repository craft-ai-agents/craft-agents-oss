/**
 * Workspace and authentication types
 */

export interface Workspace {
  id: string;
  name: string;
  slug?: string;       // URL-safe folder name for workspace-scoped storage (defaults to id if not set)
  createdAt: number;
  sessionId?: string;  // SDK session ID for conversation continuity
  iconUrl?: string;    // Space icon URL from Craft profile
}

export type AuthType = 'api_key' | 'oauth_token' | 'craft_credits';

/**
 * OAuth credentials from a fresh authentication flow.
 * Used for temporary state in UI components before saving to credential store.
 */
export interface OAuthCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  clientId: string;
  tokenType: string;
}

// Token display mode for status bar
export type TokenDisplayMode = 'hidden' | 'total' | 'separate';

// Global cumulative usage tracking across all workspaces
export interface CumulativeUsage {
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  lastUpdated: number;
}

// Config stored in JSON file (credentials stored in encrypted file, not here)
export interface StoredConfig {
  authType?: AuthType;
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  activeSessionId: string | null;  // Currently active session (primary scope)
  model?: string;
  extendedCacheTtl?: boolean;  // Extended cache TTL: true=1h all, false=5m all, undefined=auto (Opus only)
  tokenDisplay?: TokenDisplayMode;  // How to show tokens in status bar
  showCost?: boolean;  // Whether to show cost in status bar
  cumulativeUsage?: CumulativeUsage;  // Global cumulative cost
}

