import { RPC_CHANNELS } from '@archstudio/shared/protocol'
import type { RpcServer } from '@archstudio/server-core/transport'
import type { HandlerDeps } from './handler-deps'
import type { AnyMemory, MemoryEdge, MemoryQuery, MemorySearchResult } from '@archstudio/shared/memory/types'
import { app, shell } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'

import type { MemoryRepository } from '@archstudio/shared/memory/repository'
import type { VaultWatcher } from '@archstudio/shared/memory/vault-watcher'

let repoPromise: Promise<MemoryRepository> | null = null
let vaultPromise: Promise<import('@archstudio/shared/memory/obsidian-sync').ObsidianVaultSync> | null = null
let watcherPromise: Promise<VaultWatcher> | null = null
/** Current vault root path. May be overridden by `memoryVaultPath` in config. */
let currentVaultRoot: string | null = null

/**
 * Resolve the Obsidian vault root directory.
 *
 * Reads `memoryVaultPath` from the stored config. If set and the path
 * exists, uses it. Otherwise falls back to `app.getPath('userData')/vault`,
 * which on macOS is `~/Library/Application Support/ARCHstudio/vault` and
 * on Windows is `%APPDATA%/ARCHstudio/vault`.
 */
function getVaultRoot(): string {
  if (currentVaultRoot) return currentVaultRoot
  try {
    const { loadStoredConfig } = require('@archstudio/shared/config/storage')
    const config = loadStoredConfig()
    if (config?.memoryVaultPath) {
      const customPath = config.memoryVaultPath
      if (existsSync(customPath)) {
        currentVaultRoot = customPath
        return customPath
      }
    }
  } catch {
    // Config not available yet (early boot) — fall through to default
  }
  currentVaultRoot = join(app.getPath('userData'), 'vault')
  return currentVaultRoot
}

/**
 * Check whether the vault path is user-configured (vs. the default).
 */
function isCustomVaultPath(): boolean {
  try {
    const { loadStoredConfig } = require('@archstudio/shared/config/storage')
    const config = loadStoredConfig()
    return !!config?.memoryVaultPath
  } catch {
    return false
  }
}

/**
 * Get (or lazily create) the process-wide singleton MemoryRepository.
 * Shared between the IPC handlers (MemoryPanel) and the agent tools
 * (memory_search / memory_recall) so both paths hit the same SQLite
 * connection and the same FTS5 index.
 */
export async function getMemoryRepository(): Promise<MemoryRepository> {
  if (!repoPromise) {
    repoPromise = (async () => {
      const { openMemoryDatabase, bootstrapStorage } = await import('@archstudio/shared/memory/database')
      const { MemoryRepository } = await import('@archstudio/shared/memory/repository')
      const dbPath = app.getPath('userData')
      const db = openMemoryDatabase(dbPath)
      bootstrapStorage(db)
      return MemoryRepository.createMemoryRepository(db)
    })()
  }
  return repoPromise
}

/**
 * Close the shared MemoryRepository connection. Writes a WAL checkpoint
 * and releases the file lock. Safe to call before the singleton has been
 * created (no-op). Intended for use in the Electron `before-quit` handler.
 */
export async function closeMemoryRepository(): Promise<void> {
  if (!repoPromise) return
  try {
    const repo = await repoPromise
    repo.close()
    repoPromise = null
  } catch (err) {
    console.error('Failed to close memory repository:', err)
  }
}

export async function getVaultSync() {
  if (!vaultPromise) {
    vaultPromise = (async () => {
      const { ObsidianVaultSync } = await import('@archstudio/shared/memory/obsidian-sync')
      return ObsidianVaultSync.createSync(getVaultRoot())
    })()
  }
  return vaultPromise
}

/**
 * Get (or lazily create) the process-wide VaultWatcher singleton.
 * The watcher monitors the vault directory for external file changes
 * and syncs them back into the DB (Phase 4).
 */
export async function getVaultWatcher(): Promise<VaultWatcher> {
  if (!watcherPromise) {
    watcherPromise = (async () => {
      const { VaultWatcher } = await import('@archstudio/shared/memory/vault-watcher')
      const repo = await getMemoryRepository()
      const vault = await getVaultSync()
      const watcher = new VaultWatcher(getVaultRoot(), repo, vault)
      watcher.start()
      return watcher
    })()
  }
  return watcherPromise
}

/**
 * Reset the vault sync + watcher singletons so the next call re-creates
 * them with the new vault path. Called when the user changes the vault
 * path via `VAULT_SET`.
 */
async function resetVaultSync(): Promise<void> {
  // Stop the existing watcher
  if (watcherPromise) {
    try {
      const w = await watcherPromise
      w.stop()
    } catch { /* ignore */ }
  }
  watcherPromise = null
  vaultPromise = null
  currentVaultRoot = null
}

export const CORE_HANDLED_CHANNELS = [
  RPC_CHANNELS.memory.LIST,
  RPC_CHANNELS.memory.GET,
  RPC_CHANNELS.memory.CREATE,
  RPC_CHANNELS.memory.UPDATE,
  RPC_CHANNELS.memory.ARCHIVE,
  RPC_CHANNELS.memory.RESTORE,
  RPC_CHANNELS.memory.DELETE,
  RPC_CHANNELS.memory.SEARCH,
  RPC_CHANNELS.memory.GRAPH,
  RPC_CHANNELS.memory.STATS,
  RPC_CHANNELS.memory.IMPORT,
  RPC_CHANNELS.memory.VAULT_GET,
  RPC_CHANNELS.memory.VAULT_SET,
  RPC_CHANNELS.memory.VAULT_OPEN,
  RPC_CHANNELS.memory.VAULT_SYNC,
  RPC_CHANNELS.memory.VAULT_WATCHER_STATUS,
  RPC_CHANNELS.memory.EDGE_CREATE,
  RPC_CHANNELS.memory.EDGE_DELETE,
  RPC_CHANNELS.memory.EDGE_LIST,
] as const

export function registerMemoryHandlers(server: RpcServer, _deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.memory.LIST, async () => {
    const r = await getMemoryRepository()
    return r.listMemories()
  })

  server.handle(RPC_CHANNELS.memory.GET, async (_ctx, id: string) => {
    const r = await getMemoryRepository()
    return r.getMemory(id) ?? null
  })

  server.handle(RPC_CHANNELS.memory.CREATE, async (_ctx, memory: AnyMemory) => {
    const r = await getMemoryRepository()
    const v = await getVaultSync()
    const created = r.createMemory(memory)
    v.syncMemory(created)
    return created
  })

  server.handle(RPC_CHANNELS.memory.UPDATE, async (_ctx, id: string, patch: Partial<AnyMemory>) => {
    const r = await getMemoryRepository()
    const v = await getVaultSync()
    const updated = r.updateMemory(id, patch)
    v.syncMemory(updated)
    return updated
  })

  server.handle(RPC_CHANNELS.memory.ARCHIVE, async (_ctx, id: string) => {
    const r = await getMemoryRepository()
    const v = await getVaultSync()
    const archived = r.archiveMemory(id)
    v.syncMemory(archived)
    return archived
  })

  server.handle(RPC_CHANNELS.memory.RESTORE, async (_ctx, id: string) => {
    const r = await getMemoryRepository()
    const v = await getVaultSync()
    const restored = r.restoreMemory(id)
    v.syncMemory(restored)
    return restored
  })

  server.handle(RPC_CHANNELS.memory.DELETE, async (_ctx, id: string) => {
    const r = await getMemoryRepository()
    const mem = r.getMemory(id)
    if (mem) {
      const v = await getVaultSync()
      v.removeMemory(mem)
    }
    r.deleteMemory(id)
    return { success: true }
  })

  server.handle(RPC_CHANNELS.memory.GRAPH, async () => {
    const r = await getMemoryRepository()
    return r.getMemoryGraph()
  })

  // Aggregate stats: class distribution, FTS health, vault sync status
  server.handle(RPC_CHANNELS.memory.STATS, async () => {
    const r = await getMemoryRepository()
    return r.getMemoryStats(getVaultRoot())
  })

  // Full-text search: bm25 ranked hits with snippet highlighting. Empty
  // `query.query` degenerates to a filtered list (no FTS overhead). The
  // FILTER columns (class/scope/tags/category/confidence) are applied in
  // SQL with parameter binding — escapes any injection risk from the
  // user-supplied `MemoryQuery`.
  //
  // Phase 7 — Hybrid retrieval: after FTS5 returns the top hits, we
  // expand each hit via 1-hop graph edges (`findRelated`) and merge the
  // related memories into the result set. This surfaces connected
  // memories that may not share keywords with the query but are
  // semantically linked through the graph.
  server.handle(RPC_CHANNELS.memory.SEARCH, async (_ctx, query: MemoryQuery): Promise<MemorySearchResult[]> => {
    const r = await getMemoryRepository()
    const ftsResults = r.searchMemories(query)

    // Hybrid retrieval: expand top FTS hits with 1-hop graph neighbors
    const expandDepth = 1
    const expandPerHit = 3
    const ftsHitIds = new Set(ftsResults.map((res) => res.memory.id))
    const related: MemorySearchResult[] = []

    for (const hit of ftsResults.slice(0, 5)) {
      const neighbors = r.findRelated(hit.memory.id, expandDepth, expandPerHit)
      for (const neighbor of neighbors) {
        if (!ftsHitIds.has(neighbor.memory.id)) {
          // Don't add duplicates from multiple hit expansions
          if (!related.some((r2) => r2.memory.id === neighbor.memory.id)) {
            related.push(neighbor)
          }
        }
      }
    }

    // Merge: FTS results first (higher confidence), then related
    return [...ftsResults, ...related]
  })

  /**
   * Bulk-import memories from the Obsidian vault on disk.
   */
  server.handle(RPC_CHANNELS.memory.IMPORT, async (): Promise<{
    read: number
    imported: number
    skipped: number
    errors: Array<{ message: string; filePath?: string }>
  }> => {
    const r = await getMemoryRepository()
    const v = await getVaultSync()
    const { records, errors: readErrors } = v.readVault()
    const stats = r.importMemories(records, 'obsidian-vault-sync')
    const combinedErrors = [
      ...readErrors.map((e) => ({ message: e.message, filePath: e.filePath })),
      ...stats.errors,
    ]
    return {
      read: records.length + readErrors.length,
      imported: stats.imported,
      skipped: stats.skipped,
      errors: combinedErrors,
    }
  })

  // ── Phase 3: Vault configuration ───────────────────────────────────

  server.handle(RPC_CHANNELS.memory.VAULT_GET, async () => {
    const path = getVaultRoot()
    return {
      path,
      isCustom: isCustomVaultPath(),
      exists: existsSync(path),
    }
  })

  server.handle(RPC_CHANNELS.memory.VAULT_SET, async (_ctx, path: string) => {
    // Persist to config
    const { loadStoredConfig, saveConfig } = await import('@archstudio/shared/config/storage')
    const config = loadStoredConfig()
    if (config) {
      config.memoryVaultPath = path
      saveConfig(config)
    }
    // Reset vault sync singleton so next call re-creates with new path
    await resetVaultSync()
    // Re-create vault sync and export existing memories to the new vault
    const v = await getVaultSync()
    const r = await getMemoryRepository()
    const memories = r.listMemories()
    for (const mem of memories) {
      if (!mem.archived) v.syncMemory(mem)
    }
    return { success: true, path: getVaultRoot() }
  })

  server.handle(RPC_CHANNELS.memory.VAULT_OPEN, async () => {
    const path = getVaultRoot()
    await shell.openPath(path)
    return { success: true }
  })

  // Phase 4: Full bidirectional sync
  server.handle(RPC_CHANNELS.memory.VAULT_SYNC, async () => {
    const watcher = await getVaultWatcher()
    return watcher.fullSync()
  })

  // Phase 4: Watcher status
  server.handle(RPC_CHANNELS.memory.VAULT_WATCHER_STATUS, async () => {
    if (!watcherPromise) return { active: false }
    try {
      const w = await watcherPromise
      return { active: w.isActive() }
    } catch {
      return { active: false }
    }
  })

  // ── Phase 6: Edge CRUD ──────────────────────────────────────────────

  server.handle(RPC_CHANNELS.memory.EDGE_CREATE, async (_ctx, params: {
    sourceId: string
    targetId: string
    type: string
    weight?: number
  }): Promise<MemoryEdge> => {
    const r = await getMemoryRepository()
    return r.createEdge(
      params.sourceId,
      params.targetId,
      params.type as MemoryEdge['type'],
      params.weight ?? 1,
    )
  })

  server.handle(RPC_CHANNELS.memory.EDGE_DELETE, async (_ctx, edgeId: string) => {
    const r = await getMemoryRepository()
    const deleted = r.deleteEdge(edgeId)
    return { success: deleted }
  })

  server.handle(RPC_CHANNELS.memory.EDGE_LIST, async (_ctx, memoryId: string): Promise<MemoryEdge[]> => {
    const r = await getMemoryRepository()
    return r.getEdgesForMemory(memoryId)
  })
}