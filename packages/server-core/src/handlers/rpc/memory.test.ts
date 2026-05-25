import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { HandlerFn, RequestContext, RpcServer } from '../../transport/types'
import type { HandlerDeps } from '../handler-deps'

const saveMemoryEntry = mock(async (input: any) => ({
  name: input.name,
  type: input.type,
  created: '2026-05-01',
  body: input.body,
}))
const updateMemoryEntry = mock(async (input: any) => ({
  name: input.name,
  type: 'reference',
  created: '2026-05-01',
  body: input.body ?? 'Body.',
}))
const deleteMemoryEntry = mock(async () => true)
const listMemoryEvents = mock(() => [{
  id: 'evt_1',
  action: 'save',
  scope: 'user',
  entryName: 'Preferred writing style',
  source: 'rpc',
  createdAt: '2026-05-01T00:00:00.000Z',
}])
const listMemoryReviewItems = mock(() => [{
  id: 'rev_1',
  status: 'pending',
  action: 'save',
  scope: 'user',
  name: 'Preferred writing style',
  type: 'feedback',
  body: 'Use direct language.',
  confidence: 0.9,
  source: 'sidecar',
  createdAt: '2026-05-01T00:00:00.000Z',
}])
const enqueueMemoryReviewItem = mock((input: any) => ({
  id: 'rev_2',
  status: 'pending',
  createdAt: '2026-05-01T00:00:00.000Z',
  source: 'sidecar',
  ...input,
}))
const resolveMemoryReviewItem = mock((input: any) => ({
  id: input.id,
  status: input.status,
  action: 'save',
  scope: 'user',
  name: 'Preferred writing style',
  confidence: 0.9,
  source: 'sidecar',
  createdAt: '2026-05-01T00:00:00.000Z',
  decidedAt: '2026-05-01T00:01:00.000Z',
}))
const listUserMemoryEntries = mock(() => [])
const listAgentMemoryEntries = mock(() => [])
const loadUserMemory = mock(() => ({
  scope: 'user',
  envelope: { version: 1 },
  entries: [],
  filePath: '/tmp/USER.md',
}))
const loadAgentMemory = mock((agentSlug: string) => ({
  scope: 'agent',
  agentSlug,
  envelope: { version: 1, agent: agentSlug },
  entries: [],
  filePath: `/tmp/agents/${agentSlug}/MEMORY.md`,
}))

mock.module('@craft-agent/shared/memory', () => ({
  deleteMemoryEntry,
  enqueueMemoryReviewItem,
  listMemoryReviewItems,
  listMemoryEvents,
  listAgentMemoryEntries,
  listUserMemoryEntries,
  loadAgentMemory,
  loadUserMemory,
  resolveMemoryReviewItem,
  saveMemoryEntry,
  updateMemoryEntry,
}))

function createHarness() {
  const handlers = new Map<string, HandlerFn>()
  const pushCalls: Array<{ channel: string; target: any; args: any[] }> = []

  const server: RpcServer = {
    handle(channel, handler) {
      handlers.set(channel, handler)
    },
    push(channel, target, ...args) {
      pushCalls.push({ channel, target, args })
    },
    async invokeClient() {
      return undefined
    },
  }

  return { handlers, pushCalls, server }
}

const deps = {
  sessionManager: {},
  oauthFlowStore: {},
  platform: {
    appRootPath: '/',
    resourcesPath: '/',
    isPackaged: false,
    appVersion: '0.0.0-test',
    isDebugMode: true,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    imageProcessor: {
      getMetadata: async () => null,
      process: async () => Buffer.from(''),
    },
  },
} as unknown as HandlerDeps

function ctx(): RequestContext {
  return {
    clientId: 'c1',
    workspaceId: 'ws-1',
    webContentsId: 1,
  }
}

beforeEach(() => {
  saveMemoryEntry.mockClear()
  updateMemoryEntry.mockClear()
  deleteMemoryEntry.mockClear()
  listMemoryEvents.mockClear()
  listMemoryReviewItems.mockClear()
  enqueueMemoryReviewItem.mockClear()
  resolveMemoryReviewItem.mockClear()
  listUserMemoryEntries.mockClear()
  listAgentMemoryEntries.mockClear()
  loadUserMemory.mockClear()
  loadAgentMemory.mockClear()
})

describe('memory RPC handlers', () => {
  it('passes force through save and broadcasts through the RPC server', async () => {
    const { handlers, pushCalls, server } = createHarness()
    const { registerMemoryHandlers } = await import('./memory')
    registerMemoryHandlers(server, deps)

    const save = handlers.get(RPC_CHANNELS.memory.SAVE)
    if (!save) throw new Error('memory save handler not registered')

    await save(ctx(), {
      scope: 'user',
      name: 'Preferred writing style',
      type: 'user',
      body: 'Use direct language.',
      force: true,
    })

    expect(saveMemoryEntry).toHaveBeenCalledWith({
      scope: 'user',
      agentSlug: undefined,
      name: 'Preferred writing style',
      type: 'user',
      body: 'Use direct language.',
      expires: undefined,
      force: true,
      event: {
        source: 'rpc',
        runId: undefined,
        evidence: undefined,
        actor: undefined,
      },
    })
    expect(pushCalls).toEqual([{
      channel: RPC_CHANNELS.memory.CHANGED,
      target: { to: 'all' },
      args: ['user', null],
    }])
  })

  it('passes force through upsert-created entries while leaving existing entries as updates', async () => {
    const { handlers, server } = createHarness()
    const { registerMemoryHandlers } = await import('./memory')
    registerMemoryHandlers(server, deps)

    const upsert = handlers.get(RPC_CHANNELS.memory.UPSERT)
    if (!upsert) throw new Error('memory upsert handler not registered')

    await upsert(ctx(), {
      scope: 'agent',
      agentSlug: 'helper',
      name: 'Preferred writing style',
      type: 'feedback',
      body: 'Use terse notes.',
      force: true,
    })

    expect(saveMemoryEntry).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'agent',
      agentSlug: 'helper',
      name: 'Preferred writing style',
      force: true,
    }))
  })

  it('lists memory audit events for a scope', async () => {
    const { handlers, server } = createHarness()
    const { registerMemoryHandlers } = await import('./memory')
    registerMemoryHandlers(server, deps)

    const listEvents = handlers.get(RPC_CHANNELS.memory.LIST_EVENTS)
    if (!listEvents) throw new Error('memory list events handler not registered')

    const result = await listEvents(ctx(), { scope: 'agent', agentSlug: 'helper' })

    expect(listMemoryEvents).toHaveBeenCalledWith('agent', 'helper')
    expect(result).toEqual([expect.objectContaining({
      id: 'evt_1',
      action: 'save',
      entryName: 'Preferred writing style',
    })])
  })

  it('lists and mutates memory review queue items', async () => {
    const { handlers, server } = createHarness()
    const { registerMemoryHandlers } = await import('./memory')
    registerMemoryHandlers(server, deps)

    const listQueue = handlers.get(RPC_CHANNELS.memory.LIST_REVIEW_QUEUE)
    const enqueue = handlers.get(RPC_CHANNELS.memory.ENQUEUE_REVIEW)
    const resolve = handlers.get(RPC_CHANNELS.memory.RESOLVE_REVIEW)
    if (!listQueue || !enqueue || !resolve) throw new Error('memory review handlers not registered')

    const queue = await listQueue(ctx())
    expect(listMemoryReviewItems).toHaveBeenCalled()
    expect(queue).toEqual([expect.objectContaining({ id: 'rev_1', status: 'pending' })])

    await enqueue(ctx(), {
      action: 'save',
      scope: 'user',
      name: 'Preferred writing style',
      type: 'feedback',
      body: 'Use direct language.',
      confidence: 0.9,
    })
    expect(enqueueMemoryReviewItem).toHaveBeenCalledWith(expect.objectContaining({
      action: 'save',
      scope: 'user',
      name: 'Preferred writing style',
    }))

    const resolved = await resolve(ctx(), { id: 'rev_1', status: 'approved' })
    expect(resolveMemoryReviewItem).toHaveBeenCalledWith({ id: 'rev_1', status: 'approved' })
    expect(resolved).toEqual(expect.objectContaining({ id: 'rev_1', status: 'approved' }))
  })
})
