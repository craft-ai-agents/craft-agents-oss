import { useEffect, useState } from 'react'
import type { SshConnectionStatus } from '../../shared/types'

/** Latest SSH-level connection status while (re)connecting an SSH-backed workspace, composed in front of
 * the ws transport state so the UI shows SSH-friendly messages instead of a raw ws error. Null when inactive/plain-ws. */
export function useSshConnectionStatus(hostId: string | null | undefined): SshConnectionStatus | null {
  const [status, setStatus] = useState<SshConnectionStatus | null>(null)

  useEffect(() => {
    if (!hostId) {
      setStatus(null)
      return
    }
    setStatus(null)
    const unsub = window.electronAPI.onSshConnectionStatus?.((s) => {
      if (s.hostId === hostId) setStatus(s)
    })
    return () => unsub?.()
  }, [hostId])

  return status
}
