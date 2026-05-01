/**
 * RPC handlers for global user memory and per-agent memory.
 */

import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import {
  deleteMemoryEntry,
  listAgentMemoryEntries,
  listUserMemoryEntries,
  saveMemoryEntry,
  updateMemoryEntry,
  type DeleteMemoryInput,
  type MemoryEntry,
  type MemoryEntryType,
  type MemoryScope,
  type SaveMemoryInput,
  type UpdateMemoryInput,
} from '@craft-agent/shared/memory'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.memory.LIST_AGENT,
  RPC_CHANNELS.memory.LIST_USER,
  RPC_CHANNELS.memory.UPSERT,
  RPC_CHANNELS.memory.SAVE,
  RPC_CHANNELS.memory.UPDATE,
  RPC_CHANNELS.memory.DELETE,
] as const

export interface MemoryMutationPayload {
  scope: MemoryScope
  agentSlug?: string | null
  name?: string
  type?: MemoryEntryType
  body?: string
  content?: string
  metadata?: Record<string, unknown>
  expires?: string | null
}

function broadcastChanged(deps: HandlerDeps, scope: MemoryScope, agentSlug: string | null): void {
  const wsServerLike = deps as unknown as { wsServer?: { push?: (...args: unknown[]) => void } }
  wsServerLike.wsServer?.push?.(RPC_CHANNELS.memory.CHANGED, { to: 'all' }, scope, agentSlug)
}

function requireAgentSlug(scope: MemoryScope, agentSlug: string | null | undefined): string | undefined {
  if (scope === 'user') return undefined
  const slug = agentSlug?.trim()
  if (!slug) throw new Error('agentSlug is required for agent memory')
  return slug
}

function requireName(payload: MemoryMutationPayload): string {
  const name = payload.name?.trim()
  if (!name) throw new Error('name is required')
  return name
}

function requireType(payload: MemoryMutationPayload): MemoryEntryType {
  if (!payload.type) throw new Error('type is required')
  return payload.type
}

function requireBody(payload: MemoryMutationPayload): string {
  const body = (payload.body ?? payload.content)?.trim()
  if (!body) throw new Error('body/content is required')
  return body
}

async function saveMemory(payload: MemoryMutationPayload): Promise<MemoryEntry> {
  const agentSlug = requireAgentSlug(payload.scope, payload.agentSlug)
  const input: SaveMemoryInput = {
    scope: payload.scope,
    agentSlug,
    name: requireName(payload),
    type: requireType(payload),
    body: requireBody(payload),
    expires: typeof payload.expires === 'string' ? payload.expires : undefined,
  }
  return saveMemoryEntry(input)
}

async function upsertMemory(payload: MemoryMutationPayload): Promise<MemoryEntry> {
  const agentSlug = requireAgentSlug(payload.scope, payload.agentSlug)
  const name = requireName(payload)
  const existing = payload.scope === 'user'
    ? listUserMemoryEntries()
    : listAgentMemoryEntries(agentSlug!)
  if (existing.some((entry) => entry.name === name)) {
    const updated = await updateMemory({
      ...payload,
      name,
      agentSlug,
    })
    if (!updated) throw new Error(`Memory not found: ${name}`)
    return updated
  }
  return saveMemory(payload)
}

async function updateMemory(payload: MemoryMutationPayload): Promise<MemoryEntry | null> {
  const agentSlug = requireAgentSlug(payload.scope, payload.agentSlug)
  const input: UpdateMemoryInput = {
    scope: payload.scope,
    agentSlug,
    name: requireName(payload),
    body: payload.body ?? payload.content,
    expires: payload.expires,
  }
  return updateMemoryEntry(input)
}

async function deleteMemory(payload: MemoryMutationPayload): Promise<boolean> {
  const agentSlug = requireAgentSlug(payload.scope, payload.agentSlug)
  const input: DeleteMemoryInput = {
    scope: payload.scope,
    agentSlug,
    name: requireName(payload),
  }
  return deleteMemoryEntry(input)
}

export function registerMemoryHandlers(server: RpcServer, deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.memory.LIST_AGENT, async (_ctx, agentSlug: string): Promise<MemoryEntry[]> => {
    return listAgentMemoryEntries(agentSlug)
  })

  server.handle(RPC_CHANNELS.memory.LIST_USER, async (): Promise<MemoryEntry[]> => {
    return listUserMemoryEntries()
  })

  server.handle(RPC_CHANNELS.memory.UPSERT, async (_ctx, payload: MemoryMutationPayload): Promise<unknown> => {
    const result = await upsertMemory(payload)
    broadcastChanged(deps, payload.scope, payload.scope === 'agent' ? payload.agentSlug ?? null : null)
    return result
  })

  server.handle(RPC_CHANNELS.memory.SAVE, async (_ctx, payload: MemoryMutationPayload): Promise<unknown> => {
    const result = await saveMemory(payload)
    broadcastChanged(deps, payload.scope, payload.scope === 'agent' ? payload.agentSlug ?? null : null)
    return result
  })

  server.handle(RPC_CHANNELS.memory.UPDATE, async (_ctx, payload: MemoryMutationPayload): Promise<unknown> => {
    const result = await updateMemory(payload)
    broadcastChanged(deps, payload.scope, payload.scope === 'agent' ? payload.agentSlug ?? null : null)
    return result
  })

  server.handle(RPC_CHANNELS.memory.DELETE, async (_ctx, payload: MemoryMutationPayload): Promise<unknown> => {
    const result = await deleteMemory(payload)
    broadcastChanged(deps, payload.scope, payload.scope === 'agent' ? payload.agentSlug ?? null : null)
    return result
  })
}
