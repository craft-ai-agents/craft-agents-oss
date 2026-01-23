/**
 * useLabels Hook
 *
 * React hook to load and manage workspace labels.
 * Auto-refreshes when workspace changes or labels are modified.
 */

import { useEffect, useCallback } from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { labelsAtom, initializeLabelsAtom } from '@/atoms/labels'
import type { Label } from '@craft-agent/shared/labels'

export interface UseLabelsResult {
  labels: Label[]
  isLoading: boolean
  refresh: () => Promise<void>
}

/**
 * Load labels for a workspace via IPC
 * Auto-refreshes when workspaceId changes or labels are modified
 */
export function useLabels(workspaceId: string | null): UseLabelsResult {
  const [labels, setLabels] = useAtom(labelsAtom)
  const initializeLabels = useSetAtom(initializeLabelsAtom)

  const refresh = useCallback(async () => {
    if (!workspaceId) {
      setLabels([])
      return
    }

    try {
      const loadedLabels = await window.electronAPI.listLabels(workspaceId)
      setLabels(loadedLabels)
    } catch (err) {
      console.error('[useLabels] Failed to load labels:', err)
    }
  }, [workspaceId, setLabels])

  // Load labels when workspace changes
  useEffect(() => {
    if (workspaceId) {
      refresh()
    }
  }, [workspaceId, refresh])

  // Subscribe to live label changes
  useEffect(() => {
    if (!workspaceId) return

    const cleanup = window.electronAPI.onLabelsChanged((changedWorkspaceId) => {
      // Only refresh if this is our workspace
      if (changedWorkspaceId === workspaceId) {
        refresh()
      }
    })

    return cleanup
  }, [workspaceId, refresh])

  return {
    labels,
    isLoading: false, // Labels load quickly, no need for loading state
    refresh,
  }
}
