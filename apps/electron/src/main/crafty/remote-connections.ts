import type { RemoteServerConfig } from '@craft-agent/core/types'
import type { WsRpcClient } from '../../transport/client'
import { connectToRemote } from '../handlers/workspace'

/**
 * Long enough for a one-shot on the longest selection (a Rewrite of 20,000 characters can take
 * close to a minute); the default 30 s would cut it off.
 */
const REQUEST_TIMEOUT_MS = 120_000

/**
 * An unused connection closes after this. While it's open the server sends it every event of the
 * workspace (each streamed word of every session), which Crafty's main process never reads.
 */
const IDLE_CLOSE_MS = 3 * 60_000

/** The parts of a connection the pool looks at (a `WsRpcClient`). */
export interface PooledClient {
  getConnectionState(): { status: string }
  destroy(): void
}

export type OpenConnection<C> = (server: RemoteServerConfig) => Promise<C>

interface Entry<C extends PooledClient> {
  /** The server, its workspace and the token: when one changes, the connection is replaced. */
  key: string
  ready: Promise<C>
  client: C | null
  failed: boolean
  idleTimer: ReturnType<typeof setTimeout> | null
}

/** A connection to a remote workspace's server, scoped to that workspace by its handshake. */
export async function openRemoteClient(server: RemoteServerConfig): Promise<WsRpcClient> {
  const { client, error } = await connectToRemote(server.url, server.token, server.remoteWorkspaceId, { requestTimeout: REQUEST_TIMEOUT_MS })
  if (!client) throw new Error(error ?? 'Connection failed')
  return client
}

/**
 * Crafty's connections to remote workspaces' servers, one per workspace, opened on first use and
 * shared by the calls that follow (a target check runs at every shortcut). A connection that
 * dropped, failed, timed out (`discard`) or whose server, workspace or token changed is replaced
 * on the next use; one nobody used for a while closes.
 */
export class RemoteConnections<C extends PooledClient> {
  private readonly entries = new Map<string, Entry<C>>()

  constructor(
    private readonly open: OpenConnection<C>,
    private readonly idleMs = IDLE_CLOSE_MS,
  ) {}

  /** The connection to `workspaceId`'s server: the open one, else a new one (it rejects when that fails). */
  get(workspaceId: string, server: RemoteServerConfig): Promise<C> {
    const key = `${server.url}\n${server.remoteWorkspaceId}\n${server.token}`
    let entry = this.entries.get(workspaceId)
    const usable = !!entry && entry.key === key && !entry.failed
      && (entry.client === null || entry.client.getConnectionState().status === 'connected')
    if (!entry || !usable) {
      if (entry) this.close(entry)
      entry = this.connect(key, server)
      this.entries.set(workspaceId, entry)
    }
    this.touch(workspaceId, entry)
    return entry.ready
  }

  /**
   * Close the workspace's connection if it's still `client` (an older one is already gone): a
   * request on it timed out, so it may be dead while it still reads as connected.
   */
  discard(workspaceId: string, client: object): void {
    const entry = this.entries.get(workspaceId)
    if (!entry || entry.client !== client) return
    this.entries.delete(workspaceId)
    this.close(entry)
  }

  /** Close them all (Crafty stopped). */
  dispose(): void {
    for (const entry of this.entries.values()) this.close(entry)
    this.entries.clear()
  }

  private connect(key: string, server: RemoteServerConfig): Entry<C> {
    const entry = { key, client: null, failed: false, idleTimer: null } as Entry<C>
    entry.ready = this.open(server).then(
      client => {
        entry.client = client
        return client
      },
      (error: unknown) => {
        entry.failed = true
        throw error
      },
    )
    // The failure reaches whoever awaits `ready`; this only keeps it from also counting as unhandled
    entry.ready.catch(() => undefined)
    return entry
  }

  private touch(workspaceId: string, entry: Entry<C>): void {
    if (entry.idleTimer) clearTimeout(entry.idleTimer)
    entry.idleTimer = setTimeout(() => {
      if (this.entries.get(workspaceId) !== entry) return
      this.entries.delete(workspaceId)
      this.close(entry)
    }, this.idleMs)
    entry.idleTimer.unref?.()
  }

  private close(entry: Entry<C>): void {
    if (entry.idleTimer) clearTimeout(entry.idleTimer)
    entry.idleTimer = null
    if (entry.client) {
      entry.client.destroy()
      return
    }
    // Still connecting: close it once it's up
    if (!entry.failed) void entry.ready.then(client => client.destroy(), () => undefined)
  }
}
