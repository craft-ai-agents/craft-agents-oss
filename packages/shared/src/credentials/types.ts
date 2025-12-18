/**
 * Credential Storage Types
 *
 * Defines the types for secure credential storage using AES-256-GCM encryption.
 * Supports global, workspace-scoped, and agent-scoped credentials.
 *
 * Credential key naming:
 *   Format: "{type}::{scope...}"
 *
 * Examples:
 *   - anthropic_api_key::global
 *   - workspace_oauth::{workspaceId}
 *   - mcp_oauth::{workspaceId}::{agentId}::{serverName}
 *   - api_key::{workspaceId}::{agentId}::{apiName}
 *
 * Note: Using "::" as delimiter to avoid conflicts with "/" in URLs or paths.
 */

/** Types of credentials we store */
export type CredentialType =
  | 'anthropic_api_key'
  | 'claude_oauth'
  | 'craft_oauth'
  | 'workspace_oauth'
  | 'workspace_bearer'
  | 'mcp_oauth'
  | 'api_key';

/** Valid credential types for validation */
const VALID_CREDENTIAL_TYPES: readonly CredentialType[] = [
  'anthropic_api_key',
  'claude_oauth',
  'craft_oauth',
  'workspace_oauth',
  'workspace_bearer',
  'mcp_oauth',
  'api_key',
] as const;

/** Check if a string is a valid CredentialType */
function isValidCredentialType(type: string): type is CredentialType {
  return VALID_CREDENTIAL_TYPES.includes(type as CredentialType);
}

/** Credential identifier - determines credential store entry key */
export interface CredentialId {
  type: CredentialType;
  /** For workspace-scoped credentials */
  workspaceId?: string;
  /** For agent-scoped credentials (subagent MCP/API) */
  agentId?: string;
  /** Server name or API name */
  name?: string;
}

/**
 * Stored credential value in encrypted file.
 *
 * This is a generic type for all credential types (OAuth, bearer tokens, API keys).
 * All fields except `value` are optional since not all credential types use them.
 *
 * Note: `clientId` is optional here unlike `OAuthCredentials` (in storage.ts)
 * where it's required, because this type also covers bearer tokens and API keys
 * which don't have a clientId.
 */
export interface StoredCredential {
  /** The secret value (API key or access token) */
  value: string;
  /** OAuth refresh token */
  refreshToken?: string;
  /** OAuth token expiration (Unix timestamp ms) */
  expiresAt?: number;
  /** OAuth client ID (needed for token refresh) */
  clientId?: string;
  /** Token type (e.g., "Bearer") */
  tokenType?: string;
}

// Using "::" as delimiter instead of "/" because server names and API names
// could contain "/" (e.g., URLs like "https://api.example.com")
const CREDENTIAL_DELIMITER = '::';

/** Convert CredentialId to credential store account string */
export function credentialIdToAccount(id: CredentialId): string {
  const parts: string[] = [id.type];

  if (id.workspaceId) {
    parts.push(id.workspaceId);
    if (id.agentId) {
      parts.push(id.agentId);
      if (id.name) {
        parts.push(id.name);
      }
    }
  } else {
    parts.push('global');
  }

  return parts.join(CREDENTIAL_DELIMITER);
}

/** Parse credential store account string back to CredentialId. Returns null if invalid. */
export function accountToCredentialId(account: string): CredentialId | null {
  const parts = account.split(CREDENTIAL_DELIMITER);
  const typeStr = parts[0];

  // Validate the type
  if (!typeStr || !isValidCredentialType(typeStr)) {
    return null;
  }

  const type = typeStr;

  if (parts.length === 2 && parts[1] === 'global') {
    return { type };
  }

  // Workspace-scoped: type/workspaceId
  if (parts.length === 2) {
    return { type, workspaceId: parts[1] };
  }

  // Agent-scoped: type/workspaceId/agentId or type/workspaceId/agentId/name
  const id: CredentialId = { type, workspaceId: parts[1], agentId: parts[2] };

  if (parts[3]) {
    id.name = parts[3];
  }

  return id;
}
