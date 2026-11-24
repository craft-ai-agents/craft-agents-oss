import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { SessionManager, createManagedSession } from './SessionManager.ts'

// An answered permission prompt is announced to every client (`permission_resolved`), so other
// windows, the WebUI and chat bindings drop it; answering it again reports false instead of a
// misleading success (craft-agents-oss#1130).
describe('respondToPermission', () => {
  let sm: SessionManager
  let events: Array<{ type: string; [key: string]: unknown }>
  let agentResponses: ReturnType<typeof mock>

  beforeEach(() => {
    sm = new SessionManager()
    events = []
    sm.setEventSink((_channel, _target, event) => events.push(event as never))
    agentResponses = mock(() => {})
    for (const id of ['s1', 's2']) {
      const workspace = { id: 'ws-test', name: 'Test Workspace', rootPath: '/nonexistent', createdAt: 1 }
      const managed = createManagedSession({ id, name: id }, workspace as never, { messagesLoaded: true })
      managed.agent = { respondToPermission: agentResponses } as never
      ;(sm as unknown as { sessions: Map<string, unknown> }).sessions.set(id, managed)
    }
  })

  function pending(requestId: string, meta: { sessionId: string; type?: string; commandHash?: string }) {
    ;(sm as any).pendingPermissionRequests.set(requestId, meta)
  }

  const resolved = () => events.filter(e => e.type === 'permission_resolved')

  it('delivers a pending answer and tells every client it was answered', () => {
    pending('req-1', { sessionId: 's1' })

    expect(sm.respondToPermission('s1', 'req-1', true, false)).toBe(true)

    expect(agentResponses.mock.calls).toEqual([['req-1', true, false]])
    expect(resolved()).toEqual([{ type: 'permission_resolved', sessionId: 's1', requestId: 'req-1', allowed: true }])
  })

  it('reports false for a prompt that was already answered, without answering it again', () => {
    pending('req-1', { sessionId: 's1' })
    sm.respondToPermission('s1', 'req-1', true, false)

    expect(sm.respondToPermission('s1', 'req-1', false, false)).toBe(false)

    expect(agentResponses).toHaveBeenCalledTimes(1)
    expect(resolved()).toHaveLength(1)
  })

  it('reports false for an unknown request, or one pending in another session', () => {
    pending('req-2', { sessionId: 's2' })

    expect(sm.respondToPermission('s1', 'nope', true, false)).toBe(false)
    expect(sm.respondToPermission('s1', 'req-2', true, false)).toBe(false)

    expect(agentResponses).not.toHaveBeenCalled()
    expect(resolved()).toHaveLength(0)
    // Still answerable in its own session.
    expect(sm.respondToPermission('s2', 'req-2', true, false)).toBe(true)
  })

  it('fails an admin approval the broker rejects closed, and announces it as denied', () => {
    // No broker request exists for it, so the broker refuses the approval.
    pending('req-admin', { sessionId: 's1', type: 'admin_approval', commandHash: 'hash' })

    expect(sm.respondToPermission('s1', 'req-admin', true, false)).toBe(false)

    expect(agentResponses.mock.calls).toEqual([['req-admin', false, false]])
    expect(resolved()).toEqual([{ type: 'permission_resolved', sessionId: 's1', requestId: 'req-admin', allowed: false }])
  })
})
