import { useEffect, useState } from 'react'
import type { TransportConnectionState } from '../../shared/types'

export function useTransportConnectionState(): TransportConnectionState | null {
  const [state, setState] = useState<TransportConnectionState | null>(null)

  useEffect(() => {
    let mounted = true

    const readInitialState = async () => {
      if (!window.electronAPI.getTransportConnectionState) return
      try {
        const initial = await window.electronAPI.getTransportConnectionState()
        if (mounted) {
          setState(initial)
        }
      } catch {
        // Best effort only — avoid crashing renderer if preload state is unavailable.
      }
    }

    void readInitialState()

    const unsubscribe = window.electronAPI.onTransportConnectionStateChanged?.((next) => {
      if (mounted) {
        setState(next)
      }
    })

    return () => {
      mounted = false
      unsubscribe?.()
    }
  }, [])

  return state
}
