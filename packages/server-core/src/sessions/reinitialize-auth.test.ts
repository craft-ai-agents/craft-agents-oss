import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import * as config from '@craft-agent/shared/config'
import * as credentials from '@craft-agent/shared/credentials'
import { SessionManager, createManagedSession } from './SessionManager.ts'

const ENV_KEYS = ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_BASE_URL']
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))

afterEach(() => {
  mock.restore()
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

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

  // process.env reaches the processes the app starts, the Pi subprocess and the shell commands
  // its agent runs among them. A Claude agent resolves its own credentials in postInit.
  it("never puts a connection's credentials into process.env", async () => {
    spyOn(config, 'getLlmConnection').mockImplementation(((slug: string) => ({
      slug, name: slug, providerType: 'anthropic', authType: 'api_key', baseUrl: 'https://gateway.example.com',
    })) as never)
    spyOn(credentials, 'getCredentialManager').mockReturnValue({
      getLlmApiKey: async () => 'sk-saved-in-settings',
    } as never)
    const sm = new SessionManager()
    sm.setEventSink(() => {})

    await sm.reinitializeAuth('test-gateway-conn')

    for (const key of ENV_KEYS) expect(process.env[key]).toBe(originalEnv[key])
  })
})
