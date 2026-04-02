import type {
  CraftPluginManifest,
  PluginCapabilityRef,
  PluginCapabilityType,
  PluginContributionRefs,
  PluginDetails,
  PluginSource,
} from '@craft-agent/shared/plugins'

const CONTRIBUTION_TO_CAPABILITY: Array<[keyof PluginContributionRefs, PluginCapabilityType]> = [
  ['backends', 'backend'],
  ['routingPolicies', 'routingPolicy'],
  ['sourceConnectors', 'sourceConnector'],
  ['settingsPanes', 'settingsPane'],
  ['routes', 'routePage'],
  ['sessionActions', 'sessionAction'],
  ['composerActions', 'composerAction'],
  ['chatCardTypes', 'chatCardType'],
  ['eventEnrichers', 'eventEnricher'],
  ['taskProviders', 'taskProvider'],
  ['automationProviders', 'automationProvider'],
  ['voiceInputProviders', 'voiceInputProvider'],
  ['speechOutputProviders', 'speechOutputProvider'],
  ['mcpAppProviders', 'mcpAppProvider'],
]

export interface RegisteredPluginState {
  enabled: boolean
  compatible: boolean
  source: PluginSource
  status: NonNullable<PluginDetails['status']>
  error?: string
}

export function manifestToCapabilities(manifest: CraftPluginManifest): PluginCapabilityRef[] {
  return CONTRIBUTION_TO_CAPABILITY.flatMap(([key, type]) =>
    (manifest.contributions[key] ?? []).map((id) => ({
      pluginId: manifest.id,
      id,
      type,
    })),
  )
}

export function manifestToPluginDetails(
  manifest: CraftPluginManifest,
  state: RegisteredPluginState,
): PluginDetails {
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    apiVersion: manifest.apiVersion,
    description: manifest.description,
    enabled: state.enabled,
    source: state.source,
    permissions: [...manifest.permissions],
    entrypoints: manifest.entrypoints,
    contributions: manifest.contributions,
    trust: manifest.trust,
    compatible: state.compatible,
    status: state.status,
    error: state.error,
  }
}

export class CapabilityRegistry {
  private readonly plugins = new Map<string, PluginDetails>()
  private readonly capabilities = new Map<PluginCapabilityType, PluginCapabilityRef[]>()

  private isPluginActive(pluginId: string): boolean {
    const plugin = this.plugins.get(pluginId)
    return Boolean(plugin?.enabled && plugin.compatible && plugin.status === 'active')
  }

  registerManifest(manifest: CraftPluginManifest, state: RegisteredPluginState): PluginDetails {
    if (this.plugins.has(manifest.id)) {
      throw new Error(`Plugin already registered: ${manifest.id}`)
    }

    const details = manifestToPluginDetails(manifest, state)
    this.plugins.set(manifest.id, details)

    for (const capability of manifestToCapabilities(manifest)) {
      const list = this.capabilities.get(capability.type) ?? []
      list.push(capability)
      this.capabilities.set(capability.type, list)
    }

    return details
  }

  updatePlugin(pluginId: string, patch: Partial<PluginDetails>): PluginDetails {
    const current = this.plugins.get(pluginId)
    if (!current) {
      throw new Error(`Unknown plugin: ${pluginId}`)
    }
    const next = { ...current, ...patch }
    this.plugins.set(pluginId, next)
    return next
  }

  getPlugin(pluginId: string): PluginDetails | undefined {
    return this.plugins.get(pluginId)
  }

  listPlugins(): PluginDetails[] {
    return [...this.plugins.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  listCapabilities(type?: PluginCapabilityType, activeOnly = false): PluginCapabilityRef[] {
    if (type) {
      const capabilities = [...(this.capabilities.get(type) ?? [])]
      return activeOnly
        ? capabilities.filter((capability) => this.isPluginActive(capability.pluginId))
        : capabilities
    }
    const capabilities = [...this.capabilities.values()].flat()
    return activeOnly
      ? capabilities.filter((capability) => this.isPluginActive(capability.pluginId))
      : capabilities
  }
}
