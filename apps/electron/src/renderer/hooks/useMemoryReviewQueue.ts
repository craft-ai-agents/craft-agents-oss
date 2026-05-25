import { useCallback, useEffect } from 'react'
import { useAtom } from 'jotai'
import { memoryReviewQueueStateAtom } from '@/atoms/memory'
import type {
  MemoryEntry,
  MemoryReviewItem,
  MemoryScope,
} from '@craft-agent/shared/memory/types'

export interface MemoryReviewApi {
  listMemoryReviewQueue?: () => Promise<MemoryReviewItem[]>
  onMemoryChanged?: (listener: (scope: MemoryScope, agentSlug: string | null) => void) => () => void
  resolveMemoryReview?: (payload: { id: string; status: 'approved' | 'rejected' | 'applied'; decisionReason?: string }) => Promise<MemoryReviewItem | null>
  applyMemoryReview?: (payload: { id: string; decisionReason?: string }) => Promise<MemoryReviewItem | null>
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

  useEffect(() => {
    const api = window.electronAPI as unknown as MemoryReviewApi
    return api.onMemoryChanged?.(() => {
      void refresh()
    })
  }, [refresh])

  const reject = useCallback(async (item: MemoryReviewItem, reason?: string) => {
    const api = window.electronAPI as unknown as MemoryReviewApi
    await api.resolveMemoryReview?.({ id: item.id, status: 'rejected', decisionReason: reason })
    await refresh()
  }, [refresh])

  const apply = useCallback(async (item: MemoryReviewItem) => {
    const api = window.electronAPI as unknown as MemoryReviewApi
    await applyMemoryReviewItem(api, item)
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

export async function applyMemoryReviewItem(api: MemoryReviewApi, item: MemoryReviewItem): Promise<void> {
  if (api.applyMemoryReview) {
    const applied = await api.applyMemoryReview({ id: item.id })
    if (!applied || applied.status !== 'applied') {
      throw new Error(`Memory review proposal was not applied: ${item.name}`)
    }
    return
  }

  const metadata = {
    actor: 'memory-review',
    evidence: item.evidence,
    runId: item.sourceRunId,
  }

  if (item.action === 'save') {
    if (!item.type || !item.body) throw new Error('Save proposal is missing type or body')
    if (!api.saveMemory) throw new Error('Memory save API is unavailable')
    await api.saveMemory({
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
    if (!api.updateMemory) throw new Error('Memory update API is unavailable')
    const updated = await api.updateMemory({
      scope: item.scope,
      agentSlug: item.agentSlug ?? null,
      name: item.name,
      body: item.body,
      expires: item.expires,
      metadata,
    })
    if (!updated) throw new Error(`Memory not found: ${item.name}`)
  } else {
    if (!api.deleteMemory) throw new Error('Memory delete API is unavailable')
    const deleted = await api.deleteMemory({
      scope: item.scope,
      agentSlug: item.agentSlug ?? null,
      name: item.name,
      metadata,
    })
    if (!deleted) throw new Error(`Memory not found: ${item.name}`)
  }

  if (!api.resolveMemoryReview) throw new Error('Memory review API is unavailable')
  await api.resolveMemoryReview({ id: item.id, status: 'applied' })
}
