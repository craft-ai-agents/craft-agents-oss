/**
 * Credential Storage Types
 *
 * Defines the types for secure credential storage using AES-256-GCM encryption.
 * Supports global and source-scoped credentials.
 *
 * Credential key format: "{type}::{scope...}"
 *
 * Examples:
 *   - anthropic_api_key::global
 *   - claude_oauth::global
 *   - source_oauth::{workspaceId}::{sourceId}
 *   - source_bearer::{workspaceId}::{sourceId}
 *
 * Note: Using "::" as delimiter to avoid conflicts with "/" in URLs or paths.
 */

/** Types of credentials we store */
export type CredentialType =
  // Global credentials
  | 'anthropic_api_key'  // Anthropic API key for Claude
  | 'claude_oauth'       // Claude OAuth token (Max subscription)
  // Workspace credentials
  | 'workspace_oauth'    // Workspace MCP OAuth token
  // Source credentials (stored at ~/.craft-agent/workspaces/{ws}/sources/{slug}/)
  | 'source_oauth'       // OAuth tokens for MCP/API sources
  | 'source_bearer'      // Bearer tokens
  | 'source_apikey'      // API keys
  | 'source_basic';      // Basic auth (base64 encoded user:pass)

/** Valid credential types for validation */
const VALID_CREDENTIAL_TYPES: readonly CredentialType[] = [
  'anthropic_api_key',
  'claude_oauth',
  'workspace_oauth',
  'source_oauth',
  'source_bearer',
  'source_apikey',
  'source_basic',
] as const;

/** Check if a string is a valid CredentialType */
function isValidCredentialType(type: string): type is CredentialType {
  return VALID_CREDENTIAL_TYPES.includes(type as CredentialType);
}

/** Credential identifier - determines credential store entry key */
export interface CredentialId {
  type: CredentialType;

  // Workspace-scoped format
  /** Workspace ID for workspace-scoped credentials */
  workspaceId?: string;
  /** Source ID for source credentials */
  sourceId?: string;
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
  /** Where the credential came from: 'native' (our OAuth), 'cli' (Claude CLI import) */
  source?: 'native' | 'cli';
}

// Using "::" as delimiter instead of "/" because server names and API names
// could contain "/" (e.g., URLs like "https://api.example.com")
const CREDENTIAL_DELIMITER = '::';

/** Source credential types */
const SOURCE_CREDENTIAL_TYPES = [
  'source_oauth',
  'source_bearer',
  'source_apikey',
  'source_basic',
] as const;

/** Check if type is a source credential */
function isSourceCredential(type: CredentialType): boolean {
  return (SOURCE_CREDENTIAL_TYPES as readonly string[]).includes(type);
}

/** Convert CredentialId to credential store account string */
export function credentialIdToAccount(id: CredentialId): string {
  const parts: string[] = [id.type];

  // Workspace-scoped format (no source):
  // workspace_oauth::{workspaceId}
  if (id.type === 'workspace_oauth' && id.workspaceId) {
    parts.push(id.workspaceId);
    return parts.join(CREDENTIAL_DELIMITER);
  }

  // Source-scoped format:
  // Source credentials: source_oauth::{workspaceId}::{sourceId}
  if (isSourceCredential(id.type) && id.workspaceId && id.sourceId) {
    parts.push(id.workspaceId);
    parts.push(id.sourceId);
    return parts.join(CREDENTIAL_DELIMITER);
  }

  parts.push('global');
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

  // Workspace-scoped format (no source):
  // workspace_oauth::{workspaceId}
  if (type === 'workspace_oauth' && parts.length === 2) {
    return { type, workspaceId: parts[1] };
  }

  // Source-scoped format:
  // Source credentials: source_oauth::{workspaceId}::{sourceId}
  if (isSourceCredential(type) && parts.length === 3) {
    return { type, workspaceId: parts[1], sourceId: parts[2] };
  }

  if (parts.length === 2 && parts[1] === 'global') {
    return { type };
  }

  // Unknown format
  return null;
}
