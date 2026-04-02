import type {
  CraftPluginManifest,
  PluginCapabilityRef,
  PluginCapabilityType,
  PluginDetails,
  PluginInvokeResult,
  PluginSource,
  InvokePluginComposerActionArgs,
  InvokePluginSessionActionArgs,
} from '@craft-agent/shared/plugins'
import {
  isPluginApiVersionSupported,
  isPluginEngineSatisfied,
} from '@craft-agent/shared/plugins'
import { CapabilityRegistry } from './registry'
import {
  registerExternalPluginBackend,
  unregisterExternalPluginBackend,
  type ExternalPluginBackendRegistration,
} from '@craft-agent/shared/agent/backend'
import {
  type PluginStateEntry,
  type PluginStateStore,
  getDefaultPluginDirectory,
  getDefaultPluginStatePath,
  readPluginState,
  writePluginState,
} from './storage'
import { type PluginManifestLoadFailure, loadPluginManifestsFromDirectory } from './loader'
import { PluginBridgeRuntime, type ExternalPluginPackage } from './bridge-runtime'

export const PLUGIN_API_VERSION = '1.0.0'

type SessionActionHandler = (args: InvokePluginSessionActionArgs) => Promise<PluginInvokeResult>
type ComposerActionHandler = (args: InvokePluginComposerActionArgs) => Promise<PluginInvokeResult>

interface PluginHostOptions {
  appVersion: string
  pluginApiVersion?: string
  pluginDirectory?: string
  helperRuntimePath?: string
  pluginStatePath?: string
}

export class PluginHost {
  private readonly registry = new CapabilityRegistry()
  private readonly appVersion: string
  private readonly pluginApiVersion: string
  private readonly pluginDirectory: string
  private readonly pluginStatePath: string
  private readonly helperRuntimePath?: string
  private readonly bridgeRuntime: PluginBridgeRuntime
  private readonly builtInPluginIds = new Set<string>()
  private readonly externalPluginRoots = new Map<string, string>()
  private readonly externalBackendRegistrations = new Map<string, ExternalPluginBackendRegistration[]>()
  private readonly sessionActionHandlers = new Map<string, SessionActionHandler>()
  private readonly composerActionHandlers = new Map<string, ComposerActionHandler>()
  private state: PluginStateStore = { plugins: {} }
  private loadFailures: PluginManifestLoadFailure[] = []

  constructor(options: PluginHostOptions) {
    this.appVersion = options.appVersion
    this.pluginApiVersion = options.pluginApiVersion ?? PLUGIN_API_VERSION
    this.pluginDirectory = options.pluginDirectory ?? getDefaultPluginDirectory()
    this.pluginStatePath = options.pluginStatePath ?? getDefaultPluginStatePath()
    this.helperRuntimePath = options.helperRuntimePath
    this.bridgeRuntime = new PluginBridgeRuntime({
      helperRuntimePath: options.helperRuntimePath,
    })
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
    const plugins: PluginDetails[] = []

    for (const entry of manifests) {
      const plugin = this.registerManifest(entry.manifest, undefined, undefined, entry.pluginRoot)
      if (plugin.enabled && plugin.status === 'active') {
        plugins.push(await this.activateExternalPlugin(plugin.id))
      } else {
        plugins.push(plugin)
      }
    }

    return plugins
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
    return this.listCapabilitiesRequiringPermission('sessionAction', 'ui.render')
  }

  listComposerActions(): PluginCapabilityRef[] {
    return this.listCapabilitiesRequiringPermission('composerAction', 'ui.render')
  }

  listChatCardTypes(): PluginCapabilityRef[] {
    return this.listCapabilitiesRequiringPermission('chatCardType', 'ui.render')
  }

  registerSessionActionHandler(
    pluginId: string,
    actionId: string,
    handler: SessionActionHandler,
  ): void {
    this.sessionActionHandlers.set(this.actionKey(pluginId, actionId), handler)
  }

  registerComposerActionHandler(
    pluginId: string,
    actionId: string,
    handler: ComposerActionHandler,
  ): void {
    this.composerActionHandlers.set(this.actionKey(pluginId, actionId), handler)
  }

  async invokeSessionAction(args: InvokePluginSessionActionArgs): Promise<PluginInvokeResult> {
    const capability = this.requireCapability(args.pluginId, 'sessionAction', args.actionId)
    const handler = this.sessionActionHandlers.get(this.actionKey(args.pluginId, args.actionId))
    if (handler) {
      return handler(args)
    }
    return capability.invoke ?? { type: 'noop' }
  }

  async invokeComposerAction(args: InvokePluginComposerActionArgs): Promise<PluginInvokeResult> {
    const capability = this.requireCapability(args.pluginId, 'composerAction', args.actionId)
    const handler = this.composerActionHandlers.get(this.actionKey(args.pluginId, args.actionId))
    if (handler) {
      return handler(args)
    }
    return capability.invoke ?? { type: 'noop' }
  }

  async enablePlugin(pluginId: string): Promise<PluginDetails> {
    const current = this.registry.getPlugin(pluginId)
    if (!current) {
      throw new Error(`Unknown plugin: ${pluginId}`)
    }
    if (!current.compatible) {
      throw new Error(`Cannot enable incompatible plugin: ${pluginId}`)
    }
    this.registry.updatePlugin(pluginId, {
      enabled: true,
      status: 'active',
      error: undefined,
    })
    await this.writeState(pluginId, { enabled: true, status: 'active', error: undefined })
    return this.activateExternalPlugin(pluginId)
  }

  async disablePlugin(pluginId: string): Promise<PluginDetails> {
    if (this.builtInPluginIds.has(pluginId)) {
      throw new Error(`Cannot disable built-in plugin: ${pluginId}`)
    }
    this.unregisterExternalPluginBackends(pluginId)
    const plugin = this.registry.updatePlugin(pluginId, {
      enabled: false,
      status: 'disabled',
    })
    await this.writeState(pluginId, { enabled: false, status: 'disabled' })
    return plugin
  }

  async quarantinePlugin(pluginId: string, error: string): Promise<PluginDetails> {
    this.unregisterExternalPluginBackends(pluginId)
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
    pluginRoot?: string,
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

    const plugin = this.registry.registerManifest(manifest, {
      enabled: compatible ? enabled : false,
      compatible,
      source,
      status,
      error: state.error ?? defaults?.error,
    })
    if (pluginRoot) {
      this.externalPluginRoots.set(plugin.id, pluginRoot)
    }
    return plugin
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

  private actionKey(pluginId: string, actionId: string): string {
    return `${pluginId}:${actionId}`
  }

  private requireCapability(
    pluginId: string,
    type: PluginCapabilityType,
    capabilityId: string,
  ): PluginCapabilityRef {
    const capability = this.registry.getCapability(pluginId, type, capabilityId)
    if (!capability) {
      throw new Error(`Unknown plugin capability: ${pluginId}:${capabilityId}`)
    }
    const plugin = this.registry.getPlugin(pluginId)
    if (!plugin || !plugin.enabled || !plugin.compatible || plugin.status !== 'active') {
      throw new Error(`Plugin is not active: ${pluginId}`)
    }
    if (
      (type === 'sessionAction' || type === 'composerAction' || type === 'chatCardType')
      && !plugin.permissions.includes('ui.render')
    ) {
      throw new Error(`Plugin is missing required permission for ${type}: ui.render`)
    }
    return capability
  }

  private listCapabilitiesRequiringPermission(
    type: PluginCapabilityType,
    permission: 'ui.render',
  ): PluginCapabilityRef[] {
    return this.listCapabilities(type).filter((capability) => {
      const plugin = this.registry.getPlugin(capability.pluginId)
      return plugin?.permissions.includes(permission)
    })
  }

  private async activateExternalPlugin(pluginId: string): Promise<PluginDetails> {
    const plugin = this.registry.getPlugin(pluginId)
    if (!plugin || plugin.source !== 'external') {
      return plugin as PluginDetails
    }

    this.unregisterExternalPluginBackends(pluginId)

    const pluginRoot = this.externalPluginRoots.get(pluginId)
    if (!pluginRoot) {
      return plugin
    }

    try {
      const packageInfo: ExternalPluginPackage = {
        manifest: plugin,
        pluginRoot,
      }
      const { helperPath } = await this.bridgeRuntime.activate(packageInfo)
      if (helperPath) {
        const registrations = (plugin.contributions.backends ?? []).map<ExternalPluginBackendRegistration>((backendId) => ({
          backendId,
          pluginId: plugin.id,
          helperPath,
          helperRuntimePath: this.helperRuntimePath,
        }))

        for (const registration of registrations) {
          registerExternalPluginBackend(registration)
        }
        this.externalBackendRegistrations.set(plugin.id, registrations)
      }

      return this.registry.updatePlugin(plugin.id, {
        enabled: true,
        status: 'active',
        error: undefined,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return this.quarantinePlugin(plugin.id, message)
    }
  }

  private unregisterExternalPluginBackends(pluginId: string): void {
    const registrations = this.externalBackendRegistrations.get(pluginId) ?? []
    for (const registration of registrations) {
      unregisterExternalPluginBackend(registration.backendId)
    }
    this.externalBackendRegistrations.delete(pluginId)
  }
}
