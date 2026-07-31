import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from './handler-deps'
import type { AnyMemory, MemoryQuery, MemorySearchResult } from '@craft-agent/shared/memory/types'
import { app } from 'electron'

import type { MemoryRepository } from '@craft-agent/shared/memory/repository'
import { join } from 'path'

let repoPromise: Promise<MemoryRepository> | null = null
let vaultPromise: Promise<import('@craft-agent/shared/memory/obsidian-sync').ObsidianVaultSync> | null = null

/**
 * Resolve the Obsidian vault root directory.
 *
 * Derived from `app.getPath('userData')`, which on macOS is
 * `~/Library/Application Support/ARCHstudio/` and on Windows is
 * `%APPDATA%/ARCHstudio/`. This matches the `getMemoryRepository()`
 * database path so the vault is a sibling of the memory DB.
 */
function getVaultRoot(): string {
  return join(app.getPath('userData'), 'vault')
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
      const { openMemoryDatabase, bootstrapStorage } = await import('@craft-agent/shared/memory/database')
      const { MemoryRepository } = await import('@craft-agent/shared/memory/repository')
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
      const { ObsidianVaultSync } = await import('@craft-agent/shared/memory/obsidian-sync')
      return ObsidianVaultSync.createSync(getVaultRoot())
    })()
  }
  return vaultPromise
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
  server.handle(RPC_CHANNELS.memory.SEARCH, async (_ctx, query: MemoryQuery): Promise<MemorySearchResult[]> => {
    const r = await getMemoryRepository()
    return r.searchMemories(query)
  })

  /**
   * Bulk-import memories from the Obsidian vault on disk. Reads every
   * `.md` file in the four class folders, parses them into typed
   * `AnyMemory`s, and writes them back through the repository's bulk
   * importer (with skip-dedupe + per-row audit 'import' entries).
   *
   * Returns counts so the renderer can show a stats toast. Reads are
   * synchronous; the database transaction wraps the import batch so a
   * crash midway leaves zero partial rows behind.
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
    // Combine vault-read failures (malformed frontmatter, missing
    // delimiters) with import-time failures (parse / DB errors) into a
    // single shape so the renderer doesn't have to merge them.
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
}
