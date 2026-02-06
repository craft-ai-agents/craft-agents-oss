/**
 * Workspace and authentication types
 */

/**
 * How MCP server should be authenticated (workspace-level)
 * Note: Different from SourceMcpAuthType which uses 'oauth' | 'bearer' | 'none' for individual sources
 */
export type McpAuthType = 'workspace_oauth' | 'workspace_bearer' | 'public';

/**
 * Workspace storage type
 * - 'local': Filesystem-based storage (default, existing behavior)
 * - 'cloud': Cloud-synced via Cloudflare Worker + Durable Object
 */
export type WorkspaceStorageType = 'local' | 'cloud';

export interface Workspace {
  id: string;
  name: string;            // Read from workspace folder config (not stored in global config)
  rootPath?: string;       // Absolute path to workspace folder (required for local workspaces, absent for cloud)
  createdAt: number;
  lastAccessedAt?: number; // For sorting recent workspaces
  iconUrl?: string;
  mcpUrl?: string;
  mcpAuthType?: McpAuthType;

  /** Storage backend type. Defaults to 'local' if not set. */
  storageType?: WorkspaceStorageType;

  /**
   * Inline workspace defaults (used by cloud workspaces where there's no local config.json).
   * For local workspaces, these settings live in {rootPath}/config.json instead.
   */
  defaults?: {
    model?: string;
    enabledSourceSlugs?: string[];
    permissionMode?: string;
    cyclablePermissionModes?: string[];
    workingDirectory?: string;
    thinkingLevel?: string;
    colorTheme?: string;
  };

  /**
   * Cloud workspace configuration (only present when storageType is 'cloud').
   * API key is stored separately in CredentialManager, NOT in this config.
   */
  cloudConfig?: {
    /** Remote Worker URL, e.g., "https://my-craft-cloud.workers.dev" */
    remoteUrl: string;
    /** Workspace slug used as the Durable Object identity (derived from name) */
    workspaceSlug: string;
    /** Last time data was synced from the cloud */
    lastSyncedAt?: number;
  };
}

export type AuthType = 'api_key' | 'oauth_token';

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

// Config stored in JSON file (credentials stored in encrypted file, not here)
export interface StoredConfig {
  authType?: AuthType;
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  activeSessionId: string | null;  // Currently active session (primary scope)
  model?: string;
}

