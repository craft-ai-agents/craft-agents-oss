import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from './handler-deps'
import type { AnyMemory, MemoryQuery } from '@craft-agent/shared/memory/types'
import { app } from 'electron'

let repoPromise: Promise<import('@craft-agent/shared/memory/repository').MemoryRepository> | null = null
let vaultPromise: Promise<import('@craft-agent/shared/memory/obsidian-sync').ObsidianVaultSync> | null = null

const DEFAULT_VAULT_ROOT = 'D:\\OwnerAgent\\vault'

async function getMemoryRepository() {
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

async function getVaultSync() {
  if (!vaultPromise) {
    vaultPromise = (async () => {
      const { ObsidianVaultSync } = await import('@craft-agent/shared/memory/obsidian-sync')
      return ObsidianVaultSync.createSync(DEFAULT_VAULT_ROOT)
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

  server.handle(RPC_CHANNELS.memory.SEARCH, async (_ctx, query: MemoryQuery) => {
    const r = await getMemoryRepository()
    const all = r.listMemories()
    const q = query.query?.toLowerCase() ?? ''
    return all.filter((m) => {
      if (query.class && m.class !== query.class) return false
      if (query.scope && m.scope !== query.scope) return false
      if (query.scopeId && m.scopeId !== query.scopeId) return false
      if (query.minConfidence && m.confidence < query.minConfidence) return false
      if (query.includeArchived !== true && m.archived) return false
      if (query.tags && !query.tags.every((t) => m.tags.includes(t))) return false
      if (q && !m.title.toLowerCase().includes(q) && !m.content.toLowerCase().includes(q)) return false
      return true
    })
  })
}
