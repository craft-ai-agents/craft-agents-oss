/**
 * BridgeManager — manages lifecycle of RemoteClientBridge instances.
 *
 * Maps local clientId → bridge. Creates bridges on demand, tears them
 * down on workspace switch or client disconnect.
 */

import { RemoteClientBridge } from './remote-bridge'
import type { RemoteServerConfig } from '@craft-agent/core/types'
import type { RpcServer } from '@craft-agent/server-core/transport'

export class BridgeManager {
  private bridges = new Map<string, RemoteClientBridge>()

  constructor(private localServer: RpcServer) {}

  /** Get existing bridge or create new one for a local client on a remote workspace. */
  getOrCreate(
    localClientId: string,
    workspaceId: string,
    remoteConfig: RemoteServerConfig,
  ): RemoteClientBridge {
    const existing = this.bridges.get(localClientId)
    if (existing && existing.workspaceId === workspaceId) {
      return existing
    }

    // Client switched workspaces — tear down old bridge
    if (existing) {
      existing.destroy()
      this.bridges.delete(localClientId)
    }

    const bridge = new RemoteClientBridge(
      localClientId, workspaceId, remoteConfig, this.localServer,
    )
    this.bridges.set(localClientId, bridge)
    return bridge
  }

  /** Tear down bridge when client disconnects or switches to local workspace. */
  dispose(localClientId: string): void {
    const bridge = this.bridges.get(localClientId)
    if (bridge) {
      bridge.destroy()
      this.bridges.delete(localClientId)
    }
  }

  get(localClientId: string): RemoteClientBridge | undefined {
    return this.bridges.get(localClientId)
  }

  disposeAll(): void {
    for (const bridge of this.bridges.values()) {
      bridge.destroy()
    }
    this.bridges.clear()
  }
}
