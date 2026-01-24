/**
 * Config Types (Browser-safe)
 *
 * Pure type definitions for configuration.
 * Re-exports from @craft-agent/core for compatibility.
 */

// Re-export all config types from core (single source of truth)
export type {
  Workspace,
  McpAuthType,
  AuthType,
  OAuthCredentials,
} from '@craft-agent/core/types';

/**
 * God Mode configuration (dev-only self-building feature)
 */
export interface GodModeConfig {
  enabled: boolean;
  sourcePath: string;  // Path to craft-agents-oss source code
  workspaceContext?: string;  // Custom context for the agent
}
