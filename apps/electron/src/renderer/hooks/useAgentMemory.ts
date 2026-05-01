import { useCallback, useEffect } from 'react'
import { useAtom } from 'jotai'
import { agentMemoryStateAtomFamily } from '@/atoms/memory'
import type { LoadedMemoryFile, MemoryEntry, MemoryEntryType, MemoryScope } from '@craft-agent/shared/memory'

export interface MemoryMutationInput {
  name: string
  type: MemoryEntryType
  body: string
  expires?: string | null
}

interface MemoryApi {
  listAgentMemory?: (agentSlug: string) => Promise<MemoryEntry[] | LoadedMemoryFile>
  upsertMemory?: (payload: MemoryMutationInput & { scope: MemoryScope; agentSlug?: string | null }) => Promise<MemoryEntry | LoadedMemoryFile | void>
  deleteMemory?: (payload: { scope: MemoryScope; agentSlug?: string | null; name: string }) => Promise<boolean>
  onMemoryChanged?: (listener: (scope: MemoryScope, agentSlug: string | null) => void) => () => void
}

export function useAgentMemory(agentSlug: string | null | undefined) {
  const key = agentSlug ?? '__no_agent__'
  const [state, setState] = useAtom(agentMemoryStateAtomFamily(key))

  const refresh = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true }))
    try {
      const api = window.electronAPI as unknown as MemoryApi
      const entries = agentSlug ? normalizeMemoryEntries(await api.listAgentMemory?.(agentSlug)) : []
      setState({ entries: sortMemoryEntries(entries), loading: false, error: null })
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      }))
    }
  }, [agentSlug, setState])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const api = window.electronAPI as unknown as MemoryApi
    return api.onMemoryChanged?.((scope, changedAgentSlug) => {
      if (scope === 'agent' && changedAgentSlug === agentSlug) {
        void refresh()
      }
    })
  }, [agentSlug, refresh])

  const upsert = useCallback(async (input: MemoryMutationInput) => {
    if (!agentSlug) throw new Error('No agent selected')
    const api = window.electronAPI as unknown as MemoryApi
    await api.upsertMemory?.({ ...input, scope: 'agent', agentSlug })
    await refresh()
  }, [agentSlug, refresh])

  const remove = useCallback(async (name: string) => {
    if (!agentSlug) return false
    const api = window.electronAPI as unknown as MemoryApi
    const ok = await api.deleteMemory?.({ scope: 'agent', agentSlug, name })
    if (ok !== false) await refresh()
    return ok !== false
  }, [agentSlug, refresh])

  return {
    entries: state.entries,
    loading: state.loading,
    error: state.error,
    refresh,
    upsert,
    remove,
  }
}

function normalizeMemoryEntries(value: MemoryEntry[] | LoadedMemoryFile | undefined | void): MemoryEntry[] {
  if (!value) return []
  if (Array.isArray(value)) return value
  return value.entries ?? []
}

function sortMemoryEntries(entries: MemoryEntry[]): MemoryEntry[] {
  return [...entries].sort((a, b) => a.name.localeCompare(b.name))
}
