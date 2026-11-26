import { afterEach, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RemoteServerConfig, Workspace } from '@craft-agent/core/types'
import { listLabelsFlat } from '@craft-agent/shared/labels/storage'
import { RPC_CHANNELS, type Session } from '@craft-agent/shared/protocol'

mock.module('../../logger', () => {
  const stubLog = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }
  return {
    mainLog: stubLog,
    sessionLog: stubLog,
    handlerLog: stubLog,
    windowLog: stubLog,
    agentLog: stubLog,
    searchLog: stubLog,
    isDebugMode: false,
    getLogFilePath: () => '/tmp/main.log',
  }
})

const { localCraftySessions, remoteCraftySessions } = await import('../sessions')

const server: RemoteServerConfig = { url: 'wss://box.example:9100', token: 'secret', remoteWorkspaceId: 'remote-ws' }
const remoteWorkspace = { id: 'local-ws', name: 'Home server', slug: 'home', rootPath: '/unused', createdAt: 0, remoteServer: server } as Workspace

const session = (id: string, fields: Partial<Session> = {}): Session => ({
  id,
  workspaceId: 'remote-ws',
  workspaceName: 'Home server',
  name: `Session ${id}`,
  preview: undefined,
  lastMessageAt: 10,
  messages: [],
  isProcessing: false,
  ...fields,
}) as Session

/** A server that answers the channels in `handlers` and advertises `channels` (all when null). */
function fakeServer(handlers: Record<string, (...args: any[]) => unknown>, channels: string[] | null = null) {
  const calls: Array<{ channel: string; args: unknown[] }> = []
  const discarded: unknown[] = []
  const client = {
    async invoke(channel: string, ...args: unknown[]) {
      calls.push({ channel, args })
      const handler = handlers[channel]
      if (!handler) throw new Error(`unexpected call: ${channel}`)
      return handler(...args)
    },
    isChannelAvailable: (channel: string) => channels === null || channels.includes(channel),
  }
  const sessions = remoteCraftySessions(remoteWorkspace, server, {
    get: async () => client,
    discard: rpc => discarded.push(rpc),
  })
  return { calls, client, discarded, sessions }
}

/** How `WsRpcClient` rejects a request that got no answer in time. */
const timeout = (channel: string) => () => { throw new Error(`Request timeout: ${channel} (120000ms)`) }

describe('remoteCraftySessions', () => {
  it('looks a target up by itself and names its workspace by the id here', async () => {
    const { calls, sessions } = fakeServer({
      [RPC_CHANNELS.sessions.GET_METADATA]: (id: string) => session(id, { isProcessing: true, llmConnection: 'claude-max', model: 'claude-opus-5-5' }),
    })
    expect(await sessions.find('s1')).toEqual({
      workspaceId: 'local-ws',
      sessionId: 's1',
      name: 'Session s1',
      preview: null,
      lastMessageAt: 10,
      isProcessing: true,
      llmConnection: 'claude-max',
      model: 'claude-opus-5-5',
      thinkingLevel: undefined,
    })
    expect(calls).toEqual([{ channel: RPC_CHANNELS.sessions.GET_METADATA, args: ['s1'] }])
  })

  it('finds no target that is archived, hidden, gone or in another workspace', async () => {
    const answers: Record<string, Session | null> = {
      archived: session('archived', { isArchived: true }),
      hidden: session('hidden', { hidden: true }),
      gone: null,
      elsewhere: session('elsewhere', { workspaceId: 'other-ws' }),
    }
    const { sessions } = fakeServer({ [RPC_CHANNELS.sessions.GET_METADATA]: (id: string) => answers[id] })
    for (const id of Object.keys(answers)) expect(await sessions.find(id)).toBeNull()
  })

  it('finds a target in the list on a server older than the single lookup', async () => {
    const { calls, sessions } = fakeServer(
      { [RPC_CHANNELS.sessions.GET]: () => [session('a'), session('b')] },
      [RPC_CHANNELS.sessions.GET],
    )
    expect((await sessions.find('b'))?.sessionId).toBe('b')
    expect(await sessions.find('missing')).toBeNull()
    expect(calls.map(call => call.channel)).toEqual([RPC_CHANNELS.sessions.GET, RPC_CHANNELS.sessions.GET])
  })

  it('lists the sessions that can take questions, in the server order, up to the limit', async () => {
    const { sessions } = fakeServer({
      [RPC_CHANNELS.sessions.GET]: () => [
        session('a'),
        session('archived', { isArchived: true }),
        session('b'),
        session('c'),
      ],
    })
    const listed = await sessions.list(2)
    expect(listed.map(s => s.sessionId)).toEqual(['a', 'b'])
    expect(listed.every(s => s.workspaceId === 'local-ws')).toBe(true)
  })

  it('creates a session labelled crafty on the server, with the pick', async () => {
    const { calls, sessions } = fakeServer({
      [RPC_CHANNELS.labels.LIST]: () => [{ id: 'work', name: 'Work', children: [{ id: 'crafty', name: 'Crafty' }] }],
      [RPC_CHANNELS.sessions.CREATE]: () => session('new', { llmConnection: 'claude-max', model: 'claude-opus-5-5', thinkingLevel: 'high' }),
    })
    const created = await sessions.create({ llmConnection: 'claude-max', model: 'claude-opus-5-5' })
    expect(created).toEqual({ sessionId: 'new', workspaceId: 'local-ws', llmConnection: 'claude-max', model: 'claude-opus-5-5', thinkingLevel: 'high' })
    expect(calls.at(-1)).toEqual({
      channel: RPC_CHANNELS.sessions.CREATE,
      args: ['remote-ws', { labels: ['crafty'], llmConnection: 'claude-max', model: 'claude-opus-5-5' }],
    })
  })

  it('creates the crafty label on the server when it has none', async () => {
    const { calls, sessions } = fakeServer({
      [RPC_CHANNELS.labels.LIST]: () => [{ id: 'work', name: 'Work' }],
      [RPC_CHANNELS.labels.CREATE]: (_workspaceId: string, input: { name: string }) => ({ id: 'crafty', ...input }),
      [RPC_CHANNELS.sessions.CREATE]: () => session('new'),
    })
    await sessions.create({})
    expect(calls.find(call => call.channel === RPC_CHANNELS.labels.CREATE)?.args).toEqual(['remote-ws', { name: 'Crafty', color: 'foreground/50' }])
    expect(calls.at(-1)?.args).toEqual(['remote-ws', { labels: ['crafty'] }])
  })

  it('still creates the session when the label can not be set up', async () => {
    const { calls, sessions } = fakeServer({
      [RPC_CHANNELS.labels.LIST]: () => { throw new Error('labels are broken') },
      [RPC_CHANNELS.sessions.CREATE]: () => session('new'),
    })
    expect((await sessions.create({})).sessionId).toBe('new')
    expect(calls.at(-1)?.args).toEqual(['remote-ws', {}])
  })

  it('runs a one-shot on the server, in the server workspace', async () => {
    const { calls, sessions } = fakeServer({ [RPC_CHANNELS.sessions.RUN_UTILITY_COMPLETION]: () => 'Bonjour' })
    expect(await sessions.complete('Translate: Hello', { llmConnection: 'claude-max', model: 'claude-opus-5-5', thinkingLevel: 'high' })).toBe('Bonjour')
    expect(calls).toEqual([{
      channel: RPC_CHANNELS.sessions.RUN_UTILITY_COMPLETION,
      args: ['remote-ws', 'Translate: Hello', { llmConnection: 'claude-max', model: 'claude-opus-5-5' }],
    }])
  })

  it('says a one-shot needs a newer server instead of calling a channel it lacks', async () => {
    const { calls, sessions } = fakeServer({}, [RPC_CHANNELS.sessions.GET])
    await expect(sessions.complete('x', {})).rejects.toThrow('Rewrite and Translate need a newer version of Craft Agents on the server of “Home server”.')
    expect(calls).toEqual([])
  })

  it('names the server it could not reach', async () => {
    const sessions = remoteCraftySessions(remoteWorkspace, server, {
      get: async () => { throw new Error('ECONNREFUSED') },
      discard: () => {},
    })
    await expect(sessions.list(10)).rejects.toThrow('Couldn\'t reach the server of “Home server”: ECONNREFUSED')
  })

  it('drops a connection a request timed out on, and only for a timeout', async () => {
    const { client, discarded, sessions } = fakeServer({
      [RPC_CHANNELS.sessions.GET]: timeout(RPC_CHANNELS.sessions.GET),
      [RPC_CHANNELS.sessions.GET_METADATA]: () => { throw new Error('Session store is busy') },
    })
    await expect(sessions.list(10)).rejects.toThrow('The server of “Home server” didn\'t answer in time.')
    expect(discarded).toEqual([client])
    await expect(sessions.find('s1')).rejects.toThrow('Session store is busy')
    expect(discarded).toEqual([client])
  })

  it('does not create the session on a connection the label check timed out on', async () => {
    const { calls, client, discarded, sessions } = fakeServer({
      [RPC_CHANNELS.labels.LIST]: timeout(RPC_CHANNELS.labels.LIST),
      [RPC_CHANNELS.sessions.CREATE]: () => session('new'),
    })
    await expect(sessions.create({})).rejects.toThrow('The server of “Home server” didn\'t answer in time.')
    expect(discarded).toEqual([client])
    expect(calls.map(call => call.channel)).toEqual([RPC_CHANNELS.labels.LIST])
  })

  it('creates the label once when two first sessions are created at the same time', async () => {
    let labels: Array<{ id: string; name: string }> = []
    const { calls, sessions } = fakeServer({
      [RPC_CHANNELS.labels.LIST]: async () => {
        await new Promise(resolve => setTimeout(resolve, 5))
        return labels
      },
      [RPC_CHANNELS.labels.CREATE]: (_workspaceId: string, input: { name: string }) => {
        const label = { id: labels.length ? `crafty-${labels.length + 1}` : 'crafty', ...input }
        labels = [...labels, label]
        return label
      },
      [RPC_CHANNELS.sessions.CREATE]: () => session('new'),
    })
    await Promise.all([sessions.create({}), sessions.create({})])
    expect(calls.filter(call => call.channel === RPC_CHANNELS.labels.CREATE)).toHaveLength(1)
    expect(calls.filter(call => call.channel === RPC_CHANNELS.sessions.CREATE).map(call => call.args[1])).toEqual([
      { labels: ['crafty'] },
      { labels: ['crafty'] },
    ])
  })
})

describe('localCraftySessions', () => {
  let root: string | null = null
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
    root = null
  })

  function fakeManager(all: Session[]) {
    const created: Array<{ workspaceId: string; options: unknown }> = []
    let loaded = false
    const manager = {
      async waitForSessionsLoaded() { loaded = true },
      getSessionSnapshot: (id: string) => (loaded ? all.find(s => s.id === id) ?? null : null),
      getSessions: (workspaceId: string) => all.filter(s => s.workspaceId === workspaceId),
      async createSession(workspaceId: string, options: unknown) {
        created.push({ workspaceId, options })
        return session('new', { workspaceId, thinkingLevel: 'medium' })
      },
      runUtilityCompletion: async (workspaceId: string, prompt: string, options: unknown) => JSON.stringify({ workspaceId, prompt, options }),
    }
    return { created, manager: manager as never }
  }

  const localWorkspace = (rootPath: string) => ({ id: 'ws', name: 'Work', slug: 'work', rootPath, createdAt: 0 }) as Workspace
  /** A new workspace starts with default labels; these are Crafty's (a duplicate would be `crafty-2`). */
  const craftyLabels = (rootPath: string) => listLabelsFlat(rootPath).filter(label => label.id.startsWith('crafty'))

  it('finds a target once sessions have loaded, only in its own workspace', async () => {
    const { manager } = fakeManager([session('mine', { workspaceId: 'ws' }), session('theirs', { workspaceId: 'other' })])
    const sessions = localCraftySessions(manager, localWorkspace('/unused'))
    expect((await sessions.find('mine'))?.workspaceId).toBe('ws')
    expect(await sessions.find('theirs')).toBeNull()
  })

  it('lists its sessions that can take questions', async () => {
    const { manager } = fakeManager([
      session('a', { workspaceId: 'ws' }),
      session('hidden', { workspaceId: 'ws', hidden: true }),
      session('b', { workspaceId: 'ws' }),
    ])
    expect((await localCraftySessions(manager, localWorkspace('/unused')).list(10)).map(s => s.sessionId)).toEqual(['a', 'b'])
  })

  it('creates a session labelled crafty, setting the label up in the workspace', async () => {
    root = mkdtempSync(join(tmpdir(), 'crafty-sessions-'))
    const { created, manager } = fakeManager([])
    const result = await localCraftySessions(manager, localWorkspace(root)).create({ model: 'claude-opus-5-5' })
    expect(created).toEqual([{ workspaceId: 'ws', options: { labels: ['crafty'], model: 'claude-opus-5-5' } }])
    expect(result).toEqual({ sessionId: 'new', workspaceId: 'ws', llmConnection: undefined, model: undefined, thinkingLevel: 'medium' })
    expect(craftyLabels(root).map(({ id, name, color }) => ({ id, name, color }))).toEqual([{ id: 'crafty', name: 'Crafty', color: 'foreground/50' }])
  })

  it('creates the label once, also for two sessions at the same time', async () => {
    root = mkdtempSync(join(tmpdir(), 'crafty-sessions-'))
    const { created, manager } = fakeManager([])
    const sessions = localCraftySessions(manager, localWorkspace(root))
    await Promise.all([sessions.create({}), sessions.create({})])
    await sessions.create({})
    expect(craftyLabels(root).map(label => label.id)).toEqual(['crafty'])
    expect(created.map(entry => entry.options)).toEqual([{ labels: ['crafty'] }, { labels: ['crafty'] }, { labels: ['crafty'] }])
  })

  it('runs a one-shot with the pick connection and model only', async () => {
    const { manager } = fakeManager([])
    const raw = await localCraftySessions(manager, localWorkspace('/unused')).complete('Shorter: hi', { llmConnection: 'c', model: 'm', thinkingLevel: 'high' })
    expect(JSON.parse(raw)).toEqual({ workspaceId: 'ws', prompt: 'Shorter: hi', options: { llmConnection: 'c', model: 'm' } })
  })
})
