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
  /** True when this workspace is hosted on a configured remote server. */
  isRemote?: boolean;
  /** Stable remote server profile ID when isRemote is true. */
  remoteServerId?: string;
  /** Human-readable remote server name for UI labels. */
  remoteServerName?: string;
  /** Original server-side workspace ID before client-side target rewriting. */
  remoteWorkspaceId?: string;
  /** Remote server URL for diagnostics and badges. */
  remoteServerUrl?: string;
}

/**
 * Authentication type for AI provider
 * - api_key: Anthropic API key
 * - oauth_token: Claude Max OAuth (Anthropic)
 * - codex_oauth: ChatGPT Plus OAuth via Codex app-server
 * - codex_api_key: OpenAI API key via Codex (OpenRouter, Vercel AI Gateway compatible)
 */
export type AuthType = 'api_key' | 'oauth_token' | 'codex_oauth' | 'codex_api_key';

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
