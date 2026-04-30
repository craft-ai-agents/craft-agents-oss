/**
 * useAgents
 *
 * Renderer-side state for the agent-definitions library. Loads:
 *   - Every agent in the global library
 *   - The slugs activated in the current workspace
 *
 * Subscribes to the agentDefinitions:changed broadcast so the list stays
 * fresh when other clients (or background mutations) edit the library.
 */

import { useCallback, useEffect, useState } from 'react'
import type { AgentDefinitionDTO } from '../../shared/types'

export interface UseAgentsResult {
  /** Every agent in the global library, sorted by display name. */
  allAgents: AgentDefinitionDTO[]
  /** Slugs currently activated in the active workspace. */
  activeSlugs: string[]
  /** Convenience derived list: agents that are active in the active workspace. */
  activeAgents: AgentDefinitionDTO[]
  /** True before the first fetch resolves. */
  loading: boolean
  /** Most recent fetch error (if any). */
  error: string | null
  /** Force a refresh of both library and active list. */
  refresh: () => Promise<void>
  /** Toggle activation in the active workspace. */
  setActive: (slug: string, active: boolean) => Promise<void>
  /** Create or update an agent. Auto-activates in the current workspace. */
  upsert: (input: {
    slug: string
    metadata: AgentDefinitionDTO['metadata']
    systemPrompt: string
  }) => Promise<AgentDefinitionDTO>
  /** Delete an agent from the library AND every workspace's manifest. */
  remove: (slug: string) => Promise<boolean>
}

export function useAgents(activeWorkspaceId: string | null | undefined): UseAgentsResult {
  const [allAgents, setAllAgents] = useState<AgentDefinitionDTO[]>([])
  const [activeSlugs, setActiveSlugs] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [libraryRaw, activeRaw] = await Promise.all([
        window.electronAPI.listAllAgentDefinitions(),
        activeWorkspaceId
          ? window.electronAPI.listActiveAgentDefinitions(activeWorkspaceId)
          : Promise.resolve([] as string[]),
      ])
      const sorted = [...libraryRaw].sort((a, b) =>
        a.metadata.name.localeCompare(b.metadata.name),
      )
      setAllAgents(sorted)
      setActiveSlugs(activeRaw)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [activeWorkspaceId])

  // Initial load + reload on workspace switch.
  useEffect(() => {
    setLoading(true)
    refresh()
  }, [refresh])

  // Subscribe to library/activation broadcasts. Reload either way — both the
  // library shape and the activation list can change.
  useEffect(() => {
    const cleanup = window.electronAPI.onAgentDefinitionsChanged(() => {
      refresh()
    })
    return () => cleanup()
  }, [refresh])

  const setActive = useCallback(async (slug: string, active: boolean) => {
    if (!activeWorkspaceId) return
    const result = await window.electronAPI.setAgentDefinitionActive(activeWorkspaceId, slug, active)
    setActiveSlugs(result.active)
  }, [activeWorkspaceId])

  const upsert = useCallback(async (input: {
    slug: string
    metadata: AgentDefinitionDTO['metadata']
    systemPrompt: string
  }): Promise<AgentDefinitionDTO> => {
    const created = await window.electronAPI.upsertAgentDefinition({
      ...input,
      activateInWorkspaceId: activeWorkspaceId ?? undefined,
    })
    // Optimistic update — the broadcast will refresh too, but updating
    // immediately removes the latency before a freshly-saved agent shows up.
    setAllAgents((prev) => {
      const next = prev.filter((a) => a.slug !== created.slug)
      next.push(created)
      next.sort((a, b) => a.metadata.name.localeCompare(b.metadata.name))
      return next
    })
    if (activeWorkspaceId) {
      setActiveSlugs((prev) => (prev.includes(created.slug) ? prev : [...prev, created.slug]))
    }
    return created
  }, [activeWorkspaceId])

  const remove = useCallback(async (slug: string) => {
    const ok = await window.electronAPI.deleteAgentDefinition(slug)
    if (ok) {
      setAllAgents((prev) => prev.filter((a) => a.slug !== slug))
      setActiveSlugs((prev) => prev.filter((s) => s !== slug))
    }
    return ok
  }, [])

  // Derived: agents that are both globally available and active here.
  const activeSet = new Set(activeSlugs)
  const activeAgents = allAgents.filter((a) => activeSet.has(a.slug))

  return {
    allAgents,
    activeSlugs,
    activeAgents,
    loading,
    error,
    refresh,
    setActive,
    upsert,
    remove,
  }
}
