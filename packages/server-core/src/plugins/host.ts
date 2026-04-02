import type {
  CraftPluginManifest,
  PluginCapabilityRef,
  PluginCapabilityType,
  PluginDetails,
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
import { loadPluginManifestsFromDirectory } from './loader'

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
  private state: PluginStateStore = { plugins: {} }

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
    return this.registerManifest(manifest, { enabled: true })
  }

  async loadExternalPlugins(): Promise<PluginDetails[]> {
    const manifests = await loadPluginManifestsFromDirectory(this.pluginDirectory)
    return manifests.map((manifest) => this.registerManifest(manifest))
  }

  listPlugins(): PluginDetails[] {
    return this.registry.listPlugins()
  }

  getPlugin(pluginId: string): PluginDetails | undefined {
    return this.registry.getPlugin(pluginId)
  }

  listCapabilities(type?: PluginCapabilityType): PluginCapabilityRef[] {
    return this.registry.listCapabilities(type)
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
    const plugin = this.registry.updatePlugin(pluginId, {
      enabled: true,
      status: 'active',
      error: undefined,
    })
    await this.writeState(pluginId, { enabled: true, status: 'active', error: undefined })
    return plugin
  }

  async disablePlugin(pluginId: string): Promise<PluginDetails> {
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
  ): PluginDetails {
    const state = this.state.plugins[manifest.id] ?? {}
    const compatible = isPluginApiVersionSupported(manifest.apiVersion, this.pluginApiVersion)
      && isPluginEngineSatisfied(manifest, this.appVersion)

    const enabled = state.enabled ?? defaults?.enabled ?? false
    const status = compatible
      ? (state.status ?? defaults?.status ?? (enabled ? 'active' : 'disabled'))
      : 'incompatible'

    return this.registry.registerManifest(manifest, {
      enabled: compatible ? enabled : false,
      compatible,
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
