/**
 * Workspace and authentication types
 */

/**
 * How MCP server should be authenticated (workspace-level)
 * Note: Different from SourceMcpAuthType which uses 'oauth' | 'bearer' | 'none' for individual sources
 */
export type McpAuthType = 'workspace_oauth' | 'workspace_bearer' | 'public';

export interface Workspace {
  id: string;
  name: string;            // Read from workspace folder config (not stored in global config)
  rootPath: string;        // Absolute path to workspace folder (e.g., ~/Projects/my-app/craft-agent)
  createdAt: number;
  lastAccessedAt?: number; // For sorting recent workspaces
  iconUrl?: string;
  mcpUrl?: string;
  mcpAuthType?: McpAuthType;
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

  /**
   * Viewer service configuration for session sharing
   *
   * Configures the backend used for sharing sessions publicly via URLs.
   * Two backend types are supported:
   *
   * - `craft-hosted`: Uses the hosted Craft viewer service (requires craftUrl)
   * - `static-export`: Exports sessions as static HTML files (requires exportPath, optionally uploadCommand)
   *
   * @example
   * // Craft-hosted configuration
   * {
   *   type: 'craft-hosted',
   *   craftUrl: 'https://viewer.craft.do'
   * }
   *
   * @example
   * // Static export with S3 upload
   * {
   *   type: 'static-export',
   *   exportPath: '/Users/username/shared-sessions',
   *   uploadCommand: 'aws s3 sync /Users/username/shared-sessions s3://my-bucket/sessions'
   * }
   */
  viewer?: {
    /** The viewer backend type */
    type: 'craft-hosted' | 'static-export';
    /** Base URL for the Craft-hosted viewer service (required for craft-hosted) */
    craftUrl?: string;
    /** Local filesystem path for static exports (required for static-export) */
    exportPath?: string;
    /** Optional shell command to run after static export (e.g., rsync to S3) */
    uploadCommand?: string;
  };
}

