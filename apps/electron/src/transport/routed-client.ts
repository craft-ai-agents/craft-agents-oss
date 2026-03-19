/**
 * RoutedClient — client-side channel router.
 *
 * Wraps two WsRpcClient instances: localClient (always the embedded Electron
 * server) and workspaceClient (whichever server owns the active workspace).
 *
 * - LOCAL_ONLY channels always route to localClient
 * - Everything else routes to workspaceClient
 * - On workspace switch, workspaceClient is swapped and REMOTE_ELIGIBLE
 *   listeners are re-subscribed transparently (make-before-break)
 */

import type { WsRpcClient, TransportConnectionState } from './client'
import type { RpcClient } from '@craft-agent/server-core/transport'
import type { RemoteServerConfig } from '@craft-agent/core/types'
import { isLocalOnly, RPC_CHANNELS } from '@craft-agent/shared/protocol'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ListenerEntry {
  callback: (...args: any[]) => void
  unsub: () => void
}

/** Returned by the enhanced SWITCH_WORKSPACE handler. */
export interface WorkspaceSwitchResult {
  workspaceId: string
  remoteServer?: RemoteServerConfig | null
}

/** Factory to create a new WsRpcClient for a remote workspace. */
export type WorkspaceClientFactory = (remoteServer: RemoteServerConfig) => WsRpcClient

// ---------------------------------------------------------------------------
// RoutedClient
// ---------------------------------------------------------------------------

export class RoutedClient implements RpcClient {
  private workspaceClient: WsRpcClient

  /** REMOTE_ELIGIBLE listener registry — survives workspace switches. */
  private remoteListeners = new Map<string, Set<ListenerEntry>>()

  /** Capability handlers — re-registered on workspace switch. */
  private capabilities = new Map<string, (...args: any[]) => Promise<any> | any>()

  /** Connection state listeners (delegates to workspaceClient). */
  private connectionStateListeners = new Set<(state: TransportConnectionState) => void>()
  private connectionStateUnsub: (() => void) | null = null

  /** Factory for creating remote workspace clients on switch. */
  private clientFactory: WorkspaceClientFactory | null = null

  constructor(
    private readonly localClient: WsRpcClient,
    initialWorkspaceClient: WsRpcClient,
  ) {
    this.workspaceClient = initialWorkspaceClient
    this.bindConnectionState()
  }

  /** Set factory for creating remote workspace clients. */
  setClientFactory(factory: WorkspaceClientFactory): void {
    this.clientFactory = factory
  }

  // -------------------------------------------------------------------------
  // RpcClient interface
  // -------------------------------------------------------------------------

  async invoke(channel: string, ...args: any[]): Promise<any> {
    const target = isLocalOnly(channel) ? this.localClient : this.workspaceClient
    const result = await target.invoke(channel, ...args)

    // Intercept SWITCH_WORKSPACE response to swap workspace client
    if (channel === RPC_CHANNELS.window.SWITCH_WORKSPACE) {
      this.handleWorkspaceSwitch(result as WorkspaceSwitchResult)
    }

    return result
  }

  on(channel: string, callback: (...args: any[]) => void): () => void {
    if (isLocalOnly(channel)) {
      return this.localClient.on(channel, callback)
    }

    // REMOTE_ELIGIBLE — subscribe on workspaceClient and track for re-subscription
    const unsub = this.workspaceClient.on(channel, callback)

    let set = this.remoteListeners.get(channel)
    if (!set) {
      set = new Set()
      this.remoteListeners.set(channel, set)
    }
    const entry: ListenerEntry = { callback, unsub }
    set.add(entry)

    return () => {
      entry.unsub()
      set!.delete(entry)
      if (set!.size === 0) this.remoteListeners.delete(channel)
    }
  }

  handleCapability(channel: string, handler: (...args: any[]) => Promise<any> | any): void {
    this.capabilities.set(channel, handler)
    // Register on both clients — either server can invoke capabilities
    this.localClient.handleCapability(channel, handler)
    if (this.workspaceClient !== this.localClient) {
      this.workspaceClient.handleCapability(channel, handler)
    }
  }

  // -------------------------------------------------------------------------
  // Extended interface (used by bootstrap / build-api)
  // -------------------------------------------------------------------------

  isChannelAvailable(channel: string): boolean {
    const target = isLocalOnly(channel) ? this.localClient : this.workspaceClient
    return target.isChannelAvailable(channel)
  }

  getConnectionState(): TransportConnectionState {
    return this.workspaceClient.getConnectionState()
  }

  onConnectionStateChanged(callback: (state: TransportConnectionState) => void): () => void {
    this.connectionStateListeners.add(callback)
    callback(this.getConnectionState())
    return () => { this.connectionStateListeners.delete(callback) }
  }

  reconnectNow(): void {
    this.workspaceClient.reconnectNow()
  }

  // -------------------------------------------------------------------------
  // Workspace switch
  // -------------------------------------------------------------------------

  private handleWorkspaceSwitch(result: WorkspaceSwitchResult): void {
    if (!result) return

    if (result.remoteServer && this.clientFactory) {
      // Remote workspace — create + connect new client, then swap
      const newClient = this.clientFactory(result.remoteServer)
      newClient.connect()
      this.swapWorkspaceClient(newClient)
    } else if (!result.remoteServer && this.workspaceClient !== this.localClient) {
      // Switching to local workspace — revert to local client
      this.swapWorkspaceClient(this.localClient)
    }
  }

  private swapWorkspaceClient(newClient: WsRpcClient): void {
    const old = this.workspaceClient
    this.workspaceClient = newClient

    // Re-register capabilities on new client
    for (const [channel, handler] of this.capabilities) {
      newClient.handleCapability(channel, handler)
    }

    // Re-subscribe REMOTE_ELIGIBLE listeners (make-before-break:
    // subscribe on new first, then unsubscribe from old)
    for (const [channel, entries] of this.remoteListeners) {
      for (const entry of entries) {
        const oldUnsub = entry.unsub
        entry.unsub = newClient.on(channel, entry.callback)
        oldUnsub()
      }
    }

    // Rebind connection state delegation
    this.bindConnectionState()

    // Destroy old client (unless it's the local client or same as new)
    if (old !== this.localClient && old !== newClient) {
      old.destroy()
    }
  }

  private bindConnectionState(): void {
    this.connectionStateUnsub?.()
    this.connectionStateUnsub = this.workspaceClient.onConnectionStateChanged((state) => {
      const snapshot = { ...state }
      for (const cb of this.connectionStateListeners) {
        try { cb(snapshot) } catch { /* listener errors must not break transport */ }
      }
    })
  }
}
