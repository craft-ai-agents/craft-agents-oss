import { describe, expect, it } from 'bun:test'
import { SessionManager, createManagedSession } from './SessionManager.ts'

describe('createManagedSession', () => {
  const workspace = {
    id: 'ws_test',
    name: 'Test Workspace',
    rootPath: '/tmp/test-workspace',
    createdAt: Date.now(),
  }

  it('normalizes legacy thinkingLevel=think on restore', () => {
    const managed = createManagedSession({
      id: 'session_legacy',
      thinkingLevel: 'think' as any,
    }, workspace as any)

    expect(managed.thinkingLevel).toBe('medium')
  })

  it('drops invalid thinking levels instead of leaking them into runtime state', () => {
    const managed = createManagedSession({
      id: 'session_invalid',
      thinkingLevel: 'ultra' as any,
    }, workspace as any)

    expect(managed.thinkingLevel).toBeUndefined()
  })

  it("exposes a branch's source session id, named by its session folder", () => {
    const sm = new SessionManager()
    const sessions = (sm as unknown as { sessions: Map<string, unknown> }).sessions
    sessions.set('branch', createManagedSession({ id: 'branch' }, workspace as any, {
      branchFromSessionPath: '/tmp/test-workspace/sessions/260101-source',
    }))
    sessions.set('plain', createManagedSession({ id: 'plain' }, workspace as any))

    const byId = new Map(sm.getSessions('ws_test').map(s => [s.id, s]))
    expect(byId.get('branch')?.branchFromSessionId).toBe('260101-source')
    expect(byId.get('plain')?.branchFromSessionId).toBeUndefined()
  })
})
