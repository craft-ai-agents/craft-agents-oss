/**
 * Hook for tracking sandbox status across sessions in a workspace.
 * Polls the sandbox API to get status of active sandboxes.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import type { SandboxStatus } from '../../shared/types'

/** Polling interval when there are active sandboxes */
const ACTIVE_POLL_INTERVAL = 10_000 // 10 seconds

/** Polling interval when no active sandboxes (just checking for new ones) */
const IDLE_POLL_INTERVAL = 30_000 // 30 seconds

export interface UseSandboxStatusOptions {
  /** Workspace ID to poll for sandboxes */
  workspaceId: string | null
  /** Whether this is a cloud workspace (enables polling) */
  isCloudWorkspace: boolean
  /** Whether polling is enabled */
  enabled?: boolean
}

export interface UseSandboxStatusResult {
  /** Map of sessionId -> SandboxStatus for active sandboxes */
  sandboxStatuses: Map<string, SandboxStatus>
  /** Whether we're currently fetching status */
  isLoading: boolean
  /** Last error from fetching */
  error: string | null
  /** Terminate a sandbox for a session */
  terminateSandbox: (sessionId: string) => Promise<boolean>
  /** Refresh sandbox statuses immediately */
  refresh: () => Promise<void>
}

/**
 * Hook to track sandbox status for all sessions in a workspace.
 * Polls for any workspace that might have cloud sandboxes.
 */
export function useSandboxStatus({
  workspaceId,
  isCloudWorkspace,
  enabled = true,
}: UseSandboxStatusOptions): UseSandboxStatusResult {
  const [sandboxStatuses, setSandboxStatuses] = useState<Map<string, SandboxStatus>>(new Map())
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  // Track sandbox count separately to avoid dependency issues
  const sandboxCountRef = useRef(0)

  const fetchSandboxStatuses = useCallback(async () => {
    // Only poll for cloud workspaces — local workspaces don't have sandboxes
    if (!workspaceId || !enabled || !isCloudWorkspace) {
      return
    }

    try {
      setIsLoading(true)
      setError(null)

      const statuses = await window.electronAPI?.sandboxListSessions?.(workspaceId)

      if (statuses && Array.isArray(statuses)) {
        const statusMap = new Map<string, SandboxStatus>()
        for (const status of statuses) {
          // Only include non-expired sandboxes
          if (status.status !== 'expired') {
            statusMap.set(status.sessionId, status)
          }
        }
        sandboxCountRef.current = statusMap.size
        setSandboxStatuses(statusMap)
      } else {
        sandboxCountRef.current = 0
        setSandboxStatuses(new Map())
      }
    } catch (err) {
      // Silently fail for non-cloud workspaces (API will 404)
      // Only log actual errors
      if (err instanceof Error && !err.message.includes('404')) {
        console.error('[useSandboxStatus] Failed to fetch sandbox statuses:', err)
        setError(err.message)
      }
      sandboxCountRef.current = 0
      setSandboxStatuses(new Map())
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId, enabled])

  const terminateSandbox = useCallback(async (sessionId: string): Promise<boolean> => {
    if (!workspaceId) return false

    try {
      const result = await window.electronAPI?.sandboxTerminate?.(workspaceId, sessionId)
      if (result?.success) {
        // Remove from local state immediately
        setSandboxStatuses(prev => {
          const next = new Map(prev)
          next.delete(sessionId)
          sandboxCountRef.current = next.size
          return next
        })
        return true
      }
      return false
    } catch (err) {
      console.error('[useSandboxStatus] Failed to terminate sandbox:', err)
      return false
    }
  }, [workspaceId])

  // Initial fetch and polling setup
  useEffect(() => {
    if (!workspaceId || !enabled) {
      setSandboxStatuses(new Map())
      sandboxCountRef.current = 0
      return
    }

    // Initial fetch
    fetchSandboxStatuses()

    // Set up polling with adaptive interval
    // Cloud workspaces poll more frequently
    const pollInterval = isCloudWorkspace ? ACTIVE_POLL_INTERVAL : IDLE_POLL_INTERVAL
    intervalRef.current = setInterval(() => {
      fetchSandboxStatuses()
    }, pollInterval)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [workspaceId, enabled, isCloudWorkspace, fetchSandboxStatuses])

  return {
    sandboxStatuses,
    isLoading,
    error,
    terminateSandbox,
    refresh: fetchSandboxStatuses,
  }
}
