import { spawn, execFile } from 'child_process'
import { connect as netConnect } from 'net'
import { EventEmitter } from 'events'
import type { SshHostConfig } from '@craft-agent/shared/config'
import { getSshHost, loadManagedToken, storeManagedToken } from '@craft-agent/shared/config'
import { generateServerToken } from '@craft-agent/server-core/bootstrap'
import { findFreePort } from './port-allocator.ts'
import {
  SshTunnel,
  buildSshArgs,
  sshDestination,
  type TunnelState,
  type TunnelConnectOptions,
} from './ssh-tunnel.ts'
import { resolveServerArtifact, parseUnameTarget } from './server-artifact.ts'
import {
  bootstrapRemoteServer,
  type BootstrapProgress,
  type ServerBootstrapDeps,
} from './server-bootstrap.ts'

const SSH_BIN = 'ssh'
const SCP_BIN = 'scp'
const PROBE_TIMEOUT_MS = 8000
const PROBE_INTERVAL_MS = 250

/** Minimal factory over net.connect, injectable for tests. */
export type ConnectFn = (port: number) => import('net').Socket

/** Probe the forwarded port once. A bare TCP connect is not enough (`ssh -L`
 * accepts locally then drops), so require a response byte to an HTTP request. */
export function probeOnce(localPort: number, connectFn: ConnectFn = (p) => netConnect({ host: '127.0.0.1', port: p })): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = connectFn(localPort)
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      sock.destroy()
      resolve(ok)
    }
    sock.once('connect', () => {
      sock.write('GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n')
    })
    sock.once('data', () => finish(true))
    sock.once('error', () => finish(false))
    sock.once('close', () => finish(false))
    sock.setTimeout(3000, () => finish(false))
  })
}

/** Probe the forwarded local port for a live craft-agent server, retrying
 * until the overall timeout elapses. */
export function probeLocalPort(localPort: number): Promise<boolean> {
  const deadline = Date.now() + PROBE_TIMEOUT_MS
  return new Promise((resolve) => {
    const tryOnce = async () => {
      const ok = await probeOnce(localPort)
      if (ok) {
        resolve(true)
      } else if (Date.now() >= deadline) {
        resolve(false)
      } else {
        setTimeout(tryOnce, PROBE_INTERVAL_MS)
      }
    }
    void tryOnce()
  })
}

export class SshTunnelManager extends EventEmitter {
  private tunnels = new Map<string, SshTunnel>()

  /** Current state for a host, or a synthetic disconnected state if none. */
  getState(hostId: string): TunnelState {
    return (
      this.tunnels.get(hostId)?.getState() ?? {
        hostId,
        status: 'disconnected',
        reconnectAttempts: 0,
      }
    )
  }

  getAllStates(): TunnelState[] {
    return [...this.tunnels.values()].map((t) => t.getState())
  }

  /** Establish (or reuse) a tunnel for `host`. Resolves with the connected
   * state (including the forwarded ws:// url) or rejects with the error. */
  async connect(host: SshHostConfig, opts: TunnelConnectOptions = {}): Promise<TunnelState> {
    let tunnel = this.tunnels.get(host.id)
    if (tunnel) {
      // Discard the cached tunnel when it is idle or was built from a stale
      // host config (the user may have edited port/user/identityFile).
      const status = tunnel.getState().status
      const idle = status !== 'connected' && status !== 'connecting'
      const stale = JSON.stringify(tunnel.getHostConfig()) !== JSON.stringify(host)
      if (idle || stale) {
        tunnel.dispose()
        this.tunnels.delete(host.id)
        tunnel = undefined
      }
    }
    if (!tunnel) {
      tunnel = new SshTunnel(host, {
        spawn: (args) => spawn(SSH_BIN, args, { stdio: ['ignore', 'ignore', 'pipe'] }),
        probe: probeLocalPort,
        allocatePort: findFreePort,
      })
      tunnel.on('state', (state: TunnelState) => this.emit('state', state))
      this.tunnels.set(host.id, tunnel)
    }

    // Already up: connect() is an idempotent no-op that emits no event, so
    // waiting for one below would hang forever — return the live state.
    const current = tunnel.getState()
    if (current.status === 'connected') return current

    return new Promise<TunnelState>((resolve, reject) => {
      const onState = (state: TunnelState) => {
        if (state.status === 'connected') {
          tunnel!.off('state', onState)
          resolve(state)
        } else if (state.status === 'error' && !state.willRetry) {
          // Transient errors (willRetry) mean the tunnel is auto-reconnecting;
          // keep waiting so a recoverable blip doesn't orphan a returning tunnel.
          tunnel!.off('state', onState)
          reject(new Error(state.error ?? 'SSH tunnel failed'))
        }
      }
      tunnel!.on('state', onState)
      void tunnel!.connect(opts)
    })
  }

  disconnect(hostId: string): void {
    const tunnel = this.tunnels.get(hostId)
    if (!tunnel) return
    tunnel.disconnect()
    this.emit('state', tunnel.getState())
  }

  /** Fetch the remote craft-agent server token over ssh, best-effort: try the
   * configured token file (if any) plus the common `.env` convention. */
  async fetchRemoteToken(host: SshHostConfig, tokenPath?: string): Promise<string | undefined> {
    const candidates = tokenPath
      ? [tokenPath]
      : ['~/.craft-agent/server-token', '~/.craft-agent/.env']
    for (const path of candidates) {
      const out = await this.runRemote(host, `cat ${path} 2>/dev/null || true`)
      const token = extractToken(out)
      if (token) return token
    }
    return undefined
  }

  /** Run a one-shot command over ssh and return stdout (optional `stdin` keeps
   * secrets out of argv). SECURITY: reject with stderr only, never the argv. */
  private runRemote(
    host: SshHostConfig,
    command: string,
    opts: { timeoutMs?: number; stdin?: string } = {},
  ): Promise<string> {
    const args = buildSshArgs(host)
    // buildSshArgs ends with user@host; append the remote command.
    return new Promise((resolve, reject) => {
      const child = execFile(
        SSH_BIN,
        [...args, command],
        { timeout: opts.timeoutMs ?? 20_000 },
        (err, stdout, stderr) => {
          if (err && !stdout) {
            const detail = String(stderr || '').trim()
            reject(new Error(`Remote command failed${detail ? `: ${detail}` : ''}`))
          } else {
            resolve(stdout)
          }
        },
      )
      if (opts.stdin !== undefined) {
        child.stdin?.write(opts.stdin)
      }
      child.stdin?.end()
    })
  }

  /** Upload a local file to the remote host via scp. */
  private async uploadFile(host: SshHostConfig, localPath: string, remotePath: string): Promise<void> {
    // -O forces the legacy SCP protocol (safer for minimal sshd without sftp);
    // pre-OpenSSH-9 scp lacks -O, so retry without it on "unknown option".
    try {
      await this.scpUpload(host, localPath, remotePath, true)
    } catch (err) {
      if (err instanceof Error && /unknown option/i.test(err.message)) {
        await this.scpUpload(host, localPath, remotePath, false)
      } else {
        throw err
      }
    }
  }

  /** Injectable for tests (bun cannot mock child_process cleanly). */
  scpExec: typeof execFile = execFile

  private scpUpload(
    host: SshHostConfig,
    localPath: string,
    remotePath: string,
    legacyFlag: boolean,
  ): Promise<void> {
    const args = buildScpArgs(host, localPath, remotePath, legacyFlag)
    return new Promise((resolve, reject) => {
      this.scpExec(SCP_BIN, args, { timeout: 120_000 }, (err, _stdout, stderr) => {
        if (err) reject(new Error(`scp upload failed: ${String(stderr)?.trim() || err.message}`))
        else resolve()
      })
    })
  }

  /** Probe the remote server port directly over ssh (no tunnel needed), used
   * during bootstrap. True if something answers HTTP on 127.0.0.1:<remotePort>. */
  private async probeRemotePort(host: SshHostConfig): Promise<boolean> {
    const port = host.remotePort
    // Try curl, fall back to a /dev/tcp bash probe. We only need a byte back;
    // craft-agent answers HTTP on the RPC port. Any non-empty response = alive.
    const cmd =
      `(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:${port}/ 2>/dev/null ` +
      `|| (exec 3<>/dev/tcp/127.0.0.1/${port} && printf 'GET / HTTP/1.0\\r\\n\\r\\n' >&3 && head -c 1 <&3 | od -An -tx1)) 2>/dev/null`
    try {
      const out = (await this.runRemote(host, cmd)).trim()
      // curl prints an HTTP status; a 000 means connection refused/timeout.
      if (/^\d{3}$/.test(out)) return out !== '000'
      return out.length > 0
    } catch {
      return false
    }
  }

  /** One-click bootstrap: ensure an app-managed server is installed and running
   * on `host` (installing over SSH if needed). Returns the managed token. */
  async bootstrapServer(
    host: SshHostConfig,
    onProgress: (p: BootstrapProgress) => void,
  ): Promise<{ token: string }> {
    const deps: ServerBootstrapDeps = {
      runRemote: (h, cmd, opts) => this.runRemote(h, cmd, opts),
      uploadFile: (h, local, remote) => this.uploadFile(h, local, remote),
      detectTarget: (uname) => parseUnameTarget(uname),
      resolveArtifact: (target) =>
        resolveServerArtifact(target, { isPackaged: isAppPackaged() }),
      probe: () => this.probeRemotePort(host),
      generateToken: () => generateServerToken(),
      storeToken: (hostId, token) => storeManagedToken(hostId, token),
      loadStoredToken: (hostId) => loadManagedToken(hostId),
    }
    return bootstrapRemoteServer(host, deps, onProgress)
  }

  /** Build the side-effect deps a {@link resolveRemoteConnection} call needs,
   * bound to this manager, so the resolver stays pure/injectable for tests. */
  connectionResolverDeps(): import('./connection-resolver.ts').ConnectionResolverDeps {
    return {
      getSshHost: (hostId) => getSshHost(hostId),
      connectTunnel: async (host, opts) => {
        const state = await this.connect(host, opts)
        return { url: state.url, localPort: state.localPort }
      },
      bootstrapServer: (host, onProgress) => this.bootstrapServer(host, onProgress),
      loadManagedToken: (hostId) => loadManagedToken(hostId),
      probe: (localPort) => probeOnce(localPort),
    }
  }

  disposeAll(): void {
    for (const tunnel of this.tunnels.values()) tunnel.dispose()
    this.tunnels.clear()
    this.removeAllListeners()
  }
}

/** Build the scp argv for an upload. Exported for testing. */
export function buildScpArgs(
  host: SshHostConfig,
  localPath: string,
  remotePath: string,
  legacyFlag: boolean,
): string[] {
  // scp uses -P for the port (uppercase, unlike ssh's -p).
  const args = ['-B', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-P', String(host.port)]
  if (legacyFlag) args.unshift('-O')
  if (host.identityFile) args.push('-i', host.identityFile, '-o', 'IdentitiesOnly=yes')
  // scp does not run a shell for the destination path, so strip a leading "~/"
  // to write relative to the login home dir.
  const dest = remotePath.replace(/^~\//, '')
  args.push(localPath, `${sshDestination(host)}:${dest}`)
  return args
}

/** Pull a token out of `KEY=value` env lines or a bare token file. */
function extractToken(out: string): string | undefined {
  const text = out.trim()
  if (!text) return undefined
  const match = text.match(/CRAFT_SERVER_TOKEN\s*=\s*["']?([A-Za-z0-9._-]+)["']?/)
  if (match) return match[1]
  // A file containing just the token.
  if (/^[A-Za-z0-9._-]{16,}$/.test(text)) return text
  return undefined
}

/** Whether the Electron app is packaged. Fail-soft to `false` (dev) if electron isn't available. */
function isAppPackaged(): boolean {
  try {
    // Lazy require so this module stays importable in plain-bun unit tests.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron') as { app?: { isPackaged?: boolean } }
    return electron.app?.isPackaged ?? false
  } catch {
    return false
  }
}

let singleton: SshTunnelManager | undefined
export function getSshTunnelManager(): SshTunnelManager {
  if (!singleton) singleton = new SshTunnelManager()
  return singleton
}
