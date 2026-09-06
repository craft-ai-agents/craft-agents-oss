/**
 * usePages
 *
 * Loads workspace-scoped pages into `pagesAtom` and keeps them in sync via the
 * `pages:changed` broadcast (pushed whenever any page.json changes — create,
 * update, delete, content save, or a refresh-script run completing).
 *
 * Unlike `useProjects`, the atom is the ONLY state: consumers read
 * `pagesAtom` (or this hook's passthrough) and there is no duplicate local
 * list to drift.
 */

import { useCallback, useEffect } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { pagesAtom } from '@/atoms/pages'
import type { LoadedPage } from '@craft-agent/shared/pages/types'

export interface UsePagesResult {
  pages: LoadedPage[]
  refresh: () => Promise<void>
}

export function usePages(activeWorkspaceId: string | null | undefined): UsePagesResult {
  const pages = useAtomValue(pagesAtom)
  const setPages = useSetAtom(pagesAtom)

  const refresh = useCallback(async () => {
    if (!activeWorkspaceId) {
      setPages([])
      return
    }
    try {
      const result = await window.electronAPI.getPages(activeWorkspaceId)
      setPages(Array.isArray(result) ? result : [])
    } catch (err) {
      console.error('[usePages] Failed to load pages:', err)
      setPages([])
    }
  }, [activeWorkspaceId, setPages])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (!activeWorkspaceId) return
    const off = window.electronAPI.onPagesChanged((wsId, list) => {
      // Watcher-driven pushes carry the CONFIG workspace id, but the WebUI
      // identifies its workspace by slug — those pushes still target this
      // client (routing is handshake-based), so on an id-form mismatch we
      // re-read instead of dropping (mirrors useAutomations' refetch shape).
      if (wsId === activeWorkspaceId) {
        setPages(Array.isArray(list) ? list : [])
      } else {
        void refresh()
      }
    })
    return () => {
      if (typeof off === 'function') off()
    }
  }, [activeWorkspaceId, setPages, refresh])

  return { pages, refresh }
}
