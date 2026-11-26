import { describe, expect, it } from 'bun:test'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { HandlerFn, RequestContext, RpcServer } from '../../transport/types'
import type { HandlerDeps } from '../handler-deps'
import { registerSessionsHandlers } from './sessions'

/** The sessions handlers over a stand-in session manager: what each call reached. */
function harness() {
  const handlers = new Map<string, HandlerFn>()
  const server: RpcServer = {
    handle(channel, handler) { handlers.set(channel, handler) },
    push() {},
    async invokeClient() { return undefined },
    hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
  }
  const calls: Array<{ method: string; args: unknown[] }> = []
  const record = (method: string) => (...args: unknown[]) => { calls.push({ method, args }) }
  const sessionManager = {
    async waitForSessionsLoaded() {},
    getSessionSnapshot: (sessionId: string) => (sessionId === 'known' ? { id: 'known', workspaceId: 'ws', messages: [] } : null),
    async createSession(workspaceId: string, options: unknown, internal: unknown) {
      record('createSession')(workspaceId, options, internal)
      return { id: 'new-session', workspaceId, messages: [] }
    },
    notifySessionCreated: record('notifySessionCreated'),
    async runUtilityCompletion(workspaceId: string, prompt: string, options: unknown) {
      record('runUtilityCompletion')(workspaceId, prompt, options)
      return 'done'
    },
  }
  const log = { info() {}, warn() {}, error() {}, debug() {} }
  registerSessionsHandlers(server, { sessionManager, platform: { logger: log } } as unknown as HandlerDeps)
  const call = (channel: string, ctx: Partial<RequestContext>, ...args: unknown[]) => {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`${channel} isn't registered`)
    return handler({ clientId: 'client-1', workspaceId: 'ws', webContentsId: null, ...ctx }, ...args)
  }
  return { call, calls }
}

describe('sessions:create', () => {
  it('announces the session to every client of the workspace but the one that created it', async () => {
    const { call, calls } = harness()
    const session = await call(RPC_CHANNELS.sessions.CREATE, { clientId: 'crafty' }, 'ws', { labels: ['crafty'] })
    expect(session).toMatchObject({ id: 'new-session' })
    expect(calls).toEqual([
      { method: 'createSession', args: ['ws', { labels: ['crafty'] }, { emitCreatedEvent: false }] },
      { method: 'notifySessionCreated', args: ['ws', 'new-session', { exclude: 'crafty' }] },
    ])
  })
})

describe('sessions:getMetadata', () => {
  it('returns one session without its messages, null for an unknown id', async () => {
    const { call } = harness()
    expect(await call(RPC_CHANNELS.sessions.GET_METADATA, {}, 'known')).toMatchObject({ id: 'known' })
    expect(await call(RPC_CHANNELS.sessions.GET_METADATA, {}, 'missing')).toBeNull()
  })
})

describe('sessions:runUtilityCompletion', () => {
  it('runs the prompt in the workspace on the given connection and model', async () => {
    const { call, calls } = harness()
    expect(await call(RPC_CHANNELS.sessions.RUN_UTILITY_COMPLETION, {}, 'ws', 'Translate: hi', { llmConnection: 'claude-max', model: 'claude-opus-5-5' })).toBe('done')
    expect(calls).toEqual([{ method: 'runUtilityCompletion', args: ['ws', 'Translate: hi', { llmConnection: 'claude-max', model: 'claude-opus-5-5' }] }])
  })

  it('passes only string options on', async () => {
    const { call, calls } = harness()
    await call(RPC_CHANNELS.sessions.RUN_UTILITY_COMPLETION, {}, 'ws', 'Shorter: hi', { llmConnection: 42, model: '' })
    expect(calls[0]?.args[2]).toEqual({ llmConnection: undefined, model: undefined })
  })

  it('refuses an empty or oversized prompt before any model runs', async () => {
    const { call, calls } = harness()
    await expect(call(RPC_CHANNELS.sessions.RUN_UTILITY_COMPLETION, {}, 'ws', '   ')).rejects.toThrow('The prompt is empty.')
    await expect(call(RPC_CHANNELS.sessions.RUN_UTILITY_COMPLETION, {}, 'ws', 'x'.repeat(50_001))).rejects.toThrow('too long')
    expect(calls).toEqual([])
  })
})
