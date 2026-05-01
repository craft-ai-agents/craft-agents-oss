import { useCallback, useEffect } from 'react'
import { useAtom } from 'jotai'
import { userMemoryStateAtom } from '@/atoms/memory'
import type { LoadedMemoryFile, MemoryEntry, MemoryScope } from '@craft-agent/shared/memory'
import type { MemoryMutationInput } from '@/hooks/useAgentMemory'

interface MemoryApi {
  listUserMemory?: () => Promise<MemoryEntry[] | LoadedMemoryFile>
  upsertMemory?: (payload: MemoryMutationInput & { scope: MemoryScope; agentSlug?: string | null }) => Promise<MemoryEntry | LoadedMemoryFile | void>
  deleteMemory?: (payload: { scope: MemoryScope; agentSlug?: string | null; name: string }) => Promise<boolean>
  onMemoryChanged?: (listener: (scope: MemoryScope, agentSlug: string | null) => void) => () => void
}

export function useUserProfile() {
  const [state, setState] = useAtom(userMemoryStateAtom)

  const refresh = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true }))
    try {
      const api = window.electronAPI as unknown as MemoryApi
      const entries = normalizeMemoryEntries(await api.listUserMemory?.())
      setState({ entries: sortMemoryEntries(entries), loading: false, error: null })
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      }))
    }
  }, [setState])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const api = window.electronAPI as unknown as MemoryApi
    return api.onMemoryChanged?.((scope) => {
      if (scope === 'user') {
        void refresh()
      }
    })
  }, [refresh])

  const upsert = useCallback(async (input: MemoryMutationInput) => {
    const api = window.electronAPI as unknown as MemoryApi
    await api.upsertMemory?.({ ...input, scope: 'user' })
    await refresh()
  }, [refresh])

  const remove = useCallback(async (name: string) => {
    const api = window.electronAPI as unknown as MemoryApi
    const ok = await api.deleteMemory?.({ scope: 'user', name })
    if (ok !== false) await refresh()
    return ok !== false
  }, [refresh])

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
