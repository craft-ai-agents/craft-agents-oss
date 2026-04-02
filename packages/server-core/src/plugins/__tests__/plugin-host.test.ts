import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PluginHost } from '../host'
import {
  getDefaultPluginDirectory,
  getDefaultPluginStatePath,
  readPluginState,
  writePluginState,
} from '../storage'

function createManifest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'codex-cli',
    name: 'Codex CLI',
    version: '1.0.0',
    apiVersion: '1.0.0',
    engines: { craftAgents: '^0.8.1' },
    permissions: ['network', 'session.read'],
    contributions: {
      backends: ['codex-backend'],
      sessionActions: ['handoff-to-codex'],
      routes: ['codex-page'],
    },
    ...overrides,
  }
}

let tempRoot = ''

beforeEach(async () => {
  tempRoot = join(tmpdir(), `plugin-host-test-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  await mkdir(tempRoot, { recursive: true })
})

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

describe('plugin storage helpers', () => {
  it('returns default plugin paths under ~/.craft-agent', () => {
    expect(getDefaultPluginDirectory()).toContain('.craft-agent/plugins')
    expect(getDefaultPluginStatePath()).toContain('.craft-agent/plugin-state.json')
  })

  it('round-trips plugin state JSON', async () => {
    const statePath = join(tempRoot, 'plugin-state.json')
    await writePluginState({ plugins: { foo: { enabled: true, status: 'active' } } }, statePath)
    await expect(readPluginState(statePath)).resolves.toEqual({
      plugins: {
        foo: { enabled: true, status: 'active' },
      },
    })
  })
})

describe('PluginHost', () => {
  it('registers built-in plugins and indexes capabilities', async () => {
    const host = new PluginHost({
      appVersion: '0.8.1',
      pluginDirectory: join(tempRoot, 'plugins'),
      pluginStatePath: join(tempRoot, 'plugin-state.json'),
    })
    await host.initialize()

    const plugin = host.registerBuiltInPlugin(createManifest() as any)

    expect(plugin.enabled).toBe(true)
    expect(host.listCapabilities('backend').map((item) => item.id)).toEqual(['codex-backend'])
    expect(host.listSessionActions().map((item) => item.id)).toEqual(['handoff-to-codex'])
    expect(host.listRoutes().map((item) => item.id)).toEqual(['codex-page'])
  })

  it('rejects duplicate registration', async () => {
    const host = new PluginHost({
      appVersion: '0.8.1',
      pluginDirectory: join(tempRoot, 'plugins'),
      pluginStatePath: join(tempRoot, 'plugin-state.json'),
    })
    await host.initialize()

    host.registerBuiltInPlugin(createManifest() as any)
    expect(() => host.registerBuiltInPlugin(createManifest() as any)).toThrow('Plugin already registered: codex-cli')
  })

  it('restores disabled external plugin state from storage', async () => {
    const pluginDirectory = join(tempRoot, 'plugins')
    const pluginStatePath = join(tempRoot, 'plugin-state.json')
    await mkdir(join(pluginDirectory, 'codex-cli'), { recursive: true })
    await writeFile(join(pluginDirectory, 'codex-cli', 'plugin.json'), JSON.stringify(createManifest()))
    await writePluginState({
      plugins: {
        'codex-cli': { enabled: false, status: 'disabled' },
      },
    }, pluginStatePath)

    const host = new PluginHost({
      appVersion: '0.8.1',
      pluginDirectory,
      pluginStatePath,
    })
    await host.initialize()
    const plugins = await host.loadExternalPlugins()

    expect(plugins).toHaveLength(1)
    expect(plugins[0]?.enabled).toBe(false)
    expect(plugins[0]?.status).toBe('disabled')
  })

  it('quarantines a plugin without removing its capability record', async () => {
    const host = new PluginHost({
      appVersion: '0.8.1',
      pluginDirectory: join(tempRoot, 'plugins'),
      pluginStatePath: join(tempRoot, 'plugin-state.json'),
    })
    await host.initialize()
    host.registerBuiltInPlugin(createManifest() as any)

    const updated = await host.quarantinePlugin('codex-cli', 'boom')

    expect(updated.enabled).toBe(false)
    expect(updated.status).toBe('quarantined')
    expect(updated.error).toBe('boom')
    expect(host.listCapabilities('backend')).toHaveLength(1)
  })

  it('marks incompatible plugins disabled during registration', async () => {
    const host = new PluginHost({
      appVersion: '0.8.1',
      pluginDirectory: join(tempRoot, 'plugins'),
      pluginStatePath: join(tempRoot, 'plugin-state.json'),
    })
    await host.initialize()

    const plugin = host.registerBuiltInPlugin(createManifest({
      apiVersion: '2.0.0',
    }) as any)

    expect(plugin.enabled).toBe(false)
    expect(plugin.compatible).toBe(false)
    expect(plugin.status).toBe('incompatible')
  })
})
