/**
 * Connection Setup Logic
 *
 * Pure functions extracted from ipc.ts for testability.
 * No dependency on ipcMain, sessionManager, credential manager, or file I/O.
 */

import type { ModelDefinition } from '@craft-agent/shared/config/models'
import {
  type LlmConnection,
  type CustomEndpointApi,
  getDefaultModelsForConnection,
  getDefaultModelForConnection,
  defaultMidStreamBehavior,
} from '@craft-agent/shared/config'

// ============================================================
// Error Parsing
// ============================================================

/**
 * Parse an error message from a connection test into a user-friendly string.
 */
export function parseTestConnectionError(msg: string): string {
  const lower = msg.toLowerCase()

  if (lower.includes('econnrefused') || lower.includes('enotfound') || lower.includes('fetch failed')) {
    return 'Cannot connect to API server. Check the URL and ensure the server is running.'
  }
  if (lower.includes('no api key found for')) {
    return 'Provider mismatch during setup. Select a provider preset in Craft Agents Backend API Key mode, or use Anthropic API Key mode for arbitrary compatible endpoints.'
  }
  if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('authentication')) {
    return 'Invalid API key'
  }
  if (lower.includes('404') && lower.includes('model')) {
    return 'Model not found. Check the model name and try again.'
  }
  if (lower.includes('404')) {
    return 'API endpoint not found. Check the URL.'
  }
  if (lower.includes('429') || lower.includes('rate limit')) {
    return 'Rate limit exceeded. Please try again.'
  }
  if (lower.includes('403')) {
    return 'API key does not have permission to access this resource'
  }

  return msg.slice(0, 300)
}

/**
 * Guard against ambiguous Pi custom endpoint tests where no provider routing is selected.
 */
export function validateSetupTestInput(params: {
  provider: 'anthropic' | 'pi'
  baseUrl?: string
  piAuthProvider?: string
}): { valid: true } | { valid: false; error: string } {
  const hasCustomEndpoint = !!params.baseUrl?.trim()
  if (params.provider === 'pi' && hasCustomEndpoint && !params.piAuthProvider) {
    return {
      valid: false,
      error: 'Custom endpoint in Craft Agents Backend mode requires selecting a provider preset. For arbitrary Anthropic-compatible endpoints, use Anthropic API Key mode.',
    }
  }

  return { valid: true }
}

/**
 * Returns true when a URL points to local loopback.
 * Used to permit keyless setup tests for local model runtimes (e.g. Ollama).
 */
export function isLoopbackBaseUrl(baseUrl?: string): boolean {
  if (!baseUrl?.trim()) return false
  try {
    const hostname = new URL(baseUrl.trim()).hostname
    const normalizedHostname = hostname.startsWith('[') && hostname.endsWith(']')
      ? hostname.slice(1, -1)
      : hostname
    return normalizedHostname === 'localhost' || normalizedHostname === '127.0.0.1' || normalizedHostname === '::1'
  } catch {
    return false
  }
}

/**
 * Setup tests require API keys for non-local endpoints, but local loopback
 * endpoints may be keyless.
 */
export function setupTestRequiresApiKey(baseUrl?: string): boolean {
  return !isLoopbackBaseUrl(baseUrl)
}

/** Placeholder run that stands in for a stored API key in the edit form (GET_API_KEY). */
export const API_KEY_MASK = '••••••••'

/**
 * Mask a stored API key for display: provider prefix + mask + last four, or the
 * mask alone for short keys. The only producer of masked values.
 */
export function maskApiKey(key: string): string {
  return key.length > 15 ? key.slice(0, 7) + API_KEY_MASK + key.slice(-4) : API_KEY_MASK
}

/**
 * True for values produced by {@link maskApiKey}, i.e. the edit form echoing a
 * stored key back. Real keys never contain the bullet character.
 */
export function isMaskedApiKey(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.includes('••')
}

export type SetupTestApiKeyResolution =
  | { ok: true; apiKey: string; source: 'input' | 'stored' }
  | { ok: false; error: string }

/**
 * Decide which API key a setup test should use.
 *
 * The edit form shows the stored key as a masked placeholder; when the user
 * leaves it untouched and clicks Test, the placeholder arrives here. Testing
 * with the bullets always failed authentication (OSS #1048), so resolve it to
 * the stored credential by connection slug, and ask for the key when that is
 * not possible. Pure apart from the injected store lookup.
 */
export async function resolveSetupTestApiKey(
  input: { apiKey: string | undefined; connectionSlug?: string; allowEmptyApiKey: boolean },
  getStoredApiKey: (slug: string) => Promise<string | null>,
): Promise<SetupTestApiKeyResolution> {
  const trimmed = input.apiKey?.trim() ?? ''

  if (isMaskedApiKey(trimmed)) {
    if (!input.connectionSlug) {
      return { ok: false, error: 'Re-enter the API key to test this connection.' }
    }
    const stored = await getStoredApiKey(input.connectionSlug)
    if (!stored) {
      return { ok: false, error: 'No API key is stored for this connection. Re-enter the key to test it.' }
    }
    return { ok: true, apiKey: stored, source: 'stored' }
  }

  if (!trimmed && !input.allowEmptyApiKey) {
    return { ok: false, error: 'API key is required' }
  }
  return { ok: true, apiKey: trimmed, source: 'input' }
}

/**
 * Store an OAuth access token sent with a connection setup.
 *
 * The Claude sign-in stores the token with its refresh token and expiry
 * (`onboarding:exchangeClaudeCode`), then sends the same access token here.
 * Replacing that entry with the bare token dropped the refresh token and the
 * expiry, so the connection could not refresh once the token expired. A token
 * the connection already holds is left as stored; returns whether it stored.
 * Pure apart from the injected store.
 */
export async function storeSetupOAuthToken(
  store: {
    getLlmOAuth(slug: string): Promise<{ accessToken: string } | null>
    setLlmOAuth(slug: string, credentials: { accessToken: string }): Promise<void>
  },
  slug: string,
  accessToken: string,
): Promise<boolean> {
  if ((await store.getLlmOAuth(slug))?.accessToken === accessToken) return false
  await store.setLlmOAuth(slug, { accessToken })
  return true
}

/**
 * Delete the credentials of a deleted connection. The legacy `claude_oauth` slot
 * goes too when it was the default Claude sign-in: only the default connection
 * reads the slot (`usesLegacyClaudeOAuthSlot`), so the connection that becomes
 * the default would otherwise run on the deleted connection's account.
 * Pure apart from the injected store.
 */
export async function deleteConnectionCredentials(
  store: {
    deleteLlmCredentials(slug: string): Promise<void>
    delete(id: { type: 'claude_oauth' }): Promise<boolean>
  },
  connection: { slug: string; providerType: string; authType: string },
  wasDefault: boolean,
): Promise<void> {
  await store.deleteLlmCredentials(connection.slug)
  if (wasDefault && connection.providerType === 'anthropic' && connection.authType === 'oauth') {
    await store.delete({ type: 'claude_oauth' })
  }
}

/**
 * The default moved away from a Claude sign-in connection: the legacy `claude_oauth`
 * slot goes with it. Only the default connection reads the slot
 * (`usesLegacyClaudeOAuthSlot`), so the new default would otherwise run on the
 * previous one's account once no other connection has credentials of its own
 * (e.g. after the previous default is deleted). A previous default that ran on the
 * slot (`previousUsedSlot`, read before the switch) and has no entry of its own
 * keeps those credentials in its own entry. Pure apart from the injected store.
 */
export async function releaseLegacyClaudeSlot(
  store: {
    getClaudeOAuthCredentials(): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: number } | null>
    getLlmOAuth(slug: string): Promise<{ accessToken: string } | null>
    setLlmOAuth(slug: string, credentials: { accessToken: string; refreshToken?: string; expiresAt?: number }): Promise<void>
    delete(id: { type: 'claude_oauth' }): Promise<boolean>
  },
  previousDefault: { slug: string; providerType: string; authType: string } | null,
  previousUsedSlot: boolean,
  newDefaultSlug: string,
): Promise<void> {
  if (!previousDefault || previousDefault.slug === newDefaultSlug) return
  if (previousDefault.providerType !== 'anthropic' || previousDefault.authType !== 'oauth') return
  const legacy = await store.getClaudeOAuthCredentials()
  if (!legacy?.accessToken) return
  if (previousUsedSlot && !(await store.getLlmOAuth(previousDefault.slug))?.accessToken) {
    const { accessToken, refreshToken, expiresAt } = legacy
    await store.setLlmOAuth(previousDefault.slug, { accessToken, refreshToken, expiresAt })
  }
  await store.delete({ type: 'claude_oauth' })
}

/**
 * Decide how a custom OpenAI/Anthropic-compatible endpoint should be persisted.
 *
 * - Loopback URL with no credential → keyless local model (Ollama, LM Studio).
 * - Loopback URL *with* a credential → real local OpenAI-compat server (vLLM, LiteLLM, etc.);
 *   must be treated like a remote custom endpoint so `piAuthProvider` is set, otherwise
 *   `getPiAuth()` returns null at runtime and chat requests fail with 401 (#636).
 * - Remote URL → always keyed with provider hint for the correct icon.
 *
 * Pure: caller spreads the result into the connection updates patch.
 */
export function resolveCustomEndpointSetup(input: {
  baseUrl: string | undefined
  credential: string | undefined
  customEndpointApi: CustomEndpointApi
}): {
  authType: Extract<LlmConnection['authType'], 'none' | 'api_key_with_endpoint'>
  name?: 'Local Model'
  piAuthProvider?: 'openai' | 'anthropic'
} {
  const isKeylessLoopback = isLoopbackBaseUrl(input.baseUrl) && !input.credential
  if (isKeylessLoopback) {
    return { authType: 'none', name: 'Local Model' }
  }
  return {
    authType: 'api_key_with_endpoint',
    piAuthProvider: input.customEndpointApi === 'anthropic-messages' ? 'anthropic' : 'openai',
  }
}

// ============================================================
// Built-in Connection Templates
// ============================================================

/**
 * Built-in connection templates for the onboarding flow.
 * Each template defines the default configuration for a known connection slug.
 */
export const BUILT_IN_CONNECTION_TEMPLATES: Record<string, {
  name: string | ((hasCustomEndpoint: boolean) => string)
  providerType: LlmConnection['providerType'] | ((hasCustomEndpoint: boolean) => LlmConnection['providerType'])
  authType: LlmConnection['authType'] | ((hasCustomEndpoint: boolean) => LlmConnection['authType'])
  piAuthProvider?: string
}> = {
  'anthropic-api': {
    name: (h) => h ? 'Custom Anthropic-Compatible' : 'Anthropic (API Key)',
    providerType: (h) => h ? 'pi_compat' : 'anthropic',
    authType: (h) => h ? 'api_key_with_endpoint' : 'api_key',
  },
  'claude-max': {
    name: 'Claude Max',
    providerType: 'anthropic',
    authType: 'oauth',
  },
  'chatgpt-plus': {
    name: 'ChatGPT Plus',
    providerType: 'pi',
    authType: 'oauth',
    piAuthProvider: 'openai-codex',
  },
  'github-copilot': {
    name: 'GitHub Copilot',
    providerType: 'pi',
    authType: 'oauth',
    piAuthProvider: 'github-copilot',
  },
  'pi-api-key': {
    name: 'Craft Agents Backend (API Key)',
    providerType: 'pi',
    authType: 'api_key',
    // piAuthProvider set dynamically from setup.piAuthProvider
  },
}

// ============================================================
// Pi Auth Provider Display Names
// ============================================================

const PI_AUTH_PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  'openai-codex': 'OpenAI',
  google: 'Google AI Studio',
  openrouter: 'OpenRouter',
  'azure-openai-responses': 'Azure OpenAI',
  'cloudflare-ai-gateway': 'Cloudflare AI Gateway',
  'amazon-bedrock': 'Amazon Bedrock',
  groq: 'Groq',
  mistral: 'Mistral',
  xai: 'xAI',
  cerebras: 'Cerebras',
  zai: 'z.ai',
  huggingface: 'Hugging Face',
  minimax: 'Minimax',
  'minimax-cn': 'Minimax CN',
  'kimi-coding': 'Kimi (Coding)',
  'vercel-ai-gateway': 'Vercel AI Gateway',
}

/** Get a human-readable display name for a Pi auth provider key */
export function piAuthProviderDisplayName(piAuthProvider: string): string | null {
  return PI_AUTH_PROVIDER_DISPLAY_NAMES[piAuthProvider] ?? null
}

// ============================================================
// Connection Creation
// ============================================================

/**
 * Create an LLM connection configuration from a connection slug.
 * Uses built-in templates for known slugs, throws for unknown slugs
 * (custom connections are created through the settings UI).
 */
export function createBuiltInConnection(slug: string, baseUrl?: string | null): LlmConnection {
  // Try exact match first, then strip numeric suffix for derived slugs (e.g. 'anthropic-api-2' → 'anthropic-api')
  const baseSlug = slug.replace(/-\d+$/, '')
  const template = BUILT_IN_CONNECTION_TEMPLATES[slug] ?? BUILT_IN_CONNECTION_TEMPLATES[baseSlug]
  if (!template) {
    throw new Error(`Unknown built-in connection slug: ${slug}. Custom connections should be created through settings.`)
  }

  const hasCustomEndpoint = !!baseUrl
  const providerType = typeof template.providerType === 'function'
    ? template.providerType(hasCustomEndpoint)
    : template.providerType
  const authType = typeof template.authType === 'function'
    ? template.authType(hasCustomEndpoint)
    : template.authType
  let name = typeof template.name === 'function'
    ? template.name(hasCustomEndpoint)
    : template.name

  // Append suffix number to name for derived connections (e.g. 'anthropic-api-2' → 'Anthropic (API Key) 2')
  const suffixMatch = slug.match(/-(\d+)$/)
  if (suffixMatch && !BUILT_IN_CONNECTION_TEMPLATES[slug]) {
    name = `${name} ${suffixMatch[1]}`
  }

  return {
    slug,
    name,
    providerType,
    authType,
    models: getDefaultModelsForConnection(providerType, template.piAuthProvider),
    defaultModel: getDefaultModelForConnection(providerType, template.piAuthProvider),
    modelSelectionMode: providerType === 'pi' ? 'automaticallySyncedFromProvider' : undefined,
    piAuthProvider: template.piAuthProvider,
    midStreamBehavior: defaultMidStreamBehavior(providerType),
    createdAt: Date.now(),
  }
}

// ============================================================
// Model Validation
// ============================================================

/**
 * Validate that the default model exists in the provided model list.
 * Handles both string and ModelDefinition model entries.
 *
 * This was extracted from inline logic in the setupLlmConnection IPC handler
 * to fix a bug where Array.includes() compared strings against ModelDefinition
 * objects, always returning false for Pi connections.
 */
export function validateModelList(
  models: Array<ModelDefinition | string>,
  defaultModel: string | undefined,
): { valid: boolean; error?: string; resolvedDefaultModel?: string } {
  if (!models || models.length === 0) {
    return { valid: true }
  }

  const modelIds = models.map(m => typeof m === 'string' ? m : m.id)

  if (defaultModel && !modelIds.includes(defaultModel)) {
    return {
      valid: false,
      error: `Default model "${defaultModel}" is not in the provided model list.`,
    }
  }

  if (!defaultModel) {
    const firstModel = models[0]
    const firstModelId = typeof firstModel === 'string' ? firstModel : firstModel!.id
    return {
      valid: true,
      resolvedDefaultModel: firstModelId,
    }
  }

  return { valid: true }
}
