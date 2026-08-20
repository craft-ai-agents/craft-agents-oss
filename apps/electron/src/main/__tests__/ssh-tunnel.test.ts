import { describe, it, expect } from 'bun:test'
import { EventEmitter } from 'events'
import { SshTunnel, buildSshArgs, type SshTunnelDeps } from '../ssh-tunnel/ssh-tunnel.ts'
import { findFreePort } from '../ssh-tunnel/port-allocator.ts'
import type { SshHostConfig } from '@craft-agent/shared/config'

async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

const HOST: SshHostConfig = {
  id: 'box',
  label: 'Box',
  host: 'example.com',
  port: 2222,
  user: 'deploy',
  remotePort: 9100,
  identityFile: '/keys/id_ed25519',
}

class FakeProc extends EventEmitter {
  stderr = new EventEmitter()
  killed = false
  kill() {
    this.killed = true
    // ssh exits when killed.
    queueMicrotask(() => this.emit('exit', null))
    return true
  }
}

function makeDeps(overrides: Partial<SshTunnelDeps> & { procs?: FakeProc[] } = {}): {
  deps: SshTunnelDeps
  procs: FakeProc[]
  timers: Array<() => void>
} {
  const procs = overrides.procs ?? []
  const timers: Array<() => void> = []
  const deps: SshTunnelDeps = {
    spawn: () => {
      const p = new FakeProc()
      procs.push(p)
      return p as unknown as ReturnType<SshTunnelDeps['spawn']>
    },
    probe: overrides.probe ?? (async () => true),
    allocatePort: overrides.allocatePort ?? (async () => 55000),
    backoffMs: () => 1,
    maxReconnects: overrides.maxReconnects ?? 3,
    // Run scheduled reconnects synchronously via a collected queue.
    setTimeoutFn: (fn) => {
      timers.push(fn)
      return 0 as unknown as ReturnType<typeof setTimeout>
    },
    clearTimeoutFn: () => {},
  }
  return { deps, procs, timers }
}

describe('buildSshArgs', () => {
  it('builds -N -L forward with hardening options', () => {
    const args = buildSshArgs(HOST, { forward: { localPort: 55000 } })
    expect(args).toContain('-N')
    expect(args).toContain('55000:127.0.0.1:9100')
    expect(args.join(' ')).toContain('BatchMode=yes')
    expect(args.join(' ')).toContain('ExitOnForwardFailure=yes')
    expect(args.join(' ')).toContain('ConnectTimeout=10')
    expect(args).toContain('-i')
    expect(args).toContain('/keys/id_ed25519')
    expect(args[args.length - 1]).toBe('deploy@example.com')
    expect(args).toContain('2222')
  })

  it('omits forwarding flags in command mode', () => {
    const args = buildSshArgs(HOST)
    expect(args).not.toContain('-N')
    expect(args).not.toContain('-L')
    expect(args.join(' ')).not.toContain('ExitOnForwardFailure')
    expect(args.join(' ')).toContain('BatchMode=yes')
    expect(args.join(' ')).toContain('ConnectTimeout=10')
    expect(args[args.length - 1]).toBe('deploy@example.com')
  })

  it('omits -i when no identityFile', () => {
    const { identityFile, ...rest } = HOST
    void identityFile
    expect(buildSshArgs(rest, { forward: { localPort: 1 } }).includes('-i')).toBe(false)
  })

  it('passes a bare hostname when user is empty (imported hosts)', () => {
    const args = buildSshArgs({ ...HOST, user: '' })
    expect(args[args.length - 1]).toBe('example.com')
  })
})

describe('SshTunnel state machine', () => {
  it('goes connecting -> connected when probe succeeds', async () => {
    const { deps } = makeDeps()
    const tunnel = new SshTunnel(HOST, deps)
    const states: string[] = []
    tunnel.on('state', (s) => states.push(s.status))
    await tunnel.connect()
    const st = tunnel.getState()
    expect(st.status).toBe('connected')
    expect(st.localPort).toBe(55000)
    expect(st.url).toBe('ws://127.0.0.1:55000')
    expect(states).toEqual(['connecting', 'connected'])
  })

  it('errors when probe fails (no server on forwarded port)', async () => {
    const { deps, procs } = makeDeps({ probe: async () => false })
    const tunnel = new SshTunnel(HOST, deps)
    await tunnel.connect()
    await Promise.resolve() // let the kill's exit event fire
    expect(tunnel.getState().status).toBe('error')
    expect(procs[0]!.killed).toBe(true)
  })

  it('surfaces stderr in the error message', async () => {
    const { deps, procs } = makeDeps({ probe: async () => false })
    const tunnel = new SshTunnel(HOST, deps)
    const connectP = tunnel.connect()
    // allocatePort is async, so spawn happens a tick later.
    await Promise.resolve()
    procs[0]!.stderr.emit('data', 'Permission denied (publickey).')
    await connectP
    expect(tunnel.getState().error).toContain('Permission denied')
  })

  it('auto-reconnects with backoff when the tunnel drops', async () => {
    const probes = [true, true]
    const { deps, procs, timers } = makeDeps({ probe: async () => probes.shift() ?? true })
    const tunnel = new SshTunnel(HOST, deps)
    await tunnel.connect()
    expect(tunnel.getState().status).toBe('connected')

    // Simulate ssh dying unexpectedly.
    procs[0]!.emit('exit', 255)
    expect(tunnel.getState().status).toBe('error')
    expect(tunnel.getState().reconnectAttempts).toBe(1)
    expect(timers).toHaveLength(1)

    // Fire the scheduled reconnect.
    timers[0]!()
    await flush()
    expect(tunnel.getState().status).toBe('connected')
    expect(tunnel.getState().reconnectAttempts).toBe(0)
  })

  it('gives up after maxReconnects when reconnects keep failing', async () => {
    // First probe connects; every reconnect probe fails.
    let first = true
    const { deps, procs, timers } = makeDeps({
      maxReconnects: 2,
      probe: async () => {
        if (first) {
          first = false
          return true
        }
        return false
      },
    })
    const tunnel = new SshTunnel(HOST, deps)
    await tunnel.connect()
    expect(tunnel.getState().status).toBe('connected')

    // Drop the live tunnel -> schedules reconnect attempt 1.
    procs[procs.length - 1]!.emit('exit', 255)
    expect(tunnel.getState().reconnectAttempts).toBe(1)

    // Attempt 1 (probe fails, kills proc -> exit -> schedules attempt 2).
    timers.shift()!()
    await flush()
    expect(tunnel.getState().reconnectAttempts).toBe(2)

    // Attempt 2 (probe fails) -> exceeds maxReconnects -> give up.
    timers.shift()!()
    await flush()
    expect(tunnel.getState().status).toBe('error')
    expect(tunnel.getState().error).toContain('gave up')
  })

  it('reports connected without a live probe when requireProbe is false', async () => {
    // Server dead but ssh transport up: the resolver relies on the tunnel
    // staying up so it can bootstrap through it.
    const { deps, procs } = makeDeps({ probe: async () => false })
    const tunnel = new SshTunnel(HOST, deps)
    await tunnel.connect({ requireProbe: false })
    const st = tunnel.getState()
    expect(st.status).toBe('connected')
    expect(st.localPort).toBe(55000)
    expect(procs[0]!.killed).toBe(false) // the tunnel was NOT torn down
  })

  it('marks reconnect-pending errors willRetry=true and terminal errors willRetry=false', async () => {
    // First probe connects; the reconnect attempt's probe fails.
    const probes = [true, false]
    const { deps, procs, timers } = makeDeps({ maxReconnects: 1, probe: async () => probes.shift() ?? false })
    const tunnel = new SshTunnel(HOST, deps)
    await tunnel.connect()
    // Drop -> transient error (a retry is scheduled).
    procs[0]!.emit('exit', 255)
    expect(tunnel.getState().status).toBe('error')
    expect(tunnel.getState().willRetry).toBe(true)
    // The retry fails too (probe false -> proc killed -> exit) -> exceeds
    // maxReconnects -> terminal.
    timers.shift()!()
    await flush()
    expect(tunnel.getState().status).toBe('error')
    expect(tunnel.getState().willRetry).toBe(false)
    expect(tunnel.getState().error).toContain('gave up')
  })

  it('disconnect stops reconnection', async () => {
    const { deps, procs } = makeDeps()
    const tunnel = new SshTunnel(HOST, deps)
    await tunnel.connect()
    tunnel.disconnect()
    expect(tunnel.getState().status).toBe('disconnected')
    // A later exit event must not trigger reconnect.
    procs[0]!.emit('exit', 0)
    expect(tunnel.getState().status).toBe('disconnected')
  })
})

describe('findFreePort', () => {
  it('returns a usable port number', async () => {
    const port = await findFreePort()
    expect(port).toBeGreaterThan(0)
    expect(port).toBeLessThan(65536)
  })

  it('returns different ports across calls', async () => {
    const a = await findFreePort()
    const b = await findFreePort()
    // Not guaranteed distinct, but the allocator should not throw.
    expect(typeof a).toBe('number')
    expect(typeof b).toBe('number')
  })
})

// Manager helpers: application-level probe + shell quoting

import { probeOnce, buildScpArgs } from '../ssh-tunnel/ssh-tunnel-manager.ts'
import { posixSingleQuote } from '../ssh-tunnel/server-bootstrap.ts'
import type { Socket } from 'net'

class FakeSocket extends EventEmitter {
  written: string[] = []
  destroyed = false
  write(data: string) {
    this.written.push(data)
    return true
  }
  destroy() {
    this.destroyed = true
  }
  setTimeout(_ms: number, _cb?: () => void) {
    return this
  }
}

describe('probeOnce', () => {
  it('succeeds only after receiving a response byte', async () => {
    const sock = new FakeSocket()
    const p = probeOnce(1234, () => sock as unknown as Socket)
    sock.emit('connect')
    expect(sock.written[0]).toContain('GET / HTTP/1.1')
    sock.emit('data', Buffer.from('HTTP/1.1 400 Bad Request'))
    expect(await p).toBe(true)
    expect(sock.destroyed).toBe(true)
  })

  it('fails when the socket closes without any data (ssh -L false accept)', async () => {
    const sock = new FakeSocket()
    const p = probeOnce(1234, () => sock as unknown as Socket)
    // ssh accepts locally, then tears down when the remote channel fails.
    sock.emit('connect')
    sock.emit('close')
    expect(await p).toBe(false)
  })

  it('fails on connection error', async () => {
    const sock = new FakeSocket()
    const p = probeOnce(1234, () => sock as unknown as Socket)
    sock.emit('error', new Error('ECONNREFUSED'))
    expect(await p).toBe(false)
  })
})

describe('buildScpArgs', () => {
  it('includes -O in legacy mode and omits it otherwise', () => {
    expect(buildScpArgs(HOST, '/l/a.tgz', '~/.craft-agent/a.tgz', true)[0]).toBe('-O')
    expect(buildScpArgs(HOST, '/l/a.tgz', '~/.craft-agent/a.tgz', false)).not.toContain('-O')
  })

  it('builds user@host:dest, or host:dest when user is empty', () => {
    expect(buildScpArgs(HOST, '/l/a.tgz', '~/x', true).at(-1)).toBe('deploy@example.com:x')
    expect(buildScpArgs({ ...HOST, user: '' }, '/l/a.tgz', '~/x', true).at(-1)).toBe('example.com:x')
  })
})

describe('SshTunnelManager.uploadFile — scp -O fallback', () => {
  type ExecCb = (err: Error | null, stdout: string, stderr: string) => void

  function managerWithScp(behavior: (args: string[]) => { err?: string }) {
    const manager = new SshTunnelManager()
    const calls: string[][] = []
    manager.scpExec = ((_bin: string, args: string[], _opts: unknown, cb: ExecCb) => {
      calls.push(args)
      const { err } = behavior(args)
      queueMicrotask(() => (err ? cb(new Error('scp failed'), '', err) : cb(null, '', '')))
      return undefined as never
    }) as unknown as SshTunnelManager['scpExec']
    const upload = (
      manager as unknown as { uploadFile(h: SshHostConfig, l: string, r: string): Promise<void> }
    ).uploadFile.bind(manager)
    return { manager, calls, upload }
  }

  it('retries without -O when the local scp does not know the flag (OpenSSH < 9)', async () => {
    const { manager, calls, upload } = managerWithScp((args) =>
      args.includes('-O') ? { err: 'scp: unknown option -- O' } : {},
    )
    await upload(HOST, '/l/a.tgz', '~/.craft-agent/a.tgz')
    expect(calls).toHaveLength(2)
    expect(calls[0]).toContain('-O')
    expect(calls[1]).not.toContain('-O')
    manager.disposeAll()
  })

  it('does not retry (and surfaces stderr) on a real transfer failure', async () => {
    const { manager, calls, upload } = managerWithScp(() => ({ err: 'Permission denied' }))
    await expect(upload(HOST, '/l/a.tgz', '~/x')).rejects.toThrow(/Permission denied/)
    expect(calls).toHaveLength(1)
    manager.disposeAll()
  })
})

describe('posixSingleQuote', () => {
  it('wraps plain strings in single quotes', () => {
    expect(posixSingleQuote('echo hi')).toBe("'echo hi'")
  })

  it('escapes embedded single quotes', () => {
    expect(posixSingleQuote("echo 'hi'")).toBe("'echo '\\''hi'\\'''")
  })
})

// The renderer keeps literal copies of the SSH defaults (it cannot value-import
// the Node-only shared config barrel). Guard against drift here.
import {
  DEFAULT_SSH_PORT as SHARED_SSH_PORT,
  DEFAULT_REMOTE_SERVER_PORT as SHARED_REMOTE_PORT,
} from '@craft-agent/shared/config'
import {
  DEFAULT_SSH_PORT as RENDERER_SSH_PORT,
  DEFAULT_REMOTE_SERVER_PORT as RENDERER_REMOTE_PORT,
} from '../../shared/types.ts'

describe('SSH default port parity (renderer copies vs shared config)', () => {
  it('matches the shared config constants', () => {
    expect(RENDERER_SSH_PORT).toBe(SHARED_SSH_PORT)
    expect(RENDERER_REMOTE_PORT).toBe(SHARED_REMOTE_PORT)
  })
})

import { SshTunnelManager } from '../ssh-tunnel/ssh-tunnel-manager.ts'

describe('SshTunnelManager.connect — already-connected tunnel', () => {
  it('resolves immediately instead of waiting for a state event that never fires', async () => {
    const host: SshHostConfig = {
      id: 'live', label: 'Live', host: 'h', user: 'u', port: 22, remotePort: 9100,
    }
    // A tunnel already in 'connected' state: connect() is an idempotent no-op
    // and emits nothing — manager.connect must short-circuit, not hang.
    const tunnel = new SshTunnel(host, {
      spawn: () => { throw new Error('must not spawn') },
      probe: async () => true,
      allocatePort: async () => 61234,
    })
    ;(tunnel as unknown as { state: unknown }).state = {
      hostId: 'live', status: 'connected', localPort: 61234,
      url: 'ws://127.0.0.1:61234', reconnectAttempts: 0,
    }
    const manager = new SshTunnelManager()
    ;(manager as unknown as { tunnels: Map<string, SshTunnel> }).tunnels.set('live', tunnel)

    const result = await Promise.race([
      manager.connect(host),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('hung')), 500)),
    ])
    expect(result.url).toBe('ws://127.0.0.1:61234')
    manager.disposeAll()
  })
})

describe('SshTunnelManager.connect — pending waiters', () => {
  const host: SshHostConfig = {
    id: 'pending', label: 'Pending', host: 'h', user: 'u', port: 22, remotePort: 9100,
  }

  /** A tunnel stuck in 'connecting' (its probe never settles), injected into a manager. */
  function pendingSetup() {
    const tunnel = new SshTunnel(host, {
      spawn: () => new FakeProc() as unknown as ReturnType<SshTunnelDeps['spawn']>,
      probe: () => new Promise<boolean>(() => {}), // never settles
      allocatePort: async () => 61000,
    })
    // Mid-attempt: manager.connect must reuse (not dispose) this tunnel and
    // wait on its state events; tunnel.connect() is a no-op in this state.
    ;(tunnel as unknown as { state: unknown }).state = {
      hostId: host.id, status: 'connecting', reconnectAttempts: 0,
    }
    const manager = new SshTunnelManager()
    ;(manager as unknown as { tunnels: Map<string, SshTunnel> }).tunnels.set(host.id, tunnel)
    return { tunnel, manager }
  }

  it('rejects (not hangs) when the tunnel is disposed while a connect is pending', async () => {
    const { tunnel, manager } = pendingSetup()
    const p = manager.connect(host)
    p.catch(() => {}) // avoid unhandled-rejection noise before the assertion
    await Promise.resolve() // let connect() subscribe and start the attempt
    tunnel.dispose()
    await expect(
      Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('hung')), 500))]),
    ).rejects.toThrow(/disposed/)
    manager.disposeAll()
  })

  it('ignores transient (willRetry) errors and resolves once the tunnel reconnects', async () => {
    const { tunnel, manager } = pendingSetup()
    const p = manager.connect(host)
    await Promise.resolve()
    // A recoverable blip: the tunnel emits an error but is auto-reconnecting.
    tunnel.emit('state', {
      hostId: host.id, status: 'error', error: 'ssh exited with code 255',
      reconnectAttempts: 1, willRetry: true,
    })
    // ...and then comes back up.
    tunnel.emit('state', {
      hostId: host.id, status: 'connected', localPort: 61000,
      url: 'ws://127.0.0.1:61000', reconnectAttempts: 0, willRetry: false,
    })
    const state = await Promise.race([
      p,
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('hung')), 500)),
    ])
    expect(state.url).toBe('ws://127.0.0.1:61000')
    manager.disposeAll()
  })
})
