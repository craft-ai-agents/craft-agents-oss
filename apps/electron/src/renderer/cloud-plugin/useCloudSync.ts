/**
 * useCloudSync Hook
 *
 * Listens for CLOUD_SYNC_EVENT IPC messages from the main process
 * and triggers data refetches for the affected entities.
 *
 * This hook bridges cloud-worker WebSocket events with the renderer's
 * data loading patterns, so that remote changes from other connected
 * clients are reflected in the UI in real-time.
 */

import { useEffect } from 'react'
import { useSetAtom } from 'jotai'
import { initializeSessionsAtom } from '../atoms/sessions'
import { sourcesAtom } from '../atoms/sources'
import type { CloudSyncEvent } from '../../shared/types'

interface UseCloudSyncOptions {
  workspaceId: string | null
  enabled?: boolean
}

/**
 * Subscribe to cloud sync events and refetch data when remote changes arrive.
 *
 * When a CLOUD_SYNC_EVENT comes in, we refetch the affected data domain
 * through the existing IPC channels — the same way the app loads data initially.
 */
export function useCloudSync({ workspaceId, enabled = true }: UseCloudSyncOptions): void {
  const initializeSessions = useSetAtom(initializeSessionsAtom)
  const setSources = useSetAtom(sourcesAtom)

  useEffect(() => {
    if (!enabled || !workspaceId) return

    const cleanup = window.electronAPI.onCloudSyncEvent((event: CloudSyncEvent) => {
      // Only handle events for our workspace
      if (event.workspaceId !== workspaceId) return

      switch (event.entity) {
        case 'session':
          // Refetch the full session list
          console.log('[useCloudSync] Received session event for workspace:', event.workspaceId, 'active:', workspaceId)
          window.electronAPI.getSessions().then((sessions) => {
            console.log('[useCloudSync] Got sessions:', sessions.length, sessions.map(s => ({ id: s.id, wsId: s.workspaceId })))
            initializeSessions(sessions)
          })
          break

        case 'source':
          // Refetch sources for this workspace
          window.electronAPI.getSources(workspaceId).then((sources) => {
            setSources(sources || [])
          })
          break

        case 'statuses':
          // Statuses are refetched by the useStatuses hook via its own listener.
          // We broadcast through the same channel pattern — the existing
          // onStatusesChanged listener will handle the refetch.
          // No action needed here; the CLOUD_SYNC_EVENT for statuses is
          // also forwarded through STATUSES_CHANGED by the main process.
          break

        case 'labels':
          // Same pattern as statuses — the useLabels hook handles refetching.
          break

        case 'skill':
          // Refetch skills for this workspace
          window.electronAPI.getSkills(workspaceId).then((skills) => {
            // Skills are managed by the onSkillsChanged listener in AppShell,
            // but we also refetch here for cloud-originated changes
            // The skills atom will be set via the callback from the main process
          })
          break
      }
    })

    return cleanup
  }, [workspaceId, enabled, initializeSessions, setSources])
}
