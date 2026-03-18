import { useEffect, useState } from 'react'
import type { TransportConnectionStatus } from '../../shared/types'

interface RemoteConnectionStatus {
  workspaceId: string
  status: TransportConnectionStatus
}

/**
 * Tracks the bridge connection status for the active remote workspace.
 * Returns null when no remote bridge exists (local workspace or not yet connected).
 */
export function useRemoteConnectionStatus(): RemoteConnectionStatus | null {
  const [state, setState] = useState<RemoteConnectionStatus | null>(null)

  useEffect(() => {
    let mounted = true

    // Query initial state
    window.electronAPI.getRemoteConnectionStatus?.()
      .then((initial) => { if (mounted) setState(initial) })
      .catch(() => {})

    // Listen for changes
    const unsub = window.electronAPI.onRemoteConnectionStatusChanged?.((data) => {
      if (mounted) setState(data)
    })

    return () => {
      mounted = false
      unsub?.()
    }
  }, [])

  return state
}
