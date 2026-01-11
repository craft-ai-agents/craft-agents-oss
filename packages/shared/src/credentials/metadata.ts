/**
 * Credential Metadata
 *
 * Defines which credential types can be stored in workspace-scoped portable files
 * vs which must remain in the global machine-bound storage.
 *
 * Key distinction:
 * - Workspace-scoped (portable): API keys, bearer tokens for sources within a workspace
 * - Global (machine-bound): OAuth tokens (identity-based), Anthropic API key (billing)
 *
 * OAuth tokens are intentionally NOT portable because:
 * 1. They represent user identity and should require re-authentication per machine
 * 2. Refresh tokens could be invalidated, causing sync issues
 * 3. Security: identity credentials shouldn't be synced to shared storage
 */

import type { CredentialType, CredentialId } from './types.ts';

export type CredentialCategory = 'api_key' | 'oauth' | 'bearer';

export interface CredentialMetadata {
  /** Category of credential (for UI display and grouping) */
  category: CredentialCategory;

  /**
   * Can this credential type be stored in workspace-scoped portable files?
   *
   * true = Can be stored in workspace credentials.enc (syncable)
   * false = Must remain in global machine-bound storage
   */
  workspaceScoped: boolean;

  /** Human-readable description for UI */
  description: string;
}

/**
 * Metadata for each credential type.
 *
 * Note: Not all CredentialType values are listed here - some are legacy or
 * have the same behavior as their parent type.
 */
export const CREDENTIAL_METADATA: Partial<Record<CredentialType, CredentialMetadata>> = {
  // ============================================================
  // Workspace-scoped (can be portable)
  // ============================================================

  source_apikey: {
    category: 'api_key',
    workspaceScoped: true,
    description: 'API key for a source',
  },

  source_bearer: {
    category: 'bearer',
    workspaceScoped: true,
    description: 'Bearer token for a source',
  },

  // ============================================================
  // Global only (machine-bound, NOT portable)
  // ============================================================

  anthropic_api_key: {
    category: 'api_key',
    workspaceScoped: false, // Part of billing, not workspace
    description: 'Anthropic API key for billing',
  },

  craft_oauth: {
    category: 'oauth',
    workspaceScoped: false, // Identity - re-auth per machine
    description: 'Craft API OAuth token',
  },

  claude_oauth: {
    category: 'oauth',
    workspaceScoped: false, // Identity - re-auth per machine
    description: 'Claude Max OAuth token',
  },

  workspace_oauth: {
    category: 'oauth',
    workspaceScoped: false, // Identity - re-auth per machine
    description: 'Workspace MCP OAuth token',
  },

  source_oauth: {
    category: 'oauth',
    workspaceScoped: false, // Identity - re-auth per machine
    description: 'OAuth token for a source (e.g., Gmail)',
  },

  mcp_oauth: {
    category: 'oauth',
    workspaceScoped: false, // Identity - re-auth per machine
    description: 'MCP server OAuth token',
  },

  workspace_bearer: {
    category: 'bearer',
    workspaceScoped: false, // Usually tied to workspace OAuth flow
    description: 'Workspace bearer token',
  },

  source_basic: {
    category: 'api_key', // Basic auth is like API key
    workspaceScoped: true,
    description: 'Basic auth credentials for a source',
  },

  api_key: {
    category: 'api_key',
    workspaceScoped: false, // Generic API keys stay global
    description: 'Generic API key',
  },
};

/**
 * Check if a credential type can be stored in workspace portable files.
 *
 * @param type - The credential type to check
 * @returns true if the credential can be stored in workspace-scoped portable storage
 */
export function isWorkspaceScoped(type: CredentialType): boolean {
  const metadata = CREDENTIAL_METADATA[type];
  return metadata?.workspaceScoped ?? false;
}

/**
 * Check if a specific credential ID should be stored in portable storage
 * based on both its type and whether it has a workspaceId.
 *
 * @param id - The credential identifier
 * @returns true if this credential should use portable storage (when available)
 */
export function shouldUsePortableStorage(id: CredentialId): boolean {
  // Must be a workspace-scoped type
  if (!isWorkspaceScoped(id.type)) {
    return false;
  }

  // Must have a workspaceId (workspace-scoped credentials only)
  if (!id.workspaceId) {
    return false;
  }

  return true;
}

/**
 * Get the category of a credential type.
 *
 * @param type - The credential type
 * @returns The category ('api_key', 'oauth', or 'bearer')
 */
export function getCredentialCategory(type: CredentialType): CredentialCategory {
  const metadata = CREDENTIAL_METADATA[type];
  return metadata?.category ?? 'api_key';
}

/**
 * Get the human-readable description of a credential type.
 *
 * @param type - The credential type
 * @returns Description string
 */
export function getCredentialDescription(type: CredentialType): string {
  const metadata = CREDENTIAL_METADATA[type];
  return metadata?.description ?? 'Credential';
}
