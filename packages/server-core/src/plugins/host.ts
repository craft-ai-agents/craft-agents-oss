import type {
  CraftPluginManifest,
  PluginCapabilityRef,
  PluginCapabilityType,
  PluginDetails,
  PluginSource,
} from '@craft-agent/shared/plugins'
import {
  isPluginApiVersionSupported,
  isPluginEngineSatisfied,
} from '@craft-agent/shared/plugins'
import { CapabilityRegistry } from './registry'
import {
  type PluginStateEntry,
  type PluginStateStore,
  getDefaultPluginDirectory,
  getDefaultPluginStatePath,
  readPluginState,
  writePluginState,
} from './storage'
import { type PluginManifestLoadFailure, loadPluginManifestsFromDirectory } from './loader'

export const PLUGIN_API_VERSION = '1.0.0'

interface PluginHostOptions {
  appVersion: string
  pluginApiVersion?: string
  pluginDirectory?: string
  pluginStatePath?: string
}

export class PluginHost {
  private readonly registry = new CapabilityRegistry()
  private readonly appVersion: string
  private readonly pluginApiVersion: string
  private readonly pluginDirectory: string
  private readonly pluginStatePath: string
  private readonly builtInPluginIds = new Set<string>()
  private state: PluginStateStore = { plugins: {} }
  private loadFailures: PluginManifestLoadFailure[] = []

  constructor(options: PluginHostOptions) {
    this.appVersion = options.appVersion
    this.pluginApiVersion = options.pluginApiVersion ?? PLUGIN_API_VERSION
    this.pluginDirectory = options.pluginDirectory ?? getDefaultPluginDirectory()
    this.pluginStatePath = options.pluginStatePath ?? getDefaultPluginStatePath()
  }

  async initialize(): Promise<void> {
    this.state = await readPluginState(this.pluginStatePath)
  }

  registerBuiltInPlugin(manifest: CraftPluginManifest): PluginDetails {
    this.builtInPluginIds.add(manifest.id)
    return this.registerManifest(
      manifest,
      { enabled: true, status: 'active' },
      { respectPersistedState: false, source: 'built-in' },
    )
  }

  async loadExternalPlugins(): Promise<PluginDetails[]> {
    const { manifests, failures } = await loadPluginManifestsFromDirectory(this.pluginDirectory)
    this.loadFailures = failures
    return manifests.map((manifest) => this.registerManifest(manifest))
  }

  listLoadFailures(): PluginManifestLoadFailure[] {
    return [...this.loadFailures]
  }

  listPlugins(): PluginDetails[] {
    return this.registry.listPlugins()
  }

  getPlugin(pluginId: string): PluginDetails | undefined {
    return this.registry.getPlugin(pluginId)
  }

  listCapabilities(type?: PluginCapabilityType): PluginCapabilityRef[] {
    return this.registry.listCapabilities(type, true)
  }

  listRoutes(): PluginCapabilityRef[] {
    return this.listCapabilities('routePage')
  }

  listSettingsPanes(): PluginCapabilityRef[] {
    return this.listCapabilities('settingsPane')
  }

  listSessionActions(): PluginCapabilityRef[] {
    return this.listCapabilities('sessionAction')
  }

  listComposerActions(): PluginCapabilityRef[] {
    return this.listCapabilities('composerAction')
  }

  listChatCardTypes(): PluginCapabilityRef[] {
    return this.listCapabilities('chatCardType')
  }

  async enablePlugin(pluginId: string): Promise<PluginDetails> {
    const current = this.registry.getPlugin(pluginId)
    if (!current) {
      throw new Error(`Unknown plugin: ${pluginId}`)
    }
    if (!current.compatible) {
      throw new Error(`Cannot enable incompatible plugin: ${pluginId}`)
    }
    const plugin = this.registry.updatePlugin(pluginId, {
      enabled: true,
      status: 'active',
      error: undefined,
    })
    await this.writeState(pluginId, { enabled: true, status: 'active', error: undefined })
    return plugin
  }

  async disablePlugin(pluginId: string): Promise<PluginDetails> {
    if (this.builtInPluginIds.has(pluginId)) {
      throw new Error(`Cannot disable built-in plugin: ${pluginId}`)
    }
    const plugin = this.registry.updatePlugin(pluginId, {
      enabled: false,
      status: 'disabled',
    })
    await this.writeState(pluginId, { enabled: false, status: 'disabled' })
    return plugin
  }

  async quarantinePlugin(pluginId: string, error: string): Promise<PluginDetails> {
    const plugin = this.registry.updatePlugin(pluginId, {
      enabled: false,
      status: 'quarantined',
      error,
    })
    await this.writeState(pluginId, {
      enabled: false,
      status: 'quarantined',
      error,
    })
    return plugin
  }

  private registerManifest(
    manifest: CraftPluginManifest,
    defaults?: PluginStateEntry,
    options?: { respectPersistedState?: boolean; source?: PluginSource },
  ): PluginDetails {
    const state = options?.respectPersistedState === false
      ? {}
      : (this.state.plugins[manifest.id] ?? {})
    const source = options?.source ?? 'external'
    const compatible = isPluginApiVersionSupported(manifest.apiVersion, this.pluginApiVersion)
      && isPluginEngineSatisfied(manifest, this.appVersion)

    const enabled = state.enabled ?? defaults?.enabled ?? false
    const status = compatible
      ? (state.status ?? defaults?.status ?? (enabled ? 'active' : 'disabled'))
      : 'incompatible'

    return this.registry.registerManifest(manifest, {
      enabled: compatible ? enabled : false,
      compatible,
      source,
      status,
      error: state.error ?? defaults?.error,
    })
  }

  private async writeState(pluginId: string, entry: PluginStateEntry): Promise<void> {
    this.state = {
      plugins: {
        ...this.state.plugins,
        [pluginId]: entry,
      },
    }
    await writePluginState(this.state, this.pluginStatePath)
  }
}
