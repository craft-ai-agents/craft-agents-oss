import { useCallback, useEffect, useState } from 'react'
import type { LlmConnectionWithStatus } from '../../shared/types'

export function useLlmConnections(activeWorkspaceId: string | null, enabled: boolean) {
  const [connections, setConnections] = useState<LlmConnectionWithStatus[]>([])
  const [workspaceDefaultConnection, setWorkspaceDefaultConnection] = useState<string | undefined>()

  const refreshConnections = useCallback(async () => {
    const nextConnections = await window.electronAPI.listLlmConnectionsWithStatus()
    setConnections(nextConnections)

    if (activeWorkspaceId) {
      const settings = await window.electronAPI.getWorkspaceSettings(activeWorkspaceId)
      setWorkspaceDefaultConnection(settings?.defaultLlmConnection)
    } else {
      setWorkspaceDefaultConnection(undefined)
    }

  }, [activeWorkspaceId])

  useEffect(() => {
    if (!enabled) return
    void refreshConnections()
  }, [enabled, refreshConnections])

  useEffect(() => {
    if (!enabled) return
    return window.electronAPI.onLlmConnectionsChanged(() => {
      void refreshConnections()
    })
  }, [enabled, refreshConnections])

  return {
    connections,
    refreshConnections,
    workspaceDefaultConnection,
  }
}
