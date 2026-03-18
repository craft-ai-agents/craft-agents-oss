/**
 * RemoteClientBridge — per-client bridge to a remote Craft Agent Server.
 *
 * Each local renderer window on a remote workspace gets its own bridge.
 * The bridge wraps a WsRpcClient to the remote server and:
 * - Proxies invoke() calls for REMOTE_ELIGIBLE channels
 * - Forwards push events from the remote server to the local client
 * - Passes through capability requests (file picker, confirm dialog, etc.)
 */

import { WsRpcClient } from '../transport/client'
import type { TransportConnectionState } from '../transport/client'
import {
  LOCAL_CLIENT_CAPABILITIES,
} from '@craft-agent/server-core/transport'
import { isRemoteEligible } from '@craft-agent/shared/protocol'
import type { RemoteServerConfig } from '@craft-agent/core/types'
import type { RpcServer } from '@craft-agent/server-core/transport'

export class RemoteClientBridge {
  readonly localClientId: string
  readonly workspaceId: string
  private client: WsRpcClient
  private destroyed = false

  constructor(
    localClientId: string,
    workspaceId: string,
    remoteConfig: RemoteServerConfig,
    private localServer: RpcServer,
  ) {
    this.localClientId = localClientId
    this.workspaceId = workspaceId

    this.client = new WsRpcClient(remoteConfig.url, {
      token: remoteConfig.token,
      workspaceId: remoteConfig.remoteWorkspaceId,
      autoReconnect: true,
      mode: 'remote',
      clientCapabilities: [...LOCAL_CLIENT_CAPABILITIES],
    })

    this.registerCapabilityPassthrough()
    this.setupEventForwarding()

    // connect() is void — fire and forget.
    // First invoke() will await ensureConnected() internally.
    this.client.connect()
  }

  /** Proxy a request to the remote server. */
  async invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    return this.client.invoke(channel, ...args)
  }

  /**
   * Remote server calls invokeClient → delegate to local renderer via local server.
   * This enables file pickers, confirm dialogs, shell.openExternal, etc.
   */
  private registerCapabilityPassthrough(): void {
    for (const cap of LOCAL_CLIENT_CAPABILITIES) {
      this.client.handleCapability(cap, async (...args: unknown[]) => {
        return this.localServer.invokeClient(this.localClientId, cap, ...args)
      })
    }
  }

  /** Forward push events from remote server to the correct local client. */
  private setupEventForwarding(): void {
    this.client.onAnyEvent((channel: string, ...args: unknown[]) => {
      if (isRemoteEligible(channel)) {
        this.localServer.push(channel, { to: 'client', clientId: this.localClientId }, ...args)
      }
    })
  }

  get connectionState(): TransportConnectionState {
    return this.client.getConnectionState()
  }

  onConnectionStateChanged(cb: (state: TransportConnectionState) => void): () => void {
    return this.client.onConnectionStateChanged(cb)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.client.destroy()
  }
}
