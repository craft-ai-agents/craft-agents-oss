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
  listAgentMemoryEntries,
  listUserMemoryEntries,
  loadAgentMemory,
  loadUserMemory,
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
})
