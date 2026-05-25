/**
 * RPC handlers for global user memory and per-agent memory.
 */

import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import {
  deleteMemoryEntry,
  enqueueMemoryReviewItem,
  appendMemoryEvent,
  listMemoryReviewItems,
  listMemoryEvents,
  listAgentMemoryEntries,
  listUserMemoryEntries,
  loadAgentMemory,
  loadUserMemory,
  recallMemoryEntries,
  resolveMemoryReviewItem,
  saveMemoryEntry,
  updateMemoryEntry,
  type ApplyMemoryReviewInput,
  type DeleteMemoryInput,
  type EnqueueMemoryReviewInput,
  type LoadedMemoryFile,
  type MemoryEntry,
  type MemoryEvent,
  type MemoryEntryType,
  type MemoryMutationEventMetadata,
  type MemoryRecallResult,
  type MemoryReviewItem,
  type MemoryScope,
  type RecallMemoryInput,
  type ResolveMemoryReviewInput,
  type SaveMemoryInput,
  type UpdateMemoryInput,
} from '@craft-agent/shared/memory'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.memory.LIST_AGENT,
  RPC_CHANNELS.memory.LIST_USER,
  RPC_CHANNELS.memory.RECALL,
  RPC_CHANNELS.memory.LIST_EVENTS,
  RPC_CHANNELS.memory.LIST_REVIEW_QUEUE,
  RPC_CHANNELS.memory.ENQUEUE_REVIEW,
  RPC_CHANNELS.memory.RESOLVE_REVIEW,
  RPC_CHANNELS.memory.APPLY_REVIEW,
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

let memoryReviewApplyLock = Promise.resolve()

function withMemoryReviewApplyLock<T>(work: () => Promise<T>): Promise<T> {
  const run = memoryReviewApplyLock.then(work, work)
  memoryReviewApplyLock = run.then(() => undefined, () => undefined)
  return run
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

function entriesForReviewItem(item: MemoryReviewItem): MemoryEntry[] {
  return item.scope === 'user'
    ? listUserMemoryEntries()
    : listAgentMemoryEntries(requireAgentSlug(item.scope, item.agentSlug)!)
}

function reviewSaveAlreadyApplied(item: MemoryReviewItem): boolean {
  const body = item.body?.trim()
  if (!body) return false
  return entriesForReviewItem(item).some((entry) => (
    entry.name === item.name.trim() &&
    entry.body.trim() === body
  ))
}

async function applyMemoryReview(payload: ApplyMemoryReviewInput): Promise<MemoryReviewItem | null> {
  return withMemoryReviewApplyLock(async () => {
    const item = listMemoryReviewItems().find((candidate) => candidate.id === payload.id.trim())
    if (!item) return null
    if (item.status !== 'pending') return item

    const event: MemoryMutationEventMetadata = {
      source: 'rpc',
      runId: item.sourceRunId,
      actor: 'memory-review',
      evidence: item.evidence,
    }

    if (item.action === 'save') {
      if (!item.type || !item.body) throw new Error('Save proposal is missing type or body')
      if (!reviewSaveAlreadyApplied(item)) {
        await saveMemoryEntry({
          scope: item.scope,
          agentSlug: requireAgentSlug(item.scope, item.agentSlug),
          name: item.name,
          type: item.type,
          body: item.body,
          expires: item.expires ?? undefined,
          force: true,
          event,
        })
      }
    } else if (item.action === 'update') {
      const updated = await updateMemoryEntry({
        scope: item.scope,
        agentSlug: requireAgentSlug(item.scope, item.agentSlug),
        name: item.name,
        body: item.body,
        expires: item.expires,
        event,
      })
      if (!updated) throw new Error(`Memory not found: ${item.name}`)
    } else {
      const deleted = await deleteMemoryEntry({
        scope: item.scope,
        agentSlug: requireAgentSlug(item.scope, item.agentSlug),
        name: item.name,
        event,
      })
      if (!deleted) throw new Error(`Memory not found: ${item.name}`)
    }

    return resolveMemoryReviewItem({
      id: item.id,
      status: 'applied',
      decisionReason: payload.decisionReason,
    })
  })
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

  server.handle(RPC_CHANNELS.memory.RECALL, async (_ctx, payload: RecallMemoryInput): Promise<MemoryRecallResult[]> => {
    const results = recallMemoryEntries(payload)
    if (results.length > 0) {
      await Promise.all(results.map((result) => {
        return appendMemoryEvent('recall', result.scope, result.agentSlug, result.entry.name, undefined, {
          source: 'rpc',
          evidence: payload.query,
        })
      }))
    }
    return results
  })

  server.handle(RPC_CHANNELS.memory.LIST_EVENTS, async (_ctx, payload: ListMemoryEventsPayload): Promise<MemoryEvent[]> => {
    const agentSlug = requireAgentSlug(payload.scope, payload.agentSlug)
    return listMemoryEvents(payload.scope, agentSlug)
  })

  server.handle(RPC_CHANNELS.memory.LIST_REVIEW_QUEUE, async (): Promise<MemoryReviewItem[]> => {
    return listMemoryReviewItems()
  })

  server.handle(RPC_CHANNELS.memory.ENQUEUE_REVIEW, async (_ctx, payload: EnqueueMemoryReviewInput): Promise<MemoryReviewItem> => {
    return enqueueMemoryReviewItem(payload)
  })

  server.handle(RPC_CHANNELS.memory.RESOLVE_REVIEW, async (_ctx, payload: ResolveMemoryReviewInput): Promise<MemoryReviewItem | null> => {
    return resolveMemoryReviewItem(payload)
  })

  server.handle(RPC_CHANNELS.memory.APPLY_REVIEW, async (_ctx, payload: ApplyMemoryReviewInput): Promise<MemoryReviewItem | null> => {
    const result = await applyMemoryReview(payload)
    if (result) {
      broadcastChanged(server, result.scope, result.scope === 'agent' ? result.agentSlug ?? null : null)
    }
    return result
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
