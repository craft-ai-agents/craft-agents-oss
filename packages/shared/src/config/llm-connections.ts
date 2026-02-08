/**
 * LLM Connections
 *
 * Named provider configurations that users can add, configure, and switch between.
 * Each session locks to a specific connection after the first message.
 * Workspaces can set a default connection.
 */

// Import model types and lists from centralized registry
import {
  type ModelDefinition,
  ANTHROPIC_MODELS,
  OPENAI_MODELS,
} from './models';

// ============================================================
// Types
// ============================================================

/**
 * Provider type determines which backend/SDK implementation to use.
 * This is separate from auth mechanism - a provider may support multiple auth types.
 *
 * - 'anthropic': Direct Anthropic API (api.anthropic.com)
 * - 'anthropic_compat': Anthropic-format compatible endpoints (OpenRouter, etc.)
 * - 'openai': Direct OpenAI API (Codex via app-server)
 * - 'openai_compat': OpenAI-format compatible endpoints (Ollama, OpenRouter, etc.)
 * - 'bedrock': AWS Bedrock (Claude models via AWS)
 * - 'vertex': Google Vertex AI (Claude models via GCP)
 */
export type LlmProviderType =
  | 'anthropic'
  | 'anthropic_compat'
  | 'openai'
  | 'openai_compat'
  | 'bedrock'
  | 'vertex';

/**
 * @deprecated Use LlmProviderType instead. Kept for migration compatibility.
 */
export type LlmConnectionType = 'anthropic' | 'openai' | 'openai-compat';

/**
 * Authentication mechanism for the connection.
 * Determines the UI pattern, credential storage format, and how credentials are passed.
 *
 * Simple token auth:
 * - 'api_key': Single API key field, fixed endpoint known
 * - 'api_key_with_endpoint': API key + custom endpoint URL fields
 * - 'bearer_token': Single bearer token (different header than API key)
 *
 * OAuth flows (browser redirect):
 * - 'oauth': Browser OAuth flow, provider determined by providerType
 *
 * Cloud provider auth:
 * - 'iam_credentials': AWS-style (Access Key + Secret Key + Region)
 * - 'service_account_file': GCP-style JSON file upload
 * - 'environment': Auto-detect from environment variables
 *
 * No auth:
 * - 'none': No authentication required (local models like Ollama)
 */
export type LlmAuthType =
  | 'api_key'
  | 'api_key_with_endpoint'
  | 'oauth'
  | 'iam_credentials'
  | 'bearer_token'
  | 'service_account_file'
  | 'environment'
  | 'none';

/**
 * LLM Connection configuration.
 * Stored in config.llmConnections array.
 */
export interface LlmConnection {
  /** URL-safe identifier (e.g., 'anthropic-api', 'ollama-local') */
  slug: string;

  /** Display name shown in UI (e.g., 'Anthropic (API Key)', 'Ollama') */
  name: string;

  /** Provider type determines backend/SDK implementation */
  providerType: LlmProviderType;

  /**
   * @deprecated Use providerType instead. Kept for migration compatibility.
   * Will be removed in a future version.
   */
  type?: LlmConnectionType;

  /** Custom base URL (required for *_compat providers, optional override for others) */
  baseUrl?: string;

  /** Authentication mechanism */
  authType: LlmAuthType;

  /** Override available models (for custom endpoints that don't support model listing) */
  models?: Array<ModelDefinition | string>;

  /** Default model for this connection */
  defaultModel?: string;

  /**
   * Path to the Codex binary (for 'openai' provider connections).
   * If not set, defaults to 'codex' in PATH.
   *
   * For Craft Agents fork with PreToolUse support, download from:
   * https://github.com/lukilabs/craft-agents-codex/releases
   */
  codexPath?: string;

  // --- Cloud provider specific fields ---

  /** AWS region (for 'bedrock' provider) */
  awsRegion?: string;

  /** GCP project ID (for 'vertex' provider) */
  gcpProjectId?: string;

  /** GCP region (for 'vertex' provider, e.g., 'us-central1') */
  gcpRegion?: string;

  // --- Timestamps ---

  /** Timestamp when connection was created */
  createdAt: number;

  /** Timestamp when connection was last used */
  lastUsedAt?: number;
}

/**
 * LLM Connection with authentication status.
 * Used by UI to show which connections are ready to use.
 */
export interface LlmConnectionWithStatus extends LlmConnection {
  /** Whether the connection has valid credentials */
  isAuthenticated: boolean;

  /** Error message if authentication check failed */
  authError?: string;

  /** Whether this is the global default connection */
  isDefault?: boolean;
}

// ============================================================
// Helpers
// ============================================================

/**
 * Get the mini/utility model ID for a connection.
 * Convention: last model in connection.models = mini model.
 * Used for mini agent (Codex).
 *
 * Same logic as getSummarizationModel() for now, but separate
 * so mini agent and summarization models can diverge independently.
 *
 * @param connection - LLM connection (or partial with models array)
 * @returns Model ID string, or undefined if no models available
 */
export function getMiniModel(connection: Pick<LlmConnection, 'models'>): string | undefined {
  if (!connection.models || connection.models.length === 0) return undefined;
  const last = connection.models[connection.models.length - 1];
  return last == null ? undefined : typeof last === 'string' ? last : last.id;
}

/**
 * Get the summarization model ID for a connection.
 * Convention: last model in connection.models = summarization model.
 * Used for response summarization, title generation, and API tool summarization.
 *
 * Same logic as getMiniModel() for now, but separate
 * so summarization and mini agent models can diverge independently.
 *
 * @param connection - LLM connection (or partial with models array)
 * @returns Model ID string, or undefined if no models available
 */
export function getSummarizationModel(connection: Pick<LlmConnection, 'models'>): string | undefined {
  if (!connection.models || connection.models.length === 0) return undefined;
  const last = connection.models[connection.models.length - 1];
  return last == null ? undefined : typeof last === 'string' ? last : last.id;
}

/**
 * Generate a URL-safe slug from a display name.
 * @param name - Display name to convert
 * @returns URL-safe slug
 */
export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Check if a slug is valid (URL-safe, non-empty).
 * @param slug - Slug to validate
 * @returns true if valid
 */
export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(slug);
}

/**
 * Get credential key for an LLM connection.
 * Format: llm::{slug}::{credentialType}
 *
 * @param slug - Connection slug
 * @param credentialType - Type of credential ('api_key' or 'oauth_token')
 * @returns Credential key string
 */
export function getLlmCredentialKey(slug: string, credentialType: 'api_key' | 'oauth_token'): string {
  return `llm::${slug}::${credentialType}`;
}

/**
 * Credential storage type for each auth mechanism.
 */
export type LlmCredentialStorageType =
  | 'api_key'           // Single token stored as value
  | 'oauth_token'       // OAuth tokens (access, refresh, expiry)
  | 'iam_credentials'   // AWS-style (accessKeyId, secretAccessKey, region)
  | 'service_account'   // JSON file contents
  | null;               // No storage needed (environment or none)

/**
 * Map LlmAuthType to credential storage type.
 * Determines how credentials are stored in the credential manager.
 *
 * @param authType - LLM auth type
 * @returns Credential storage type or null if no credential storage needed
 */
export function authTypeToCredentialStorageType(authType: LlmAuthType): LlmCredentialStorageType {
  switch (authType) {
    case 'api_key':
    case 'api_key_with_endpoint':
    case 'bearer_token':
      return 'api_key';
    case 'oauth':
      return 'oauth_token';
    case 'iam_credentials':
      return 'iam_credentials';
    case 'service_account_file':
      return 'service_account';
    case 'environment':
    case 'none':
      return null;
  }
}

/**
 * @deprecated Use authTypeToCredentialStorageType instead.
 * Kept for backwards compatibility during migration.
 */
export function authTypeToCredentialType(authType: LlmAuthType): 'api_key' | 'oauth_token' | null {
  const storageType = authTypeToCredentialStorageType(authType);
  if (storageType === 'api_key' || storageType === 'oauth_token') {
    return storageType;
  }
  return null;
}

/**
 * Check if an auth type requires a custom endpoint URL.
 * @param authType - LLM auth type
 * @returns true if endpoint URL field should be shown in UI
 */
export function authTypeRequiresEndpoint(authType: LlmAuthType): boolean {
  return authType === 'api_key_with_endpoint';
}

/**
 * Check if a provider type is a "compat" provider.
 * Compat providers use custom endpoints and require explicit model lists.
 * @param providerType - Provider type to check
 * @returns true if this is a compat provider (anthropic_compat or openai_compat)
 */
export function isCompatProvider(providerType: LlmProviderType): boolean {
  return providerType === 'anthropic_compat' || providerType === 'openai_compat';
}

/**
 * Check if a provider type uses Anthropic models (Claude).
 * Includes direct Anthropic, compat endpoints, and cloud providers (Bedrock, Vertex).
 * @param providerType - Provider type to check
 * @returns true if this provider uses Anthropic/Claude models
 */
export function isAnthropicProvider(providerType: LlmProviderType): boolean {
  return (
    providerType === 'anthropic' ||
    providerType === 'anthropic_compat' ||
    providerType === 'bedrock' ||
    providerType === 'vertex'
  );
}

/**
 * Check if a provider type uses OpenAI models (Codex).
 * @param providerType - Provider type to check
 * @returns true if this provider uses OpenAI/Codex models
 */
export function isOpenAIProvider(providerType: LlmProviderType): boolean {
  return providerType === 'openai' || providerType === 'openai_compat';
}

/**
 * Get the default model list for a provider type from the registry.
 * For *_compat providers, returns empty array - those should use connection.models instead.
 *
 * @param providerType - Provider type
 * @returns Model list from registry, or empty array for compat providers
 */
export function getModelsForProviderType(providerType: LlmProviderType): ModelDefinition[] {
  // Compat providers require explicit model lists from the connection
  if (isCompatProvider(providerType)) {
    return [];
  }

  // Standard providers use registry models
  if (providerType === 'openai') {
    return OPENAI_MODELS;
  }

  // Anthropic, Bedrock, Vertex all use Claude models
  return ANTHROPIC_MODELS;
}

/**
 * Get the default model list for a connection's provider type.
 * Unlike getModelsForProviderType(), this handles compat providers by returning
 * the appropriate compat-prefixed model IDs instead of an empty array.
 *
 * Use this whenever you need to populate or backfill a connection's models.
 *
 * @param providerType - Provider type from the connection
 * @returns Default model list (ModelDefinition[] for standard, string[] for compat)
 */
export function getDefaultModelsForConnection(providerType: LlmProviderType): Array<ModelDefinition | string> {
  if (providerType === 'openai_compat') return [
    'openai/gpt-5.2-codex',
    'openai/gpt-5.1-codex-mini',
  ];
  if (providerType === 'openai') return OPENAI_MODELS;
  if (providerType === 'anthropic_compat') return [
    'anthropic/claude-opus-4.6',
    'anthropic/claude-sonnet-4.5',
    'anthropic/claude-haiku-4.5',
  ];
  // anthropic, bedrock, vertex
  return ANTHROPIC_MODELS;
}

/**
 * Get the default model ID for a connection's provider type.
 * Derived from the first entry in getDefaultModelsForConnection() — single source of truth.
 *
 * @param providerType - Provider type from the connection
 * @returns Default model ID string
 */
export function getDefaultModelForConnection(providerType: LlmProviderType): string {
  const models = getDefaultModelsForConnection(providerType);
  const first = models[0];
  if (!first) return ANTHROPIC_MODELS[0]!.id;
  return typeof first === 'string' ? first : first.id;
}

/**
 * Resolve the effective LLM connection slug from available fallbacks.
 *
 * Single source of truth for the fallback chain used everywhere in the UI:
 *   1. Explicit session connection (locked after first message)
 *   2. Workspace-level default override
 *   3. Global default (isDefault flag on a connection)
 *   4. First available connection
 *
 * @param sessionConnection  - Per-session connection slug (session.llmConnection)
 * @param workspaceDefault   - Workspace-level default connection slug
 * @param connections        - All available connections (with status metadata)
 * @returns The resolved slug, or undefined when no connections exist
 */
export function resolveEffectiveConnectionSlug(
  sessionConnection: string | undefined,
  workspaceDefault: string | undefined,
  connections: Pick<LlmConnectionWithStatus, 'slug' | 'isDefault'>[],
): string | undefined {
  return sessionConnection
    ?? workspaceDefault
    ?? connections.find(c => c.isDefault)?.slug
    ?? connections[0]?.slug
}

/**
 * Check if a session's locked connection is unavailable (deleted/removed).
 * Returns true only when a session has an explicit llmConnection that doesn't
 * match any current connection. Sessions without a stored connection (using
 * the fallback chain) are never "unavailable".
 *
 * @param sessionConnection - Per-session connection slug (session.llmConnection)
 * @param connections - All available connections
 * @returns true if the session's connection no longer exists
 */
export function isSessionConnectionUnavailable(
  sessionConnection: string | undefined,
  connections: Pick<LlmConnectionWithStatus, 'slug'>[],
): boolean {
  if (!sessionConnection) return false
  return !connections.some(c => c.slug === sessionConnection)
}

/**
 * Check if an auth type uses browser OAuth flow.
 * @param authType - LLM auth type
 * @returns true if OAuth browser flow should be triggered
 */
export function authTypeIsOAuth(authType: LlmAuthType): boolean {
  return authType === 'oauth';
}

/**
 * Check if a provider supports a given auth type.
 * Returns valid combinations for the type system.
 *
 * @param providerType - Provider type
 * @param authType - Auth type to check
 * @returns true if this is a valid combination
 */
export function isValidProviderAuthCombination(
  providerType: LlmProviderType,
  authType: LlmAuthType
): boolean {
  const validCombinations: Record<LlmProviderType, LlmAuthType[]> = {
    anthropic: ['api_key', 'oauth'],
    anthropic_compat: ['api_key_with_endpoint'],
    openai: ['api_key', 'oauth'],
    openai_compat: ['api_key_with_endpoint', 'none'],
    bedrock: ['bearer_token', 'iam_credentials', 'environment'],
    vertex: ['oauth', 'service_account_file', 'environment'],
  };

  return validCombinations[providerType]?.includes(authType) ?? false;
}

/**
 * Validate that codexPath exists for OpenAI/Codex connections.
 * Only checks path existence - does not verify executability (that happens at runtime).
 *
 * @param connection - LLM connection to validate
 * @returns Object with isValid boolean and optional error message
 */
export function validateCodexPath(connection: LlmConnection): { isValid: boolean; error?: string } {
  // Only validate for OpenAI provider type (Codex)
  if (connection.providerType !== 'openai') {
    return { isValid: true };
  }

  // If no custom codexPath, it will use 'codex' from PATH - that's valid
  if (!connection.codexPath) {
    return { isValid: true };
  }

  // Check if the custom path exists
  // Dynamic import to avoid bundling fs in browser contexts
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { existsSync } = require('fs');
    if (!existsSync(connection.codexPath)) {
      return {
        isValid: false,
        error: `Codex binary not found at path: ${connection.codexPath}. ` +
               `Please verify the path or remove it to use 'codex' from PATH.`,
      };
    }
  } catch {
    // If fs is not available (browser), skip validation
    return { isValid: true };
  }

  return { isValid: true };
}

// ============================================================
// Migration Helpers
// ============================================================

/**
 * Migrate legacy connection type to new provider type.
 * Used during config migration.
 *
 * @param legacyType - Legacy LlmConnectionType value
 * @returns New LlmProviderType value
 */
export function migrateConnectionType(legacyType: LlmConnectionType): LlmProviderType {
  switch (legacyType) {
    case 'anthropic':
      return 'anthropic';
    case 'openai':
      return 'openai';
    case 'openai-compat':
      return 'openai_compat';
  }
}

/**
 * Migrate legacy auth type to new auth type.
 * Determines new auth type based on legacy type + connection context.
 *
 * @param legacyAuthType - Legacy auth type ('api_key' | 'oauth' | 'none')
 * @param hasCustomEndpoint - Whether connection has a custom baseUrl
 * @returns New LlmAuthType value
 */
export function migrateAuthType(
  legacyAuthType: 'api_key' | 'oauth' | 'none',
  hasCustomEndpoint: boolean
): LlmAuthType {
  switch (legacyAuthType) {
    case 'api_key':
      // If has custom endpoint, use api_key_with_endpoint
      return hasCustomEndpoint ? 'api_key_with_endpoint' : 'api_key';
    case 'oauth':
      return 'oauth';
    case 'none':
      return 'none';
  }
}

/**
 * Migrate a legacy LlmConnection to the new format.
 * Creates a new connection object with providerType instead of type.
 *
 * @param legacy - Legacy connection with 'type' field
 * @returns Migrated connection with 'providerType' field
 */
export function migrateLlmConnection(legacy: {
  slug: string;
  name: string;
  type: LlmConnectionType;
  baseUrl?: string;
  authType: 'api_key' | 'oauth' | 'none';
  models?: ModelDefinition[];
  defaultModel?: string;
  codexPath?: string;
  createdAt: number;
  lastUsedAt?: number;
}): LlmConnection {
  const providerType = migrateConnectionType(legacy.type);
  const hasCustomEndpoint = !!legacy.baseUrl && legacy.type !== 'anthropic';
  const authType = migrateAuthType(legacy.authType, hasCustomEndpoint);

  return {
    slug: legacy.slug,
    name: legacy.name,
    providerType,
    type: legacy.type, // Keep for backwards compatibility
    baseUrl: legacy.baseUrl,
    authType,
    models: legacy.models,
    defaultModel: legacy.defaultModel,
    codexPath: legacy.codexPath,
    createdAt: legacy.createdAt,
    lastUsedAt: legacy.lastUsedAt,
  };
}
