import type { ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import type { SshHostConfig } from '@craft-agent/shared/config'

export type TunnelStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface TunnelState {
  hostId: string
  status: TunnelStatus
  /** Forwarded local port (set once the tunnel is up). */
  localPort?: number
  /** ws:// url pointing at the forwarded port, when connected. */
  url?: string
  /** Human-readable error, when status === 'error'. */
  error?: string
  /** How many auto-reconnect attempts have been made in the current outage. */
  reconnectAttempts: number
  /** Only meaningful when status === 'error': true means transient (about to
   * retry on its own); false/undefined means terminal. */
  willRetry?: boolean
}

export interface TunnelConnectOptions {
  /** When false, a tunnel with ssh up but no server answering is still reported
   * 'connected' so the resolver can bootstrap through it. Default true. */
  requireProbe?: boolean
}

export type SpawnSshFn = (args: string[]) => ChildProcess
/** Probe the forwarded local port for a live craft-agent server. */
export type ProbeFn = (localPort: number) => Promise<boolean>
/** Allocate a free local port. */
export type AllocatePortFn = () => Promise<number>

export interface SshTunnelDeps {
  spawn: SpawnSshFn
  probe: ProbeFn
  allocatePort: AllocatePortFn
  /** Delay before the Nth (1-based) reconnect attempt, in ms. */
  backoffMs?: (attempt: number) => number
  /** Max reconnect attempts before giving up (default 6). */
  maxReconnects?: number
  /** Injectable timers for tests. */
  setTimeoutFn?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimeoutFn?: (t: ReturnType<typeof setTimeout>) => void
}

const DEFAULT_MAX_RECONNECTS = 6

function defaultBackoff(attempt: number): number {
  // 0.5s, 1s, 2s, 4s, 8s, capped at 15s.
  return Math.min(500 * 2 ** (attempt - 1), 15_000)
}

export interface BuildSshArgsOptions {
  /** When set, run in -N -L port-forward mode; otherwise a one-shot command connection. */
  forward?: { localPort: number }
}

/** Build the ssh argv for a host. Exported for testing. */
export function buildSshArgs(host: SshHostConfig, opts: BuildSshArgsOptions = {}): string[] {
  const args: string[] = []
  if (opts.forward) {
    args.push('-N', '-L', `${opts.forward.localPort}:127.0.0.1:${host.remotePort}`, '-o', 'ExitOnForwardFailure=yes')
  }
  args.push(
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=10',
    '-o',
    'ServerAliveInterval=15',
    '-o',
    'ServerAliveCountMax=3',
    '-p',
    String(host.port),
  )
  if (host.identityFile) {
    args.push('-i', host.identityFile, '-o', 'IdentitiesOnly=yes')
  }
  args.push(sshDestination(host))
  return args
}

/** `user@host`, or just `host` when no user is configured (ssh then defaults to
 * the local username, like the CLI). */
export function sshDestination(host: SshHostConfig): string {
  return host.user ? `${host.user}@${host.host}` : host.host
}

export class SshTunnel extends EventEmitter {
  private state: TunnelState
  private proc?: ChildProcess
  private reconnectTimer?: ReturnType<typeof setTimeout>
  private stderrTail = ''
  private probeError?: string
  private disposed = false
  private wantConnected = false
  private requireProbe = true

  private readonly maxReconnects: number
  private readonly backoffMs: (attempt: number) => number
  private readonly setTimeoutFn: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  private readonly clearTimeoutFn: (t: ReturnType<typeof setTimeout>) => void

  constructor(
    private readonly host: SshHostConfig,
    private readonly deps: SshTunnelDeps,
  ) {
    super()
    this.state = { hostId: host.id, status: 'disconnected', reconnectAttempts: 0 }
    this.maxReconnects = deps.maxReconnects ?? DEFAULT_MAX_RECONNECTS
    this.backoffMs = deps.backoffMs ?? defaultBackoff
    this.setTimeoutFn = deps.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearTimeoutFn = deps.clearTimeoutFn ?? ((t) => clearTimeout(t))
  }

  getState(): Readonly<TunnelState> {
    return this.state
  }

  getHostConfig(): Readonly<SshHostConfig> {
    return this.host
  }

  private setState(patch: Partial<TunnelState>): void {
    this.state = { ...this.state, ...patch }
    this.emit('state', this.state)
  }

  /** Start (or restart) the tunnel. Idempotent while already connecting/connected. */
  async connect(opts: TunnelConnectOptions = {}): Promise<void> {
    if (this.disposed) return
    this.wantConnected = true
    this.requireProbe = opts.requireProbe ?? true
    if (this.state.status === 'connecting' || this.state.status === 'connected') return
    await this.attempt()
  }

  private async attempt(): Promise<void> {
    if (this.disposed) return
    this.clearReconnectTimer()
    this.setState({ status: 'connecting', error: undefined })

    let localPort: number
    try {
      localPort = await this.deps.allocatePort()
    } catch (err) {
      this.fail(`Could not allocate a local port: ${errMsg(err)}`)
      return
    }
    if (this.disposed) return

    const args = buildSshArgs(this.host, { forward: { localPort } })
    const proc = this.deps.spawn(args)
    this.proc = proc
    this.stderrTail = ''

    proc.stderr?.on('data', (chunk: Buffer | string) => {
      this.stderrTail = (this.stderrTail + String(chunk)).slice(-2000)
    })

    proc.once('error', (err: Error) => {
      if (this.proc !== proc) return
      this.handleExit(localPort, `ssh failed to start: ${err.message}`)
    })

    proc.once('exit', (code: number | null) => {
      if (this.proc !== proc) return
      const detail =
        this.probeError || this.stderrTail.trim() || `ssh exited with code ${code ?? 'null'}`
      this.handleExit(localPort, detail)
    })

    // With -N there is no ready signal on stdout, so probe the forwarded port.
    const alive = await this.deps.probe(localPort)
    if (this.disposed || this.proc !== proc) return
    if (!alive && !this.requireProbe) {
      // ssh transport is up but nothing answers the forwarded port; the caller
      // asked to keep it so it can bootstrap the server through the forward.
      this.probeError = undefined
      this.setState({
        status: 'connected',
        localPort,
        url: `ws://127.0.0.1:${localPort}`,
        error: undefined,
        reconnectAttempts: 0,
        willRetry: false,
      })
      this.emit('connected', this.state)
      return
    }
    if (!alive) {
      // Probe failed but ssh may still be up; record why, then tear it down.
      // The proc's exit handler routes to reconnect (if wanted) or disconnect.
      this.probeError =
        this.stderrTail.trim() ||
        `No craft-agent server answered on the forwarded port (remote ${this.host.remotePort}).`
      this.killProc(proc)
      return
    }

    this.probeError = undefined
    this.setState({
      status: 'connected',
      localPort,
      url: `ws://127.0.0.1:${localPort}`,
      error: undefined,
      reconnectAttempts: 0,
      willRetry: false,
    })
    this.emit('connected', this.state)
  }

  private handleExit(_localPort: number, detail: string): void {
    this.proc = undefined
    if (this.disposed || !this.wantConnected) {
      this.setState({ status: 'disconnected', url: undefined, localPort: undefined })
      return
    }
    // The tunnel dropped while we still want it — schedule a reconnect.
    this.scheduleReconnect(detail)
  }

  private scheduleReconnect(detail: string): void {
    const attempts = this.state.reconnectAttempts + 1
    if (attempts > this.maxReconnects) {
      this.fail(`Tunnel dropped and reconnect gave up after ${this.maxReconnects} attempts: ${detail}`)
      return
    }
    this.setState({
      status: 'error',
      url: undefined,
      localPort: undefined,
      error: detail,
      reconnectAttempts: attempts,
      // Transient: a reconnect is scheduled below — waiters should keep waiting.
      willRetry: true,
    })
    const delay = this.backoffMs(attempts)
    this.reconnectTimer = this.setTimeoutFn(() => {
      void this.attempt()
    }, delay)
  }

  private fail(error: string): void {
    this.setState({ status: 'error', url: undefined, localPort: undefined, error, willRetry: false })
    this.emit('failed', this.state)
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      this.clearTimeoutFn(this.reconnectTimer)
      this.reconnectTimer = undefined
    }
  }

  private killProc(proc: ChildProcess): void {
    try {
      proc.kill('SIGTERM')
    } catch {
      /* already gone */
    }
  }

  /** Stop the tunnel and prevent auto-reconnect. */
  disconnect(): void {
    this.wantConnected = false
    this.clearReconnectTimer()
    if (this.proc) {
      const proc = this.proc
      this.proc = undefined
      this.killProc(proc)
    }
    this.setState({ status: 'disconnected', url: undefined, localPort: undefined, error: undefined })
  }

  dispose(): void {
    this.disposed = true
    // Emit a terminal error BEFORE listeners are dropped so any pending
    // connect() waiter rejects instead of hanging forever.
    const st = this.state
    if (st.status === 'connecting' || (st.status === 'error' && st.willRetry)) this.setState({
      status: 'error',
      url: undefined,
      localPort: undefined,
      error: 'SSH tunnel disposed (host configuration changed)',
      willRetry: false,
    })
    this.disconnect()
    this.removeAllListeners()
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
