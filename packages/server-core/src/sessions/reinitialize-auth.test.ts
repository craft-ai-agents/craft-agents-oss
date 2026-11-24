import { describe, expect, it } from 'bun:test'
import { SessionManager, createManagedSession } from './SessionManager.ts'

// A Claude agent's CLIs start with the credentials its own postInit resolved, so a key or sign-in
// saved in Settings (SETUP → reinitializeAuth(slug)) reached running sessions only once they were
// recreated.
describe('reinitializeAuth', () => {
  it('resolves the credentials of the running agents on the connection again', async () => {
    const sm = new SessionManager()
    sm.setEventSink(() => {})
    const workspace = { id: 'ws-test', name: 'Test Workspace', rootPath: '/tmp/ws-test', createdAt: 1 }
    const sessions = (sm as unknown as { sessions: Map<string, ReturnType<typeof createManagedSession>> }).sessions
    const postInits: string[] = []
    for (const [id, slug] of [['on-it', 'test-reauth-conn'], ['other', 'test-other-conn'], ['no-agent', 'test-reauth-conn']] as const) {
      const managed = createManagedSession({ id, name: id }, workspace as never, { messagesLoaded: true })
      managed.llmConnection = slug
      if (id !== 'no-agent') {
        managed.agent = { postInit: async () => { postInits.push(id); return { authInjected: true } } } as never
      }
      sessions.set(id, managed)
    }

    await sm.reinitializeAuth('test-reauth-conn')

    expect(postInits).toEqual(['on-it'])
  })
})
