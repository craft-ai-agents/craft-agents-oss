import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getSessionFilePath } from '../../../shared/src/sessions/storage.ts'
import * as backendFactory from '../../../shared/src/agent/backend/factory.ts'
import { SessionManager, createManagedSession } from './SessionManager.ts'

// `admitMessage` resolves when a message is admitted (started a turn, queued or steered), never
// after the turn, and sends to one session are admitted one at a time (craft-agents-oss#1132,
// craft-agents-oss#1130). Hermetic: agent, pre-turn decisions and the connection are stubbed.
describe('message admission', () => {
  let tmpRoot: string
  let sm: SessionManager
  let events: Array<{ type: string; [key: string]: unknown }>

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sm-admission-'))
    sm = new SessionManager()
    events = []
    sm.setEventSink((_channel, _target, event) => events.push(event as never))
    ;(sm as any).decisionFeatureActive = () => false
    ;(sm as any).startPreTurnDecisions = async () => ({ thinkingOverride: null, suggestionHint: null })
    spyOn(backendFactory, 'resolveSessionConnection').mockReturnValue({ providerType: 'anthropic', midStreamBehavior: 'queue' } as any)
  })

  afterEach(() => {
    mock.restore()
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  /** A session whose agent holds each turn open until the test releases it. */
  function idleSession(id: string) {
    const workspace = { id: 'ws-test', name: 'Test Workspace', rootPath: tmpRoot, createdAt: Date.now() }
    // Named, so the first message doesn't start title generation.
    const managed = createManagedSession({ id, name: 'admission test' }, workspace as never, { messagesLoaded: true })
    ;(sm as unknown as { sessions: Map<string, unknown> }).sessions.set(id, managed)
    const turns: Array<{ message: string; release: () => void }> = []
    const agent = {
      getModel: () => 'claude-sonnet-4-6',
      setAllSources: () => {},
      getSessionId: () => 'sdk-session',
      chat: async function* (message: string) {
        let release!: () => void
        const held = new Promise<void>(resolve => { release = resolve })
        turns.push({ message, release })
        await held
        yield { type: 'complete' }
      },
    }
    ;(sm as any).getOrCreateAgent = async () => agent
    return { managed, turns }
  }

  function persistedMessageIds(sessionId: string): string[] {
    const path = getSessionFilePath(tmpRoot, sessionId)
    if (!existsSync(path)) return []
    // First line is the header, the rest are messages.
    return readFileSync(path, 'utf-8').trim().split('\n').slice(1).map(line => JSON.parse(line).id as string)
  }

  async function waitFor(condition: () => boolean, what: string) {
    for (let i = 0; i < 200; i++) {
      if (condition()) return
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  /** The renderer never moves a message from processing back to queued, so the server must not either. */
  function expectNoQueuedAfterProcessing() {
    const processing = new Set<string>()
    for (const event of events) {
      if (event.type !== 'user_message') continue
      const id = (event.message as { id: string }).id
      if (event.status === 'processing') processing.add(id)
      else if (event.status === 'queued') expect(processing.has(id)).toBe(false)
    }
  }

  /** Whether `promise` settles within `ms`. */
  async function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
    return Promise.race([promise.then(() => true, () => true), new Promise<boolean>(resolve => setTimeout(() => resolve(false), ms))])
  }

  /** Holds the turn-end step that clears the browser pane (a remote call on a headless server) until released. */
  function holdTurnEndStep(onlyFirst = false) {
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    let calls = 0
    ;(sm as any).getBrowserPaneManagerForSession = () => ({
      clearVisualsForSession: () => (onlyFirst && ++calls > 1 ? Promise.resolve() : held),
      unbindAllForSession: () => {},
    })
    return release
  }

  it('resolves `started` for an idle session while its turn is still running', async () => {
    const { managed, turns } = idleSession('idle')

    const admitted = await sm.admitMessage('idle', 'hello')

    expect(admitted.outcome).toBe('started')
    expect(managed.isProcessing).toBe(true)
    expect(managed.messages.filter(m => m.id === admitted.messageId)).toHaveLength(1)
    expect(persistedMessageIds('idle').filter(id => id === admitted.messageId)).toHaveLength(1)

    await waitFor(() => turns.length === 1, 'the turn to start')
    expect(turns[0]!.message).toBe('hello')
    turns[0]!.release()
    await waitFor(() => events.some(e => e.type === 'complete'), 'complete')
    expect(managed.isProcessing).toBe(false)
  })

  it('resolves `queued` for a busy session and records the message once', async () => {
    const { managed } = idleSession('busy')
    managed.isProcessing = true

    const admitted = await sm.admitMessage('busy', 'later please')

    expect(admitted.outcome).toBe('queued')
    expect(managed.messageQueue.map(q => q.messageId)).toEqual([admitted.messageId])
    expect(managed.messages.filter(m => m.id === admitted.messageId)).toHaveLength(1)
    expect(persistedMessageIds('busy').filter(id => id === admitted.messageId)).toHaveLength(1)
  })

  it('resolves `steered` when the running turn takes the message', async () => {
    const { managed } = idleSession('steer')
    ;(backendFactory.resolveSessionConnection as any).mockReturnValue({ providerType: 'pi', midStreamBehavior: 'steer' })
    managed.isProcessing = true
    managed.agent = { redirect: () => true } as any

    const admitted = await sm.admitMessage('steer', 'also check the tests')

    expect(admitted.outcome).toBe('steered')
    expect(managed.messageQueue).toHaveLength(0)
  })

  it('admits concurrent sends to an idle session one at a time: one turn, the other queued in order', async () => {
    const { managed, turns } = idleSession('concurrent')

    const [first, second] = await Promise.all([
      sm.admitMessage('concurrent', 'first'),
      sm.admitMessage('concurrent', 'second'),
    ])

    expect(first.outcome).toBe('started')
    expect(second.outcome).toBe('queued')
    expect(managed.messageQueue.map(q => q.messageId)).toEqual([second.messageId])
    expect(managed.messages.filter(m => m.role === 'user').map(m => m.content)).toEqual(['first', 'second'])

    await waitFor(() => turns.length === 1, 'the first turn')
    // Only one turn runs: the second send did not start (and supersede) another.
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(turns.map(t => t.message)).toEqual(['first'])

    turns[0]!.release()
    await waitFor(() => turns.length === 2, 'the queued message to replay')
    expect(turns[1]!.message).toBe('second')
    turns[1]!.release()
    await waitFor(() => events.some(e => e.type === 'complete'), 'complete')
    expect(managed.isProcessing).toBe(false)
  })

  it('rejects for an unknown session', async () => {
    await expect(sm.admitMessage('missing', 'hello')).rejects.toThrow('not found')
  })

  it('rejects when the message cannot be persisted, leaving the session idle and admitting later sends', async () => {
    const { managed, turns } = idleSession('flush-fails')
    const flushSession = (sm as any).flushSession.bind(sm)
    ;(sm as any).flushSession = async () => { throw new Error('disk full') }

    await expect(sm.admitMessage('flush-fails', 'hello')).rejects.toThrow('disk full')
    expect(managed.isProcessing).toBe(false)

    ;(sm as any).flushSession = flushSession
    const admitted = await sm.admitMessage('flush-fails', 'hello again')
    expect(admitted.outcome).toBe('started')
    await waitFor(() => turns.length === 1, 'the turn')
    turns[0]!.release()
    await waitFor(() => events.some(e => e.type === 'complete'), 'complete')
  })

  it('send_agent_message returns while the target is still running the turn it started (#1132)', async () => {
    const { turns } = idleSession('target')
    const sender = { id: 'sender', workspace: { id: 'ws-test' } }

    const first = await (sm as any).deliverAgentMessage(sender, 'target', 'status?')
    expect(first).toEqual({ delivery: 'started' })

    // The target's turn is still held: a second message is queued behind it, and the call
    // still returns without waiting for the turn.
    await waitFor(() => turns.length === 1, 'the target turn')
    const second = await (sm as any).deliverAgentMessage(sender, 'target', 'and another thing')
    expect(second).toEqual({ delivery: 'queued' })

    turns[0]!.release()
    await waitFor(() => turns.length === 2, 'the queued message to replay')
    turns[1]!.release()
    await waitFor(() => events.some(e => e.type === 'complete'), 'complete')
  })

  it('acceptPlan resolves once the approval is admitted, while the plan runs (#1130)', async () => {
    const { managed, turns } = idleSession('plan')
    managed.permissionMode = 'ask'

    await sm.acceptPlan('plan', '/tmp/plan.md')

    expect(managed.isProcessing).toBe(true)
    await waitFor(() => turns.length === 1, 'the plan turn')
    turns[0]!.release()
    await waitFor(() => events.some(e => e.type === 'complete'), 'complete')
  })

  it('send_agent_message to an unknown session rejects', async () => {
    const sender = { id: 'sender', workspace: { id: 'ws-test' } }
    await expect((sm as any).deliverAgentMessage(sender, 'missing', 'hi')).rejects.toThrow('not found')
  })

  it('ends a started turn whose setup fails after the ack, so the next send starts a new turn', async () => {
    const { managed, turns } = idleSession('setup-fails')
    const getOrCreateAgent = (sm as any).getOrCreateAgent
    ;(sm as any).getOrCreateAgent = async () => { throw new Error('agent setup failed') }

    const admitted = await sm.admitMessage('setup-fails', 'hello')
    expect(admitted.outcome).toBe('started')

    await waitFor(() => events.some(e => e.type === 'complete'), 'complete')
    expect(events.find(e => e.type === 'error')?.error).toBe('agent setup failed')
    expect(managed.isProcessing).toBe(false)

    ;(sm as any).getOrCreateAgent = getOrCreateAgent
    const next = await sm.admitMessage('setup-fails', 'try again')
    expect(next.outcome).toBe('started')
    await waitFor(() => turns.length === 1, 'the next turn')
    turns[0]!.release()
  })

  it('replays a queued message before one sent while the turn before it ends', async () => {
    const { managed, turns } = idleSession('turn-end')
    await sm.admitMessage('turn-end', 'first')
    await waitFor(() => turns.length === 1, 'the first turn')
    expect((await sm.admitMessage('turn-end', 'second')).outcome).toBe('queued')

    // Sent once the session reads idle, while the turn-end steps run and before the replay starts.
    let third: Promise<{ outcome: string }> | undefined
    const isSessionBeingViewed = (sm as any).isSessionBeingViewed.bind(sm)
    ;(sm as any).isSessionBeingViewed = (...args: unknown[]) => {
      if (!third && !managed.isProcessing) third = sm.admitMessage('turn-end', 'third')
      return isSessionBeingViewed(...args)
    }
    turns[0]!.release()

    await waitFor(() => turns.length === 2, 'the queued message to replay')
    expect(turns[1]!.message).toBe('second')
    expect((await third!).outcome).toBe('queued')
    expect(managed.messages.filter(m => m.role === 'user').map(m => m.content)).toEqual(['first', 'second', 'third'])

    turns[1]!.release()
    await waitFor(() => turns.length === 3, 'the third message to replay')
    expect(turns[2]!.message).toBe('third')
    turns[2]!.release()
    await waitFor(() => events.some(e => e.type === 'complete'), 'complete')
  })

  it('queues behind the queued messages a send that reaches the busy check after the turn ended', async () => {
    const { managed, turns } = idleSession('replay-due')
    await sm.admitMessage('replay-due', 'first')
    await waitFor(() => turns.length === 1, 'the first turn')
    await sm.admitMessage('replay-due', 'second')

    // 'third' is admitted while the first turn runs but reaches the busy check after it ended, with
    // the replay of 'second' due: it is queued behind 'second' instead of starting a turn first.
    let openGate!: () => void
    const gate = new Promise<void>(resolve => { openGate = resolve })
    const ensureMessagesLoaded = (sm as any).ensureMessagesLoaded.bind(sm)
    ;(sm as any).ensureMessagesLoaded = async (...args: unknown[]) => { await gate; return ensureMessagesLoaded(...args) }
    const third = sm.admitMessage('replay-due', 'third')
    turns[0]!.release()
    await waitFor(() => !managed.isProcessing, 'the first turn to end')
    openGate()

    expect((await third).outcome).toBe('queued')
    await waitFor(() => turns.length === 2, 'the queued message to replay')
    expect(turns[1]!.message).toBe('second')
    turns[1]!.release()
    await waitFor(() => turns.length === 3, 'the third message to replay')
    expect(turns[2]!.message).toBe('third')
    turns[2]!.release()
    await waitFor(() => events.some(e => e.type === 'complete'), 'complete')
    expect(managed.messages.filter(m => m.role === 'user').map(m => m.content)).toEqual(['first', 'second', 'third'])
    expectNoQueuedAfterProcessing()
  })

  it('acks at once, as queued, a message sent while the turn before queued messages ends', async () => {
    const { managed, turns } = idleSession('turn-end-ack')
    await sm.admitMessage('turn-end-ack', 'first')
    await waitFor(() => turns.length === 1, 'the first turn')
    await sm.admitMessage('turn-end-ack', 'second')
    const finishStep = holdTurnEndStep()
    turns[0]!.release()
    await waitFor(() => !managed.isProcessing, 'the first turn to end')

    const third = sm.admitMessage('turn-end-ack', 'third')
    expect(await settlesWithin(third, 200)).toBe(true)
    expect((await third).outcome).toBe('queued')
    expect(persistedMessageIds('turn-end-ack')).toContain((await third).messageId)

    finishStep()
    await waitFor(() => turns.length === 2, 'the queued message to replay')
    expect(turns[1]!.message).toBe('second')
    turns[1]!.release()
    await waitFor(() => turns.length === 3, 'the third message to replay')
    expect(turns[2]!.message).toBe('third')
    turns[2]!.release()
    await waitFor(() => events.some(e => e.type === 'complete'), 'complete')
  })

  it('does not report completion while a turn started during the turn-end steps runs', async () => {
    const { managed, turns } = idleSession('turn-end-start')
    await sm.admitMessage('turn-end-start', 'first')
    await waitFor(() => turns.length === 1, 'the first turn')
    const finishStep = holdTurnEndStep(true)
    turns[0]!.release()
    await waitFor(() => !managed.isProcessing, 'the first turn to end')

    // Nothing was queued, so this starts a turn while the first turn's end is still running.
    expect((await sm.admitMessage('turn-end-start', 'next')).outcome).toBe('started')
    await waitFor(() => turns.length === 2, 'the next turn')
    finishStep()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(events.some(e => e.type === 'complete')).toBe(false)

    turns[1]!.release()
    await waitFor(() => events.some(e => e.type === 'complete'), 'complete')
    expect(managed.isProcessing).toBe(false)
  })

  it('keeps queue order when a turn end is reported twice, and a Stop still cancels what is queued', async () => {
    const { managed, turns } = idleSession('double-stop')
    managed.isProcessing = true  // a turn the test ends by hand, twice
    await sm.admitMessage('double-stop', 'q1')
    await sm.admitMessage('double-stop', 'q2')

    // The first report waits in a turn-end step; a second one (e.g. Stop's 5 s timeout) overtakes it.
    const finishStep = holdTurnEndStep(true)
    const firstReport = (sm as any).onProcessingStopped('double-stop', 'complete')
    void (sm as any).onProcessingStopped('double-stop', 'timeout')
    await waitFor(() => turns.length === 1, 'the first replay')
    expect(turns[0]!.message).toBe('q1')

    finishStep()
    await firstReport
    // Its replay found q1's turn running and left q2 in the queue as it was.
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(turns).toHaveLength(1)
    const q2 = managed.messages.find(m => m.content === 'q2')!
    expect(managed.messageQueue.map(q => q.messageId)).toEqual([q2.id])
    expect(q2.isQueued).toBe(true)
    expectNoQueuedAfterProcessing()

    // So a Stop of q1's turn cancels q2 too, which goes back to the input.
    await sm.cancelProcessing('double-stop')
    expect(events.find(e => e.type === 'interrupted')?.queuedMessages).toEqual(['q2'])
    turns[0]!.release()
    await waitFor(() => events.some(e => e.type === 'complete'), 'complete')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(turns.map(t => t.message)).toEqual(['q1'])
  })

  it('runs messages queued before a restart ahead of the send that loads the session', async () => {
    const { managed, turns } = idleSession('recovered')
    managed.messages = [{ id: 'saved-queued', role: 'user', content: 'sent before the restart', timestamp: Date.now() - 1000, isQueued: true }]
    ;(sm as any).persistSession(managed)
    await (sm as any).flushSession('recovered')
    managed.messages = []
    managed.messagesLoaded = false

    const admitted = await sm.admitMessage('recovered', 'sent after')

    expect(admitted.outcome).toBe('queued')
    await waitFor(() => turns.length === 1, 'the recovered message to replay')
    expect(turns[0]!.message).toBe('sent before the restart')
    turns[0]!.release()
    await waitFor(() => turns.length === 2, 'the new message to replay')
    expect(turns[1]!.message).toBe('sent after')
    turns[1]!.release()
    await waitFor(() => events.some(e => e.type === 'complete'), 'complete')
    expectNoQueuedAfterProcessing()
  })

  it('admits later sends after a recovered replay fails before it starts its turn', async () => {
    const { managed, turns } = idleSession('replay-throws')
    managed.messages = [{ id: 'saved-queued', role: 'user', content: 'sent before the restart', timestamp: Date.now() - 1000, isQueued: true }]
    ;(sm as any).persistSession(managed)
    await (sm as any).flushSession('replay-throws')
    managed.messages = []
    managed.messagesLoaded = false
    // Showing the replay as processing throws once (a failing event sink).
    const sendEvent = (sm as any).sendEvent.bind(sm)
    let thrown = false
    ;(sm as any).sendEvent = (event: { type: string; status?: string }, workspaceId?: string) => {
      if (!thrown && event.type === 'user_message' && event.status === 'processing') {
        thrown = true
        throw new Error('event sink failed')
      }
      return sendEvent(event, workspaceId)
    }

    void sm.admitMessage('replay-throws', 'loads the session')
    await waitFor(() => thrown, 'the failing replay')
    await waitFor(() => events.some(e => e.type === 'typed_error'), 'the replay failure')
    // Nothing stays reserved: the message that loaded the session runs, and so does a later one.
    await waitFor(() => turns.length === 1, 'the next message to run')
    expect(turns[0]!.message).toBe('loads the session')
    const later = sm.admitMessage('replay-throws', 'later')
    expect(await settlesWithin(later, 200)).toBe(true)
    turns[0]!.release()
    await waitFor(() => turns.length === 2, 'the later message to replay')
    turns[1]!.release()
    await waitFor(() => events.some(e => e.type === 'complete'), 'complete')
    expect(managed.pendingQueueReplays ?? 0).toBe(0)
  })

  it('ends a turn whose setup fails on the plain send path, and runs what was queued meanwhile', async () => {
    const { managed, turns } = idleSession('setup-fails-send')
    const getOrCreateAgent = (sm as any).getOrCreateAgent
    let failSetup!: () => void
    const setup = new Promise<void>(resolve => { failSetup = resolve })
    ;(sm as any).getOrCreateAgent = async () => { await setup; throw new Error('agent setup failed') }

    // Like the desktop app's send RPC: acked once admitted, while the turn runs on.
    let acked: string | undefined
    const send = sm.sendMessage('setup-fails-send', 'hello', undefined, undefined, undefined, undefined, undefined, (_id, outcome) => { acked = outcome })
    await waitFor(() => acked === 'started', 'the ack')
    expect((await sm.admitMessage('setup-fails-send', 'queued meanwhile')).outcome).toBe('queued')

    ;(sm as any).getOrCreateAgent = getOrCreateAgent
    failSetup()
    // The failure ends the turn with an error, as a failure inside the turn does; it isn't thrown at the caller.
    await send
    expect(events.find(e => e.type === 'error')?.error).toBe('agent setup failed')
    await waitFor(() => turns.length === 1, 'the queued message to replay')
    expect(turns[0]!.message).toBe('queued meanwhile')
    turns[0]!.release()
    await waitFor(() => events.some(e => e.type === 'complete') && !managed.isProcessing, 'complete')
  })

  it('queues a message sent while a steering turn is set up, without aborting the agent', async () => {
    const { managed } = idleSession('setup-steer')
    ;(backendFactory.resolveSessionConnection as any).mockReturnValue({ providerType: 'pi', midStreamBehavior: 'steer' })
    // An agent kept from an earlier turn. Like PiAgent, it can't steer before it streams, and a
    // redirect then force-aborts it.
    const forceAborts: string[] = []
    const turns: Array<{ message: string; turnContext?: string; release: () => void }> = []
    let streaming = false
    const agent = {
      getModel: () => 'pi-model',
      setAllSources: () => {},
      getSessionId: () => 'pi-session',
      canSteerNow: () => streaming,
      redirect(_message: string) {
        if (streaming) return true
        forceAborts.push('redirect')
        return false
      },
      chat: async function* (message: string, _attachments: unknown, options?: { turnContext?: string }) {
        streaming = true
        let release!: () => void
        const held = new Promise<void>(resolve => { release = resolve })
        turns.push({ message, turnContext: options?.turnContext, release })
        await held
        streaming = false
        yield { type: 'complete' }
      },
    }
    managed.agent = agent as any
    let finishSetup!: () => void
    const setup = new Promise<void>(resolve => { finishSetup = resolve })
    ;(sm as any).getOrCreateAgent = async () => { await setup; return agent }

    expect((await sm.admitMessage('setup-steer', 'first')).outcome).toBe('started')
    expect((await sm.admitMessage('setup-steer', 'second')).outcome).toBe('queued')
    expect(forceAborts).toEqual([])
    expect(managed.wasInterrupted).toBeFalsy()

    finishSetup()
    await waitFor(() => turns.length === 1, 'the first turn')
    expect(turns[0]!.turnContext ?? '').not.toContain('interrupted')
    turns[0]!.release()
    await waitFor(() => turns.length === 2, 'the queued message to replay')
    expect(turns[1]!.message).toBe('second')
    expect(turns[1]!.turnContext ?? '').not.toContain('interrupted')
    turns[1]!.release()
    await waitFor(() => events.some(e => e.type === 'complete'), 'complete')
  })
})
