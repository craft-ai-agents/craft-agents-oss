/**
 * RPC handlers for global user memory and per-agent memory.
 */

import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import {
  deleteMemoryEntry,
  listMemoryEvents,
  listAgentMemoryEntries,
  listUserMemoryEntries,
  loadAgentMemory,
  loadUserMemory,
  saveMemoryEntry,
  updateMemoryEntry,
  type DeleteMemoryInput,
  type LoadedMemoryFile,
  type MemoryEntry,
  type MemoryEvent,
  type MemoryEntryType,
  type MemoryMutationEventMetadata,
  type MemoryScope,
  type SaveMemoryInput,
  type UpdateMemoryInput,
} from '@craft-agent/shared/memory'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.memory.LIST_AGENT,
  RPC_CHANNELS.memory.LIST_USER,
  RPC_CHANNELS.memory.LIST_EVENTS,
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
  force?: boolean
}

export interface ListMemoryEventsPayload {
  scope: MemoryScope
  agentSlug?: string | null
}

function broadcastChanged(server: RpcServer, scope: MemoryScope, agentSlug: string | null): void {
  server.push(RPC_CHANNELS.memory.CHANGED, { to: 'all' }, scope, agentSlug)
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

function rpcMemoryEvent(payload: MemoryMutationPayload): MemoryMutationEventMetadata {
  const metadata = payload.metadata ?? {}
  return {
    source: 'rpc',
    runId: typeof metadata.runId === 'string' ? metadata.runId : undefined,
    evidence: typeof metadata.evidence === 'string' ? metadata.evidence : undefined,
    actor: typeof metadata.actor === 'string' ? metadata.actor : undefined,
  }
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
    force: payload.force === true,
    event: rpcMemoryEvent(payload),
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
    event: rpcMemoryEvent(payload),
  }
  return updateMemoryEntry(input)
}

async function deleteMemory(payload: MemoryMutationPayload): Promise<boolean> {
  const agentSlug = requireAgentSlug(payload.scope, payload.agentSlug)
  const input: DeleteMemoryInput = {
    scope: payload.scope,
    agentSlug,
    name: requireName(payload),
    event: rpcMemoryEvent(payload),
  }
  return deleteMemoryEntry(input)
}

export function registerMemoryHandlers(server: RpcServer, deps: HandlerDeps): void {
  void deps

  server.handle(RPC_CHANNELS.memory.LIST_AGENT, async (_ctx, agentSlug: string): Promise<LoadedMemoryFile> => {
    const loaded = loadAgentMemory(agentSlug)
    if (!loaded) throw new Error(`Memory file is invalid or unreadable for agent: ${agentSlug}`)
    return loaded
  })

  server.handle(RPC_CHANNELS.memory.LIST_USER, async (): Promise<LoadedMemoryFile> => {
    const loaded = loadUserMemory()
    if (!loaded) throw new Error('USER.md is invalid or unreadable')
    return loaded
  })

  server.handle(RPC_CHANNELS.memory.LIST_EVENTS, async (_ctx, payload: ListMemoryEventsPayload): Promise<MemoryEvent[]> => {
    const agentSlug = requireAgentSlug(payload.scope, payload.agentSlug)
    return listMemoryEvents(payload.scope, agentSlug)
  })

  server.handle(RPC_CHANNELS.memory.UPSERT, async (_ctx, payload: MemoryMutationPayload): Promise<unknown> => {
    const result = await upsertMemory(payload)
    broadcastChanged(server, payload.scope, payload.scope === 'agent' ? payload.agentSlug ?? null : null)
    return result
  })

  server.handle(RPC_CHANNELS.memory.SAVE, async (_ctx, payload: MemoryMutationPayload): Promise<unknown> => {
    const result = await saveMemory(payload)
    broadcastChanged(server, payload.scope, payload.scope === 'agent' ? payload.agentSlug ?? null : null)
    return result
  })

  server.handle(RPC_CHANNELS.memory.UPDATE, async (_ctx, payload: MemoryMutationPayload): Promise<unknown> => {
    const result = await updateMemory(payload)
    broadcastChanged(server, payload.scope, payload.scope === 'agent' ? payload.agentSlug ?? null : null)
    return result
  })

  server.handle(RPC_CHANNELS.memory.DELETE, async (_ctx, payload: MemoryMutationPayload): Promise<unknown> => {
    const result = await deleteMemory(payload)
    broadcastChanged(server, payload.scope, payload.scope === 'agent' ? payload.agentSlug ?? null : null)
    return result
  })
}
