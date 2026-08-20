import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { resetExtensionStateStoreCache } from '@craft-agent/shared/extensions'
import { SiyuanKernelClient } from '@craft-agent/core/knowledge/providers/siyuan'
import { HANDLED_CHANNELS, registerExtensionsHandlers } from '../extensions'
import {
  resetPluginBridgeFixture,
  __setPluginBridgeKernelClientForTests,
} from '../plugin-bridge'
import { __setSiyuanDataDirCandidatesForTests } from '../../../knowledge/siyuan-plugins-fs'

type Handler = (ctx: unknown, ...args: unknown[]) => unknown | Promise<unknown>

function createMockServer() {
  const handlers = new Map<string, Handler>()
  return {
    handlers,
    handle(channel: string, fn: Handler) {
      handlers.set(channel, fn)
    },
    push() {},
  }
}

describe('extensions RPC', () => {
  let dir: string
  let prev: string | undefined
  let prevConfPaths: string | undefined

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ext-rpc-'))
    prev = process.env.CRAFT_CONFIG_DIR
    process.env.CRAFT_CONFIG_DIR = dir
    // Avoid real SiYuan conf token fallback probing during catalog list.
    prevConfPaths = process.env.CRAFT_SIYUAN_CONF_PATHS
    process.env.CRAFT_SIYUAN_CONF_PATHS = join(dir, 'no-conf.json')
    resetExtensionStateStoreCache()
    resetPluginBridgeFixture()
    __setPluginBridgeKernelClientForTests(null)
    __setSiyuanDataDirCandidatesForTests([])
    // Minimal marketplace cache so catalog load does not hit network hard-fail.
    const mp = join(dir, 'marketplace')
    mkdirSync(mp, { recursive: true })
    writeFileSync(
      join(mp, 'catalog.cache.json'),
      JSON.stringify({
        fetchedAt: Date.now(),
        catalog: {
          catalogVersion: 1,
          entries: [
            {
              id: 'demo-pack',
              kind: 'skillpack',
              title: 'Demo Pack',
              descriptionRu: 'demo',
              source: {
                type: 'github',
                repo: 'acme/demo',
                ref: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              },
              skills: ['a'],
              expectedContentSha256: {
                a: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
              },
            },
          ],
        },
      }),
      'utf8',
    )
    writeFileSync(
      join(mp, 'lock.json'),
      JSON.stringify({
        version: 1,
        entries: {
          'demo-pack': {
            id: 'demo-pack',
            kind: 'skillpack',
            repo: 'acme/demo',
            ref: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            installedAt: Date.now(),
            status: 'installed',
            targets: [join(dir, 'skills', 'a')],
          },
        },
      }),
      'utf8',
    )
  })

  afterEach(() => {
    resetExtensionStateStoreCache()
    resetPluginBridgeFixture()
    __setPluginBridgeKernelClientForTests(undefined)
    __setSiyuanDataDirCandidatesForTests(null)
    if (prev === undefined) delete process.env.CRAFT_CONFIG_DIR
    else process.env.CRAFT_CONFIG_DIR = prev
    if (prevConfPaths === undefined) delete process.env.CRAFT_SIYUAN_CONF_PATHS
    else process.env.CRAFT_SIYUAN_CONF_PATHS = prevConfPaths
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it('registers expected channels', () => {
    const server = createMockServer()
    registerExtensionsHandlers(server as never, {
      platform: { logger: { info() {}, error() {}, warn() {}, debug() {} } },
    } as never)
    expect(HANDLED_CHANNELS).toEqual([
      RPC_CHANNELS.extensions.LIST_CATALOG,
      RPC_CHANNELS.extensions.LIST_INSTALLED,
      RPC_CHANNELS.extensions.SET_ENABLED,
      RPC_CHANNELS.extensions.GET_STATE,
    ])
    for (const ch of HANDLED_CHANNELS) {
      expect(server.handlers.has(ch)).toBe(true)
    }
  })

  it('listCatalog includes craft-curated entries and siyuan stub provider', async () => {
    const server = createMockServer()
    registerExtensionsHandlers(server as never, {
      platform: { logger: { info() {}, error() {}, warn() {}, debug() {} } },
    } as never)
    const list = server.handlers.get(RPC_CHANNELS.extensions.LIST_CATALOG)!
    const result = (await list({}, {})) as {
      entries: Array<{ id: string; runtime: string }>
      providers: Array<{ id: string }>
    }
    expect(result.providers.map((p) => p.id).sort()).toEqual(['craft-curated', 'siyuan-bazaar'])
    expect(result.entries.some((e) => e.id === 'marketplace:demo-pack')).toBe(true)
    expect(result.entries.find((e) => e.id === 'marketplace:demo-pack')?.runtime).toBe('skill-pack')
  })

  it('listInstalled projects marketplace lock + setEnabled persists', async () => {
    const server = createMockServer()
    registerExtensionsHandlers(server as never, {
      platform: { logger: { info() {}, error() {}, warn() {}, debug() {} } },
    } as never)
    const listInstalled = server.handlers.get(RPC_CHANNELS.extensions.LIST_INSTALLED)!
    const setEnabled = server.handlers.get(RPC_CHANNELS.extensions.SET_ENABLED)!
    const getState = server.handlers.get(RPC_CHANNELS.extensions.GET_STATE)!

    const before = (await listInstalled({}, {})) as {
      records: Array<{ id: string; status: string }>
    }
    expect(before.records.some((r) => r.id === 'marketplace:demo-pack')).toBe(true)
    expect(before.records.find((r) => r.id === 'marketplace:demo-pack')?.status).toBe('enabled')

    await setEnabled({}, { id: 'marketplace:demo-pack', enabled: false })
    const state = (await getState({})) as { state: { enabled: Record<string, boolean> } }
    expect(state.state.enabled['marketplace:demo-pack']).toBe(false)

    const after = (await listInstalled({}, {})) as {
      records: Array<{ id: string; status: string }>
    }
    expect(after.records.find((r) => r.id === 'marketplace:demo-pack')?.status).toBe('disabled')
  })

  it('listInstalled projects siyuan-plugin from kernel-aware feed after mock install', async () => {
    type HandlerResult = { data?: unknown; code?: number; msg?: string }
    type FetchHandler = (body: Record<string, unknown>) => HandlerResult
    const installedPkgs: Array<Record<string, unknown>> = []
    const handlers: Record<string, FetchHandler> = {
      '/api/bazaar/getInstalledPlugin': () => ({ data: installedPkgs }),
      '/api/petal/loadPetals': () => ({
        data: installedPkgs.map((p) => ({ name: p.name, enabled: true })),
      }),
      '/api/bazaar/getBazaarPlugin': () => ({ data: { packages: [] } }),
    }
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      const endpoint = String(url).replace(/^https?:\/\/[^/]+/, '')
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      const handler = handlers[endpoint]
      if (!handler) throw new Error(`unmocked kernel endpoint: ${endpoint}`)
      const result = handler(body)
      return new Response(
        JSON.stringify({ code: result.code ?? 0, msg: result.msg ?? '', data: result.data }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }) as unknown as typeof fetch
    const client = new SiyuanKernelClient({
      baseUrl: 'http://127.0.0.1:6806',
      token: 'tok',
      fetchImpl,
    })
    __setPluginBridgeKernelClientForTests(client)

    const server = createMockServer()
    registerExtensionsHandlers(server as never, {
      platform: { logger: { info() {}, error() {}, warn() {}, debug() {} } },
    } as never)
    const listInstalled = server.handlers.get(RPC_CHANNELS.extensions.LIST_INSTALLED)!
    const listCatalog = server.handlers.get(RPC_CHANNELS.extensions.LIST_CATALOG)!

    const empty = (await listInstalled({}, {})) as {
      records: Array<{ id: string }>
    }
    expect(empty.records.some((r) => r.id.startsWith('siyuan-plugin:'))).toBe(false)

    // Simulate kernel install completing
    installedPkgs.push({ name: 'fresh-plugin', version: '1.2.3', enabled: true })

    const after = (await listInstalled({}, {})) as {
      records: Array<{ id: string; status: string; manifest: { name: string } }>
    }
    const hit = after.records.find((r) => r.id === 'siyuan-plugin:fresh-plugin')
    expect(hit).toBeTruthy()
    expect(hit?.manifest.name).toBe('fresh-plugin')
    expect(hit?.status).toBe('enabled')

    const catalog = (await listCatalog({}, {})) as {
      entries: Array<{ id: string; bazaar?: unknown }>
    }
    const catHit = catalog.entries.find((e) => e.id === 'siyuan-plugin:fresh-plugin')
    expect(catHit).toBeTruthy()
    // Installed half of catalog has no bazaar coords (Install button gone)
    expect(catHit?.bazaar).toBeUndefined()
  })
})
