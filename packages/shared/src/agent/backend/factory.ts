/**
 * Agent Factory
 *
 * Creates the appropriate AI agent based on configuration.
 * Supports two agents:
 * - ClaudeAgent (Anthropic) - Default, using @anthropic-ai/claude-agent-sdk
 * - CodexAgent (OpenAI) - Using app-server mode with JSON-RPC
 *
 * Both agents implement AgentBackend directly.
 *
 * LLM Connections:
 * - Backends can be created from LLM connection configs
 * - providerType determines SDK selection and credential routing
 * - authType determines how credentials are retrieved
 */

import type { AgentBackend, BackendConfig, AgentProvider, LlmProviderType, LlmAuthType } from './types.ts';
import { ClaudeAgent } from '../claude-agent.ts';
import { CodexAgent } from '../codex-agent.ts';
import {
  getLlmConnection,
  getDefaultLlmConnection,
  type LlmConnection,
} from '../../config/storage.ts';
// Import deprecated type for legacy migration function only
import type { LlmConnectionType } from '../../config/llm-connections.ts';
// Import validation helpers for provider-auth combinations and codexPath
import { isValidProviderAuthCombination, validateCodexPath } from '../../config/llm-connections.ts';

/**
 * Detect provider from stored auth type.
 *
 * Maps authentication types to their corresponding providers:
 * - api_key, oauth_token → Anthropic (Claude) by default
 *
 * Note: Provider is now determined by LLM connection type, not auth type.
 * This function is kept for backward compatibility.
 *
 * @param authType - The stored authentication type
 * @returns The detected provider
 */
export function detectProvider(authType: string): AgentProvider {
  switch (authType) {
    case 'api_key':
    case 'oauth_token':
      return 'anthropic';

    // Default to Anthropic for unknown types
    default:
      return 'anthropic';
  }
}

/**
 * Create the appropriate backend based on configuration.
 *
 * @param config - Backend configuration including provider selection
 * @returns An initialized AgentBackend instance
 * @throws Error if the requested provider is not yet implemented
 *
 * @example
 * ```typescript
 * // Create Anthropic (Claude) backend
 * const backend = createBackend({
 *   provider: 'anthropic',
 *   workspace: myWorkspace,
 *   model: 'claude-sonnet-4-5-20250929',
 * });
 *
 * // Create Codex backend (uses app-server mode)
 * const codexBackend = createBackend({
 *   provider: 'openai',
 *   workspace: myWorkspace,
 * });
 * ```
 */
export function createBackend(config: BackendConfig): AgentBackend {
  switch (config.provider) {
    case 'anthropic':
      // ClaudeAgent implements AgentBackend directly
      return new ClaudeAgent(config);

    case 'openai':
      // CodexAgent implements AgentBackend directly
      // Auth is handled via ChatGPT Plus OAuth (native flow)
      return new CodexAgent(config);

    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

/**
 * Create the appropriate agent based on configuration.
 * Alias for createBackend - prefer this name for new code.
 */
export const createAgent = createBackend;

/**
 * Get list of currently available providers.
 *
 * @returns Array of provider identifiers that have working implementations
 */
export function getAvailableProviders(): AgentProvider[] {
  return ['anthropic', 'openai'];
}

/**
 * Check if a provider is available for use.
 *
 * @param provider - Provider to check
 * @returns true if the provider has a working implementation
 */
export function isProviderAvailable(provider: AgentProvider): boolean {
  return getAvailableProviders().includes(provider);
}

// ============================================================
// LLM Connection Support
// ============================================================

/**
 * Map LlmProviderType to AgentProvider (SDK selection).
 *
 * AgentProvider determines which backend class to instantiate:
 * - 'anthropic' → ClaudeAgent
 * - 'openai' → CodexAgent
 *
 * @param providerType - The full provider type from LLM connection
 * @returns The agent provider for SDK selection
 */
export function providerTypeToAgentProvider(providerType: LlmProviderType): AgentProvider {
  switch (providerType) {
    // Anthropic SDK backends
    case 'anthropic':
    case 'anthropic_compat':
    case 'bedrock':    // Bedrock uses Anthropic SDK with different auth
    case 'vertex':     // Vertex uses Anthropic SDK with different auth
      return 'anthropic';

    // OpenAI/Codex backends
    case 'openai':
    case 'openai_compat':
      return 'openai';

    default:
      // Exhaustive check
      const _exhaustive: never = providerType;
      return 'anthropic';
  }
}

/**
 * @deprecated Use providerTypeToAgentProvider instead.
 * Map legacy LLM connection type to agent provider.
 *
 * @param connectionType - The legacy LLM connection type
 * @returns The corresponding agent provider
 */
export function connectionTypeToProvider(connectionType: LlmConnectionType): AgentProvider {
  switch (connectionType) {
    case 'anthropic':
      return 'anthropic';
    case 'openai':
    case 'openai-compat':
      return 'openai';
    default:
      return 'anthropic';
  }
}

/**
 * @deprecated Use LlmAuthType directly - no mapping needed.
 * Map legacy LLM auth type to backend auth type.
 *
 * @param authType - The legacy LLM connection auth type
 * @returns The corresponding backend auth type
 */
export function connectionAuthTypeToBackendAuthType(
  authType: LlmAuthType
): LlmAuthType | undefined {
  switch (authType) {
    case 'api_key':
    case 'api_key_with_endpoint':
    case 'oauth':
    case 'bearer_token':
    case 'iam_credentials':
    case 'service_account_file':
      // Pass through auth types that the backend handles
      return authType;
    case 'none':
    case 'environment':
      // These auth types don't require explicit credential passing
      return undefined;
  }
}

/**
 * Get LLM connection for a session.
 * Resolution order: session.llmConnection > workspace.defaults.defaultLlmConnection > global default
 *
 * @param sessionConnection - Connection slug from session (may be undefined)
 * @param workspaceDefaultConnection - Workspace default connection (may be undefined)
 * @returns The resolved LLM connection or null if not found
 */
export function resolveSessionConnection(
  sessionConnection?: string,
  workspaceDefaultConnection?: string
): LlmConnection | null {
  // 1. Session-level connection (locked after first message)
  if (sessionConnection) {
    const connection = getLlmConnection(sessionConnection);
    if (connection) return connection;
  }

  // 2. Workspace default
  if (workspaceDefaultConnection) {
    const connection = getLlmConnection(workspaceDefaultConnection);
    if (connection) return connection;
  }

  // 3. Global default
  const defaultSlug = getDefaultLlmConnection();
  if (!defaultSlug) return null;
  return getLlmConnection(defaultSlug);
}

/**
 * Create backend configuration from an LLM connection.
 *
 * @param connection - The LLM connection config
 * @param baseConfig - Base backend config (workspace, session, etc.)
 * @returns Complete BackendConfig ready for createBackend()
 */
export function createConfigFromConnection(
  connection: LlmConnection,
  baseConfig: Omit<BackendConfig, 'provider' | 'authType' | 'providerType'>
): BackendConfig {
  // Use new providerType if available, fall back to legacy type
  const providerType = connection.providerType || (connection.type ? connectionTypeToProvider(connection.type) as unknown as LlmProviderType : 'anthropic');
  const provider = providerTypeToAgentProvider(providerType);

  return {
    ...baseConfig,
    provider,
    providerType,
    authType: connection.authType,
    connectionSlug: connection.slug,
    // Use connection's default model if no model specified in baseConfig
    model: baseConfig.model || connection.defaultModel,
  };
}

/**
 * Create backend from an LLM connection slug.
 *
 * @param connectionSlug - The LLM connection slug
 * @param baseConfig - Base backend config (workspace, session, etc.)
 * @returns An initialized AgentBackend instance
 * @throws Error if connection not found or has invalid provider-auth combination
 */
export function createBackendFromConnection(
  connectionSlug: string,
  baseConfig: Omit<BackendConfig, 'provider' | 'authType'>
): AgentBackend {
  const connection = getLlmConnection(connectionSlug);
  if (!connection) {
    throw new Error(`LLM connection not found: ${connectionSlug}`);
  }

  // Validate provider-auth combination before creating backend
  // This catches invalid configurations early with a clear error message
  if (!isValidProviderAuthCombination(connection.providerType, connection.authType)) {
    throw new Error(
      `Invalid LLM connection configuration: provider '${connection.providerType}' ` +
      `does not support auth type '${connection.authType}'. ` +
      `Please update the connection settings for '${connection.name}'.`
    );
  }

  // Validate codexPath exists for OpenAI/Codex connections
  const codexValidation = validateCodexPath(connection);
  if (!codexValidation.isValid) {
    throw new Error(codexValidation.error);
  }

  const config = createConfigFromConnection(connection, baseConfig);
  return createBackend(config);
}

