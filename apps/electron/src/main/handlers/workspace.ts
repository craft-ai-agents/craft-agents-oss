import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from './handler-deps'

export const GUI_HANDLED_CHANNELS = [
  RPC_CHANNELS.remote.TEST_CONNECTION,
  RPC_CHANNELS.window.OPEN_WORKSPACE,
  RPC_CHANNELS.window.OPEN_SESSION_IN_NEW_WINDOW,
  RPC_CHANNELS.window.CLOSE,
  RPC_CHANNELS.window.CONFIRM_CLOSE,
  RPC_CHANNELS.window.CANCEL_CLOSE,
  RPC_CHANNELS.window.SET_TRAFFIC_LIGHTS,
] as const

/**
 * Connect to a remote server and wait for handshake.
 * Returns the connected client or null + error message.
 */
async function connectToRemote(url: string, token: string) {
  const { WsRpcClient } = await import('../../transport/client')
  const client = new WsRpcClient(url, { token, autoReconnect: false, tlsRejectUnauthorized: false })

  const connected = await new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => resolve(false), 10_000)
    const unsub = client.onConnectionStateChanged((state) => {
      if (state.status === 'connected') {
        clearTimeout(timeout)
        unsub()
        resolve(true)
      } else if (state.status === 'failed') {
        clearTimeout(timeout)
        unsub()
        resolve(false)
      }
    })
    client.connect()
  })

  if (!connected) {
    const error = client.getConnectionState().lastError?.message ?? 'Connection failed'
    client.destroy()
    return { client: null, error }
  }

  return { client, error: null }
}

export function registerWorkspaceGuiHandlers(server: RpcServer, deps: HandlerDeps): void {
  const windowManager = deps.windowManager

  // Test connection to a remote Craft Agent Server.
  // - Without workspaceName: discovers existing workspace or returns needsWorkspace flag
  // - With workspaceName: creates a workspace on the remote server if none exists
  server.handle(RPC_CHANNELS.remote.TEST_CONNECTION, async (_ctx, url: string, token: string, workspaceName?: string) => {
    const { client, error } = await connectToRemote(url, token)
    if (!client) return { ok: false, error }

    // Read server version from handshake_ack (null for old servers)
    const serverVersion = client.getServerVersion() ?? undefined

    try {
      let workspaces = await client.invoke('workspaces:get') as Array<{ id: string; name: string }>

      if (workspaces.length === 0) {
        if (!workspaceName) {
          // Fresh server, no name provided — tell the caller to provide one
          return { ok: true, needsWorkspace: true, serverVersion }
        }

        // Create workspace on remote with the user's chosen name.
        // Use checkSlug to get the platform-correct default path on the remote machine.
        const slug = workspaceName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workspace'
        const slugCheck = await client.invoke('workspaces:checkSlug', slug) as { exists: boolean; path: string }
        await client.invoke('workspaces:create', slugCheck.path, workspaceName)
        workspaces = await client.invoke('workspaces:get') as Array<{ id: string; name: string }>
      }

      if (workspaces.length === 0) {
        return { ok: false, error: 'Failed to create workspace on remote server' }
      }

      return {
        ok: true,
        serverVersion,
        remoteWorkspaces: workspaces,
        // Convenience: auto-select if exactly one
        remoteWorkspaceId: workspaces.length === 1 ? workspaces[0].id : undefined,
        remoteWorkspaceName: workspaces.length === 1 ? workspaces[0].name : undefined,
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' }
    } finally {
      client.destroy()
    }
  })

  // Open workspace in new window (or focus existing)
  server.handle(RPC_CHANNELS.window.OPEN_WORKSPACE, async (_ctx, workspaceId: string) => {
    if (!windowManager) return
    windowManager.focusOrCreateWindow(workspaceId)
  })

  // Open a session in a new window
  server.handle(RPC_CHANNELS.window.OPEN_SESSION_IN_NEW_WINDOW, async (_ctx, workspaceId: string, sessionId: string) => {
    if (!windowManager) return
    const deepLink = `craftagents://allSessions/session/${sessionId}`
    windowManager.createWindow({
      workspaceId,
      focused: true,
      initialDeepLink: deepLink,
    })
  })

  // Close the calling window (triggers close event which may be intercepted)
  server.handle(RPC_CHANNELS.window.CLOSE, (ctx) => {
    if (!windowManager) return
    windowManager.closeWindow(ctx.webContentsId!)
  })

  // Confirm close - force close the window (bypasses interception).
  server.handle(RPC_CHANNELS.window.CONFIRM_CLOSE, (ctx) => {
    if (!windowManager) return
    windowManager.forceCloseWindow(ctx.webContentsId!)
  })

  // Cancel close - renderer handled the request (closed a modal/panel).
  server.handle(RPC_CHANNELS.window.CANCEL_CLOSE, (ctx) => {
    if (!windowManager) return
    windowManager.cancelPendingClose(ctx.webContentsId!)
  })

  // Show/hide macOS traffic light buttons (for fullscreen overlays)
  server.handle(RPC_CHANNELS.window.SET_TRAFFIC_LIGHTS, (ctx, visible: boolean) => {
    if (!windowManager) return
    windowManager.setTrafficLightsVisible(ctx.webContentsId!, visible)
  })
}
