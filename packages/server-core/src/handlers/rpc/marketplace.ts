/**
 * Marketplace RPC handlers (runtime-context-marketplace PRD §8, plan §5 M4a).
 *
 * LOCAL_ONLY: the catalog cache, lock registry, and installed artifacts live
 * in the local config dir. kind:tool installs validate against the toolchain
 * manifest, record a lock entry, then call toolchain.update(toolName) so the
 * binary/npm artifact is actually installed (progress via toolchain:statusChanged).
 */

import { CodedError, RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { loadStoredConfig, saveConfig, type StoredConfig } from '@craft-agent/shared/config'
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { getToolchainManager } from '@craft-agent/shared/toolchain-runtime'
import type { ToolName } from '@craft-agent/shared/toolchain'
import {
  createConfigMetaStore,
  createFileStatsStore,
  fetchMarketplaceStats,
  getCatalog,
  installEntry,
  marketplacePaths,
  readLock,
  refreshCatalog,
  removeEntry,
  upsertLockRecord,
  type MarketplaceCatalogResult,
  type MarketplaceEntry,
  type MarketplaceFetch,
  type MarketplaceMeta,
  type MarketplaceStatsFetch,
} from '@craft-agent/shared/marketplace'
export const HANDLED_CHANNELS = [
  RPC_CHANNELS.marketplace.CATALOG,
  RPC_CHANNELS.marketplace.STATS,
  RPC_CHANNELS.marketplace.INSTALL,
  RPC_CHANNELS.marketplace.REMOVE,
  RPC_CHANNELS.marketplace.UPDATE,
  RPC_CHANNELS.marketplace.REFRESH,
] as const

type MarketplaceConfigShape = { marketplace?: MarketplaceMeta } & Record<string, unknown>

/** Minimal adapter: WHATWG fetch → the trivially-mockable marketplace fetch shape. */
const catalogFetch: MarketplaceFetch = async (url, init) => {
  const res = await fetch(url, { headers: init?.headers, signal: init?.signal })
  return {
    ok: res.ok,
    status: res.status,
    headers: { get: (name: string) => res.headers.get(name) },
    text: () => res.text(),
  }
}

const statsFetch: MarketplaceStatsFetch = async (url, init) => {
  const res = await fetch(url, { headers: init?.headers })
  return { ok: res.ok, status: res.status, json: () => res.json() }
}

export function registerMarketplaceHandlers(server: RpcServer, _deps: HandlerDeps): void {
  // ETag/fetch timestamps persist in StoredConfig.marketplace (plan §0.1).
  const metaStore = createConfigMetaStore(
    () => loadStoredConfig() as MarketplaceConfigShape | null,
    (config) => {
      saveConfig(config as unknown as StoredConfig)
    },
  )

  const loadCatalogView = async (): Promise<MarketplaceCatalogResult> => {
    const result = await getCatalog({ metaStore, fetchFn: catalogFetch })
    return { ...result, installs: readLock(marketplacePaths().lockFile).entries }
  }

  const requireEntry = async (id: string): Promise<MarketplaceEntry> => {
    const { catalog } = await getCatalog({ metaStore, fetchFn: catalogFetch })
    const entry = catalog.entries.find((e) => e.id === id)
    if (!entry) {
      throw new CodedError('MARKETPLACE_ENTRY_NOT_FOUND', `Marketplace entry '${id}' is not in the catalog`)
    }
    return entry
  }

  // One mutation per slug at a time (in-memory). Installs are serialized in
  // the single local server process; a second caller fails fast instead of
  // racing the same artifacts.
  const inFlight = new Set<string>()
  const exclusive = async <T>(id: string, fn: () => Promise<T>): Promise<T> => {
    if (inFlight.has(id)) {
      throw new CodedError('MARKETPLACE_OPERATION_IN_FLIGHT', `Marketplace entry '${id}' already has an operation in flight`)
    }
    inFlight.add(id)
    try {
      return await fn()
    } finally {
      inFlight.delete(id)
    }
  }

  // Catalog view + install registry (ETag/24h TTL handled inside getCatalog)
  server.handle(RPC_CHANNELS.marketplace.CATALOG, async () => {
    return loadCatalogView()
  })

  // Live card stats (6h cache inside fetchMarketplaceStats)
  server.handle(RPC_CHANNELS.marketplace.STATS, async () => {
    const { catalog } = await getCatalog({ metaStore, fetchFn: catalogFetch })
    return fetchMarketplaceStats(catalog.entries, {
      store: createFileStatsStore(marketplacePaths().statsCache),
      fetchFn: statsFetch,
    })
  })

  const finalizeToolInstall = async (
    entry: MarketplaceEntry,
    toolName: string,
    action: 'installed' | 'updated',
  ) => {
    const status = await getToolchainManager().update(toolName as ToolName)
    const paths = marketplacePaths()
    const lockPath = paths.lockFile
    const existing = readLock(lockPath).entries[entry.id]
    const now = Date.now()
    if (status.phase === 'ready') {
      upsertLockRecord(lockPath, {
        id: entry.id,
        kind: 'tool',
        repo: entry.source.repo,
        ref: entry.source.ref,
        installedAt: existing?.installedAt ?? now,
        updatedAt: now,
        status: 'installed',
        targets: status.installedPath ? [status.installedPath] : [],
        toolName,
      })
      return {
        id: entry.id,
        kind: 'tool' as const,
        status: 'installed' as const,
        ref: entry.source.ref,
        toolName,
      }
    }
    // Keep deferred intent so Update can retry; surface failure to the client.
    upsertLockRecord(lockPath, {
      id: entry.id,
      kind: 'tool',
      repo: entry.source.repo,
      ref: entry.source.ref,
      installedAt: existing?.installedAt ?? now,
      updatedAt: now,
      status: 'deferred',
      targets: [],
      toolName,
    })
    throw new CodedError(
      'MARKETPLACE_TOOL_INSTALL_FAILED',
      `Toolchain install of '${toolName}' finished with phase '${status.phase}'${status.error ? `: ${status.error}` : ''}`,
    )
  }

  // Install by catalog id. kind:tool → lock intent + toolchain.update; ready → installed.
  server.handle(RPC_CHANNELS.marketplace.INSTALL, async (_ctx, id: string) => {
    return exclusive(id, async () => {
      const entry = await requireEntry(id)
      const onProgress = (phase: 'clone' | 'verify' | 'install' | 'fetch' | 'collision', detail?: string) => {
        pushTyped(server, RPC_CHANNELS.marketplace.PROGRESS, { to: 'all' }, { id, phase, detail })
      }
      const result = await installEntry(entry, { fetchFn: catalogFetch, onProgress })
      if (result.kind === 'tool' && result.toolName) {
        const final = await finalizeToolInstall(entry, result.toolName, 'installed')
        pushTyped(server, RPC_CHANNELS.marketplace.CHANGED, { to: 'all' }, { id, action: 'installed', ref: entry.source.ref })
        return final
      }
      pushTyped(server, RPC_CHANNELS.marketplace.CHANGED, { to: 'all' }, { id, action: 'installed', ref: entry.source.ref })
      return result
    })
  })

  // Remove artifacts we own (soft-clean: locally-edited targets are kept).
  // kind:tool: lock only — we do NOT uninstall toolchain binaries (shared).
  server.handle(RPC_CHANNELS.marketplace.REMOVE, async (_ctx, id: string) => {
    return exclusive(id, async () => {
      const ref = readLock(marketplacePaths().lockFile).entries[id]?.ref
      const result = removeEntry(id)
      if (result.status !== 'not-installed') {
        pushTyped(server, RPC_CHANNELS.marketplace.CHANGED, { to: 'all' }, ref ? { id, action: 'removed', ref } : { id, action: 'removed' })
      }
      return result
    })
  })

  // Update = re-install from the current catalog pin; requires an installed/deferred record.
  server.handle(RPC_CHANNELS.marketplace.UPDATE, async (_ctx, id: string) => {
    return exclusive(id, async () => {
      if (!readLock(marketplacePaths().lockFile).entries[id]) {
        throw new CodedError('MARKETPLACE_ENTRY_NOT_INSTALLED', `Marketplace entry '${id}' is not installed`)
      }
      const entry = await requireEntry(id)
      const onProgress = (phase: 'clone' | 'verify' | 'install' | 'fetch' | 'collision', detail?: string) => {
        pushTyped(server, RPC_CHANNELS.marketplace.PROGRESS, { to: 'all' }, { id, phase, detail })
      }
      const result = await installEntry(entry, { fetchFn: catalogFetch, onProgress })
      if (result.kind === 'tool' && result.toolName) {
        const final = await finalizeToolInstall(entry, result.toolName, 'updated')
        pushTyped(server, RPC_CHANNELS.marketplace.CHANGED, { to: 'all' }, { id, action: 'updated', ref: entry.source.ref })
        return final
      }
      pushTyped(server, RPC_CHANNELS.marketplace.CHANGED, { to: 'all' }, { id, action: 'updated', ref: entry.source.ref })
      return result
    })
  })

  // Force remote refresh (ETag still honored; 304 keeps the cache body)
  server.handle(RPC_CHANNELS.marketplace.REFRESH, async () => {
    const result = await refreshCatalog({ metaStore, fetchFn: catalogFetch })
    return { ...result, installs: readLock(marketplacePaths().lockFile).entries }
  })
}
