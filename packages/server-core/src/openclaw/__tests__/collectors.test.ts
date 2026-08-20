import { describe, expect, it } from 'bun:test'
import { EventEmitter } from 'node:events'
import {
  OpenClawAuditProcessSupervisor,
  type ManagedOpenClawAuditChildProcess,
  type OpenClawAuditProcessRequest,
} from '../collectors.ts'

class TermIgnoringChild extends EventEmitter implements ManagedOpenClawAuditChildProcess {
  readonly stdout = new EventEmitter()
  readonly stderr = new EventEmitter()
  readonly pid: number
  readonly signals: Array<NodeJS.Signals | number | undefined> = []

  constructor(pid = 0) {
    super()
    this.pid = pid
  }

  kill(signal?: NodeJS.Signals | number): boolean {
    this.signals.push(signal)
    if (signal === 'SIGKILL') queueMicrotask(() => this.emit('close', null))
    return true
  }
}

class ParentExitsBeforeDescendant extends TermIgnoringChild {
  kill(signal?: NodeJS.Signals | number): boolean {
    this.signals.push(signal)
    if (signal === 'SIGTERM') queueMicrotask(() => this.emit('close', 0))
    return true
  }
}

class TermIgnoringDescendant {
  readonly signals: Array<NodeJS.Signals | number | undefined> = []

  kill(signal?: NodeJS.Signals | number): boolean {
    this.signals.push(signal)
    return true
  }
}

class FakeAuditClock {
  private readonly callbacks: Array<{ callback: () => void; cancelled: boolean }> = []

  readonly schedule = (callback: () => void): { clear(): void } => {
    const entry = { callback, cancelled: false }
    this.callbacks.push(entry)
    return {
      clear() {
        entry.cancelled = true
      },
    }
  }

  runNext(): void {
    while (this.callbacks.length > 0) {
      const entry = this.callbacks.shift()!
      if (entry.cancelled) continue
      entry.callback()
      return
    }
    throw new Error('no scheduled audit callback')
  }
}

function request(overrides: Partial<OpenClawAuditProcessRequest> = {}): OpenClawAuditProcessRequest {
  return {
    executablePath: '/managed/node',
    args: ['/managed/openclaw/openclaw.mjs', 'security', 'audit', '--json'],
    cwd: '/safe/runtime',
    env: { HOME: '/safe/runtime', NODE_ENV: 'production' },
    shell: false,
    timeoutMs: 10_000,
    maxOutputBytes: 8,
    ...overrides,
  }
}

describe('OpenClawAuditProcessSupervisor', () => {
  it('escalates a TERM-ignoring timed out audit to KILL and settles without raw process output', async () => {
    const child = new TermIgnoringChild()
    const clock = new FakeAuditClock()
    const runner = new OpenClawAuditProcessSupervisor({
      spawn: () => child,
      schedule: clock.schedule,
    })
    const pending = runner.run(request({ timeoutMs: 1 }))
    child.stderr.emit('data', Buffer.from('raw stderr must never leave the audit supervisor', 'utf8'))
    clock.runNext()
    clock.runNext()
    clock.runNext()
    const result = await pending

    expect(child.signals).toEqual(['SIGTERM', 'SIGKILL'])
    expect(result).toEqual(expect.objectContaining({ exitCode: null, timedOut: true, stdout: '' }))
    expect(JSON.stringify(result)).not.toContain('raw stderr must never leave the audit supervisor')
  })

  it('terminates a TERM-ignoring audit on output cap, bounds captured data, and escalates to KILL', async () => {
    const child = new TermIgnoringChild()
    const clock = new FakeAuditClock()
    const runner = new OpenClawAuditProcessSupervisor({
      spawn: () => child,
      schedule: clock.schedule,
    })
    const pending = runner.run(request({ maxOutputBytes: 4 }))
    child.stdout.emit('data', Buffer.from('0123456789', 'utf8'))
    clock.runNext()
    clock.runNext()
    const result = await pending
    expect(child.signals).toEqual(['SIGTERM', 'SIGKILL'])
    expect(result).toEqual(expect.objectContaining({ exitCode: null, stdout: '0123', stdoutTruncated: true }))
  })

  it('tracks active audit children and disposes them with bounded TERM-to-KILL escalation on quit', async () => {
    const child = new TermIgnoringChild()
    const clock = new FakeAuditClock()
    const runner = new OpenClawAuditProcessSupervisor({
      spawn: () => child,
      schedule: clock.schedule,
    })
    const pending = runner.run(request())

    const disposing = runner.dispose()
    clock.runNext()
    clock.runNext()
    await disposing
    const result = await pending
    expect(child.signals).toEqual(['SIGTERM', 'SIGKILL'])
    expect(result).toEqual(expect.objectContaining({ exitCode: null, stdout: '' }))
    await expect(runner.dispose()).resolves.toBeUndefined()
  })
  it('keeps owned tree cleanup through KILL when the audit parent exits before a descendant', async () => {
    const child = new ParentExitsBeforeDescendant()
    const descendant = new TermIgnoringDescendant()
    const clock = new FakeAuditClock()
    const runner = new OpenClawAuditProcessSupervisor({
      spawn: (_executablePath, _args, options) => {
        expect(options.detached).toBe(process.platform !== 'win32')
        return child
      },
      schedule: clock.schedule,
      terminateTree: (owned, signal) => {
        owned.kill(signal)
        descendant.kill(signal)
      },
    })
    const pending = runner.run(request())

    const disposing = runner.dispose()
    await Promise.resolve()
    clock.runNext()
    clock.runNext()
    await disposing
    await pending

    expect(descendant.signals).toEqual(['SIGTERM', 'SIGKILL'])
  })

  it('fails closed on injected Windows before spawning an audit child', async () => {
    let spawnCalls = 0
    const runner = new OpenClawAuditProcessSupervisor({
      platform: 'win32',
      spawn: () => {
        spawnCalls += 1
        throw new Error('Windows audit child must not spawn')
      },
    })

    await expect(runner.run(request())).resolves.toEqual({
      exitCode: null,
      stdout: '',
      unsupported: true,
    })
    expect(spawnCalls).toBe(0)
  })
})

