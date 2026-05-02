import { useCallback, useEffect } from 'react'
import { useAtom } from 'jotai'
import { agentMemoryStateAtomFamily } from '@/atoms/memory'
import type { LoadedMemoryFile, MemoryEntry, MemoryEntryType, MemoryScope } from '@craft-agent/shared/memory/types'

export interface MemoryMutationInput {
  name: string
  type: MemoryEntryType
  body: string
  expires?: string | null
  force?: boolean
}

interface MemoryApi {
  listAgentMemory?: (agentSlug: string) => Promise<LoadedMemoryFile>
  upsertMemory?: (payload: MemoryMutationInput & { scope: MemoryScope; agentSlug?: string | null }) => Promise<MemoryEntry | void>
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
      const result = agentSlug ? await api.listAgentMemory?.(agentSlug) : undefined
      setState({
        entries: sortMemoryEntries(result?.entries ?? []),
        loading: false,
        error: null,
        warning: formatMemoryWarnings(result),
      })
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
        warning: null,
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
    await api.upsertMemory?.({ ...input, scope: 'agent', agentSlug, force: true })
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
    warning: state.warning,
    refresh,
    upsert,
    remove,
  }
}

function sortMemoryEntries(entries: MemoryEntry[]): MemoryEntry[] {
  return [...entries].sort((a, b) => {
    const byDate = Date.parse(b.updated ?? b.created) - Date.parse(a.updated ?? a.created)
    return byDate || a.name.localeCompare(b.name)
  })
}

function formatMemoryWarnings(value: LoadedMemoryFile | undefined | void): string | null {
  if (!value?.parseWarnings?.length) return null
  return value.parseWarnings.map((warning) => warning.message).join(' ')
}
