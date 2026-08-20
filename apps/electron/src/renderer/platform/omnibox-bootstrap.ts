/**
 * Omnibox bootstrap (W3) — module-level singletons + provider/command registration.
 *
 * - CommandRegistry + ResourceProviderRegistry + ContextKeyService
 * - Bridges existing `actions` definitions as craft CommandContributions
 * - Registers minimal resource providers (sessions/settings/skills/sources/knowledge/automations)
 * - knowledge.search / knowledge.openHome / knowledge.openCompat (+ siyuan.openCompat)
 * - Soft-load enabled L2+ SiYuan plugin bridge commands (fail-soft if API absent)
 *
 * Called once from OmniboxHost on mount. Safe to call multiple times (idempotent).
 */

import {
  createCommandRegistry,
  createContextKeyService,
  createResourceProviderRegistry,
  type CommandContribution,
  type CommandRegistry,
  type ContextKeyService,
  type ResourceProviderRegistry,
} from '@craft-agent/core/platform'
import { getDefaultStore } from 'jotai'
import { actions, type ActionId } from '@/actions/definitions'
import {
  sessionMetaMapAtom,
  windowWorkspaceIdAtom,
} from '@/atoms/sessions'
import { skillsAtom } from '@/atoms/skills'
import { sourcesAtom } from '@/atoms/sources'
import { automationsAtom } from '@/atoms/automations'
import { navigate, routes } from '@/lib/navigate'
import { SETTINGS_PAGES, type SettingsSubpage } from '../../shared/settings-registry'
import {
  searchKnowledge,
  resolveKnowledgeApi,
} from '@/knowledge/KnowledgeHome'
import {
  createAutomationsProvider,
  createKnowledgeProvider,
  createSessionsProvider,
  createSettingsProvider,
  createSkillsProvider,
  createSourcesProvider,
} from './omnibox-providers'
import { SIYUAN_FULL_SURFACE_ID } from '@/knowledge/siyuan-url'

export interface OmniboxPlatform {
  commands: CommandRegistry
  resources: ResourceProviderRegistry
  contextKeys: ContextKeyService
}

let platform: OmniboxPlatform | null = null
let actionExecute: ((actionId: ActionId) => void) | null = null
let bootstrapped = false
const disposables: Array<{ dispose(): void }> = []

/** Access the shared omnibox platform (creates empty registries if needed). */
export function getOmniboxPlatform(): OmniboxPlatform {
  if (!platform) {
    platform = {
      commands: createCommandRegistry(),
      resources: createResourceProviderRegistry(),
      contextKeys: createContextKeyService(),
    }
  }
  return platform
}

/**
 * Provide the live ActionRegistry.execute so command contributions can dispatch
 * through the existing hotkey/handler system (no second executor).
 */
export function setOmniboxActionExecutor(execute: (actionId: ActionId) => void): void {
  actionExecute = execute
}

/** Optional i18n label resolver for settings pages (defaults to id). */
export type LabelResolver = (key: string, fallback: string) => string

/**
 * Idempotent bootstrap: register craft actions as commands + resource providers.
 * Pass `t` for localized settings labels when available.
 */
export function bootstrapOmnibox(options?: { t?: LabelResolver }): OmniboxPlatform {
  const p = getOmniboxPlatform()
  if (bootstrapped) return p
  bootstrapped = true

  registerActionCommands(p.commands)
  registerKnowledgeCommands(p.commands)
  registerResourceProviders(p.resources, options?.t)
  // Fail-soft: never block palette bootstrap if plugin bridge is missing.
  void refreshPluginBridgeCommands(p.commands).catch((err) => {
    console.debug('[omnibox] plugin bridge registration skipped', err)
  })
  // Keep plugin contributions in sync with install/remove/enable/disable.
  if (typeof window !== 'undefined' && typeof window.electronAPI?.onExtensionsChanged === 'function') {
    const off = window.electronAPI.onExtensionsChanged(() => {
      void refreshPluginBridgeCommands(p.commands).catch((err) => {
        console.debug('[omnibox] plugin bridge refresh failed', err)
      })
    })
    track({ dispose: off })
  }

  return p
}

/** Test-only reset. */
export function __resetOmniboxBootstrapForTests(): void {
  for (const d of disposables.splice(0)) {
    try {
      d.dispose()
    } catch {
      /* ignore */
    }
  }
  for (const list of pluginDisposables.values()) {
    for (const d of list) {
      try {
        d.dispose()
      } catch {
        /* ignore */
      }
    }
  }
  pluginDisposables.clear()
  pluginRefreshInFlight.clear()
  pluginRefreshQueued.clear()
  platform = null
  actionExecute = null
  bootstrapped = false
}

function track(d: { dispose(): void }): void {
  disposables.push(d)
}

function scopeToWhen(scope: string | undefined): string | undefined {
  if (!scope || scope === 'global') return undefined
  if (scope === 'chat') return 'chatFocus'
  if (scope === 'navigator') return 'navigatorFocus'
  if (scope === 'sidebar') return 'sidebarFocus'
  return undefined
}

function registerActionCommands(commands: CommandRegistry): void {
  for (const def of Object.values(actions)) {
    const action = def as {
      id: string
      label: string
      category: string
      description?: string
      defaultHotkey: string | null
      scope?: string
      when?: string
    }
    const actionId = action.id as ActionId
    const whenParts = [action.when, scopeToWhen(action.scope)].filter(Boolean) as string[]
    const when = whenParts.length === 0 ? undefined : whenParts.join(' && ')

    const contribution: CommandContribution = {
      id: action.id,
      title: action.label,
      category: action.category,
      source: 'craft',
      when,
      keywords: action.description ? [action.description] : undefined,
      defaultHotkey: action.defaultHotkey ?? undefined,
      async execute() {
        actionExecute?.(actionId)
      },
    }
    try {
      track(commands.register(contribution))
    } catch (err) {
      console.error('[omnibox] failed to register action command', action.id, err)
    }
  }
}

function openSiyuanCompatSurface(): void {
  navigate(routes.view.siyuan({ kind: 'notebook', id: SIYUAN_FULL_SURFACE_ID }))
}

function registerKnowledgeCommands(commands: CommandRegistry): void {
  const openHome: CommandContribution = {
    id: 'knowledge.openHome',
    title: 'Open Knowledge',
    category: 'Knowledge',
    source: 'craft',
    keywords: ['knowledge', 'siyuan', 'notes', 'docs'],
    async execute() {
      navigate(routes.view.knowledge())
    },
  }
  const search: CommandContribution = {
    id: 'knowledge.search',
    title: 'Search Knowledge',
    category: 'Knowledge',
    source: 'craft',
    keywords: ['knowledge', 'search', 'find', 'docs'],
    async execute() {
      navigate(routes.view.knowledge())
    },
  }
  const openCompat: CommandContribution = {
    id: 'knowledge.openCompat',
    title: 'Open SiYuan compatibility view',
    category: 'Knowledge',
    source: 'craft',
    keywords: ['knowledge', 'siyuan', 'compat', 'full', 'interface', 'plugin'],
    async execute() {
      openSiyuanCompatSurface()
    },
  }
  const openCompatAlias: CommandContribution = {
    id: 'siyuan.openCompat',
    title: 'Open SiYuan compatibility view',
    category: 'Knowledge',
    source: 'craft',
    keywords: ['siyuan', 'compat', 'full', 'interface', 'plugin'],
    async execute() {
      openSiyuanCompatSurface()
    },
  }
  try {
    track(commands.register(openHome))
    track(commands.register(search))
    track(commands.register(openCompat))
    track(commands.register(openCompatAlias))
  } catch (err) {
    console.error('[omnibox] failed to register knowledge commands', err)
  }
}

type PluginBridgeListItem = {
  id: string
  enabled?: boolean
  level?: number
  name?: string
  grantedPermissions?: string[]
}

type PluginBridgeCommand = {
  id: string
  title: string
  titleRu?: string
  when?: string
  defaultHotkey?: string
  pluginId?: string
}

type PluginBridgeProjections = {
  commands?: PluginBridgeCommand[]
  level?: number
  pluginId?: string
}

type PluginBridgeApi = {
  pluginBridgeListPlugins?: () => Promise<{ plugins?: PluginBridgeListItem[] }>
  pluginBridgeGetProjections?: (args: {
    pluginId: string
    grantedPermissions?: string[]
  }) => Promise<PluginBridgeProjections>
  pluginBridgeOpenCompat?: (args?: { pluginId?: string }) => Promise<unknown>
}

/**
 * Stable command id: always `siyuan-plugin:${barePluginName}:${contributeId}`.
 * Strips one leading `siyuan-plugin:` from plugin id; never double-prefixes;
 * never returns a bare dotted contribute id without the namespace.
 */
export function pluginCommandId(pluginId: string, contributeId: string): string {
  const barePlugin = pluginId.startsWith('siyuan-plugin:')
    ? pluginId.slice('siyuan-plugin:'.length)
    : pluginId
  const bareContribute = contributeId.startsWith(`siyuan-plugin:${barePlugin}:`)
    ? contributeId.slice(`siyuan-plugin:${barePlugin}:`.length)
    : contributeId.startsWith('siyuan-plugin:')
      ? contributeId.slice('siyuan-plugin:'.length)
      : contributeId
  return `siyuan-plugin:${barePlugin}:${bareContribute}`
}

/** Default install-time grants for enabled L2/L3 plugins until user revoke. */
function defaultPluginBridgeGrants(level: number | undefined): string[] {
  return (level ?? 0) >= 2 ? ['ui.command', 'ui.panel'] : []
}

/**
 * Soft-load enabled L2+ plugin projections into the command registry.
 * Refreshable: disposes previously-registered plugin contributions and
 * re-registers from the current plugin set so install/remove/enable/disable
 * is reflected without an app restart. Serialized per-registry instance.
 */
const pluginDisposables = new Map<CommandRegistry, Array<{ dispose(): void }>>()
const pluginRefreshInFlight = new Map<CommandRegistry, Promise<void>>()
/** Coalesce concurrent refresh requests into one trailing run. */
const pluginRefreshQueued = new Set<CommandRegistry>()

async function refreshPluginBridgeCommands(commands: CommandRegistry): Promise<void> {
  const inFlight = pluginRefreshInFlight.get(commands)
  if (inFlight) {
    // A refresh is already running — queue one trailing pass and wait for it.
    pluginRefreshQueued.add(commands)
    return inFlight
  }

  const run = (async () => {
    try {
      do {
        pluginRefreshQueued.delete(commands)
        if (typeof window === 'undefined') return
        const api = window.electronAPI as PluginBridgeApi | undefined
        if (!api?.pluginBridgeListPlugins || !api?.pluginBridgeGetProjections) return

        const list = await api.pluginBridgeListPlugins()
        const plugins = list?.plugins ?? []
        const contributions: CommandContribution[] = []
        for (const plugin of plugins) {
          if (!plugin?.id || plugin.enabled === false) continue
          if ((plugin.level ?? 0) < 2) continue

          let projections: PluginBridgeProjections
          try {
            const grantedPermissions =
              plugin.grantedPermissions ?? defaultPluginBridgeGrants(plugin.level)
            projections = await api.pluginBridgeGetProjections({
              pluginId: plugin.id,
              grantedPermissions,
            })
          } catch (err) {
            console.debug('[omnibox] getProjections failed', plugin.id, err)
            continue
          }
          if ((projections?.level ?? plugin.level ?? 0) < 2) continue

          for (const cmd of projections?.commands ?? []) {
            if (!cmd?.id || !cmd.title) continue
            const id = pluginCommandId(plugin.id, cmd.id)
            contributions.push({
              id,
              title: cmd.title,
              category: 'SiYuan Plugin',
              // Domain lands `siyuan-plugin` on the source union; cast keeps bootstrap green either way.
              source: 'siyuan-plugin' as CommandContribution['source'],
              when: cmd.when,
              defaultHotkey: cmd.defaultHotkey,
              keywords: ['siyuan', 'plugin', plugin.name ?? plugin.id],
              async execute() {
                try {
                  if (typeof api.pluginBridgeOpenCompat === 'function') {
                    await api.pluginBridgeOpenCompat({ pluginId: plugin.id })
                  }
                } catch (err) {
                  console.warn('[omnibox] plugin bridge openCompat failed', id, err)
                }
                try {
                  openSiyuanCompatSurface()
                } catch (err) {
                  console.warn('[omnibox] openSiyuanCompatSurface failed', id, err)
                }
              },
            })
          }
        }

        // Full swap: dispose stale plugin contributions, register the new set.
        for (const d of pluginDisposables.get(commands) ?? []) {
          try {
            d.dispose()
          } catch {
            /* ignore */
          }
        }
        const fresh: Array<{ dispose(): void }> = []
        for (const contribution of contributions) {
          try {
            fresh.push(commands.register(contribution))
          } catch (err) {
            console.debug('[omnibox] skip plugin command', contribution.id, err)
          }
        }
        pluginDisposables.set(commands, fresh)
      } while (pluginRefreshQueued.has(commands))
    } catch (err) {
      console.debug('[omnibox] plugin bridge soft-load failed', err)
    } finally {
      pluginRefreshInFlight.delete(commands)
      pluginRefreshQueued.delete(commands)
    }
  })()
  pluginRefreshInFlight.set(commands, run)
  return run
}

function registerResourceProviders(
  resources: ResourceProviderRegistry,
  t?: LabelResolver,
): void {
  const store = getDefaultStore()

  track(
    resources.register(
      createSessionsProvider(
        () => Array.from(store.get(sessionMetaMapAtom).values()),
        (id) => routes.view.allSessions(id),
      ),
    ),
  )

  const pages = SETTINGS_PAGES.map((page) => ({
    id: page.id,
    label: t ? t(page.labelKey, page.id) : page.id,
    description: t ? t(page.descriptionKey, '') : undefined,
  }))
  track(
    resources.register(
      createSettingsProvider(pages, (id) => routes.view.settings(id as SettingsSubpage)),
    ),
  )

  track(
    resources.register(
      createSkillsProvider(
        () => store.get(skillsAtom),
        (slug) => routes.view.skills(slug),
      ),
    ),
  )

  track(
    resources.register(
      createSourcesProvider(
        () => store.get(sourcesAtom),
        (slug) => routes.view.sources({ sourceSlug: slug }),
      ),
    ),
  )

  track(
    resources.register(
      createAutomationsProvider(
        () => store.get(automationsAtom),
        (id) => routes.view.automations({ automationId: id }),
      ),
    ),
  )

  track(
    resources.register(
      createKnowledgeProvider(async (query, signal) => {
        if (signal?.aborted) return null
        const api = resolveKnowledgeApi()
        const ws = store.get(windowWorkspaceIdAtom)
        if (!ws) return null
        if (signal?.aborted) return null
        const hits = await searchKnowledge(api, ws, query)
        if (!hits) return null
        return hits.map((hit) => ({
          ref: { kind: hit.ref.kind, id: hit.ref.id },
          title: hit.title,
          snippet: hit.snippet,
          notebookPath: hit.notebookPath,
          score: hit.score,
        }))
      }),
    ),
  )
}
