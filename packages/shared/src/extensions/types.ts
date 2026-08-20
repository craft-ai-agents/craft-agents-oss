/**
 * Extension Center domain contracts (S-05 / W5).
 *
 * One catalog UI over multiple runtimes. Physical entity storage
 * (skills/sources/automations/marketplace) is NOT migrated — adapters project
 * existing models into ExtensionRecord.
 */

/** Eight runtimes — adding a 9th requires schema + table change (fail-closed). */
export type ExtensionRuntime =
  | 'craft-native'
  | 'craft-sandbox'
  | 'siyuan-plugin'
  | 'mcp-source'
  | 'skill-pack'
  | 'automation-pack'
  | 'web-widget'
  | 'agent-runtime'

export const EXTENSION_RUNTIMES = [
  'craft-native',
  'craft-sandbox',
  'siyuan-plugin',
  'mcp-source',
  'skill-pack',
  'automation-pack',
  'web-widget',
  'agent-runtime',
] as const satisfies readonly ExtensionRuntime[]

/** Catalog filter categories (presentation axis; runtime is execution axis). */
export type CatalogCategory =
  | 'apps'
  | 'knowledge'
  | 'skills'
  | 'sources'
  | 'automations'
  | 'agent-runtimes'
  | 'themes'

export const CATALOG_CATEGORIES = [
  'apps',
  'knowledge',
  'skills',
  'sources',
  'automations',
  'agent-runtimes',
  'themes',
] as const satisfies readonly CatalogCategory[]

export type ExtensionProviderId =
  | 'craft-curated'
  | 'siyuan-bazaar'
  | 'local'
  | 'url'
  | 'installed'

export type ExtensionStatus =
  | 'available'
  | 'installed'
  | 'enabled'
  | 'disabled'
  | 'update-available'
  | 'degraded'

export type ExtensionInstallTarget = 'global' | 'workspace' | 'project'

/**
 * Permission vocabulary (S-05 §3.6).
 * `secrets.use:<credential-id>` is open-ended by design.
 */
export type ExtensionPermission =
  | 'knowledge.read'
  | 'knowledge.write'
  | 'knowledge.delete'
  | 'sessions.read'
  | 'sessions.create'
  | 'sessions.update'
  | 'browser.open'
  | 'browser.read'
  | 'browser.automate'
  | 'filesystem.read'
  | 'filesystem.write'
  | 'network.request'
  | 'shell.execute'
  | 'automation.register'
  | 'ui.panel'
  | 'ui.command'
  | `secrets.use:${string}`

/** Known contribute keys — unknown keys fail-closed at parse time. */
export const EXTENSION_CONTRIBUTE_KEYS = [
  'commands',
  'activityItems',
  'panels',
  'surfaces',
  'menus',
  'settings',
  'skills',
  'automationTriggers',
  'automationActions',
  'agentActions',
] as const

export type ExtensionContributeKey = (typeof EXTENSION_CONTRIBUTE_KEYS)[number]

export type ExtensionContributes = Partial<Record<ExtensionContributeKey, unknown[]>>

export interface ExtensionManifest {
  id: string
  name: string
  version: string
  runtime: ExtensionRuntime
  activationEvents?: string[]
  permissions: ExtensionPermission[]
  /** Known contribute keys only — validated at parse. */
  contributes?: ExtensionContributes
  engines?: { craft?: string }
  dependencies?: string[]
}

export interface ExtensionRecord {
  id: string
  manifest: ExtensionManifest
  category: CatalogCategory
  providerId: ExtensionProviderId
  status: ExtensionStatus
  worksIn: string[]
  installTarget?: ExtensionInstallTarget
  accountLabel?: string
  description?: string
  /**
   * True for pure projections of skills/sources/automations until uninstall
   * happens via their native UI — Extension Center must not rewrite their disk.
   */
  readOnly?: boolean
  /** Marketplace kind when projected from craft-curated catalog. */
  marketplaceKind?: 'skillpack' | 'tool' | 'context-doc'
  /** Raw marketplace entry id when projected from craft-curated catalog. */
  marketplaceId?: string
  /** Optional tags for search/filter. */
  tags?: string[]
  /** When the underlying entity is disabled at source (e.g. source.enabled=false). */
  sourceEnabled?: boolean
}

/** Normalized catalog row before install state is applied. */
export interface CatalogEntry {
  id: string
  name: string
  version: string
  description?: string
  category: CatalogCategory
  runtime: ExtensionRuntime
  providerId: ExtensionProviderId
  permissions: ExtensionPermission[]
  worksIn: string[]
  installTarget?: ExtensionInstallTarget
  tags?: string[]
  marketplaceKind?: 'skillpack' | 'tool' | 'context-doc'
  /** Raw marketplace entry id for install delegation. */
  marketplaceId?: string
  dependencies?: string[]
  /**
   * Kernel install coordinates for remote SiYuan Bazaar packages.
   * Present on available remote catalog rows; installed rows may omit.
   * Craft never downloads the zip — kernel installBazaarPlugin uses these.
   */
  bazaar?: {
    packageName: string
    repoURL: string
    repoHash: string
  }
}

export interface CatalogFilter {
  category?: CatalogCategory | 'all'
  query?: string
  runtime?: ExtensionRuntime
  providerId?: ExtensionProviderId
}

/** Enable/disable bookkeeping only — does not rewrite skills/sources files. */
export interface ExtensionStateFile {
  version: 1
  /** extension id → enabled flag (absent = default enabled for installed). */
  enabled: Record<string, boolean>
  updatedAt?: string
}

export interface ExtensionsChangedPayload {
  /** Optional workspace scope; omit for global. */
  workspaceId?: string
  reason: 'state' | 'install' | 'remove' | 'refresh' | 'projection'
}

export interface ExtensionsListCatalogResult {
  entries: CatalogEntry[]
  providers: Array<{ id: ExtensionProviderId; label: string }>
}

export interface ExtensionsListInstalledResult {
  records: ExtensionRecord[]
  state: ExtensionStateFile
}

export interface ExtensionsGetStateResult {
  state: ExtensionStateFile
}

export interface ExtensionsSetEnabledResult {
  id: string
  enabled: boolean
  state: ExtensionStateFile
}

/** Human-readable runtime placement copy keys (UI resolves via i18n). */
export const RUNTIME_PLACEMENT: Record<ExtensionRuntime, string> = {
  'craft-native': 'First-party Craft code (main/renderer)',
  'craft-sandbox': 'Extension Host utilityProcess (sandboxed)',
  'siyuan-plugin': 'Inside SiYuan runtime (not Craft main)',
  'mcp-source': 'server-core SourceServerBuilder',
  'skill-pack': 'SKILL.md documents read by the agent',
  'automation-pack': 'Automation engine (server-core)',
  'web-widget': 'Sandboxed webContents only',
  'agent-runtime': 'External agent process supervisor',
}
