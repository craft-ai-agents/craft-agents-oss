/**
 * Provider metadata for user-facing error messages and recovery actions.
 * Maps provider identifiers to their status pages and dashboards.
 */

export interface ProviderMetadata {
  /** Display name (e.g., "Anthropic", "OpenAI") */
  name: string
  /** Provider status page URL */
  statusPageUrl?: string
  /** Provider dashboard/billing URL */
  dashboardUrl?: string
}

/**
 * Metadata for known providers.
 * Keys are piAuthProvider values + 'anthropic' for direct API connections.
 */
const PROVIDER_METADATA: Record<string, ProviderMetadata> = {
  anthropic: {
    name: 'Anthropic',
    statusPageUrl: 'https://status.anthropic.com',
    dashboardUrl: 'https://console.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    statusPageUrl: 'https://status.openai.com',
    dashboardUrl: 'https://platform.openai.com',
  },
  google: {
    name: 'Google AI Studio',
    statusPageUrl: 'https://status.cloud.google.com',
    dashboardUrl: 'https://aistudio.google.com',
  },
  'amazon-bedrock': {
    name: 'Amazon Bedrock',
    statusPageUrl: 'https://health.aws.amazon.com',
    dashboardUrl: 'https://console.aws.amazon.com/bedrock',
  },
  'google-vertex': {
    name: 'Google Vertex AI',
    statusPageUrl: 'https://status.cloud.google.com',
    dashboardUrl: 'https://console.cloud.google.com/vertex-ai',
  },
  'github-copilot': {
    name: 'GitHub Copilot',
    statusPageUrl: 'https://www.githubstatus.com',
    dashboardUrl: 'https://github.com/settings/copilot',
  },
  openrouter: {
    name: 'OpenRouter',
    dashboardUrl: 'https://openrouter.ai/settings',
  },
  groq: {
    name: 'Groq',
    statusPageUrl: 'https://status.groq.com',
    dashboardUrl: 'https://console.groq.com',
  },
  mistral: {
    name: 'Mistral',
    dashboardUrl: 'https://console.mistral.ai',
  },
  xai: {
    name: 'xAI',
    dashboardUrl: 'https://console.x.ai',
  },
  cursor: {
    name: 'Cursor',
    statusPageUrl: 'https://status.cursor.com',
    dashboardUrl: 'https://cursor.com/settings',
  },
}

/**
 * Look up provider metadata by provider type and optional piAuthProvider.
 *
 * For direct Anthropic connections: getProviderMetadata('anthropic')
 * For Pi connections: getProviderMetadata('pi', 'openai') or getProviderMetadata('pi', 'amazon-bedrock')
 */
export function getProviderMetadata(
  providerType: string,
  piAuthProvider?: string,
): ProviderMetadata | undefined {
  if (providerType === 'anthropic') {
    return PROVIDER_METADATA.anthropic
  }
  if (piAuthProvider) {
    return PROVIDER_METADATA[piAuthProvider]
  }
  return undefined
}

/**
 * Get just the display name for a provider, with a fallback.
 */
export function getProviderDisplayName(
  providerType: string,
  piAuthProvider?: string,
): string {
  return getProviderMetadata(providerType, piAuthProvider)?.name ?? 'AI provider'
}
