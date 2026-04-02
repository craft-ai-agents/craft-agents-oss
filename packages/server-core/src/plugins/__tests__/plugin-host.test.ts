import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { bootstrapPluginHost } from '../bootstrap'
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

function createPluginHost() {
  return new PluginHost({
    appVersion: '0.8.1',
    pluginDirectory: join(tempRoot, 'plugins'),
    pluginStatePath: join(tempRoot, 'plugin-state.json'),
  })
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
    const host = createPluginHost()
    await host.initialize()

    const plugin = host.registerBuiltInPlugin(createManifest() as any)

    expect(plugin.enabled).toBe(true)
    expect(host.listCapabilities('backend').map((item) => item.id)).toEqual(['codex-backend'])
    expect(host.listSessionActions().map((item) => item.id)).toEqual(['handoff-to-codex'])
    expect(host.listRoutes().map((item) => item.id)).toEqual(['codex-page'])
  })

  it('rejects duplicate registration', async () => {
    const host = createPluginHost()
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

  it('does not honor persisted disabled state for built-in plugins', async () => {
    const pluginStatePath = join(tempRoot, 'plugin-state.json')
    await writePluginState({
      plugins: {
        'codex-cli': { enabled: false, status: 'disabled' },
      },
    }, pluginStatePath)

    const host = new PluginHost({
      appVersion: '0.8.1',
      pluginDirectory: join(tempRoot, 'plugins'),
      pluginStatePath,
    })
    await host.initialize()

    const plugin = host.registerBuiltInPlugin(createManifest() as any)

    expect(plugin.enabled).toBe(true)
    expect(plugin.status).toBe('active')
  })

  it('removes quarantined plugin capabilities from active lookups', async () => {
    const host = createPluginHost()
    await host.initialize()
    host.registerBuiltInPlugin(createManifest() as any)

    const updated = await host.quarantinePlugin('codex-cli', 'boom')

    expect(updated.enabled).toBe(false)
    expect(updated.status).toBe('quarantined')
    expect(updated.error).toBe('boom')
    expect(host.listCapabilities('backend')).toHaveLength(0)
  })

  it('removes disabled plugin capabilities from active lookups', async () => {
    const pluginDirectory = join(tempRoot, 'plugins')
    await mkdir(join(pluginDirectory, 'codex-cli'), { recursive: true })
    await writeFile(join(pluginDirectory, 'codex-cli', 'plugin.json'), JSON.stringify(createManifest()))

    const host = new PluginHost({
      appVersion: '0.8.1',
      pluginDirectory,
      pluginStatePath: join(tempRoot, 'plugin-state.json'),
    })
    await host.initialize()
    await host.loadExternalPlugins()

    await host.disablePlugin('codex-cli')

    expect(host.listCapabilities('backend')).toHaveLength(0)
  })

  it('rejects disabling built-in plugins until runtime gating is implemented', async () => {
    const host = createPluginHost()
    await host.initialize()
    host.registerBuiltInPlugin(createManifest() as any)

    await expect(host.disablePlugin('codex-cli')).rejects.toThrow('Cannot disable built-in plugin: codex-cli')
    expect(host.getPlugin('codex-cli')?.enabled).toBe(true)
    expect(host.getPlugin('codex-cli')?.status).toBe('active')
  })

  it('marks incompatible plugins disabled during registration', async () => {
    const host = createPluginHost()
    await host.initialize()

    const plugin = host.registerBuiltInPlugin(createManifest({
      apiVersion: '2.0.0',
    }) as any)

    expect(plugin.enabled).toBe(false)
    expect(plugin.compatible).toBe(false)
    expect(plugin.status).toBe('incompatible')
    expect(host.listCapabilities('backend')).toHaveLength(0)
  })

  it('rejects enabling incompatible plugins', async () => {
    const host = createPluginHost()
    await host.initialize()
    host.registerBuiltInPlugin(createManifest({
      apiVersion: '1.9.0',
    }) as any)

    await expect(host.enablePlugin('codex-cli')).rejects.toThrow('Cannot enable incompatible plugin: codex-cli')
    expect(host.getPlugin('codex-cli')?.status).toBe('incompatible')
    expect(host.getPlugin('codex-cli')?.enabled).toBe(false)
  })

  it('allows quarantined plugins to recover through enablePlugin', async () => {
    const host = createPluginHost()
    await host.initialize()
    host.registerBuiltInPlugin(createManifest() as any)
    await host.quarantinePlugin('codex-cli', 'boom')

    const recovered = await host.enablePlugin('codex-cli')

    expect(recovered.status).toBe('active')
    expect(recovered.enabled).toBe(true)
    expect(recovered.error).toBeUndefined()
    expect(host.listCapabilities('backend').map((item) => item.id)).toEqual(['codex-backend'])
  })

  it('loads valid external plugins even when a neighbor manifest is broken', async () => {
    const pluginDirectory = join(tempRoot, 'plugins')
    await mkdir(join(pluginDirectory, 'codex-cli'), { recursive: true })
    await writeFile(join(pluginDirectory, 'codex-cli', 'plugin.json'), JSON.stringify(createManifest()))
    await mkdir(join(pluginDirectory, 'broken-plugin'), { recursive: true })
    await writeFile(join(pluginDirectory, 'broken-plugin', 'plugin.json'), '{ not-json')

    const host = new PluginHost({
      appVersion: '0.8.1',
      pluginDirectory,
      pluginStatePath: join(tempRoot, 'plugin-state.json'),
    })
    await host.initialize()

    const plugins = await host.loadExternalPlugins()

    expect(plugins).toHaveLength(1)
    expect(plugins[0]?.id).toBe('codex-cli')
    expect(host.listPlugins().map((plugin) => plugin.id)).toEqual(['codex-cli'])
    expect(host.listLoadFailures()).toHaveLength(1)
    expect(host.listLoadFailures()[0]?.pluginPath).toContain('broken-plugin/plugin.json')
  })

  it('bootstraps built-in and external plugins together', async () => {
    const pluginDirectory = join(tempRoot, 'plugins')
    await mkdir(join(pluginDirectory, 'codex-cli'), { recursive: true })
    await writeFile(join(pluginDirectory, 'codex-cli', 'plugin.json'), JSON.stringify(createManifest({
      id: 'external.codex-cli',
      name: 'External Codex CLI',
      contributions: { backends: ['codex-backend'] },
    })))

    const warnings: string[] = []
    const host = await bootstrapPluginHost({
      appVersion: '0.8.1',
      pluginDirectory,
      pluginStatePath: join(tempRoot, 'plugin-state.json'),
      builtInManifests: [createManifest({
        id: 'craft.anthropic',
        name: 'Anthropic Backend',
        contributions: { backends: ['anthropic'] },
      }) as any],
      logger: { warn: (message: string) => warnings.push(message) },
    })

    expect(host.listPlugins().map((plugin) => plugin.id).sort()).toEqual(['craft.anthropic', 'external.codex-cli'])
    expect(host.listCapabilities('backend').map((capability) => capability.id).sort()).toEqual(['anthropic'])
    expect(warnings).toEqual([])
  })
})
