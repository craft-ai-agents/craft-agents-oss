import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, realpath, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  OpenClawRuntimeManager,
  type ManagedChildProcess,
  type OpenClawCredentialStore,
  type OpenClawRuntimeManagerDependencies,
} from '../runtime-manager.ts'

class FakeChild extends EventEmitter implements ManagedChildProcess {
  readonly pid: number
  readonly stdout = new EventEmitter()
  readonly stderr = new EventEmitter()
  readonly signals: Array<NodeJS.Signals | number | undefined> = []

  constructor(pid: number) {
    super()
    this.pid = pid
  }

  kill(signal?: NodeJS.Signals | number): boolean {
    this.signals.push(signal)
    queueMicrotask(() => this.emit('exit', 0, signal ?? null))
    return true
  }
}

function makeCredentialStore(): OpenClawCredentialStore & { readonly values: Map<string, string> } {
  const values = new Map<string, string>()
  return {
    values,
    async get(id) {
      return values.has(id.runtimeId!) ? { value: values.get(id.runtimeId!)! } : null
    },
    async set(id, credential) {
      values.set(id.runtimeId!, credential.value)
    },
    async delete(id) {
      return values.delete(id.runtimeId!)
    },
  }
}

describe('OpenClawRuntimeManager', () => {
  let root: string
  let canonicalRoot: string
  let children: FakeChild[]
  let launches: Array<{ executablePath: string; args: readonly string[]; options: Record<string, unknown> }>
  let logs: string[]
  let portAvailable = true
  let credentials: ReturnType<typeof makeCredentialStore>
  let manager: OpenClawRuntimeManager

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'craft-openclaw-runtime-'))
    canonicalRoot = await realpath(root)
    children = []
    launches = []
    logs = []
    portAvailable = true
    credentials = makeCredentialStore()

    const deps: OpenClawRuntimeManagerDependencies = {
      runtimeRoot: root,
      credentialStore: credentials,
      resolveManagedLauncher: async () => ({
        executablePath: '/managed/node',
        argsPrefix: ['/managed/openclaw/openclaw.mjs'] as const,
        version: '2026.7.1-2' as const,
      }),
      spawn: (executablePath, args, options) => {
        launches.push({ executablePath, args, options: options as unknown as Record<string, unknown> })
        const child = new FakeChild(10_000 + children.length)
        children.push(child)
        return child
      },
      probeHealth: async ({ host, path }) => host === '127.0.0.1' && path === '/health',
      isPortAvailable: async () => portAvailable,
      logger: {
        info(message) { logs.push(message) },
        warn(message) { logs.push(message) },
      },
      healthTimeoutMs: 50,
      healthPollIntervalMs: 1,
      stopTimeoutMs: 50,
    }
    manager = new OpenClawRuntimeManager(deps)
  })

  afterEach(async () => {
    await manager.shutdown()
    await rm(root, { recursive: true, force: true })
  })

  it('moves only through explicit runtime states and exposes no path, port, pid, or credential material', async () => {
    const unavailable = await manager.getRuntimeStatus('workspace-1')
    expect(unavailable).toMatchObject({ state: 'unavailable', safeError: 'RUNTIME_MISSING', managed: true })

    const provisioned = await manager.provisionRuntime('workspace-1')
    expect(provisioned.state).toBe('provisioned')

    const running = await manager.startRuntime('workspace-1')
    expect(running.state).toBe('running')

    const stopped = await manager.stopRuntime('workspace-1')
    expect(stopped.state).toBe('stopped')
    expect(Object.keys(stopped)).toEqual(expect.arrayContaining(['runtimeId', 'workspaceId', 'state', 'managed']))
    expect(JSON.stringify(stopped)).not.toContain(root)
    expect(JSON.stringify(stopped)).not.toContain('10000')
    expect(JSON.stringify(stopped)).not.toContain('token')
  })

  it('serializes concurrent starts so exactly one owned foreground child is launched', async () => {
    await manager.provisionRuntime('workspace-concurrent')

    const [first, second] = await Promise.all([
      manager.startRuntime('workspace-concurrent'),
      manager.startRuntime('workspace-concurrent'),
    ])

    expect(first).toEqual(second)
    expect(first.state).toBe('running')
    expect(children).toHaveLength(1)
    expect(launches).toHaveLength(1)
  })

  it('rejects path traversal workspace identities and does not create a runtime root escape', async () => {
    await expect(manager.provisionRuntime('../escape')).rejects.toMatchObject({ code: 'INVALID_WORKSPACE' })
  })

  it('fails closed when a runtime directory is a symlink', async () => {
    const status = await manager.getRuntimeStatus('workspace-symlink')
    const outside = await mkdtemp(join(tmpdir(), 'craft-openclaw-outside-'))
    await symlink(outside, join(root, status.runtimeId))

    const result = await manager.provisionRuntime('workspace-symlink')
    expect(result).toMatchObject({ state: 'failed', safeError: 'PATH_REJECTED' })
    expect(credentials.values).toHaveLength(0)
    await rm(outside, { recursive: true, force: true })
  })

  it('detects a port block conflict without starting or killing a foreign process', async () => {
    await manager.provisionRuntime('workspace-port-conflict')
    portAvailable = false

    const result = await manager.startRuntime('workspace-port-conflict')
    expect(result).toMatchObject({ state: 'failed', safeError: 'PORT_CONFLICT' })
    expect(children).toHaveLength(0)
  })

  it('uses a fixed shell-free managed launch, configures hardened baseline state, and keeps its token out of args, config, and logs', async () => {
    const provisioned = await manager.provisionRuntime('workspace-no-secret')
    const token = credentials.values.get(provisioned.runtimeId)
    if (token === undefined) throw new Error('expected a generated runtime token')

    await manager.startRuntime('workspace-no-secret')
    const launch = launches[0]!
    const config = await readFile(join(canonicalRoot, provisioned.runtimeId, 'config', 'openclaw.json'), 'utf8')

    expect(launch.executablePath).toBe('/managed/node')
    expect(launch.args).toEqual([
      '/managed/openclaw/openclaw.mjs',
      'gateway',
      'run',
      '--config',
      join(canonicalRoot, provisioned.runtimeId, 'config', 'openclaw.json'),
    ])
    expect(launch.args).not.toContain('--force')
    expect(launch.options.shell).toBe(false)
    expect((launch.options.env as Record<string, string>).OPENCLAW_GATEWAY_TOKEN).toBe(token)
    expect(config).not.toContain(token)
    expect(JSON.stringify(launch.args)).not.toContain(token)
    expect(logs.join('\n')).not.toContain(token)
    expect(config).toContain('"bind": "loopback"')
    expect(config).toContain('"security": "deny"')
  })

  it('never starts an unmanaged PATH fallback when the verified launcher is unavailable', async () => {
    const missing = new OpenClawRuntimeManager({
      runtimeRoot: root,
      credentialStore: credentials,
      resolveManagedLauncher: async () => null,
      spawn: () => { throw new Error('must not spawn') },
      probeHealth: async () => false,
      isPortAvailable: async () => true,
    })

    await expect(missing.provisionRuntime('workspace-no-launcher')).resolves.toMatchObject({
      state: 'unsupported',
      safeError: 'UNSUPPORTED',
    })
  })

  it('provides Control-UI origin and setup credential only for a running owned runtime', async () => {
    const provisioned = await manager.provisionRuntime('workspace-host-control')

    await expect(manager.getControlUiOriginForHostControl('workspace-host-control')).rejects.toMatchObject({
      code: 'RUNTIME_STOPPED',
    })
    await expect(manager.getGatewayTokenForHostControl('workspace-host-control')).rejects.toMatchObject({
      code: 'RUNTIME_STOPPED',
    })

    await manager.startRuntime('workspace-host-control')
    const origin = await manager.getControlUiOriginForHostControl('workspace-host-control')
    const credential = await manager.getGatewayTokenForHostControl('workspace-host-control')
    const storedCredential = credentials.values.get(provisioned.runtimeId)
    if (storedCredential === undefined) throw new Error('expected a stored runtime token')
    expect(credential).toBe(storedCredential)
    expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/)

    await manager.stopRuntime('workspace-host-control')
    await expect(manager.getControlUiOriginForHostControl('workspace-host-control')).rejects.toMatchObject({
      code: 'RUNTIME_STOPPED',
    })
    await expect(manager.getGatewayTokenForHostControl('workspace-host-control')).rejects.toMatchObject({
      code: 'RUNTIME_STOPPED',
    })
  })
})
