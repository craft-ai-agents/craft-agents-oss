/**
 * usePulseNotifications
 *
 * Renderer state for the Pulse notification bell. Mirrors `useWorkflowRuns`:
 * - per-workspace atom family
 * - merge-by-id refresh that prefers the newer createdAt (race-fix pattern)
 * - global broadcast subscription replaces entries on push
 *
 * NOTE: deviates from the brief's filename `useNotifications.ts` because that
 * filename already exists in the codebase for OS-level browser notifications.
 */

import { useCallback, useEffect, useMemo } from 'react'
import { useAtom } from 'jotai'
import {
  notificationsStateAtomFamily,
  type NotificationEntry,
  type NotificationsState,
} from '@/atoms/notifications'

const NULL_WORKSPACE_KEY = '__no_workspace__'
const loadedWorkspaceKeys = new Set<string>()
const inFlightRefreshes = new Map<string, Promise<void>>()
const mountedWorkspaceKeys = new Map<string, number>()
let globalCleanup: (() => void) | null = null
const setStateByWorkspaceKey = new Map<
  string,
  (updater: (prev: NotificationsState) => NotificationsState) => void
>()

function getWorkspaceKey(workspaceId: string | null | undefined): string {
  return workspaceId ?? NULL_WORKSPACE_KEY
}

function sortEntries(entries: NotificationEntry[]): NotificationEntry[] {
  return [...entries].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
}

function spliceEntry(entries: NotificationEntry[], next: NotificationEntry): NotificationEntry[] {
  const filtered = entries.filter((e) => e.id !== next.id)
  filtered.push(next)
  return sortEntries(filtered)
}

/**
 * The bridge surface is fully typed via `apps/electron/src/shared/types.ts`
 * (Lane C). No `as any` cast — the methods either exist or the typecheck
 * fails. Returns the same `window.electronAPI` reference for the hook to
 * use directly.
 */
function getApi() {
  return window.electronAPI
}

export interface UsePulseNotificationsResult {
  entries: NotificationEntry[]
  loading: boolean
  error: string | null
  unreadCount: number
  highestUrgency: 'low' | 'normal' | 'high' | null
  entriesByUrgency: { high: NotificationEntry[]; normal: NotificationEntry[]; low: NotificationEntry[] }
  refresh: () => Promise<void>
  acknowledge: (id: string) => Promise<void>
  clear: (id: string) => Promise<void>
  clearAll: () => Promise<void>
  respond: (id: string, text: string) => Promise<void>
}

export function usePulseNotifications(
  workspaceId: string | null | undefined,
): UsePulseNotificationsResult {
  const workspaceKey = getWorkspaceKey(workspaceId)
  const [state, setState] = useAtom(notificationsStateAtomFamily(workspaceKey))

  const refresh = useCallback(async () => {
    const existing = inFlightRefreshes.get(workspaceKey)
    if (existing) return existing
    const api = getApi()

    const run = (async () => {
      setState((prev) => ({ ...prev, loading: true }))
      try {
        const entries: NotificationEntry[] =
          workspaceId && api.listNotifications
            ? await api.listNotifications(workspaceId)
            : []
        setState((prev) => {
          const byId = new Map<string, NotificationEntry>()
          for (const entry of entries) byId.set(entry.id, entry)
          for (const entry of prev.entries) {
            const listed = byId.get(entry.id)
            if (!listed || (entry.createdAt ?? '') > (listed.createdAt ?? '')) {
              byId.set(entry.id, entry)
            }
          }
          return {
            entries: sortEntries([...byId.values()]),
            loading: false,
            error: null,
          }
        })
        loadedWorkspaceKeys.add(workspaceKey)
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
  }, [setState, workspaceId, workspaceKey])

  useEffect(() => {
    setStateByWorkspaceKey.set(workspaceKey, setState)
    return () => {
      if (setStateByWorkspaceKey.get(workspaceKey) === setState) {
        setStateByWorkspaceKey.delete(workspaceKey)
      }
    }
  }, [setState, workspaceKey])

  useEffect(() => {
    if (!loadedWorkspaceKeys.has(workspaceKey)) {
      void refresh()
    }
  }, [refresh, workspaceKey])

  useEffect(() => {
    mountedWorkspaceKeys.set(workspaceKey, (mountedWorkspaceKeys.get(workspaceKey) ?? 0) + 1)
    if (!globalCleanup) {
      const api = getApi()
      if (api.onNotificationsUpdated) {
        globalCleanup = api.onNotificationsUpdated((changedWorkspaceId, nextEntries) => {
          const changedKey = getWorkspaceKey(changedWorkspaceId)
          const setStateChanged = setStateByWorkspaceKey.get(changedKey)
          if (setStateChanged) {
            setStateChanged((prev) => ({ ...prev, entries: sortEntries(nextEntries) }))
          }
        })
      }
    }
    return () => {
      const nextCount = (mountedWorkspaceKeys.get(workspaceKey) ?? 1) - 1
      if (nextCount <= 0) mountedWorkspaceKeys.delete(workspaceKey)
      else mountedWorkspaceKeys.set(workspaceKey, nextCount)

      if (mountedWorkspaceKeys.size === 0 && globalCleanup) {
        globalCleanup()
        globalCleanup = null
      }
    }
  }, [workspaceKey])

  const acknowledge = useCallback(async (id: string) => {
    if (!workspaceId) return
    const api = getApi()
    if (!api.acknowledgeNotification) return
    const next = await api.acknowledgeNotification(workspaceId, id)
    if (next) {
      setState((prev) => ({ ...prev, entries: spliceEntry(prev.entries, next) }))
    }
  }, [setState, workspaceId])

  const clear = useCallback(async (id: string) => {
    if (!workspaceId) return
    const api = getApi()
    if (!api.clearNotification) return
    const ok = await api.clearNotification(workspaceId, id)
    if (ok) {
      setState((prev) => ({ ...prev, entries: prev.entries.filter((e) => e.id !== id) }))
    }
  }, [setState, workspaceId])

  const clearAll = useCallback(async () => {
    if (!workspaceId) return
    const api = getApi()
    if (!api.clearAllNotifications) return
    await api.clearAllNotifications(workspaceId)
    setState((prev) => ({ ...prev, entries: [] }))
  }, [setState, workspaceId])

  const respond = useCallback(async (id: string, text: string) => {
    if (!workspaceId) return
    const api = getApi()
    if (!api.respondToNotification) return
    const next = await api.respondToNotification(workspaceId, id, text)
    if (next) {
      setState((prev) => ({ ...prev, entries: spliceEntry(prev.entries, next) }))
    }
  }, [setState, workspaceId])

  const { unreadCount, highestUrgency, entriesByUrgency } = useMemo(() => {
    const unread = state.entries.filter((e) => !e.acknowledgedAt && !e.clearedAt)
    const buckets: { high: NotificationEntry[]; normal: NotificationEntry[]; low: NotificationEntry[] } = {
      high: [],
      normal: [],
      low: [],
    }
    for (const e of unread) buckets[e.urgency].push(e)
    let highest: 'low' | 'normal' | 'high' | null = null
    if (buckets.high.length > 0) highest = 'high'
    else if (buckets.normal.length > 0) highest = 'normal'
    else if (buckets.low.length > 0) highest = 'low'
    return {
      unreadCount: unread.length,
      highestUrgency: highest,
      entriesByUrgency: buckets,
    }
  }, [state.entries])

  return {
    entries: state.entries,
    loading: state.loading,
    error: state.error,
    unreadCount,
    highestUrgency,
    entriesByUrgency,
    refresh,
    acknowledge,
    clear,
    clearAll,
    respond,
  }
}
