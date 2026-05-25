import { useCallback, useEffect } from 'react'
import { useAtom } from 'jotai'
import { memoryReviewQueueStateAtom } from '@/atoms/memory'
import type {
  MemoryEntry,
  MemoryReviewItem,
  MemoryScope,
} from '@craft-agent/shared/memory/types'

interface MemoryReviewApi {
  listMemoryReviewQueue?: () => Promise<MemoryReviewItem[]>
  resolveMemoryReview?: (payload: { id: string; status: 'approved' | 'rejected' | 'applied'; decisionReason?: string }) => Promise<MemoryReviewItem | null>
  saveMemory?: (payload: {
    scope: MemoryScope
    agentSlug?: string | null
    name: string
    type: NonNullable<MemoryReviewItem['type']>
    body?: string
    content?: string
    expires?: string | null
    force?: boolean
    metadata?: Record<string, unknown>
  }) => Promise<MemoryEntry>
  updateMemory?: (payload: {
    scope: MemoryScope
    agentSlug?: string | null
    name: string
    body?: string
    content?: string
    expires?: string | null
    metadata?: Record<string, unknown>
  }) => Promise<MemoryEntry | null>
  deleteMemory?: (payload: {
    scope: MemoryScope
    agentSlug?: string | null
    name: string
    metadata?: Record<string, unknown>
  }) => Promise<boolean>
}

export function useMemoryReviewQueue(filter?: { scope?: MemoryScope; agentSlug?: string | null }) {
  const [state, setState] = useAtom(memoryReviewQueueStateAtom)

  const refresh = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true }))
    try {
      const api = window.electronAPI as unknown as MemoryReviewApi
      const items = await api.listMemoryReviewQueue?.()
      setState({
        items: sortReviewItems(items ?? []),
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
  }, [setState])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const reject = useCallback(async (item: MemoryReviewItem, reason?: string) => {
    const api = window.electronAPI as unknown as MemoryReviewApi
    await api.resolveMemoryReview?.({ id: item.id, status: 'rejected', decisionReason: reason })
    await refresh()
  }, [refresh])

  const apply = useCallback(async (item: MemoryReviewItem) => {
    const api = window.electronAPI as unknown as MemoryReviewApi
    const metadata = {
      actor: 'memory-review',
      evidence: item.evidence,
      runId: item.sourceRunId,
    }

    if (item.action === 'save') {
      if (!item.type || !item.body) throw new Error('Save proposal is missing type or body')
      await api.saveMemory?.({
        scope: item.scope,
        agentSlug: item.agentSlug ?? null,
        name: item.name,
        type: item.type,
        body: item.body,
        expires: item.expires,
        force: true,
        metadata,
      })
    } else if (item.action === 'update') {
      await api.updateMemory?.({
        scope: item.scope,
        agentSlug: item.agentSlug ?? null,
        name: item.name,
        body: item.body,
        expires: item.expires,
        metadata,
      })
    } else {
      await api.deleteMemory?.({
        scope: item.scope,
        agentSlug: item.agentSlug ?? null,
        name: item.name,
        metadata,
      })
    }

    await api.resolveMemoryReview?.({ id: item.id, status: 'applied' })
    await refresh()
  }, [refresh])

  return {
    items: filterReviewItems(state.items, filter),
    loading: state.loading,
    error: state.error,
    refresh,
    apply,
    reject,
  }
}

function filterReviewItems(
  items: MemoryReviewItem[],
  filter?: { scope?: MemoryScope; agentSlug?: string | null },
): MemoryReviewItem[] {
  return items.filter((item) => {
    if (item.status !== 'pending') return false
    if (filter?.scope && item.scope !== filter.scope) return false
    if (filter?.scope === 'agent' && filter.agentSlug && item.agentSlug !== filter.agentSlug) return false
    return true
  })
}

function sortReviewItems(items: MemoryReviewItem[]): MemoryReviewItem[] {
  return [...items].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
}
