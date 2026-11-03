import { describe, expect, it } from 'bun:test'
import { tool } from '@anthropic-ai/claude-agent-sdk'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { ClaudeAgent, claudeThinkingKey } from '../claude-agent.ts'
import { createPushableInputStream } from '../backend/claude/persistent-input.ts'
import { createToolServer, liveMcpServers } from '../backend/claude/live-mcp-servers.ts'

// Keep-alive: the persistent query reads mcpServers only when created, so a source turned on or off
// mid-session reached a running Claude session only after the query was restarted.
function server(name: string, toolNames: string[]) {
  return createToolServer({
    name,
    version: '1.0.0',
    tools: toolNames.map(toolName => tool(toolName, toolName, {}, async () => ({ content: [] }))),
  })
}

/** A server whose tool `slow` runs until finish() is called, with a client to call it (a background agent's call). */
async function busyServer(name: string, toolNames: string[]) {
  let finish!: () => void
  let started!: () => void
  const running = new Promise<void>((resolve) => { started = resolve })
  const busy = createToolServer({
    name,
    version: '1.0.0',
    tools: [...toolNames.map(toolName => tool(toolName, toolName, {}, async () => ({ content: [] }))),
      tool('slow', 'slow', {}, () => new Promise((resolve) => { finish = () => resolve({ content: [] }); started() }))],
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await busy.instance.connect(serverTransport)
  const client = new Client({ name: 'background-agent', version: '1.0.0' })
  await client.connect(clientTransport)
  const call = client.callTool({ name: 'slow', arguments: {} })
  await running
  return { server: busy, finish: async () => { finish(); await call } }
}

const THINKING = { thinking: { type: 'adaptive' as const }, effort: 'high' as const }

/** A live query that, like the SDK, reports what each setMcpServers call added and removed. */
function fakeQuery(initial: string[]) {
  const fake = {
    calls: [] as string[][],
    live: [...initial],
    fail: false,
    status: (_name: string): string => 'connected',
    statusChecks: 0,
    applyFlagSettings: async () => {},
    setMaxThinkingTokens: async () => {},
    async setMcpServers(next: Record<string, unknown>) {
      const names = Object.keys(next)
      fake.calls.push(names)
      if (fake.fail) throw new Error('query closed')
      const added = names.filter(name => !fake.live.includes(name))
      const removed = fake.live.filter(name => !names.includes(name))
      fake.live = names
      return { added, removed, errors: {} }
    },
    async mcpServerStatus() {
      fake.statusChecks++
      return fake.live.map(name => ({ name, status: fake.status(name) }))
    },
  }
  return fake
}

function agentWithLiveQuery(servers: Record<string, ReturnType<typeof server>>) {
  const agent = Object.create(ClaudeAgent.prototype) as any
  const query = fakeQuery(Object.keys(servers))
  agent.fakeQuery = query
  agent.currentQuery = query
  agent.persistentInput = createPushableInputStream()
  agent.persistentThinkingKey = claudeThinkingKey(THINKING)
  agent.persistentMcpServers = liveMcpServers(servers)
  agent.persistentModel = ''
  const sync = (next: Record<string, unknown> | undefined) => agent.syncPersistentMcpServers(next) as Promise<void>
  return { agent, query, sync }
}

describe('ClaudeAgent live MCP servers (keep-alive)', () => {
  it('sets nothing while the servers and their tools stay the same', async () => {
    const { query, sync } = agentWithLiveQuery({ session: server('session', ['a']) })
    await sync({ session: server('session', ['a']) })
    await sync(undefined)
    expect(query.calls).toEqual([])
  })

  it('adds a source turned on mid-session in one call, then leaves it', async () => {
    const { query, sync } = agentWithLiveQuery({ session: server('session', ['a']) })
    await sync({ session: server('session', ['a']), linear: server('source-proxy-linear', ['list_issues']) })
    await sync({ session: server('session', ['a']), linear: server('source-proxy-linear', ['list_issues']) })
    await sync({ session: server('session', ['a']) })
    expect(query.calls).toEqual([['session', 'linear'], ['session']])
  })

  it('removes a server whose tools changed before adding it back, since the SDK keeps an instance by name', async () => {
    const { query, sync } = agentWithLiveQuery({ session: server('session', ['a']), github: server('source-proxy-github', ['x']) })
    // Coding profile: the first enabled source brings the source_* session tools
    await sync({ session: server('session', ['a', 'source_test']), github: server('source-proxy-github', ['x']) })
    expect(query.calls).toEqual([['github'], ['session', 'github']])
  })

  it('sets every server again on the next turn after a failed update', async () => {
    const { agent, query, sync } = agentWithLiveQuery({ session: server('session', ['a']) })
    query.fail = true
    await sync({ session: server('session', ['a']), linear: server('source-proxy-linear', ['x']) })
    expect(agent.persistentMcpServers).toBeNull()

    query.fail = false
    await sync({ session: server('session', ['a']), linear: server('source-proxy-linear', ['x']) })
    expect(query.calls).toEqual([['session', 'linear'], [], ['session', 'linear']])
    expect([...agent.persistentMcpServers].map(([name, live]: [string, { signature: string | null }]) => [name, live.signature !== null]))
      .toEqual([['session', true], ['linear', true]])
  })

  it('leaves a server answering a background agent\'s call for a later turn, so the call is not failed', async () => {
    const session = await busyServer('session', ['a'])
    const linear = await busyServer('source-proxy-linear', ['x'])
    const { agent, query, sync } = agentWithLiveQuery({ session: session.server, linear: linear.server })
    // The session tools change and linear is turned off while both answer a call
    const next = { session: server('session', ['a', 'slow', 'source_test']) }
    await sync(next)
    expect(query.calls).toEqual([['session', 'linear']])
    expect(agent.persistentMcpServers.get('session').config).toBe(session.server)
    expect(agent.persistentMcpServers.get('linear').config).toBe(linear.server)

    await session.finish()
    await linear.finish()
    await sync(next)
    expect(query.calls).toEqual([['session', 'linear'], [], ['session']])
    expect(agent.persistentMcpServers.get('session').config).toBe(next.session)
    expect([...agent.persistentMcpServers.keys()]).toEqual(['session'])
  })

  it('replaces a server that did not connect on the next turn', async () => {
    const { query, sync } = agentWithLiveQuery({ session: server('session', ['a']) })
    let linearStatus = 'failed'
    query.status = name => name === 'linear' ? linearStatus : 'connected'
    await sync({ session: server('session', ['a']), linear: server('source-proxy-linear', ['x']) })
    linearStatus = 'connected'
    await sync({ session: server('session', ['a']), linear: server('source-proxy-linear', ['x']) })
    await sync({ session: server('session', ['a']), linear: server('source-proxy-linear', ['x']) })
    expect(query.calls).toEqual([['session', 'linear'], ['session'], ['session', 'linear']])
  })

  it('pushes the turn\'s message only once the servers it added have connected', async () => {
    const { agent, query } = agentWithLiveQuery({ session: server('session', ['a']) })
    // setMcpServers returns before an added server connects (a few milliseconds in-process)
    query.status = name => name === 'linear' && query.statusChecks < 3 ? 'pending' : 'connected'
    const pushed: Array<{ message: unknown; statusChecks: number }> = []
    agent.persistentInput = { push: (message: unknown) => { pushed.push({ message, statusChecks: query.statusChecks }) } }
    const message = { type: 'user', message: { role: 'user', content: 'use linear' }, parent_tool_use_id: null }
    await agent.beginPersistentTurn(message, { mcpServers: { session: server('session', ['a']), linear: server('source-proxy-linear', ['x']) } }, THINKING)
    expect(query.calls).toEqual([['session', 'linear']])
    expect(pushed).toEqual([{ message, statusChecks: 3 }])
  })
})

// A source activated inside a turn restarts the turn (the host re-sends the request). It used to
// hard-abort the keep-alive query, killing the session's background agents along with it.
describe('ClaudeAgent source activation (keep-alive)', () => {
  async function agentInTurn(keepAlive: boolean) {
    const { agent } = agentWithLiveQuery({ session: server('session', ['a']) })
    let interrupts = 0
    agent.keepBackgroundTasksAlive = keepAlive
    agent.debug = () => {}
    agent.config = {}
    agent.pendingSteers = { pause: () => {} }
    agent.fakeQuery.interrupt = async () => { interrupts++ }
    agent.persistentAbortController = new AbortController()
    agent.currentQueryAbortController = agent.persistentAbortController
    await agent.beginPersistentTurn({ type: 'user', message: { role: 'user', content: 'hello' }, parent_tool_use_id: null }, {}, THINKING)
    return { agent, interrupts: () => interrupts }
  }

  it('stops the turn like a user Stop, keeping the query and its background agents', async () => {
    const { agent, interrupts } = await agentInTurn(true)
    const channel = agent.activeTurnChannel
    agent.endTurnForSourceActivation()
    expect(channel.isEnded).toBe(true)
    expect(interrupts()).toBe(1)
    expect(agent.currentQuery).toBe(agent.fakeQuery)
    expect(agent.persistentAbortController.signal.aborted).toBe(false)
    clearTimeout(agent.stoppedTurn.fallback)
  })

  it('leaves the query alone when the turn already ended', async () => {
    const { agent, interrupts } = await agentInTurn(true)
    agent.activeTurnChannel.end()
    agent.activeTurnChannel = null
    agent.endTurnForSourceActivation()
    expect(interrupts()).toBe(0)
    expect(agent.currentQuery).toBe(agent.fakeQuery)
    expect(agent.persistentAbortController.signal.aborted).toBe(false)
  })

  it('aborts a per-turn query', async () => {
    const { agent, interrupts } = await agentInTurn(false)
    const controller = agent.currentQueryAbortController
    agent.endTurnForSourceActivation()
    expect(interrupts()).toBe(0)
    expect(controller.signal.aborted).toBe(true)
    expect(agent.currentQuery).toBeNull()
  })
})

// A call to a source the session has not enabled (PreToolUse). `continue: false` ended the whole turn
// with no reply and nothing re-sent (craft-agents-oss#1102).
describe('ClaudeAgent call to an inactive source', () => {
  function agent(opts: { activate?: (slug: string) => Promise<boolean>; userMessage?: string | null }) {
    const agent = Object.create(ClaudeAgent.prototype) as any
    agent.debug = () => {}
    agent._pendingSourceActivationRestart = null
    agent._currentTurnUserMessage = opts.userMessage ?? null
    agent.onSourceActivationRequest = opts.activate
    return agent
  }

  it('activates the source, refuses the call without ending the turn, and restarts the turn with its tools', async () => {
    const activated: string[] = []
    const subject = agent({ activate: async slug => { activated.push(slug); return true }, userMessage: 'list my issues' })
    const answer = await subject.answerInactiveSourceCall('linear', true)
    expect(activated).toEqual(['linear'])
    expect(answer).toMatchObject({ continue: true, decision: 'block' })
    expect(subject.consumePendingSourceActivationRestart()).toEqual({ sourceSlug: 'linear', userMessage: 'list my issues' })
  })

  it('restarts nothing without a request to re-send', async () => {
    const subject = agent({ activate: async () => true, userMessage: null })
    expect(await subject.answerInactiveSourceCall('linear', true)).toMatchObject({ continue: true, decision: 'block' })
    expect(subject.consumePendingSourceActivationRestart()).toBeNull()
  })

  it('lets the turn go on when the source cannot be activated', async () => {
    const failing = [
      agent({ activate: async () => false, userMessage: 'x' }),
      agent({ activate: async () => { throw new Error('auth required') }, userMessage: 'x' }),
      agent({ userMessage: 'x' }),
    ]
    for (const subject of failing) {
      expect(await subject.answerInactiveSourceCall('linear', true)).toMatchObject({ continue: true, decision: 'block' })
      expect(subject.consumePendingSourceActivationRestart()).toBeNull()
    }
    const missing = agent({ activate: async () => true, userMessage: 'x' })
    expect(await missing.answerInactiveSourceCall('linear', false)).toMatchObject({ continue: true, decision: 'block' })
    expect(missing.consumePendingSourceActivationRestart()).toBeNull()
  })
})
