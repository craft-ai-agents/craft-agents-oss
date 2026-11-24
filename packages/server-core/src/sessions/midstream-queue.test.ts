import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getPendingPlanExecution, saveSession } from '../../../shared/src/sessions/storage.ts'
import * as backendFactory from '../../../shared/src/agent/backend/factory.ts'
import { ClaudeAgent } from '../../../shared/src/agent/claude-agent.ts'
import { PendingSteers } from '../../../shared/src/agent/backend/claude/pending-steers.ts'
import {
  SessionManager,
  createManagedSession,
  resolveMidStreamDeliveryOutcome,
  shouldAttemptMidStreamSteer,
  canSteerTextPayload,
} from './SessionManager.ts'

describe('mid-stream queue runtime invariants', () => {
  let tmpRoot: string
  let sm: SessionManager

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sm-midstream-'))
    sm = new SessionManager()
  })

  afterEach(() => {
    mock.restore()
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  function buildSession(id: string) {
    const workspace = {
      id: 'ws-test',
      name: 'Test Workspace',
      rootPath: tmpRoot,
      createdAt: Date.now(),
    }
    const managed = createManagedSession(
      { id, name: 'mid-stream test' },
      workspace as never,
      { messagesLoaded: true },
    )
    ;(sm as unknown as { sessions: Map<string, unknown> }).sessions.set(id, managed)
    return managed
  }

  it('distinguishes non-interrupting queue mode from a failed steer', () => {
    expect(resolveMidStreamDeliveryOutcome('queue', false)).toEqual({
      shouldQueue: true,
      wasInterrupted: false,
    })
    expect(resolveMidStreamDeliveryOutcome('steer', false)).toEqual({
      shouldQueue: true,
      wasInterrupted: true,
    })
    expect(resolveMidStreamDeliveryOutcome('steer', true)).toEqual({
      shouldQueue: false,
      wasInterrupted: false,
    })
  })

  it('queues instead of steering while a manual compaction owns the turn (#1058)', () => {
    const compacting = { isCompactionInFlight: () => true }
    const idle = { isCompactionInFlight: () => false }
    expect(shouldAttemptMidStreamSteer('steer', true, compacting)).toBe(false)
    expect(shouldAttemptMidStreamSteer('steer', true, idle)).toBe(true)
    // Backends without the concept behave as before.
    expect(shouldAttemptMidStreamSteer('steer', true, {})).toBe(true)
    expect(shouldAttemptMidStreamSteer('queue', true, idle)).toBe(false)
    expect(shouldAttemptMidStreamSteer('steer', false, idle)).toBe(false)
    expect(shouldAttemptMidStreamSteer('steer', true, undefined)).toBe(false)
    // The forced queue path is not an interruption: the compaction runs to
    // completion and the replayed turn must not claim it was cut off.
    expect(resolveMidStreamDeliveryOutcome('queue', false)).toEqual({ shouldQueue: true, wasInterrupted: false })

    // Claude reports a live /compact turn through its event adapter; a bare
    // prototype without an adapter reads as not compacting.
    const claude = Object.create(ClaudeAgent.prototype) as any
    claude.currentQuery = { interrupt: async () => {} }
    expect(claude.isCompactionInFlight()).toBe(false)
    claude.eventAdapter = { isManualCompactionRequested: () => true }
    expect(claude.isCompactionInFlight()).toBe(true)
    expect(shouldAttemptMidStreamSteer('steer', true, claude)).toBe(false)
    claude.currentQuery = null
    expect(claude.isCompactionInFlight()).toBe(false)
  })

  it('queues instead of steering while the agent is not streaming the turn', () => {
    // During the turn's setup or end a redirect would only abort the agent and mark the replay
    // as interrupted.
    expect(shouldAttemptMidStreamSteer('steer', true, { canSteerNow: () => false })).toBe(false)
    expect(shouldAttemptMidStreamSteer('steer', true, { canSteerNow: () => true })).toBe(true)
  })

  it('recovers distinct identical-text steers by identity without interrupting or duplicating', async () => {
    const managed = buildSession('recover')
    const payloads = ['a', 'b', 'c'].map(messageId => ({ message: 'same', messageId, optimisticMessageId: `optimistic-${messageId}` }))
    managed.messages = payloads.map(p => ({ id: p.messageId, content: p.message, role: 'user', timestamp: 1 }))
    ;(managed as any).acceptedSteers = new Map(payloads.map(p => [p.messageId, p]))
    ;(sm as any).persistSession = () => {}
    for (const p of payloads) await (sm as any).processEvent(managed, { type: 'steer_undelivered', message: p.message, messageId: p.messageId })
    expect(managed.messageQueue).toEqual(payloads)
    expect(managed.messages).toHaveLength(3)
    expect(managed.messages.every(m => m.isQueued)).toBe(true)
    expect(managed.wasInterrupted).not.toBe(true)
    await (sm as any).processEvent(managed, { type: 'steer_undelivered', message: 'same', messageId: 'a' })
    expect(managed.messageQueue).toHaveLength(3)
  })

  it('allows empty presentation metadata but queues semantic and future options', () => {
    expect(canSteerTextPayload([], [], { skillSlugs: [], badges: [], hidden: false, optimisticMessageId: 'id' })).toBe(true)
    expect(canSteerTextPayload(undefined, undefined, { skillSlugs: ['skill'] })).toBe(false)
    expect(canSteerTextPayload(undefined, undefined, { hidden: true })).toBe(false)
    expect(canSteerTextPayload(undefined, undefined, { futureOption: false } as any)).toBe(false)
    expect(canSteerTextPayload(undefined, [{ id: 'stored' }] as any)).toBe(false)
  })

  it('queues attachments and semantic options intact without calling a text-only redirect', async () => {
    spyOn(backendFactory, 'resolveSessionConnection').mockReturnValue({ providerType: 'pi', midStreamBehavior: 'steer' } as any)
    const managed = buildSession('attachments')
    managed.isProcessing = true
    const redirect = mock(() => true)
    managed.agent = { redirect } as any
    ;(sm as any).persistSession = () => {}
    ;(sm as any).flushSession = async () => {}
    const attachments = [{ name: 'photo.png', type: 'image', mimeType: 'image/png', base64: 'image-bytes' }] as any
    const storedAttachments = [{ id: 'file', name: 'photo.png', type: 'image', storedPath: '/tmp/photo.png' }] as any
    const options = { skillSlugs: ['image-skill'], hidden: true, optimisticMessageId: 'optimistic' }
    const events: any[] = []
    sm.setEventSink((_channel, _target, event) => events.push(event))
    await sm.sendMessage(managed.id, 'inspect image', attachments, storedAttachments, options)
    expect(redirect).not.toHaveBeenCalled()
    expect(managed.wasInterrupted).not.toBe(true)
    expect(managed.messageQueue[0]).toMatchObject({ attachments, storedAttachments, options, messageId: managed.messages[0]!.id })
    expect(managed.messages[0]!.isQueued).toBe(true)
    expect(events.find(e => e.type === 'user_message').status).toBe('queued')
    // Also prove the existing supported replay path receives the same objects, once the turn ended.
    const replay = mock(async (..._args: unknown[]) => {})
    ;(sm as any).sendAdmittedMessage = replay
    managed.isProcessing = false
    ;(sm as any).processNextQueuedMessage(managed.id)
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(replay.mock.calls[0]!.slice(1)).toEqual([managed.id, 'inspect image', attachments, storedAttachments, options, managed.messages[0]!.id])
  })

  it('marks Accept & Compact ready only after a manual compaction success and preserves the fresh snapshot', async () => {
    const managed = buildSession('manual-compact-ready')
    managed.isProcessing = true
    managed.tokenUsage = { inputTokens: 419_000, outputTokens: 10, totalTokens: 419_010, contextTokens: 0, costUsd: 0 }
    await saveSession({ id: managed.id, workspaceRootPath: tmpRoot, createdAt: 1, lastUsedAt: 1, messages: [], tokenUsage: managed.tokenUsage } as any)
    await sm.setPendingPlanExecution(managed.id, '/tmp/plan.md', 'draft')
    const events: any[] = []
    sm.setEventSink((_channel, _target, event) => events.push(event))
    ;(sm as any).persistSession = () => {}

    await (sm as any).processEvent(managed, { type: 'context_usage', contextUsage: { usedTokens: 12_000, limitTokens: 200_000, limitKind: 'compaction', isEstimate: true, isStale: false, canCompact: true } })
    await (sm as any).processEvent(managed, { type: 'info', message: 'Compacted Conversation', compactionTrigger: 'manual' })

    expect(getPendingPlanExecution(tmpRoot, managed.id)).toMatchObject({ awaitingCompaction: false, executionDispatched: false })
    expect(managed.tokenUsage.contextUsage?.usedTokens).toBe(12_000)
    expect(events.find(e => e.type === 'usage_update').tokenUsage.contextUsage.usedTokens).toBe(12_000)
    expect(events.find(e => e.type === 'info')).toMatchObject({ statusType: 'compaction_complete' })
    expect(await sm.markPendingPlanExecutionDispatched(managed.id)).toBe(false)
    managed.isProcessing = false
    expect(await sm.markPendingPlanExecutionDispatched(managed.id)).toBe(true)
    expect(await sm.markPendingPlanExecutionDispatched(managed.id)).toBe(false)
  })

  it('does not release pending plan execution for auto or failed compaction outcomes', async () => {
    for (const [id, event] of [
      ['auto-compact', { type: 'info', message: 'Compacted Conversation', compactionTrigger: 'auto' }],
      ['failed-compact', { type: 'compaction_failed' }],
    ] as const) {
      const managed = buildSession(id)
      await saveSession({ id: managed.id, workspaceRootPath: tmpRoot, createdAt: 1, lastUsedAt: 1, messages: [], tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 } } as any)
      await sm.setPendingPlanExecution(managed.id, '/tmp/plan.md')
      ;(sm as any).persistSession = () => {}
      await (sm as any).processEvent(managed, event)
      managed.isProcessing = false
      expect(await sm.markPendingPlanExecutionDispatched(managed.id)).toBe(false)
      const pending = getPendingPlanExecution(tmpRoot, managed.id)
      if (id === 'auto-compact') expect(pending).toMatchObject({ awaitingCompaction: true, executionDispatched: false })
      else expect(pending).toBeNull()
    }
  })

  it('keeps the pending plan record while sending the /compact command that releases it', async () => {
    const managed = buildSession('send-compact')
    await saveSession({ id: managed.id, workspaceRootPath: tmpRoot, createdAt: 1, lastUsedAt: 1, messages: [], tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 } } as any)
    await sm.setPendingPlanExecution(managed.id, '/tmp/plan.md')
    const agent = {
      getModel: () => 'claude-sonnet-4-6',
      setAllSources: () => {},
      getSessionId: () => 'sdk-session',
      chat: async function* () {
        yield { type: 'context_usage', contextUsage: { usedTokens: 12_000, limitTokens: 200_000, limitKind: 'compaction', isEstimate: true, isStale: false, canCompact: true } }
        yield { type: 'info', message: 'Compacted Conversation', compactionTrigger: 'manual' }
        yield { type: 'complete' }
      },
    }
    ;(sm as any).getOrCreateAgent = async () => agent
    sm.setEventSink(() => {})
    await sm.sendMessage(managed.id, '/compact')
    expect(getPendingPlanExecution(tmpRoot, managed.id)).toMatchObject({ awaitingCompaction: false, executionDispatched: false })
  })

  it('the actual host sendMessage loop consumes Claude recovery before stopping at complete', async () => {
    spyOn(backendFactory, 'resolveSessionConnection').mockReturnValue({ providerType: 'pi', midStreamBehavior: 'steer' } as any)
    const managed = buildSession('host-completion')
    managed.sdkSessionId = 'offline-sdk'
    const agent = Object.create(ClaudeAgent.prototype) as any
    agent.pendingSteers = new PendingSteers()
    agent.currentQuery = { interrupt: async () => {} }
    agent.currentQueryAbortController = new AbortController()
    agent.debug = () => {}
    agent.getModel = () => 'claude-sonnet-4-6'
    agent.setAllSources = () => {}
    agent.getSessionId = () => 'offline-sdk'
    agent.chat = agent.chatImpl.bind(agent)
    const acceptedIds: string[] = []
    agent.chatTurn = async function* () {
      for (const id of ['a', 'b', 'c']) {
        await sm.sendMessage(managed.id, 'same', undefined, undefined, { optimisticMessageId: `opt-${id}` })
        acceptedIds.push(managed.messages.at(-1)!.id)
      }
      yield { type: 'complete' }
    }
    managed.agent = agent
    ;(sm as any).getOrCreateAgent = async () => agent
    ;(sm as any).persistSession = () => {}
    ;(sm as any).flushSession = async () => {}
    const stopped = mock(async () => { managed.isProcessing = false })
    ;(sm as any).onProcessingStopped = stopped
    const events: any[] = []
    sm.setEventSink((_channel, _target, event) => events.push(event))
    await sm.sendMessage(managed.id, 'initial')
    expect(stopped).toHaveBeenCalledTimes(1)
    expect(managed.messageQueue.map(p => p.messageId)).toEqual(acceptedIds)
    expect(managed.messageQueue.map(p => p.optimisticMessageId)).toEqual(['opt-a', 'opt-b', 'opt-c'])
    expect(managed.messages.filter(m => m.role === 'user')).toHaveLength(4)
    expect(managed.wasInterrupted).not.toBe(true)
    expect(events.filter(e => e.type === 'user_message' && e.status === 'queued').map(e => e.message.id)).toEqual(acceptedIds)
  })

  it.each(['complete', 'error'])('ignores a trailing %s from a handed-off turn after a newer turn starts', async terminal => {
    const managed = buildSession('handoff-new-turn')
    managed.sdkSessionId = 'offline-sdk'
    const agent = Object.create(ClaudeAgent.prototype) as any
    agent.pendingSteers = new PendingSteers()
    agent.currentQuery = { interrupt: async () => {} }
    agent.currentQueryAbortController = new AbortController()
    agent.debug = () => {}
    agent.getModel = () => 'claude-sonnet-4-6'
    agent.setAllSources = () => {}
    agent.getSessionId = () => 'offline-sdk'
    agent.chat = agent.chatImpl.bind(agent)
    const gates = [Promise.withResolvers<void>(), Promise.withResolvers<void>()]
    const starts = [Promise.withResolvers<void>(), Promise.withResolvers<void>()]
    let turn = 0
    agent.chatTurn = async function* () {
      const index = turn++
      starts[index]!.resolve()
      await gates[index]!.promise
      if (index === 0 && terminal === 'error') throw new Error('old query aborted')
      yield { type: 'complete' }
    }
    managed.agent = agent
    ;(sm as any).getOrCreateAgent = async () => agent
    ;(sm as any).persistSession = () => {}
    ;(sm as any).flushSession = async () => {}
    const stopped = mock(async () => { managed.isProcessing = false })
    ;(sm as any).onProcessingStopped = stopped
    const first = sm.sendMessage(managed.id, 'first')
    await starts[0]!.promise
    ;(sm as any).recoverPendingSteers(managed)
    managed.isProcessing = false // The UI handoff callback pauses without waiting for the old SDK result.
    const second = sm.sendMessage(managed.id, 'second')
    await starts[1]!.promise
    gates[0]!.resolve()
    try {
      await first
      expect(stopped).not.toHaveBeenCalled()
      expect(managed.isProcessing).toBe(true)
    } finally {
      gates[1]!.resolve()
      await second
    }
    expect(stopped).toHaveBeenCalledTimes(1)
  })

  it('transfers handoff steers ahead of already queued later attachments', () => {
    const managed = buildSession('handoff-order')
    managed.messages = ['a', 'b', 'c'].map(id => ({ id, role: 'user', content: id, timestamp: 1 }))
    const payloads = ['a', 'c'].map(messageId => ({ message: messageId, messageId }))
    managed.acceptedSteers = new Map(payloads.map(p => [p.messageId, p]))
    managed.messageQueue = [{ message: 'b', messageId: 'b', attachments: [{ name: 'keep' }] as any }]
    managed.agent = { takePendingSteers: () => payloads } as any
    ;(sm as any).persistSession = () => {}
    ;(sm as any).recoverPendingSteers(managed)
    expect(managed.messageQueue.map(p => p.messageId)).toEqual(['a', 'b', 'c'])
    expect(managed.messageQueue[1]!.attachments).toEqual([{ name: 'keep' }] as any)
    expect(managed.wasInterrupted).not.toBe(true)
  })

  it('hard Stop visibly cancels accepted pending steers and rejects trailing recovery', async () => {
    const managed = buildSession('stop')
    managed.isProcessing = true
    managed.messages = [{ id: 'a', role: 'user', content: 'pending', timestamp: 1 }]
    const payload = { message: 'pending', messageId: 'a' }
    managed.acceptedSteers = new Map([['a', payload]])
    const forceAbort = mock(() => {})
    managed.agent = { takePendingSteers: () => [payload], forceAbort } as any
    ;(sm as any).persistSession = () => {}
    const events: any[] = []
    sm.setEventSink((_channel, _target, event) => events.push(event))
    await sm.cancelProcessing(managed.id)
    expect(forceAbort).toHaveBeenCalledTimes(1)
    expect(events.find(e => e.type === 'interrupted').queuedMessages).toEqual(['pending'])
    expect(managed.messages.some(m => m.id === 'a')).toBe(false)
    expect(managed.messageQueue).toEqual([])
    await (sm as any).processEvent(managed, { type: 'steer_undelivered', ...payload })
    expect(managed.messageQueue).toEqual([])
    managed.isProcessing = false // Disarm the production Stop backstop timer.
  })

  it('re-stamps replay after the prior final response and emits that timestamp', async () => {
    const sessionId = 'queue-ordering'
    const managed = buildSession(sessionId)
    const priorFinalTimestamp = Date.now()
    managed.messages = [
      {
        id: 'initial-user',
        role: 'user',
        content: 'question',
        timestamp: priorFinalTimestamp - 200,
      },
      {
        id: 'queued-user',
        role: 'user',
        content: 'follow up',
        timestamp: priorFinalTimestamp - 100,
        isQueued: true,
      },
      {
        id: 'prior-answer',
        role: 'assistant',
        content: 'complete answer',
        timestamp: priorFinalTimestamp,
      },
    ]
    managed.messageQueue.push({
      message: 'follow up',
      messageId: 'queued-user',
      optimisticMessageId: 'optimistic-user',
    })

    const events: any[] = []
    sm.setEventSink((_channel, _target, event) => events.push(event))
    ;(sm as unknown as { lastTimestamp: number }).lastTimestamp = priorFinalTimestamp
    ;(sm as unknown as { persistSession: () => void }).persistSession = () => {}
    const sendAdmittedMessage = mock(async () => {})
    ;(sm as unknown as { sendAdmittedMessage: typeof sendAdmittedMessage }).sendAdmittedMessage = sendAdmittedMessage

    ;(sm as unknown as { processNextQueuedMessage: (id: string) => void })
      .processNextQueuedMessage(sessionId)
    await new Promise<void>(resolve => setImmediate(resolve))

    const replayed = managed.messages.find(message => message.id === 'queued-user')
    expect(replayed?.isQueued).toBe(false)
    expect(replayed?.timestamp).toBeGreaterThan(priorFinalTimestamp)

    const processingEvent = events.find(event => event.type === 'user_message')
    expect(processingEvent?.status).toBe('processing')
    expect(processingEvent?.message.timestamp).toBe(replayed?.timestamp)
    expect(processingEvent?.optimisticMessageId).toBe('optimistic-user')
    expect(sendAdmittedMessage).toHaveBeenCalledTimes(1)
  })
})
