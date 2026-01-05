/**
 * Config Types (Browser-safe)
 *
 * Pure type definitions for configuration.
 * No runtime dependencies - safe for browser bundling.
 */

/**
 * How MCP server should be authenticated
 */
export type McpAuthType = 'workspace_oauth' | 'workspace_bearer' | 'public';

/**
 * Workspace configuration
 */
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

/**
 * Authentication/billing type
 */
export type AuthType = 'api_key' | 'oauth_token' | 'craft_credits';
