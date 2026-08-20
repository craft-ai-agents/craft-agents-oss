/**
 * Extension Center RPC handlers (S-05 / W5 + W6 bazaar fixture feed).
 *
 * Federated list of craft-curated catalog + installed projections
 * (skills/sources/automations/marketplace lock + optional SiYuan bridge
 * fixtures / remote Bazaar soft-fail). Enable/disable is stored in
 * `{configDir}/extensions/state.json` and does NOT rewrite entity stores.
 *
 * Install/remove for marketplace ids remains on marketplace.* handlers.
 * Bazaar install/uninstall is on pluginBridge.installBazaar / uninstallBazaar
 * (kernel-only; catalog entries carry bazaar coords when available).
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { CONFIG_DIR } from '@craft-agent/shared/config/paths'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import {
  automationsToExtensionRecords,
  createDefaultCatalogRegistry,
  detectCompatLevel,
  getExtensionStateStore,
  marketplaceEntryToRecord,
  pluginJsonToExtensionRecord,
  resetExtensionStateStoreCache,
  skillsToExtensionRecords,
  sourcesToExtensionRecords,
  type CatalogFilter,
  type CatalogCategory,
  type ExtensionRecord,
  type ExtensionsGetStateResult,
  type ExtensionsListCatalogResult,
  type ExtensionsListInstalledResult,
  type ExtensionsSetEnabledResult,
} from '@craft-agent/shared/extensions'
import {
  getCatalog,
  marketplacePaths,
  readLock,
  type MarketplaceCatalog,
} from '@craft-agent/shared/marketplace'
import { loadAllSkills } from '@craft-agent/shared/skills'
import { loadWorkspaceSources } from '@craft-agent/shared/sources'
import { resolveAutomationsConfigPath } from '@craft-agent/shared/automations/resolve-config-path'
import type { AutomationsConfig } from '@craft-agent/shared/automations'
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import {
  loadPluginBridgeManifests,
  pluginBridgeBazaarCatalogListFn,
} from './plugin-bridge'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.extensions.LIST_CATALOG,
  RPC_CHANNELS.extensions.LIST_INSTALLED,
  RPC_CHANNELS.extensions.SET_ENABLED,
  RPC_CHANNELS.extensions.GET_STATE,
] as const

export interface ExtensionsListCatalogArgs {
  filter?: CatalogFilter
}

export interface ExtensionsListInstalledArgs {
  workspaceId?: string
  workingDirectory?: string
}

export interface ExtensionsSetEnabledArgs {
  id: string
  enabled: boolean
}

function configDir(): string {
  return process.env.CRAFT_CONFIG_DIR || CONFIG_DIR
}

async function loadMarketplaceCatalog(): Promise<MarketplaceCatalog> {
  const result = await getCatalog({ configDir: configDir() })
  return result.catalog
}

function broadcastChanged(
  server: RpcServer,
  payload: { workspaceId?: string; reason: 'state' | 'install' | 'remove' | 'refresh' | 'projection' },
): void {
  try {
    pushTyped(server, RPC_CHANNELS.extensions.CHANGED, { to: 'all' }, payload)
  } catch {
    /* push optional */
  }
}

async function loadAutomationsConfig(workspaceRoot: string): Promise<AutomationsConfig | null> {
  try {
    const configPath = resolveAutomationsConfigPath(workspaceRoot)
    if (!existsSync(configPath)) return null
    const content = await readFile(configPath, 'utf-8')
    return JSON.parse(content) as AutomationsConfig
  } catch {
    return null
  }
}

function applyCategoryFilter(
  records: ExtensionRecord[],
  category?: CatalogCategory | 'all',
): ExtensionRecord[] {
  if (!category || category === 'all') return records
  return records.filter((r) => r.category === category)
}

export function registerExtensionsHandlers(server: RpcServer, deps: HandlerDeps): void {
  const log = deps.platform.logger

  server.handle(
    RPC_CHANNELS.extensions.LIST_CATALOG,
    async (_ctx, args?: ExtensionsListCatalogArgs): Promise<ExtensionsListCatalogResult> => {
      const registry = createDefaultCatalogRegistry(() => loadMarketplaceCatalog(), {
        bazaarListFn: pluginBridgeBazaarCatalogListFn,
      })
      const entries = await registry.listAll(args?.filter)
      return {
        entries,
        providers: registry.listProviders().map((p) => ({ id: p.id, label: p.label })),
      }
    },
  )

  server.handle(
    RPC_CHANNELS.extensions.LIST_INSTALLED,
    async (_ctx, args?: ExtensionsListInstalledArgs): Promise<ExtensionsListInstalledResult> => {
      const dir = configDir()
      const store = getExtensionStateStore(dir)
      const state = store.getState()
      const enabledMap = state.enabled
      const records: ExtensionRecord[] = []

      // Marketplace lock projections
      try {
        const catalog = await loadMarketplaceCatalog()
        const installs = readLock(marketplacePaths(dir).lockFile).entries
        for (const entry of catalog.entries ?? []) {
          const lockRec = installs[entry.id]
          if (!lockRec) continue
          const id = `marketplace:${entry.id}`
          const flag = enabledMap[id]
          records.push(
            marketplaceEntryToRecord(entry, {
              lock: lockRec,
              enabled: flag === undefined ? true : flag,
            }),
          )
        }
      } catch (err) {
        log?.warn?.(
          `EXTENSIONS_LIST_INSTALLED: marketplace projection failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        )
      }

      const workspaceId = args?.workspaceId
      if (workspaceId) {
        const workspace = getWorkspaceByNameOrId(workspaceId)
        if (workspace) {
          const effectiveWorkingDir =
            args?.workingDirectory && existsSync(args.workingDirectory)
              ? args.workingDirectory
              : undefined

          try {
            const skills = loadAllSkills(workspace.rootPath, effectiveWorkingDir, {
              includeOmp: true,
              includeShadowedOmp: true,
            })
            records.push(...skillsToExtensionRecords(skills, enabledMap))
          } catch (err) {
            log?.warn?.(
              `EXTENSIONS_LIST_INSTALLED: skills projection failed: ${
                err instanceof Error ? err.message : String(err)
              }`,
            )
          }

          try {
            const sources = loadWorkspaceSources(workspace.rootPath)
            records.push(...sourcesToExtensionRecords(sources, enabledMap))
          } catch (err) {
            log?.warn?.(
              `EXTENSIONS_LIST_INSTALLED: sources projection failed: ${
                err instanceof Error ? err.message : String(err)
              }`,
            )
          }

          try {
            const autoConfig = await loadAutomationsConfig(workspace.rootPath)
            records.push(...automationsToExtensionRecords(autoConfig, workspaceId, enabledMap))
          } catch (err) {
            log?.warn?.(
              `EXTENSIONS_LIST_INSTALLED: automations projection failed: ${
                err instanceof Error ? err.message : String(err)
              }`,
            )
          }
        } else {
          log?.error?.(`EXTENSIONS_LIST_INSTALLED: Workspace not found: ${workspaceId}`)
        }
      }

      // SiYuan plugin bridge — kernel-aware installed feed (same as LIST_PLUGINS).
      try {
        const loaded = await loadPluginBridgeManifests()
        for (const manifest of loaded.manifests) {
          const id = `siyuan-plugin:${manifest.name}`
          const flag = enabledMap[id]
          const enabled = flag === undefined ? true : flag
          const level = detectCompatLevel(manifest)
          records.push(pluginJsonToExtensionRecord(manifest, level, enabled))
        }
      } catch (err) {
        log?.warn?.(
          `EXTENSIONS_LIST_INSTALLED: siyuan-plugin projection failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        )
      }

      return { records, state }
    },
  )

  server.handle(
    RPC_CHANNELS.extensions.SET_ENABLED,
    async (_ctx, args: ExtensionsSetEnabledArgs): Promise<ExtensionsSetEnabledResult> => {
      if (!args?.id || typeof args.enabled !== 'boolean') {
        throw new Error('extensions.setEnabled: id and enabled are required')
      }
      const store = getExtensionStateStore(configDir())
      const state = store.setEnabled(args.id, args.enabled)
      broadcastChanged(server, { reason: 'state' })
      return { id: args.id, enabled: args.enabled, state }
    },
  )

  server.handle(
    RPC_CHANNELS.extensions.GET_STATE,
    async (_ctx): Promise<ExtensionsGetStateResult> => {
      const store = getExtensionStateStore(configDir())
      return { state: store.getState() }
    },
  )
}

/** Test helpers */
export { resetExtensionStateStoreCache, applyCategoryFilter }
