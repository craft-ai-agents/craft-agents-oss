/**
 * useSchedules Hook
 *
 * React hook to load and manage workspace scheduled prompts.
 * Auto-refreshes when workspace changes or schedules config is modified.
 */

import { useState, useEffect, useCallback } from 'react'
import type { ScheduledPromptConfig } from '@craft-agent/shared/schedules'

export interface UseSchedulesResult {
  schedules: ScheduledPromptConfig[]
  isLoading: boolean
  error: string | null
  refresh: () => Promise<void>
}

/**
 * Load schedules for a workspace via IPC
 * Auto-refreshes when workspaceId changes or config file changes
 */
export function useSchedules(workspaceId: string | null): UseSchedulesResult {
  const [schedules, setSchedules] = useState<ScheduledPromptConfig[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!workspaceId) {
      setSchedules([])
      setIsLoading(false)
      return
    }

    try {
      setIsLoading(true)
      const configs = await window.electronAPI.listSchedules(workspaceId)
      setSchedules(configs)
      setError(null)
    } catch (err) {
      console.error('[useSchedules] Failed to load schedules:', err)
      setError(err instanceof Error ? err.message : 'Failed to load schedules')
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId])

  // Load schedules when workspace changes
  useEffect(() => {
    refresh()
  }, [refresh])

  // Subscribe to live schedule changes (config file changes)
  useEffect(() => {
    if (!workspaceId) return

    const cleanup = window.electronAPI.onSchedulesChanged((changedWorkspaceId) => {
      // Only refresh if this is our workspace
      if (changedWorkspaceId === workspaceId) {
        refresh()
      }
    })

    return cleanup
  }, [workspaceId, refresh])

  return {
    schedules,
    isLoading,
    error,
    refresh,
  }
}
