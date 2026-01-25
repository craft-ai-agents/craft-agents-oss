/**
 * useLabels Hook
 *
 * React hook to load and manage workspace labels.
 * Auto-refreshes when workspace changes or labels are modified.
 */

import { useEffect, useCallback, useRef } from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { labelsAtom, initializeLabelsAtom } from '@/atoms/labels'
import type { Label } from '@vesper/shared/labels'

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

  // Use ref to store workspaceId for use in event handler without causing re-subscriptions
  const workspaceIdRef = useRef(workspaceId)
  workspaceIdRef.current = workspaceId

  const refresh = useCallback(async () => {
    const currentWorkspaceId = workspaceIdRef.current
    if (!currentWorkspaceId) {
      setLabels([])
      return
    }

    try {
      const loadedLabels = await window.electronAPI.listLabels(currentWorkspaceId)
      setLabels(loadedLabels)
    } catch (err) {
      console.error('[useLabels] Failed to load labels:', err)
    }
  }, [setLabels])

  // Load labels when workspace changes
  useEffect(() => {
    if (workspaceId) {
      refresh()
    }
  }, [workspaceId, refresh])

  // Subscribe to live label changes - stable effect that doesn't re-subscribe on refresh changes
  useEffect(() => {
    if (!workspaceId) return

    const cleanup = window.electronAPI.onLabelsChanged((changedWorkspaceId) => {
      // Only refresh if this is our workspace (use ref for current value)
      if (changedWorkspaceId === workspaceIdRef.current) {
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
