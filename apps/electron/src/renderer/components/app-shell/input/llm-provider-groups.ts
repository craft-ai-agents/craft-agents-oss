import { getProviderDisplayName } from '@/lib/provider-icons'

export type ProviderAwareConnection = {
  providerType?: string
  type?: string
  baseUrl?: string | null
}

const KNOWN_PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  anthropic_compat: 'Anthropic',
  bedrock: 'Anthropic',
  vertex: 'Anthropic',
  pi: 'Craft Agents Backend',
  pi_compat: 'Craft Agents Backend',
  openai: 'OpenAI',
  openai_compat: 'OpenAI',
}

function toTitleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

/**
 * Resolve a connection's provider label for the model selector grouping.
 *
 * - Supports known canonical providers with fixed grouping labels.
 * - Uses getProviderDisplayName() for migrated/compat provider types.
 * - Falls back to title-cased provider identifier.
 */
export function getConnectionProviderGroupName(connection: ProviderAwareConnection): string {
  const providerType = (connection.providerType || connection.type || '').toLowerCase()
  if (!providerType) {
    return 'Other'
  }

  const explicitLabel = KNOWN_PROVIDER_LABELS[providerType]
  if (explicitLabel) {
    return explicitLabel
  }

  const detectedLabel = getProviderDisplayName(providerType, connection.baseUrl)
  if (detectedLabel !== providerType) {
    return detectedLabel
  }

  return toTitleCase(providerType)
}

/**
 * Group LLM connections by provider label while preserving first-seen order.
 */
export function groupConnectionsByProvider<T extends ProviderAwareConnection>(connections: readonly T[]): Array<[string, T[]]> {
  const grouped = new Map<string, T[]>()

  for (const conn of connections) {
    const providerLabel = getConnectionProviderGroupName(conn)
    const bucket = grouped.get(providerLabel)
    if (bucket) {
      bucket.push(conn)
    } else {
      grouped.set(providerLabel, [conn])
    }
  }

  return Array.from(grouped.entries())
}
