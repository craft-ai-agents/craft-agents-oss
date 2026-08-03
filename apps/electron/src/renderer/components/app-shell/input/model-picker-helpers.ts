import {
  isLocalConnection,
  type LlmConnection,
} from '@config/llm-connections'
import { GROUP_NAME } from '@archstudio/shared/branding'

// Direct subpath, not the '@archstudio/shared/config' barrel — the barrel
// re-exports config/storage.ts (fs) and would break the renderer bundle.
export { getConnectionDisplayName } from '@archstudio/shared/config/provider-labels'

/**
 * Format token count for display (e.g., 1500 -> "1.5k", 200000 -> "200k").
 * Shared by the desktop model dropdown and the compact (drawer) model picker.
 */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M`
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(tokens >= 10000 ? 0 : 1)}k`
  }
  return tokens.toString()
}

/**
 * Strip the "pi/" prefix from model IDs/display names so the user sees a
 * provider-agnostic label in the picker (e.g., "pi/claude-opus" → "claude-opus").
 */
export function stripPiPrefixForDisplay(value: string): string {
  return value.startsWith('pi/') ? value.slice(3) : value
}

export type ConnectionGroup = [groupName: string, connections: LlmConnection[]]

/**
 * Group connections by provider type for hierarchical picker rendering.
 * Each provider section can contain multiple connections (API Key, OAuth, …).
 * Order is significant for UI: Anthropic, Local, ARCHstudio Backend.
 * Empty groups are dropped.
 */
export function groupConnectionsByProvider<T extends LlmConnection>(
  connections: readonly T[],
): Array<[string, T[]]> {
  const groups: Record<string, T[]> = {
    'Anthropic': [],
    'Local': [],
    [GROUP_NAME]: [],
  }
  for (const conn of connections) {
    const provider = conn.providerType || 'anthropic'
    if (provider === 'anthropic') {
      groups['Anthropic'].push(conn)
    } else if (provider === 'pi_compat' && isLocalConnection(conn)) {
      groups['Local'].push(conn)
    } else if (provider === 'pi' || provider === 'pi_compat') {
      groups[GROUP_NAME].push(conn)
    }
  }

  // Rename 'Local' to 'Ollama' when all connections in that group are
  // flagged as local-model (isLocalModel=true), e.g. Ollama instances.
  // When there's a mix of flagged and legacy local connections, keep 'Local'.
  const localGroupName = (
    groups['Local'].length > 0 && groups['Local'].every(c => c.isLocalModel)
  ) ? 'Ollama' : 'Local'

  // Rebuild with guaranteed order: Anthropic → Ollama/Local → ARCHstudio Backend
  const result: Array<[string, T[]]> = [
    ['Anthropic', groups['Anthropic']],
    [localGroupName, groups['Local']],
    [GROUP_NAME, groups[GROUP_NAME]],
  ]
  return result.filter(([, conns]) => conns.length > 0)
}
