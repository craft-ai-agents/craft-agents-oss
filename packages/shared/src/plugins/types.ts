export type PluginPermission =
  | 'network'
  | 'filesystem'
  | 'session.read'
  | 'session.write'
  | 'routing.control'
  | 'sources.read'
  | 'sources.write'
  | 'tools.invoke'
  | 'voice.input'
  | 'voice.output'
  | 'ui.render'
  | 'automation.manage'

export type PluginCapabilityType =
  | 'backend'
  | 'routingPolicy'
  | 'sourceConnector'
  | 'settingsPane'
  | 'routePage'
  | 'sessionAction'
  | 'composerAction'
  | 'chatCardType'
  | 'eventEnricher'
  | 'taskProvider'
  | 'automationProvider'
  | 'voiceInputProvider'
  | 'speechOutputProvider'
  | 'mcpAppProvider'

export type PluginHookNamespace =
  | 'backend.registry'
  | 'routing.policy'
  | 'source.catalog'
  | 'settings.sections'
  | 'navigation.routes'
  | 'session.actions'
  | 'composer.actions'
  | 'chat.cards'
  | 'event.pipeline'
  | 'task.providers'
  | 'automation.providers'
  | 'voice.input'
  | 'speech.output'
  | 'mcp.app.surface'

export type PluginSource = 'built-in' | 'external'

export interface PluginEntrypoints {
  main?: string
  helper?: string
  ui?: string
}

export interface PluginEngineRequirements {
  craftAgents: string
}

export interface PluginTrustConfig {
  signed?: boolean
  publisher?: string
}

export interface PluginContributionRefs {
  backends?: string[]
  routingPolicies?: string[]
  sourceConnectors?: string[]
  settingsPanes?: string[]
  routes?: string[]
  sessionActions?: string[]
  composerActions?: string[]
  chatCardTypes?: string[]
  eventEnrichers?: string[]
  taskProviders?: string[]
  automationProviders?: string[]
  voiceInputProviders?: string[]
  speechOutputProviders?: string[]
  mcpAppProviders?: string[]
}

export interface CraftPluginManifest {
  id: string
  name: string
  version: string
  apiVersion: string
  description?: string
  author?: string
  homepage?: string
  engines: PluginEngineRequirements
  trust?: PluginTrustConfig
  permissions: PluginPermission[]
  entrypoints?: PluginEntrypoints
  contributions: PluginContributionRefs
}

export interface PluginCapabilityRef {
  pluginId: string
  id: string
  type: PluginCapabilityType
  title?: string
  description?: string
  hook?: PluginHookNamespace
}

export interface PluginSummary {
  id: string
  name: string
  version: string
  enabled: boolean
  apiVersion: string
  source: PluginSource
  description?: string
}

export interface PluginDetails extends PluginSummary {
  permissions: PluginPermission[]
  entrypoints?: PluginEntrypoints
  contributions: PluginContributionRefs
  trust?: PluginTrustConfig
  compatible?: boolean
  status?: 'active' | 'disabled' | 'incompatible' | 'quarantined'
  error?: string
}

export interface BackendContribution extends PluginCapabilityRef {
  type: 'backend'
}

export interface RoutingPolicyContribution extends PluginCapabilityRef {
  type: 'routingPolicy'
}

export interface SourceConnectorContribution extends PluginCapabilityRef {
  type: 'sourceConnector'
}

export interface SettingsPaneContribution extends PluginCapabilityRef {
  type: 'settingsPane'
  settingsPageId?: string
}

export interface RoutePageContribution extends PluginCapabilityRef {
  type: 'routePage'
  route: string
}

export interface SessionActionContribution extends PluginCapabilityRef {
  type: 'sessionAction'
}

export interface ComposerActionContribution extends PluginCapabilityRef {
  type: 'composerAction'
}

export interface ChatCardContribution extends PluginCapabilityRef {
  type: 'chatCardType'
}

export interface EventEnricherContribution extends PluginCapabilityRef {
  type: 'eventEnricher'
}

export interface TaskProviderContribution extends PluginCapabilityRef {
  type: 'taskProvider'
}

export interface AutomationProviderContribution extends PluginCapabilityRef {
  type: 'automationProvider'
}

export interface VoiceInputContribution extends PluginCapabilityRef {
  type: 'voiceInputProvider'
}

export interface SpeechOutputContribution extends PluginCapabilityRef {
  type: 'speechOutputProvider'
}

export interface McpAppContribution extends PluginCapabilityRef {
  type: 'mcpAppProvider'
}

export type PluginCapabilityContribution =
  | BackendContribution
  | RoutingPolicyContribution
  | SourceConnectorContribution
  | SettingsPaneContribution
  | RoutePageContribution
  | SessionActionContribution
  | ComposerActionContribution
  | ChatCardContribution
  | EventEnricherContribution
  | TaskProviderContribution
  | AutomationProviderContribution
  | VoiceInputContribution
  | SpeechOutputContribution
  | McpAppContribution

export interface PluginHostServices {
  getHomeDir(): string
  getWorkspaceId?(): string | undefined
}

export interface PluginActivationContext {
  registerBackend(def: BackendContribution): void
  registerRoutingPolicy(def: RoutingPolicyContribution): void
  registerSourceConnector(def: SourceConnectorContribution): void
  registerSettingsPane(def: SettingsPaneContribution): void
  registerRoutePage(def: RoutePageContribution): void
  registerSessionAction(def: SessionActionContribution): void
  registerComposerAction(def: ComposerActionContribution): void
  registerChatCardType(def: ChatCardContribution): void
  registerEventEnricher(def: EventEnricherContribution): void
  registerTaskProvider(def: TaskProviderContribution): void
  registerAutomationProvider(def: AutomationProviderContribution): void
  registerVoiceInputProvider(def: VoiceInputContribution): void
  registerSpeechOutputProvider(def: SpeechOutputContribution): void
  registerMcpAppProvider(def: McpAppContribution): void
  logger: Pick<Console, 'debug' | 'info' | 'warn' | 'error'>
  host: PluginHostServices
}
