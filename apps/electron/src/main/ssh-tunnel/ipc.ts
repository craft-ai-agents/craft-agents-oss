import { ipcMain, BrowserWindow } from 'electron'
import type { SshHostConfig, SshHostInput } from '@craft-agent/shared/config'
import {
  loadSshHosts,
  addSshHost,
  updateSshHost,
  deleteSshHost,
  getSshHost,
  importSshConfigSuggestions,
} from '@craft-agent/shared/config'
import { getSshTunnelManager } from './ssh-tunnel-manager.ts'
import type { TunnelState } from './ssh-tunnel.ts'
import type { BootstrapProgress } from './server-bootstrap.ts'
import {
  resolveRemoteConnection,
  tunnelStateToConnectionStatus,
  type SshConnectionStatus,
} from './connection-resolver.ts'
import type { RemoteServerConfig } from '@craft-agent/core/types'

export const SSH_BOOTSTRAP_PROGRESS_EVENT = 'ssh:bootstrapProgress'
/** Resolution progress for an SSH-backed workspace being (re)connected. */
export const SSH_CONNECTION_STATUS_EVENT = 'ssh:connectionStatus'

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

let registered = false

export function registerSshTunnelIpc(): void {
  if (registered) return
  registered = true

  const manager = getSshTunnelManager()
  manager.on('state', (state: TunnelState) => {
    // Mid-session tunnel drops: forward tunnel state as an SSH connection status so
    // banners show "tunnel reconnecting…" — the ONLY emitter once a workspace is connected.
    const host = getSshHost(state.hostId)
    const status = tunnelStateToConnectionStatus(state, host?.label ?? state.hostId)
    if (status) broadcast(SSH_CONNECTION_STATUS_EVENT, status)
  })

  ipcMain.handle('ssh:listHosts', () => loadSshHosts())

  ipcMain.handle('ssh:addHost', (_e, input: SshHostInput) => addSshHost(input))

  ipcMain.handle('ssh:updateHost', (_e, id: string, updates: Partial<SshHostConfig>) =>
    updateSshHost(id, updates),
  )

  ipcMain.handle('ssh:deleteHost', (_e, id: string) => deleteSshHost(id))

  ipcMain.handle('ssh:importFromConfig', () => importSshConfigSuggestions())

  // Connect and return { url, token? } for the existing remote-workspace flow.
  ipcMain.handle('ssh:connect', async (_e, hostId: string) => {
    const host = getSshHost(hostId)
    if (!host) throw new Error(`Unknown SSH host: ${hostId}`)
    const state = await manager.connect(host)
    const token = await manager.fetchRemoteToken(host)
    return { url: state.url, localPort: state.localPort, token }
  })

  // One-click bootstrap: install (if needed) + start a managed server, then establish
  // the tunnel. Streams progress; returns { url, token } (managed secret) for workspace creation.
  ipcMain.handle('ssh:bootstrapConnect', async (event, hostId: string) => {
    const host = getSshHost(hostId)
    if (!host) throw new Error(`Unknown SSH host: ${hostId}`)
    const emit = (p: BootstrapProgress) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win && !win.isDestroyed()) {
        win.webContents.send(SSH_BOOTSTRAP_PROGRESS_EVENT, { hostId, ...p })
      }
    }
    const { token } = await manager.bootstrapServer(host, emit)
    emit({ phase: 'connecting-tunnel' })
    const state = await manager.connect(host)
    emit({ phase: 'creating-workspace' })
    return { url: state.url, localPort: state.localPort, token, hostId }
  })

  // Resolve a persisted RemoteServerConfig into a live { url, token } before the ws
  // transport dials. SSH configs re-dial the tunnel for a FRESH forwarded port + managed token.
  ipcMain.handle(
    'ssh:resolveWorkspaceConnection',
    async (event, remoteServer: RemoteServerConfig) => {
      const onStatus = (s: SshConnectionStatus) => {
        const win = BrowserWindow.fromWebContents(event.sender)
        if (win && !win.isDestroyed()) {
          win.webContents.send(SSH_CONNECTION_STATUS_EVENT, s)
        }
      }
      return resolveRemoteConnection(remoteServer, manager.connectionResolverDeps(), onStatus)
    },
  )
}
