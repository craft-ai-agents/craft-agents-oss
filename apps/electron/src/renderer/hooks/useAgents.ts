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

import { useCallback, useEffect, useMemo } from 'react'
import { useAtom } from 'jotai'
import { agentsStateAtomFamily, type AgentsState } from '@/atoms/agents'
import { CONCIERGE_SLUG, ORCHESTRATOR_SLUG, SOCIAL_PUBLISHER_SLUG } from '@craft-agent/shared/agent-definitions/types'
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

const NULL_WORKSPACE_KEY = '__no_workspace__'
const SYSTEM_AGENT_SLUGS = [CONCIERGE_SLUG, ORCHESTRATOR_SLUG, SOCIAL_PUBLISHER_SLUG] as const
const inFlightRefreshes = new Map<string, Promise<void>>()
const mountedWorkspaceKeys = new Map<string, number>()
let globalDefinitionsCleanup: (() => void) | null = null
const refreshersByWorkspaceKey = new Map<string, () => Promise<void>>()

function getWorkspaceKey(activeWorkspaceId: string | null | undefined): string {
  return activeWorkspaceId ?? NULL_WORKSPACE_KEY
}

function sortAgents(agents: AgentDefinitionDTO[]): AgentDefinitionDTO[] {
  return [...agents].sort((a, b) => a.metadata.name.localeCompare(b.metadata.name))
}

function withSystemActiveSlugs(slugs: string[], agents: AgentDefinitionDTO[]): string[] {
  const next = new Set(slugs)
  for (const systemSlug of SYSTEM_AGENT_SLUGS) {
    if (agents.some((agent) => agent.slug === systemSlug)) next.add(systemSlug)
  }
  return Array.from(next)
}

export function useAgents(activeWorkspaceId: string | null | undefined): UseAgentsResult {
  const workspaceKey = getWorkspaceKey(activeWorkspaceId)
  const [state, setState] = useAtom(agentsStateAtomFamily(workspaceKey))

  const refresh = useCallback(async () => {
    const existing = inFlightRefreshes.get(workspaceKey)
    if (existing) return existing

    const run = (async () => {
      setState((prev) => ({ ...prev, loading: true }))
      try {
        const [libraryRaw, activeRaw] = await Promise.all([
          window.electronAPI.listAllAgentDefinitions(),
          activeWorkspaceId
            ? window.electronAPI.listActiveAgentDefinitions(activeWorkspaceId)
            : Promise.resolve([] as string[]),
        ])
        const allAgents = sortAgents(libraryRaw)
        const next: AgentsState = {
          allAgents,
          activeSlugs: withSystemActiveSlugs(activeRaw, allAgents),
          loading: false,
          error: null,
        }
        setState(next)
      } catch (err) {
        setState((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        }))
      } finally {
        inFlightRefreshes.delete(workspaceKey)
      }
    })()

    inFlightRefreshes.set(workspaceKey, run)
    return run
  }, [activeWorkspaceId, setState, workspaceKey])

  useEffect(() => {
    refreshersByWorkspaceKey.set(workspaceKey, refresh)
    return () => {
      if (refreshersByWorkspaceKey.get(workspaceKey) === refresh) {
        refreshersByWorkspaceKey.delete(workspaceKey)
      }
    }
  }, [refresh, workspaceKey])

  useEffect(() => {
    refresh()
  }, [refresh, workspaceKey])

  useEffect(() => {
    mountedWorkspaceKeys.set(workspaceKey, (mountedWorkspaceKeys.get(workspaceKey) ?? 0) + 1)
    if (!globalDefinitionsCleanup) {
      globalDefinitionsCleanup = window.electronAPI.onAgentDefinitionsChanged(() => {
        for (const refreshWorkspace of refreshersByWorkspaceKey.values()) {
          refreshWorkspace()
        }
      })
    }
    return () => {
      const nextCount = (mountedWorkspaceKeys.get(workspaceKey) ?? 1) - 1
      if (nextCount <= 0) mountedWorkspaceKeys.delete(workspaceKey)
      else mountedWorkspaceKeys.set(workspaceKey, nextCount)

      if (mountedWorkspaceKeys.size === 0 && globalDefinitionsCleanup) {
        globalDefinitionsCleanup()
        globalDefinitionsCleanup = null
      }
    }
  }, [workspaceKey])

  const setActive = useCallback(async (slug: string, active: boolean) => {
    if (!activeWorkspaceId) return
    if ((SYSTEM_AGENT_SLUGS as readonly string[]).includes(slug) && !active) {
      setState((prev) => ({ ...prev, activeSlugs: withSystemActiveSlugs(prev.activeSlugs, prev.allAgents) }))
      return
    }
    const result = await window.electronAPI.setAgentDefinitionActive(activeWorkspaceId, slug, active)
    setState((prev) => ({ ...prev, activeSlugs: withSystemActiveSlugs(result.active, prev.allAgents) }))
  }, [activeWorkspaceId, setState])

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
    setState((prev) => {
      const next = prev.allAgents.filter((a) => a.slug !== created.slug)
      next.push(created)
      next.sort((a, b) => a.metadata.name.localeCompare(b.metadata.name))
      return { ...prev, allAgents: next }
    })
    if (activeWorkspaceId) {
      setState((prev) => ({
        ...prev,
        activeSlugs: prev.activeSlugs.includes(created.slug)
          ? prev.activeSlugs
          : [...prev.activeSlugs, created.slug],
      }))
    }
    return created
  }, [activeWorkspaceId, setState])

  const remove = useCallback(async (slug: string) => {
    const ok = await window.electronAPI.deleteAgentDefinition(slug)
    if (ok) {
      setState((prev) => ({
        ...prev,
        allAgents: prev.allAgents.filter((a) => a.slug !== slug),
        activeSlugs: prev.activeSlugs.filter((s) => s !== slug),
      }))
    }
    return ok
  }, [setState])

  // Derived: agents that are both globally available and active here.
  const activeAgents = useMemo(() => {
    const activeSet = new Set(state.activeSlugs)
    return state.allAgents.filter((a) => activeSet.has(a.slug))
  }, [state.activeSlugs, state.allAgents])

  return {
    allAgents: state.allAgents,
    activeSlugs: state.activeSlugs,
    activeAgents,
    loading: state.loading,
    error: state.error,
    refresh,
    setActive,
    upsert,
    remove,
  }
}
