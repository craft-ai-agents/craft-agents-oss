import { describe, expect, it } from 'bun:test'
import type { AgentEvent } from '@craft-agent/core/types'
import type { SessionEvent } from '@craft-agent/shared/protocol'
import { SessionManager, createManagedSession } from './SessionManager.ts'

// The model's safeguards stopped a reply (Claude's refusal fallback): the stopped reply the CLI took
// back leaves the transcript, the notices stay in it, and the session moves to the fallback model.

type ManagedSession = ReturnType<typeof createManagedSession>
type EventHarness = {
  processEvent(managed: ManagedSession, event: AgentEvent): Promise<void>
  pendingDeltas: Map<string, { delta: string; turnId?: string }>
  deltaFlushTimers: Map<string, ReturnType<typeof setTimeout>>
  sessionActivityListeners: Map<string, Set<() => void>>
  sendEvent(event: SessionEvent, workspaceId?: string): void
  persistSession(managed: ManagedSession): void
  updateSessionModel(sessionId: string, workspaceId: string, model: string | null): Promise<void>
  monotonic(): number
}

/** The real event methods without agents, disk writes or watchers. */
function harness() {
  const manager = Object.create(SessionManager.prototype) as EventHarness
  const events: SessionEvent[] = []
  const modelChanges: Array<[string, string, string | null]> = []
  let persisted = 0
  let clock = 0
  manager.pendingDeltas = new Map()
  manager.deltaFlushTimers = new Map()
  manager.sessionActivityListeners = new Map()
  manager.sendEvent = event => { events.push(event) }
  manager.persistSession = () => { persisted++ }
  manager.updateSessionModel = async (...args) => { modelChanges.push(args) }
  manager.monotonic = () => ++clock
  const managed = createManagedSession({ id: 'refusal-test' }, {
    id: 'workspace', slug: 'workspace', name: 'Test', rootPath: '/unused-refusal-test', createdAt: Date.now(),
  })
  managed.model = 'claude-opus-5-5'
  return { managed, events, modelChanges, persisted: () => persisted, fire: (event: AgentEvent) => manager.processEvent(managed, event) }
}

describe('refusal fallback in the session', () => {
  it('keeps the notices, drops the reply taken back, and moves the session to the fallback model', async () => {
    const { managed, events, modelChanges, fire } = harness()
    await fire({ type: 'text_complete', text: 'Sure, here is how to', turnId: 'msg_1' })
    await fire({ type: 'model_refusal', message: "Opus 5.5's safeguards stopped the response above · continuing once with that noted" })
    await fire({ type: 'text_delta', text: 'Sure, here is how to', turnId: 'msg_2' })
    await fire({ type: 'text_discard', turnId: 'msg_2' })
    await fire({ type: 'messages_retracted', turnIds: ['msg_2'], toolUseIds: [] })
    await fire({ type: 'model_refusal', message: 'Opus 4.8 is answering instead.', fallbackModel: 'claude-opus-4-8' })
    await fire({ type: 'text_complete', text: 'Fallback answer', turnId: 'msg_3' })

    expect(managed.messages.map(m => [m.role, m.content, m.infoLevel])).toEqual([
      ['assistant', 'Sure, here is how to', undefined],
      ['info', "Opus 5.5's safeguards stopped the response above · continuing once with that noted", 'warning'],
      ['info', 'Opus 4.8 is answering instead.', 'warning'],
      ['assistant', 'Fallback answer', undefined],
    ])
    expect(events.filter(e => e.type === 'info')).toEqual([
      { type: 'info', sessionId: managed.id, message: "Opus 5.5's safeguards stopped the response above · continuing once with that noted", level: 'warning', timestamp: 2 },
      { type: 'info', sessionId: managed.id, message: 'Opus 4.8 is answering instead.', level: 'warning', timestamp: 3 },
    ])
    expect(events).toContainEqual({ type: 'messages_retracted', sessionId: managed.id, turnIds: ['msg_2'], toolUseIds: [] })
    // The stopped text never reaches a client
    expect(events.some(e => e.type === 'text_delta')).toBe(false)
    expect(modelChanges).toEqual([[managed.id, 'workspace', 'claude-opus-4-8']])
  })

  it('removes finished text and tool calls, and points the unread marker at the last answer left', async () => {
    const { managed, events, persisted, fire } = harness()
    await fire({ type: 'text_complete', text: 'Earlier answer', turnId: 'msg_0' })
    const earlier = managed.lastFinalMessageId
    await fire({ type: 'tool_start', toolName: 'Read', toolUseId: 'toolu_2', input: {}, turnId: 'msg_2' })
    await fire({ type: 'text_complete', text: 'Stopped reply', turnId: 'msg_2' })
    const before = persisted()

    await fire({ type: 'messages_retracted', turnIds: ['msg_2'], toolUseIds: ['toolu_2'] })

    expect(managed.messages.map(m => m.content)).toEqual(['Earlier answer'])
    expect(managed.lastFinalMessageId).toBe(earlier)
    expect(persisted()).toBe(before + 1)
    expect(events.at(-1)).toEqual({ type: 'messages_retracted', sessionId: managed.id, turnIds: ['msg_2'], toolUseIds: ['toolu_2'] })
  })

  it("keeps the session's model when the backend goes on with the same one, or none", async () => {
    const { modelChanges, fire } = harness()
    await fire({ type: 'model_refusal', message: 'Stopped', fallbackModel: 'claude-opus-5-5' })
    await fire({ type: 'model_refusal', message: 'Stopped' })
    expect(modelChanges).toEqual([])
  })
})
