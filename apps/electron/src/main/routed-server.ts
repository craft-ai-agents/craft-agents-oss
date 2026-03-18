/**
 * RoutedServer — RpcServer wrapper that routes requests to local or remote
 * handlers based on the workspace's RemoteServerConfig.
 *
 * Wraps `handle()` registrations to add routing logic. Does NOT modify
 * WsRpcServer, the RpcServer interface, or any shared code.
 *
 * Also manages bridge lifecycle on workspace switch:
 * - Switch to remote workspace → pre-warm bridge (connect fire-and-forget)
 * - Switch to local workspace → tear down bridge
 *
 * Usage:
 *   const bridgeManager = new BridgeManager(server)
 *   const routed = new RoutedServer(server, bridgeManager)
 *   registerHandlers(routed, deps)  // handlers register on the wrapper
 */

import { RPC_CHANNELS, isLocalOnly } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import type { RpcServer, HandlerFn, RequestContext } from '@craft-agent/server-core/transport'
import type { PushTarget } from '@craft-agent/shared/protocol'
import type { BridgeManager } from './remote-bridge-manager'

const SWITCH_WORKSPACE_CHANNEL = RPC_CHANNELS.window.SWITCH_WORKSPACE

/**
 * Recursively rewrite `workspaceId` fields in response data from remote→local.
 * Handles session objects, arrays of sessions, and nested structures.
 */
function rewriteWorkspaceIds(data: unknown, remoteId: string, localId: string): unknown {
  if (data == null || typeof data !== 'object') return data
  if (Array.isArray(data)) return data.map(item => rewriteWorkspaceIds(item, remoteId, localId))

  const obj = data as Record<string, unknown>
  if (obj.workspaceId === remoteId) {
    obj.workspaceId = localId
  }
  return obj
}

export class RoutedServer implements RpcServer {
  /** Per-client unsubscribe callbacks for bridge connection state listeners. */
  private connectionUnsubs = new Map<string, () => void>()

  constructor(
    private inner: RpcServer,
    private bridgeManager: BridgeManager,
  ) {
    // Register local-only handler: query current bridge connection status
    this.inner.handle(RPC_CHANNELS.workspace.GET_REMOTE_STATUS, async (ctx: RequestContext) => {
      const bridge = this.bridgeManager.get(ctx.clientId)
      if (!bridge) return null
      return { workspaceId: bridge.workspaceId, status: bridge.connectionState.status }
    })
  }

  /**
   * Subscribe to a bridge's connection state changes and push updates to the client.
   * Unsubscribes any previous listener for this client first.
   */
  private subscribeToBridgeState(clientId: string, workspaceId: string): void {
    // Clean up previous subscription
    this.connectionUnsubs.get(clientId)?.()

    const bridge = this.bridgeManager.get(clientId)
    if (!bridge) return

    const unsub = bridge.onConnectionStateChanged((state) => {
      this.inner.push(
        RPC_CHANNELS.workspace.REMOTE_STATUS_CHANGED,
        { to: 'client', clientId },
        { workspaceId, status: state.status },
      )
    })
    this.connectionUnsubs.set(clientId, unsub)

    // Push initial state immediately
    this.inner.push(
      RPC_CHANNELS.workspace.REMOTE_STATUS_CHANGED,
      { to: 'client', clientId },
      { workspaceId, status: bridge.connectionState.status },
    )
  }

  handle(channel: string, handler: HandlerFn): void {
    if (channel === SWITCH_WORKSPACE_CHANNEL) {
      // Special case: wrap switch handler with bridge lifecycle management
      this.inner.handle(channel, async (ctx: RequestContext, ...args: unknown[]) => {
        // Run the original switch handler first (updates window mapping, config watcher, etc.)
        const result = await handler(ctx, ...args)

        // Manage bridge lifecycle after switch completes
        const workspaceId = args[0] as string
        const workspace = getWorkspaceByNameOrId(workspaceId)
        if (workspace?.remoteServer) {
          // Pre-warm bridge for remote workspace (connect is fire-and-forget)
          this.bridgeManager.getOrCreate(ctx.clientId, workspaceId, workspace.remoteServer)
          this.subscribeToBridgeState(ctx.clientId, workspaceId)
        } else {
          // Switching to local workspace — tear down bridge + subscription
          this.connectionUnsubs.get(ctx.clientId)?.()
          this.connectionUnsubs.delete(ctx.clientId)
          this.bridgeManager.dispose(ctx.clientId)

          // Notify renderer: no remote connection
          this.inner.push(
            RPC_CHANNELS.workspace.REMOTE_STATUS_CHANGED,
            { to: 'client', clientId: ctx.clientId },
            null,
          )
        }

        return result
      })
      return
    }

    if (isLocalOnly(channel)) {
      // Local-only: always use local handler, no routing
      this.inner.handle(channel, handler)
      return
    }

    // Remote-eligible: wrap handler with routing check
    this.inner.handle(channel, async (ctx: RequestContext, ...args: unknown[]) => {
      const workspace = getWorkspaceByNameOrId(ctx.workspaceId ?? '')

      if (!workspace?.remoteServer) {
        // Local workspace — run local handler
        return handler(ctx, ...args)
      }

      // Remote workspace — proxy through bridge
      const bridge = this.bridgeManager.getOrCreate(
        ctx.clientId,
        workspace.id,
        workspace.remoteServer,
      )

      // Ensure we're subscribed to connection state (covers on-demand bridge creation)
      if (!this.connectionUnsubs.has(ctx.clientId)) {
        this.subscribeToBridgeState(ctx.clientId, workspace.id)
      }

      // Rewrite workspace ID in args: many handlers take workspaceId as the
      // first parameter (statuses:list, labels:list, etc.). The local workspace
      // ID doesn't exist on the remote — swap it for remoteWorkspaceId.
      const remoteArgs = [...args]
      if (typeof remoteArgs[0] === 'string' && remoteArgs[0] === workspace.id) {
        remoteArgs[0] = workspace.remoteServer.remoteWorkspaceId
      }

      const result = await bridge.invoke(channel, ...remoteArgs)

      // Rewrite workspace IDs in the response: the remote returns its own
      // workspace ID in session objects etc. The renderer filters by the local
      // workspace ID, so we must translate back.
      return rewriteWorkspaceIds(result, workspace.remoteServer.remoteWorkspaceId, workspace.id)
    })
  }

  // Delegate unchanged — push/invokeClient/updateClientWorkspace always operate on local server
  push(channel: string, target: PushTarget, ...args: unknown[]): void {
    this.inner.push(channel, target, ...args)
  }

  invokeClient(clientId: string, channel: string, ...args: unknown[]): Promise<unknown> {
    return this.inner.invokeClient(clientId, channel, ...args)
  }

  updateClientWorkspace?(clientId: string, workspaceId: string): void {
    this.inner.updateClientWorkspace?.(clientId, workspaceId)
  }
}
