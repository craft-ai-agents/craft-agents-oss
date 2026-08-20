/**
 * Local SiYuan bootstrap — pure-ish units with injected FS/fetch/spawn.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  __resetSiyuanBootstrapForTests,
  ensureDefaultLocalConnection,
  ensureLocalKernel,
  probeKernelHealth,
  siyuanDataDir,
  SIYUAN_LOCAL_CONNECTION_ID,
} from '../siyuan-bootstrap'
import { KnowledgeConnectionsStore } from '../connections-store'

let configDir: string

beforeEach(() => {
  __resetSiyuanBootstrapForTests()
  configDir = mkdtempSync(join(tmpdir(), 'siyuan-boot-'))
  process.env.CRAFT_CONFIG_DIR = configDir
})

afterEach(() => {
  __resetSiyuanBootstrapForTests()
  try {
    rmSync(configDir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

describe('siyuanDataDir', () => {
  it('nests under config dir', () => {
    expect(siyuanDataDir('/tmp/cfg')).toBe(join('/tmp/cfg', 'siyuan-workspace'))
  })
})

describe('probeKernelHealth', () => {
  it('returns running+version on code 0 string data', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ code: 0, msg: '', data: '3.7.3' }), { status: 200 })) as unknown as typeof fetch
    await expect(probeKernelHealth('http://127.0.0.1:6806', { fetchImpl })).resolves.toEqual({
      running: true,
      version: '3.7.3',
    })
  })

  it('returns running:false on network failure', async () => {
    const fetchImpl = (async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown as typeof fetch
    await expect(probeKernelHealth('http://127.0.0.1:6806', { fetchImpl })).resolves.toEqual({
      running: false,
    })
  })
})

describe('ensureDefaultLocalConnection', () => {
  it('creates siyuan-local once', () => {
    const store = new KnowledgeConnectionsStore(configDir)
    const first = ensureDefaultLocalConnection(store, { workspaceId: 'ws-a' })
    expect(first.created).toBe(true)
    expect(first.connectionId).toBe(SIYUAN_LOCAL_CONNECTION_ID)
    const record = store.get(SIYUAN_LOCAL_CONNECTION_ID)
    expect(record?.baseUrl).toBe('http://127.0.0.1:6806')
    expect(record?.credentialRef).toBe(`source_bearer::ws-a::${SIYUAN_LOCAL_CONNECTION_ID}`)

    const second = ensureDefaultLocalConnection(store)
    expect(second.created).toBe(false)
    expect(store.list()).toHaveLength(1)
  })

  it('reuses an existing siyuan connection instead of double-seeding', () => {
    const store = new KnowledgeConnectionsStore(configDir)
    store.save({
      id: 'user-conn',
      baseUrl: 'http://127.0.0.1:6806',
      credentialRef: 'source_bearer::ws1::user-conn',
    })
    const result = ensureDefaultLocalConnection(store)
    expect(result).toEqual({ connectionId: 'user-conn', created: false })
    expect(store.get(SIYUAN_LOCAL_CONNECTION_ID)).toBeNull()
  })
})

describe('ensureLocalKernel', () => {
  it('reports already running without spawn', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ code: 0, msg: '', data: '3.1.0' }), { status: 200 })) as unknown as typeof fetch
    let spawned = 0
    const result = await ensureLocalKernel({
      configDir,
      fetchImpl,
      existsSync: () => true,
      pathEnv: '',
      homeDir: '',
      platform: 'darwin',
      spawnFn: (() => {
        spawned += 1
        return { unref() {}, pid: 1 }
      }) as unknown as typeof import('node:child_process').spawn,
    })
    expect(result.ok).toBe(true)
    expect(result.alreadyRunning).toBe(true)
    expect(result.started).toBe(false)
    expect(spawned).toBe(0)
    expect(result.connectionId).toBeTruthy()
  })

  it('returns siyuan-not-installed when binary missing and kernel down', async () => {
    const fetchImpl = (async () => {
      throw new Error('down')
    }) as unknown as typeof fetch
    const result = await ensureLocalKernel({
      configDir,
      fetchImpl,
      existsSync: () => false,
      pathEnv: '',
      homeDir: '',
      platform: 'linux',
      env: { CRAFT_SIYUAN_AUTO_START: '1' },
    })
    expect(result.ok).toBe(false)
    expect(result.error).toBe('siyuan-not-installed')
    expect(result.binaryPath).toBeNull()
  })
  it('opens mac app when GUI binary detected', async () => {
    const fetchImpl = (async () => {
      throw new Error('down')
    }) as unknown as typeof fetch
    let opened = ''
    const appBin = '/Applications/SiYuan.app/Contents/MacOS/SiYuan'
    const result = await ensureLocalKernel({
      configDir,
      fetchImpl,
      platform: 'darwin',
      pathEnv: '',
      homeDir: '',
      existsSync: (p) => p === appBin,
      openAppFn: async (name) => {
        opened = name
      },
    })
    expect(result.ok).toBe(true)
    expect(result.started).toBe(true)
    expect(result.method).toBe('open-app')
    expect(opened).toBe('SiYuan')
  })

})
