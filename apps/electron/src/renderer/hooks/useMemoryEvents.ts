import { useCallback, useEffect } from 'react'
import { useAtom } from 'jotai'
import { memoryEventsStateAtomFamily } from '@/atoms/memory'
import type { MemoryEvent, MemoryScope } from '@craft-agent/shared/memory/types'

interface MemoryEventsApi {
  listMemoryEvents?: (payload: { scope: MemoryScope; agentSlug?: string | null }) => Promise<MemoryEvent[]>
  onMemoryChanged?: (listener: (scope: MemoryScope, agentSlug: string | null) => void) => () => void
}

function memoryEventsKey(scope: MemoryScope, agentSlug: string | null | undefined): string {
  return scope === 'user' ? 'user' : `agent:${agentSlug ?? '__no_agent__'}`
}

export function useMemoryEvents(scope: MemoryScope, agentSlug?: string | null) {
  const key = memoryEventsKey(scope, agentSlug)
  const [state, setState] = useAtom(memoryEventsStateAtomFamily(key))

  const refresh = useCallback(async () => {
    if (scope === 'agent' && !agentSlug) {
      setState({ events: [], loading: false, error: null })
      return
    }

    setState((prev) => ({ ...prev, loading: true }))
    try {
      const api = window.electronAPI as unknown as MemoryEventsApi
      const events = await api.listMemoryEvents?.({
        scope,
        agentSlug: scope === 'agent' ? agentSlug ?? null : null,
      })
      setState({
        events: sortMemoryEvents(events ?? []),
        loading: false,
        error: null,
      })
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      }))
    }
  }, [agentSlug, scope, setState])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const api = window.electronAPI as unknown as MemoryEventsApi
    return api.onMemoryChanged?.((changedScope, changedAgentSlug) => {
      if (changedScope === 'user' && scope === 'user') {
        void refresh()
      }
      if (changedScope === 'agent' && scope === 'agent' && changedAgentSlug === agentSlug) {
        void refresh()
      }
    })
  }, [agentSlug, refresh, scope])

  return {
    events: state.events,
    loading: state.loading,
    error: state.error,
    refresh,
  }
}

function sortMemoryEvents(events: MemoryEvent[]): MemoryEvent[] {
  return [...events].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
}
