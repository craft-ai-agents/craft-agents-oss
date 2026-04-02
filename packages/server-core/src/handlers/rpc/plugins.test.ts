import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RequestContext, HandlerFn, RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { PluginHost } from '../../plugins'
import { registerPluginsHandlers } from './plugins'

function createManifest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'craft.anthropic',
    name: 'Anthropic Backend',
    version: '0.8.1',
    apiVersion: '1.0.0',
    description: 'Built-in Anthropic backend',
    engines: { craftAgents: '*' },
    permissions: ['session.read', 'session.write'],
    contributions: {
      backends: ['anthropic'],
      sessionActions: ['handoff-to-anthropic'],
    },
    ...overrides,
  }
}

function createMockServer() {
  const handlers = new Map<string, HandlerFn>()

  const server: RpcServer = {
    handle(channel, handler) {
      handlers.set(channel, handler)
    },
    push() {},
    async invokeClient() {},
  }

  return { server, handlers }
}

async function createPluginHost(root: string) {
  const pluginDirectory = join(root, 'plugins')
  await mkdir(join(pluginDirectory, 'external-tooling'), { recursive: true })
  await writeFile(join(pluginDirectory, 'external-tooling', 'plugin.json'), JSON.stringify(createManifest({
    id: 'external.tooling',
    name: 'External Tooling',
    contributions: {
      composerActions: ['tooling-compose'],
    },
  })))

  const pluginHost = new PluginHost({
    appVersion: '0.8.1',
    pluginDirectory,
    pluginStatePath: join(root, 'plugin-state.json'),
  })
  await pluginHost.initialize()
  pluginHost.registerBuiltInPlugin(createManifest() as any)
  await pluginHost.loadExternalPlugins()
  return pluginHost
}

let tempRoot = ''

beforeEach(async () => {
  tempRoot = join(tmpdir(), `plugins-rpc-test-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  await mkdir(tempRoot, { recursive: true })
})

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

describe('registerPluginsHandlers', () => {
  it('registers plugin RPC handlers and proxies host state changes', async () => {
    const pluginHost = await createPluginHost(tempRoot)
    const { server, handlers } = createMockServer()

    const deps: HandlerDeps = {
      sessionManager: {} as HandlerDeps['sessionManager'],
      oauthFlowStore: {} as HandlerDeps['oauthFlowStore'],
      platform: {
        appRootPath: '/',
        resourcesPath: '/',
        isPackaged: false,
        appVersion: '0.0.0-test',
        isDebugMode: true,
        logger: console,
        imageProcessor: {
          getMetadata: async () => null,
          process: async () => Buffer.from(''),
        },
      },
      pluginHost,
    }

    registerPluginsHandlers(server, deps)

    const ctx: RequestContext = {
      clientId: 'client-1',
      workspaceId: 'ws-1',
      webContentsId: 101,
    }

    const list = handlers.get(RPC_CHANNELS.plugins.LIST)
    const get = handlers.get(RPC_CHANNELS.plugins.GET)
    const disable = handlers.get(RPC_CHANNELS.plugins.DISABLE)
    const enable = handlers.get(RPC_CHANNELS.plugins.ENABLE)
    const listCapabilities = handlers.get(RPC_CHANNELS.plugins.LIST_CAPABILITIES)

    expect(list).toBeDefined()
    expect(get).toBeDefined()
    expect(disable).toBeDefined()
    expect(enable).toBeDefined()
    expect(listCapabilities).toBeDefined()

    await expect(list?.(ctx)).resolves.toEqual({
      plugins: expect.arrayContaining([
        expect.objectContaining({ id: 'craft.anthropic', enabled: true }),
        expect.objectContaining({ id: 'external.tooling', enabled: false }),
      ]),
    })
    await expect(get?.(ctx, 'craft.anthropic')).resolves.toEqual({
      plugin: expect.objectContaining({ id: 'craft.anthropic', status: 'active' }),
    })
    await expect(listCapabilities?.(ctx)).resolves.toEqual({
      capabilities: [
        { pluginId: 'craft.anthropic', id: 'anthropic', type: 'backend' },
        { pluginId: 'craft.anthropic', id: 'handoff-to-anthropic', type: 'sessionAction' },
      ],
    })

    await expect(disable?.(ctx, 'external.tooling')).resolves.toEqual({
      plugin: expect.objectContaining({ id: 'external.tooling', enabled: false, status: 'disabled' }),
    })
    await expect(listCapabilities?.(ctx)).resolves.toEqual({
      capabilities: [
        { pluginId: 'craft.anthropic', id: 'anthropic', type: 'backend' },
        { pluginId: 'craft.anthropic', id: 'handoff-to-anthropic', type: 'sessionAction' },
      ],
    })

    await expect(enable?.(ctx, 'external.tooling')).resolves.toEqual({
      plugin: expect.objectContaining({ id: 'external.tooling', enabled: true, status: 'active' }),
    })
    await expect(listCapabilities?.(ctx)).resolves.toEqual({
      capabilities: expect.arrayContaining([
        { pluginId: 'craft.anthropic', id: 'anthropic', type: 'backend' },
        { pluginId: 'craft.anthropic', id: 'handoff-to-anthropic', type: 'sessionAction' },
        { pluginId: 'external.tooling', id: 'tooling-compose', type: 'composerAction' },
      ]),
    })
  })
})
