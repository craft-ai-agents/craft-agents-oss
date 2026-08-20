import type { RemoteServerConfig } from '@craft-agent/core/types'
import type { SshHostConfig } from '@craft-agent/shared/config'
import type { BootstrapProgress } from './server-bootstrap.ts'
import type { TunnelState } from './ssh-tunnel.ts'
import { isSshBacked } from '../../shared/ssh.ts'

/** A live connection target for the ws transport. */
export interface ResolvedConnection {
  url: string
  token: string
  remoteWorkspaceId: string
}

/** User-facing status for the SSH resolution phase, composed IN FRONT of the ws
 * states so the UI never surfaces a raw ws error for an SSH workspace. */
export type SshConnectionPhase =
  | 'tunnel-connecting'
  | 'bootstrapping'
  | 'tunnel-reconnecting'
  | 'ready'
  | 'error'

export interface SshConnectionStatus {
  hostId: string
  hostLabel: string
  phase: SshConnectionPhase
  /** Reconnect attempt count, when the tunnel dropped and is retrying. */
  attempt?: number
  /** Non-secret detail (e.g. bootstrap sub-phase). */
  detail?: string
}

/** Injected side effects so the resolver is unit-testable without ssh/net. */
export interface ConnectionResolverDeps {
  /** Look up the durable SSH host record by id. */
  getSshHost: (hostId: string) => SshHostConfig | undefined
  /** Ensure a tunnel is up; resolves the forwarded ws url + local port.
   * `requireProbe: false` keeps it even when nothing answers the port yet. */
  connectTunnel: (
    host: SshHostConfig,
    opts?: { requireProbe?: boolean },
  ) => Promise<{ url?: string; localPort?: number }>
  /** Ensure a managed server is installed + running on the host (fast path when
   * already alive). Resolves the managed token. */
  bootstrapServer: (
    host: SshHostConfig,
    onProgress: (p: BootstrapProgress) => void,
  ) => Promise<{ token: string }>
  /** Read the stored managed token for a host, if any (credential store). */
  loadManagedToken: (hostId: string) => Promise<string | undefined>
  /** Probe a forwarded local port for a live craft-agent server. */
  probe: (localPort: number) => Promise<boolean>
}

/** Map a live tunnel state change to the SSH connection status (or null). This
 * is the mid-session-drop path; resolve only streams status during a (re)dial. */
export function tunnelStateToConnectionStatus(
  state: TunnelState,
  hostLabel: string,
): SshConnectionStatus | null {
  const base = { hostId: state.hostId, hostLabel }
  switch (state.status) {
    case 'connected':
      // Also clears any earlier reconnecting/error banner when no resolve runs.
      return { ...base, phase: 'ready' }
    case 'connecting':
      // First connect (attempts 0) is narrated by the active resolve; only a
      // drop-recovery retry needs to be pushed from here.
      return state.reconnectAttempts > 0
        ? { ...base, phase: 'tunnel-reconnecting', attempt: state.reconnectAttempts }
        : null
    case 'error':
      return state.willRetry
        ? {
            ...base,
            phase: 'tunnel-reconnecting',
            attempt: Math.max(state.reconnectAttempts, 1),
            detail: state.error,
          }
        : { ...base, phase: 'error', detail: state.error }
    case 'disconnected':
    default:
      return null
  }
}

/** Resolve a persisted RemoteServerConfig into a live {url, token}. Plain-ws is
 * returned unchanged; SSH-backed goes through the tunnel + bootstrap machinery. */
export async function resolveRemoteConnection(
  remote: RemoteServerConfig,
  deps: ConnectionResolverDeps,
  onStatus: (s: SshConnectionStatus) => void = () => {},
): Promise<ResolvedConnection> {
  if (!isSshBacked(remote)) {
    // Plain ws — dial exactly as persisted.
    return { url: remote.url, token: remote.token, remoteWorkspaceId: remote.remoteWorkspaceId }
  }

  const hostId = remote.sshHostId
  const host = deps.getSshHost(hostId)
  if (!host) {
    onStatus({ hostId, hostLabel: hostId, phase: 'error', detail: 'unknown-host' })
    throw new Error(`SSH host "${hostId}" is no longer configured. Re-add it in Remote (SSH) settings.`)
  }

  // Wrap the whole SSH resolution so ANY failure reaches the renderer as a
  // terminal 'error' phase, instead of leaving the banner spinning forever.
  try {
    // 1. Ensure the tunnel is up → fresh forwarded local port. `requireProbe:
    //    false` keeps it even when the server is dead so step 3 can bootstrap.
    onStatus({ hostId, hostLabel: host.label, phase: 'tunnel-connecting' })
    let tunnel: { url?: string; localPort?: number }
    try {
      tunnel = await deps.connectTunnel(host, { requireProbe: false })
    } catch (err) {
      throw new Error(`SSH tunnel to ${host.label} failed: ${errMsg(err)}`)
    }
    if (!tunnel.url || tunnel.localPort == null) {
      throw new Error(`SSH tunnel to ${host.label} did not report a forwarded port.`)
    }

    // 2. Is a managed server already answering on the fresh port with a token we hold?
    const stored = await deps.loadManagedToken(hostId)
    const alive = await deps.probe(tunnel.localPort)
    if (alive && stored) {
      onStatus({ hostId, hostLabel: host.label, phase: 'ready' })
      return { url: tunnel.url, token: stored, remoteWorkspaceId: remote.remoteWorkspaceId }
    }

    // 3. Server not answering (or no token) — run the one-click bootstrap. It probes
    //    over ssh, fast-paths when already installed, and installs+starts otherwise.
    onStatus({ hostId, hostLabel: host.label, phase: 'bootstrapping' })
    const { token } = await deps.bootstrapServer(host, (p) => {
      onStatus({ hostId, hostLabel: host.label, phase: 'bootstrapping', detail: p.phase })
    })

    // Re-ensure the tunnel (idempotent when it stayed up) and grab a current
    // forwarded url now that a server answers.
    const after = await deps.connectTunnel(host)
    const url = after.url ?? tunnel.url
    onStatus({ hostId, hostLabel: host.label, phase: 'ready' })
    return { url, token, remoteWorkspaceId: remote.remoteWorkspaceId }
  } catch (err) {
    onStatus({ hostId, hostLabel: host.label, phase: 'error', detail: errMsg(err) })
    throw err
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
