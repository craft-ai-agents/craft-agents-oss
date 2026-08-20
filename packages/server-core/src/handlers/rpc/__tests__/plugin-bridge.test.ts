import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getExtensionStateStore, resetExtensionStateStoreCache } from '@craft-agent/shared/extensions'
import { SiyuanKernelClient } from '@craft-agent/core/knowledge/providers/siyuan'
import {
  HANDLED_CHANNELS,
  loadBazaarRemoteManifests,
  pluginBridgeBazaarCatalogListFn,
  pluginBridgeBazaarListFn,
  registerPluginBridgeHandlers,
  resetPluginBridgeFixture,
  resolveKernelClient,
  setPluginBridgeFixture,
  __setPluginBridgeKernelClientForTests,
} from '../plugin-bridge'
import { __setSiyuanDataDirCandidatesForTests } from '../../../knowledge/siyuan-plugins-fs'

type Handler = (ctx: unknown, ...args: unknown[]) => unknown | Promise<unknown>

function createMockServer() {
  const handlers = new Map<string, Handler>()
  const pushes: Array<{ channel: string; target: unknown; args: unknown[] }> = []
  return {
    handlers,
    pushes,
    handle(channel: string, fn: Handler) {
      handlers.set(channel, fn)
    },
    broadcast() {},
    push(channel: string, target: unknown, ...args: unknown[]) {
      pushes.push({ channel, target, args })
    },
  }
}

function makeTempDataDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'craft-plugin-bridge-data-'))
  mkdirSync(join(root, 'plugins'), { recursive: true })
  mkdirSync(join(root, 'storage', 'petal'), { recursive: true })
  return root
}

function writePlugin(dataDir: string, name: string, body: Record<string, unknown>): void {
  const dir = join(dataDir, 'plugins', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'plugin.json'), JSON.stringify(body), 'utf8')
}

type HandlerResult = { data?: unknown; code?: number; msg?: string; httpStatus?: number }
type FetchHandler = (body: Record<string, unknown>) => HandlerResult

function makeKernelClient(handlers: Record<string, FetchHandler>): SiyuanKernelClient {
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const endpoint = String(url).replace(/^https?:\/\/[^/]+/, '')
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    const handler = handlers[endpoint]
    if (!handler) throw new Error(`unmocked kernel endpoint: ${endpoint}`)
    const result = handler(body)
    if (result.httpStatus !== undefined) {
      return new Response('', { status: result.httpStatus })
    }
    return new Response(
      JSON.stringify({ code: result.code ?? 0, msg: result.msg ?? '', data: result.data }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as typeof fetch
  return new SiyuanKernelClient({ baseUrl: 'http://127.0.0.1:6806', token: 'tok', fetchImpl })
}

describe('pluginBridge handlers', () => {
  let configDir: string
  let prevConfig: string | undefined
  let prevConfPaths: string | undefined
  let dataDir: string | undefined

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'craft-plugin-bridge-'))
    prevConfig = process.env.CRAFT_CONFIG_DIR
    process.env.CRAFT_CONFIG_DIR = configDir
    // Isolate conf-token fallback from the developer's real SiYuan conf.
    prevConfPaths = process.env.CRAFT_SIYUAN_CONF_PATHS
    process.env.CRAFT_SIYUAN_CONF_PATHS = join(configDir, 'no-such-conf.json')
    resetExtensionStateStoreCache()
    resetPluginBridgeFixture()
    __setPluginBridgeKernelClientForTests(null) // force no auto kernel
    __setSiyuanDataDirCandidatesForTests([]) // empty fs by default
  })

  afterEach(() => {
    resetPluginBridgeFixture()
    resetExtensionStateStoreCache()
    __setPluginBridgeKernelClientForTests(undefined)
    __setSiyuanDataDirCandidatesForTests(null)
    if (prevConfig === undefined) delete process.env.CRAFT_CONFIG_DIR
    else process.env.CRAFT_CONFIG_DIR = prevConfig
    if (prevConfPaths === undefined) delete process.env.CRAFT_SIYUAN_CONF_PATHS
    else process.env.CRAFT_SIYUAN_CONF_PATHS = prevConfPaths
    rmSync(configDir, { recursive: true, force: true })
    if (dataDir) {
      rmSync(dataDir, { recursive: true, force: true })
      dataDir = undefined
    }
  })

  it('registers every HANDLED_CHANNELS entry', () => {
    const server = createMockServer()
    registerPluginBridgeHandlers(server as never, {
      platform: { logger: { info() {}, error() {}, warn() {}, debug() {} } },
    } as never)
    expect([...HANDLED_CHANNELS]).toEqual([
      RPC_CHANNELS.pluginBridge.LIST_PLUGINS,
      RPC_CHANNELS.pluginBridge.GET_PROJECTIONS,
      RPC_CHANNELS.pluginBridge.SET_ENABLED,
      RPC_CHANNELS.pluginBridge.OPEN_COMPAT,
      RPC_CHANNELS.pluginBridge.INSTALL_BAZAAR,
      RPC_CHANNELS.pluginBridge.UNINSTALL_BAZAAR,
    ])
    for (const ch of HANDLED_CHANNELS) {
      expect(server.handlers.has(ch)).toBe(true)
    }
  })

  it('LIST_PLUGINS soft-fails empty with residual when no fixture/fs/kernel', async () => {
    const server = createMockServer()
    registerPluginBridgeHandlers(server as never, {
      platform: { logger: { info() {}, error() {}, warn() {}, debug() {} } },
    } as never)
    const list = server.handlers.get(RPC_CHANNELS.pluginBridge.LIST_PLUGINS)!
    const result = (await list({})) as {
      plugins: unknown[]
      residual?: string
      fixture?: boolean
    }
    expect(result.plugins).toEqual([])
    expect(result.residual).toBeTruthy()
    expect(result.fixture).toBeUndefined()
  })

  it('LIST_PLUGINS returns fixture manifests', async () => {
    setPluginBridgeFixture([
      {
        name: 'fx-plugin',
        version: '0.1.0',
        craft: { level: 2 },
      },
    ])
    const server = createMockServer()
    registerPluginBridgeHandlers(server as never, {
      platform: { logger: { info() {}, error() {}, warn() {}, debug() {} } },
    } as never)
    const list = server.handlers.get(RPC_CHANNELS.pluginBridge.LIST_PLUGINS)!
    const result = (await list({})) as {
      plugins: Array<{ id: string; level: number; enabled: boolean }>
      fixture?: boolean
      residual?: string
    }
    expect(result.fixture).toBe(true)
    expect(result.plugins).toHaveLength(1)
    expect(result.plugins[0]?.id).toBe('siyuan-plugin:fx-plugin')
    expect(result.plugins[0]?.level).toBe(2)
    expect(result.plugins[0]?.enabled).toBe(true)
    expect(result.residual).toContain('fixture')
  })

  it('LIST_PLUGINS returns filesystem manifests with petals enabled', async () => {
    dataDir = makeTempDataDir()
    writePlugin(dataDir, 'fs-plugin', {
      name: 'fs-plugin',
      version: '3.1.0',
      craft: { level: 1 },
    })
    writePlugin(dataDir, 'other-plugin', {
      name: 'other-plugin',
      version: '0.2.0',
    })
    writeFileSync(
      join(dataDir, 'storage', 'petal', 'petals.json'),
      JSON.stringify([
        { name: 'fs-plugin', enabled: false },
        { name: 'other-plugin', enabled: true },
      ]),
      'utf8',
    )
    __setSiyuanDataDirCandidatesForTests([dataDir])

    const server = createMockServer()
    registerPluginBridgeHandlers(server as never, {
      platform: { logger: { info() {}, error() {}, warn() {}, debug() {} } },
    } as never)
    const list = server.handlers.get(RPC_CHANNELS.pluginBridge.LIST_PLUGINS)!
    const result = (await list({})) as {
      plugins: Array<{ id: string; name: string; enabled: boolean; level: number }>
      fixture?: boolean
      residual?: string
    }
    expect(result.fixture).toBeUndefined()
    expect(result.plugins).toHaveLength(2)
    const fsPlugin = result.plugins.find((p) => p.name === 'fs-plugin')
    expect(fsPlugin?.enabled).toBe(false)
    expect(fsPlugin?.level).toBe(1)
    expect(result.plugins.find((p) => p.name === 'other-plugin')?.enabled).toBe(true)
    expect(result.residual).toContain('filesystem')
  })

  it('LIST_PLUGINS prefers kernel feed when healthy client is injected', async () => {
    const client = makeKernelClient({
      '/api/system/version': () => ({ data: '3.1.28' }),
      '/api/bazaar/getInstalledPlugin': () => ({
        data: [
          {
            name: 'kernel-plugin',
            version: '9.0.0',
            craft: { level: 2 },
          },
        ],
      }),
      '/api/petal/loadPetals': () => ({
        data: [{ name: 'kernel-plugin', enabled: false }],
      }),
    })
    __setPluginBridgeKernelClientForTests(client)

    const server = createMockServer()
    registerPluginBridgeHandlers(server as never, {
      platform: { logger: { info() {}, error() {}, warn() {}, debug() {} } },
    } as never)
    const list = server.handlers.get(RPC_CHANNELS.pluginBridge.LIST_PLUGINS)!
    const result = (await list({})) as {
      plugins: Array<{ id: string; enabled: boolean; level: number }>
      residual?: string
    }
    expect(result.plugins).toHaveLength(1)
    expect(result.plugins[0]?.id).toBe('siyuan-plugin:kernel-plugin')
    expect(result.plugins[0]?.enabled).toBe(false)
    expect(result.plugins[0]?.level).toBe(2)
    expect(result.residual).toContain('kernel')
  })

  it('LIST_PLUGINS soft-falls to filesystem when kernel throws', async () => {
    dataDir = makeTempDataDir()
    writePlugin(dataDir, 'fs-only', { name: 'fs-only', version: '1.0.0' })
    __setSiyuanDataDirCandidatesForTests([dataDir])

    const client = makeKernelClient({
      '/api/system/version': () => ({ data: '3.1.28' }),
      '/api/bazaar/getInstalledPlugin': () => {
        throw new Error('kernel down mid-call')
      },
      '/api/petal/loadPetals': () => ({ data: [] }),
    })
    __setPluginBridgeKernelClientForTests(client)

    const server = createMockServer()
    registerPluginBridgeHandlers(server as never, {
      platform: { logger: { info() {}, error() {}, warn() {}, debug() {} } },
    } as never)
    const list = server.handlers.get(RPC_CHANNELS.pluginBridge.LIST_PLUGINS)!
    const result = (await list({})) as {
      plugins: Array<{ name: string }>
      residual?: string
    }
    expect(result.plugins.map((p) => p.name)).toEqual(['fs-only'])
    expect(result.residual).toContain('filesystem')
  })

  it('GET_PROJECTIONS projects fixture with granted permissions', async () => {
    setPluginBridgeFixture([
      {
        name: 'fx-plugin',
        version: '0.1.0',
        craft: {
          level: 2,
          contributes: {
            commands: [{ id: 'fx.run', title: 'Run', permissions: ['ui.command'] }],
          },
        },
      },
    ])
    const server = createMockServer()
    registerPluginBridgeHandlers(server as never, {
      platform: { logger: { info() {}, error() {}, warn() {}, debug() {} } },
    } as never)
    const get = server.handlers.get(RPC_CHANNELS.pluginBridge.GET_PROJECTIONS)!
    const denied = (await get({}, { pluginId: 'fx-plugin', grantedPermissions: [] })) as {
      commands: unknown[]
      diagnostics: Array<{ kind: string }>
    }
    expect(denied.commands).toEqual([])
    expect(denied.diagnostics.some((d) => d.kind === 'permission-denied')).toBe(true)

    const ok = (await get(
      {},
      { pluginId: 'siyuan-plugin:fx-plugin', grantedPermissions: ['ui.command'] },
    )) as { commands: Array<{ id: string; source: string }> }
    expect(ok.commands).toHaveLength(1)
    expect(ok.commands[0]).toMatchObject({ id: 'fx.run', source: 'siyuan-plugin' })
  })

  it('GET_PROJECTIONS without grants still returns L2 commands when plugin declares ui.command', async () => {
    setPluginBridgeFixture([
      {
        name: 'fx-plugin',
        version: '0.1.0',
        craft: {
          level: 2,
          contributes: {
            commands: [{ id: 'fx.run', title: 'Run', permissions: ['ui.command'] }],
          },
        },
      },
    ])
    const server = createMockServer()
    registerPluginBridgeHandlers(server as never, {
      platform: { logger: { info() {}, error() {}, warn() {}, debug() {} } },
    } as never)
    const get = server.handlers.get(RPC_CHANNELS.pluginBridge.GET_PROJECTIONS)!
    const projected = (await get({}, { pluginId: 'fx-plugin' })) as {
      commands: Array<{ id: string; source: string }>
      level: number
    }
    expect(projected.level).toBe(2)
    expect(projected.commands).toHaveLength(1)
    expect(projected.commands[0]).toMatchObject({ id: 'fx.run', source: 'siyuan-plugin' })
  })

  it('SET_ENABLED persists locally only when kernel unavailable', async () => {
    const server = createMockServer()
    registerPluginBridgeHandlers(server as never, {
      platform: { logger: { info() {}, error() {}, warn() {}, debug() {} } },
    } as never)
    const set = server.handlers.get(RPC_CHANNELS.pluginBridge.SET_ENABLED)!
    const result = (await set({}, { pluginId: 'fx-plugin', enabled: false })) as {
      pluginId: string
      enabled: boolean
      persisted: string
      residual?: string
    }
    expect(result.pluginId).toBe('siyuan-plugin:fx-plugin')
    expect(result.enabled).toBe(false)
    expect(result.persisted).toBe('local')
    expect(result.residual).toContain('kernel')
    // Multi-window UI stays in sync via extensions.CHANGED
    expect(server.pushes.some((p) => p.channel === RPC_CHANNELS.extensions.CHANGED)).toBe(true)
    expect(server.pushes.some((p) => p.args[0] && (p.args[0] as { reason?: string }).reason === 'state')).toBe(
      true,
    )
  })

  it('SET_ENABLED local then LIST shows disabled without kernel', async () => {
    setPluginBridgeFixture([
      {
        name: 'fx-plugin',
        version: '0.1.0',
        craft: { level: 2 },
      },
    ])
    const server = createMockServer()
    registerPluginBridgeHandlers(server as never, {
      platform: { logger: { info() {}, error() {}, warn() {}, debug() {} } },
    } as never)
    const set = server.handlers.get(RPC_CHANNELS.pluginBridge.SET_ENABLED)!
    const list = server.handlers.get(RPC_CHANNELS.pluginBridge.LIST_PLUGINS)!

    const setResult = (await set({}, { pluginId: 'fx-plugin', enabled: false })) as {
      persisted: string
    }
    expect(setResult.persisted).toBe('local')

    const result = (await list({})) as {
      plugins: Array<{ id: string; enabled: boolean }>
    }
    expect(result.plugins).toHaveLength(1)
    expect(result.plugins[0]?.id).toBe('siyuan-plugin:fx-plugin')
    expect(result.plugins[0]?.enabled).toBe(false)
  })

  it('SET_ENABLED calls setPetalEnabled when kernel available', async () => {
    const calls: Array<{ endpoint: string; body: Record<string, unknown> }> = []
    const client = makeKernelClient({
      '/api/system/version': () => ({ data: '3.1.28' }),
      '/api/petal/setPetalEnabled': (body) => {
        calls.push({ endpoint: '/api/petal/setPetalEnabled', body })
        return { data: null }
      },
    })
    __setPluginBridgeKernelClientForTests(client)

    const server = createMockServer()
    registerPluginBridgeHandlers(server as never, {
      platform: { logger: { info() {}, error() {}, warn() {}, debug() {} } },
    } as never)
    const set = server.handlers.get(RPC_CHANNELS.pluginBridge.SET_ENABLED)!
    const result = (await set({}, { pluginId: 'siyuan-plugin:fx-plugin', enabled: true })) as {
      persisted: string
      residual?: string
    }
    expect(result.persisted).toBe('kernel')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.body).toEqual({ packageName: 'fx-plugin', enabled: true })
  })

  it('OPEN_COMPAT returns route descriptor only', async () => {
    const server = createMockServer()
    registerPluginBridgeHandlers(server as never, {
      platform: { logger: { info() {}, error() {}, warn() {}, debug() {} } },
    } as never)
    const open = server.handlers.get(RPC_CHANNELS.pluginBridge.OPEN_COMPAT)!
    const result = (await open({}, { pluginId: 'any' })) as {
      route: string
      ref: { kind: string; id: string }
    }
    expect(result.route).toBe('knowledge/notebook/__full__')
    expect(result.ref).toEqual({ kind: 'notebook', id: '__full__' })
  })
})

describe('resolveKernelClient conf fallback + bazaar catalog merge', () => {
  let configDir: string
  let prevConfig: string | undefined
  let prevConfPaths: string | undefined
  let dataDir: string | undefined

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'craft-kernel-resolve-'))
    prevConfig = process.env.CRAFT_CONFIG_DIR
    process.env.CRAFT_CONFIG_DIR = configDir
    prevConfPaths = process.env.CRAFT_SIYUAN_CONF_PATHS
    process.env.CRAFT_SIYUAN_CONF_PATHS = join(configDir, 'missing-conf.json')
    resetPluginBridgeFixture()
    __setPluginBridgeKernelClientForTests(undefined)
    __setSiyuanDataDirCandidatesForTests([])
    dataDir = undefined
  })

  afterEach(() => {
    resetPluginBridgeFixture()
    __setPluginBridgeKernelClientForTests(undefined)
    __setSiyuanDataDirCandidatesForTests(null)
    if (prevConfig === undefined) delete process.env.CRAFT_CONFIG_DIR
    else process.env.CRAFT_CONFIG_DIR = prevConfig
    if (prevConfPaths === undefined) delete process.env.CRAFT_SIYUAN_CONF_PATHS
    else process.env.CRAFT_SIYUAN_CONF_PATHS = prevConfPaths
    rmSync(configDir, { recursive: true, force: true })
    if (dataDir) {
      rmSync(dataDir, { recursive: true, force: true })
      dataDir = undefined
    }
  })

  it('resolveKernelClient returns null without connections/conf/override', async () => {
    await expect(resolveKernelClient()).resolves.toBeNull()
  })

  it('resolveKernelClient uses conf api.token when no knowledge connections', async () => {
    const confPath = join(configDir, 'conf.json')
    writeFileSync(
      confPath,
      JSON.stringify({
        api: { token: 'conf-secret-token' },
        serverAddrs: ['http://127.0.0.1:6806'],
      }),
      'utf8',
    )
    process.env.CRAFT_SIYUAN_CONF_PATHS = confPath

    // Inject healthy client AFTER conf is read by patching via override is not the path under test.
    // Instead, install a fetchImpl-backed client through a temporary override only to prove the
    // conf-read unit separately, then exercise resolveKernelClient end-to-end with a mock fetch
    // by constructing SiyuanKernelClient ourselves after conf read (assignment: conf unit + mock probe).
    // Here we probe resolveKernelClient against a temporary HTTP mock that accepts conf token.
    const seenAuth: string[] = []
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      const endpoint = String(url).replace(/^https?:\/\/[^/]+/, '')
      const auth = String((init?.headers as Record<string, string> | undefined)?.Authorization ?? '')
      seenAuth.push(auth)
      if (endpoint === '/api/system/version') {
        return new Response(JSON.stringify({ code: 0, msg: '', data: '3.1.28' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      throw new Error(`unmocked ${endpoint}`)
    }) as unknown as typeof fetch

    // Monkey-patch global fetch only for this call so conf-built client can probe.
    const prevFetch = globalThis.fetch
    globalThis.fetch = fetchImpl
    try {
      const client = await resolveKernelClient()
      expect(client).not.toBeNull()
      expect(client!.baseUrl).toBe('http://127.0.0.1:6806')
      expect(seenAuth.some((a) => a.includes('Token conf-secret-token'))).toBe(true)
      // Never leak token into baseUrl
      expect(client!.baseUrl.includes('conf-secret-token')).toBe(false)
    } finally {
      globalThis.fetch = prevFetch
    }
  })

  it('loadBazaarRemoteManifests soft-fails empty when kernel unavailable', async () => {
    __setPluginBridgeKernelClientForTests(null)
    await expect(loadBazaarRemoteManifests()).resolves.toEqual([])
  })

  it('pluginBridgeBazaarCatalogListFn merges installed + remote; installed wins; remote keeps bazaar coords', async () => {
    setPluginBridgeFixture([
      {
        name: 'shared-plugin',
        version: '9.9.9',
        displayName: { en: 'Installed Shared' },
        craft: { level: 2, contributes: { commands: [{ id: 'c1', title: 'C1' }] } },
      },
      {
        name: 'local-only',
        version: '1.0.0',
      },
    ])

    const remoteClient = makeKernelClient({
      '/api/bazaar/getBazaarPlugin': () => ({
        data: {
          packages: [
            {
              name: 'shared-plugin',
              version: '1.0.0',
              displayName: { en: 'Remote Shared' },
              repoURL: 'https://github.com/ex/shared',
              repoHash: 'hash-shared',
            },
            {
              name: 'remote-only',
              version: '2.0.0',
              author: 'bazaar',
              repoURL: 'https://github.com/ex/remote',
              repoHash: 'hash-remote',
            },
          ],
        },
      }),
    })
    __setPluginBridgeKernelClientForTests(remoteClient)

    const installed = pluginBridgeBazaarListFn()
    expect(installed.map((m) => m.name).sort()).toEqual(['local-only', 'shared-plugin'])

    const merged = await pluginBridgeBazaarCatalogListFn()
    const names = merged
      .map((e) => (e.id.startsWith('siyuan-plugin:') ? e.id.slice('siyuan-plugin:'.length) : e.id))
      .sort()
    expect(names).toEqual(['local-only', 'remote-only', 'shared-plugin'])

    const shared = merged.find((e) => e.id === 'siyuan-plugin:shared-plugin')
    expect(shared?.version).toBe('9.9.9')
    // installed overwrites remote — bazaar coords from remote are not kept on installed win
    expect(shared?.bazaar).toBeUndefined()

    const remoteOnly = merged.find((e) => e.id === 'siyuan-plugin:remote-only')
    expect(remoteOnly?.version).toBe('2.0.0')
    expect(remoteOnly?.bazaar).toEqual({
      packageName: 'remote-only',
      repoURL: 'https://github.com/ex/remote',
      repoHash: 'hash-remote',
    })
  })

  it('INSTALL_BAZAAR calls kernel install + setPetalEnabled; fails without kernel', async () => {
    __setPluginBridgeKernelClientForTests(null)
    {
      const server = createMockServer()
      registerPluginBridgeHandlers(server as never, {
        platform: { logger: { info() {}, error() {}, warn() {}, debug() {} } },
      } as never)
      const install = server.handlers.get(RPC_CHANNELS.pluginBridge.INSTALL_BAZAAR)!
      await expect(
        install(
          {},
          {
            packageName: 'p',
            repoURL: 'https://github.com/ex/p',
            repoHash: 'abc',
          },
        ),
      ).rejects.toMatchObject({ code: 'CONNECTION_UNAVAILABLE' })
    }

    const calls: Array<{ endpoint: string; body: Record<string, unknown> }> = []
    const client = makeKernelClient({
      '/api/bazaar/installBazaarPlugin': (body) => {
        calls.push({ endpoint: '/api/bazaar/installBazaarPlugin', body })
        return { data: null }
      },
      '/api/petal/setPetalEnabled': (body) => {
        calls.push({ endpoint: '/api/petal/setPetalEnabled', body })
        return { data: null }
      },
    })
    __setPluginBridgeKernelClientForTests(client)

    const server = createMockServer()
    registerPluginBridgeHandlers(server as never, {
      platform: { logger: { info() {}, error() {}, warn() {}, debug() {} } },
    } as never)
    const install = server.handlers.get(RPC_CHANNELS.pluginBridge.INSTALL_BAZAAR)!
    const result = (await install(
      {},
      {
        packageName: 'remote-only',
        repoURL: 'https://github.com/ex/remote',
        repoHash: 'hash-remote',
      },
    )) as { packageName: string; enabled?: boolean }
    expect(result.packageName).toBe('remote-only')
    expect(result.enabled).toBe(true)
    expect(calls.map((c) => c.endpoint)).toEqual([
      '/api/bazaar/installBazaarPlugin',
      '/api/petal/setPetalEnabled',
    ])
    expect(calls[0]?.body).toEqual({
      frontend: 'desktop',
      repoURL: 'https://github.com/ex/remote',
      repoHash: 'hash-remote',
      packageName: 'remote-only',
    })
    expect(calls[1]?.body).toEqual({ packageName: 'remote-only', enabled: true })
  })

  it('INSTALL_BAZAAR strips siyuan-plugin: prefix before kernel + store id', async () => {
    const store = getExtensionStateStore(configDir)
    const calls: Array<{ endpoint: string; body: Record<string, unknown> }> = []
    const client = makeKernelClient({
      '/api/bazaar/installBazaarPlugin': (body) => {
        calls.push({ endpoint: '/api/bazaar/installBazaarPlugin', body })
        return { data: null }
      },
      '/api/petal/setPetalEnabled': (body) => {
        calls.push({ endpoint: '/api/petal/setPetalEnabled', body })
        return { data: null }
      },
    })
    __setPluginBridgeKernelClientForTests(client)

    const server = createMockServer()
    registerPluginBridgeHandlers(server as never, {
      platform: { logger: { info() {}, error() {}, warn() {}, debug() {} } },
    } as never)
    const install = server.handlers.get(RPC_CHANNELS.pluginBridge.INSTALL_BAZAAR)!
    const result = (await install(
      {},
      {
        packageName: 'siyuan-plugin:foo',
        repoURL: 'https://github.com/ex/foo',
        repoHash: 'hash-foo',
      },
    )) as { packageName: string; enabled?: boolean }

    expect(result.packageName).toBe('foo')
    expect(result.enabled).toBe(true)
    expect(calls[0]?.body).toEqual({
      frontend: 'desktop',
      repoURL: 'https://github.com/ex/foo',
      repoHash: 'hash-foo',
      packageName: 'foo',
    })
    expect(calls[1]?.body).toEqual({ packageName: 'foo', enabled: true })
    expect(store.getState().enabled['siyuan-plugin:foo']).toBe(true)
  })

  it('after INSTALL_BAZAAR, catalog listFn shows package as installed (kernel feed wins over remote)', async () => {
    const installedPkgs: Array<Record<string, unknown>> = []
    const client = makeKernelClient({
      '/api/bazaar/installBazaarPlugin': (body) => {
        installedPkgs.push({
          name: body.packageName,
          version: '1.2.3',
          enabled: true,
        })
        return { data: null }
      },
      '/api/petal/setPetalEnabled': () => ({ data: null }),
      '/api/bazaar/getInstalledPlugin': () => ({ data: installedPkgs }),
      '/api/petal/loadPetals': () => ({
        data: installedPkgs.map((p) => ({ name: p.name, enabled: true })),
      }),
      '/api/bazaar/getBazaarPlugin': () => ({
        data: {
          packages: [
            {
              name: 'fresh-plugin',
              version: '0.9.0',
              repoURL: 'https://github.com/ex/fresh',
              repoHash: 'hash-fresh',
            },
          ],
        },
      }),
    })
    __setPluginBridgeKernelClientForTests(client)

    // Before install: remote-only in catalog, not in installed kernel feed
    const before = await pluginBridgeBazaarCatalogListFn()
    const beforeEntry = before.find((e) => e.id === 'siyuan-plugin:fresh-plugin')
    expect(beforeEntry?.version).toBe('0.9.0')
    expect(beforeEntry?.bazaar).toEqual({
      packageName: 'fresh-plugin',
      repoURL: 'https://github.com/ex/fresh',
      repoHash: 'hash-fresh',
    })

    const server = createMockServer()
    registerPluginBridgeHandlers(server as never, {
      platform: { logger: { info() {}, error() {}, warn() {}, debug() {} } },
    } as never)
    const install = server.handlers.get(RPC_CHANNELS.pluginBridge.INSTALL_BAZAAR)!
    await install(
      {},
      {
        packageName: 'fresh-plugin',
        repoURL: 'https://github.com/ex/fresh',
        repoHash: 'hash-fresh',
      },
    )

    // After install: kernel installed feed wins — no bazaar coords (Install UI disappears)
    const after = await pluginBridgeBazaarCatalogListFn()
    const afterEntry = after.find((e) => e.id === 'siyuan-plugin:fresh-plugin')
    expect(afterEntry).toBeTruthy()
    expect(afterEntry?.version).toBe('1.2.3')
    expect(afterEntry?.bazaar).toBeUndefined()
  })

  it('UNINSTALL_BAZAAR calls kernel uninstall and clears ExtensionStateStore', async () => {
    const store = getExtensionStateStore(configDir)
    store.setEnabled('siyuan-plugin:gone-plugin', true)
    expect(store.getState().enabled['siyuan-plugin:gone-plugin']).toBe(true)

    const calls: Array<{ endpoint: string; body: Record<string, unknown> }> = []
    const client = makeKernelClient({
      '/api/bazaar/uninstallBazaarPlugin': (body) => {
        calls.push({ endpoint: '/api/bazaar/uninstallBazaarPlugin', body })
        return { data: null }
      },
    })
    __setPluginBridgeKernelClientForTests(client)

    const server = createMockServer()
    registerPluginBridgeHandlers(server as never, {
      platform: { logger: { info() {}, error() {}, warn() {}, debug() {} } },
    } as never)
    const uninstall = server.handlers.get(RPC_CHANNELS.pluginBridge.UNINSTALL_BAZAAR)!
    const result = (await uninstall({}, { packageName: 'siyuan-plugin:gone-plugin' })) as {
      packageName: string
    }
    expect(result.packageName).toBe('gone-plugin')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.body).toEqual({ packageName: 'gone-plugin' })
    expect(store.getState().enabled['siyuan-plugin:gone-plugin']).toBeUndefined()
  })

  it('LIST_PLUGINS enriches thin kernel packages from filesystem plugin.json', async () => {
    dataDir = makeTempDataDir()
    writePlugin(dataDir, 'thin-kernel', {
      name: 'thin-kernel',
      version: '3.0.0',
      displayName: { en: 'Full FS Name' },
      description: { en: 'From disk' },
      author: 'fs-author',
      backends: ['all'],
      frontends: ['desktop'],
      craft: {
        level: 2,
        contributes: { commands: [{ id: 'cmd.fs', title: 'FS Cmd' }] },
      },
    })
    __setSiyuanDataDirCandidatesForTests([dataDir])

    const client = makeKernelClient({
      '/api/system/version': () => ({ data: '3.1.28' }),
      '/api/bazaar/getInstalledPlugin': () => ({
        data: [{ name: 'thin-kernel', version: '3.0.0', enabled: true }],
      }),
      '/api/petal/loadPetals': () => ({
        data: [{ name: 'thin-kernel', enabled: true }],
      }),
    })
    __setPluginBridgeKernelClientForTests(client)

    const server = createMockServer()
    registerPluginBridgeHandlers(server as never, {
      platform: { logger: { info() {}, error() {}, warn() {}, debug() {} } },
    } as never)
    const list = server.handlers.get(RPC_CHANNELS.pluginBridge.LIST_PLUGINS)!
    const result = (await list({})) as {
      plugins: Array<{ name: string; level: number; displayName?: string }>
    }
    const hit = result.plugins.find((p) => p.name === 'thin-kernel')
    expect(hit).toBeTruthy()
    // craft block from FS → L2
    expect(hit?.level).toBe(2)
    expect(hit?.displayName).toBe('Full FS Name')
  })
})
