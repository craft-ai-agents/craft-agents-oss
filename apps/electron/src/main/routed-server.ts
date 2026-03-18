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

export class RoutedServer implements RpcServer {
  constructor(
    private inner: RpcServer,
    private bridgeManager: BridgeManager,
  ) {}

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
        } else {
          // Switching to local workspace — tear down bridge
          this.bridgeManager.dispose(ctx.clientId)
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
      return bridge.invoke(channel, ...args)
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
