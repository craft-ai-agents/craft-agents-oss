import * as React from 'react'
import { useAppShellContext } from '@/context/AppShellContext'

/**
 * Live probe of the knowledge engine (SiYuan kernel) for the active workspace.
 * Returns:
 * - `null` while the first probe is in flight
 * - `true` when a connection exists and engineStatus.running
 * - `false` when no API / no connections / kernel down / probe error
 */
export function useSiyuanConnected(): boolean | null {
  const { activeWorkspaceId } = useAppShellContext()
  const [connected, setConnected] = React.useState<boolean | null>(null)

  React.useEffect(() => {
    let cancelled = false
    const probe = async () => {
      const api = window.electronAPI?.knowledge
      if (!api?.engineStatus || !api?.listConnections) {
        if (!cancelled) setConnected(false)
        return
      }
      try {
        const connections = await api.listConnections()
        const connectionId =
          connections.find((c) => c.id === 'siyuan-local')?.id ??
          connections.find((c) => (c.label ?? '').toLowerCase().includes('local'))?.id ??
          connections[0]?.id
        if (!connectionId) {
          if (!cancelled) setConnected(false)
          return
        }
        const status = await api.engineStatus({
          ...(activeWorkspaceId ? { workspaceId: activeWorkspaceId } : {}),
          connectionId,
        })
        if (!cancelled) setConnected(!!status.running)
      } catch {
        if (!cancelled) setConnected(false)
      }
    }
    void probe()
    return () => {
      cancelled = true
    }
  }, [activeWorkspaceId])

  return connected
}
