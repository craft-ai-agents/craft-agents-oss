import { describe, expect, it } from 'bun:test'
import { buildSsoLoginUrl, handleSsoCallback, handleSsoLogout, handleSsoStartupSession } from './sso'
import type { SsoSession } from '@craft-agent/shared/auth'

const session: SsoSession = {
  token: 'session-token',
  accessToken: 'access-token',
  idToken: 'id-token',
  expiresAt: 123456,
  employeeId: 'employee-1',
  ystId: 'yst-1',
  department: 'Engineering',
  userName: 'Ada Lovelace',
}

describe('SSO RPC handlers', () => {
  it('builds the OIDC authorization URL from environment configuration', () => {
    const url = new URL(buildSsoLoginUrl({
      MDP_AUTH_URL: 'https://auth.example.test/oauth/authorize?prompt=login',
      MDP_CLIENT_ID: 'desktop-client',
    } as NodeJS.ProcessEnv))

    expect(url.origin + url.pathname).toBe('https://auth.example.test/oauth/authorize')
    expect(url.searchParams.get('prompt')).toBe('login')
    expect(url.searchParams.get('client_id')).toBe('desktop-client')
    expect(url.searchParams.get('redirect_uri')).toBe('mdp://sso-callback')
    expect(url.searchParams.get('response_type')).toBe('code')
  })

  it('exchanges an SSO callback code and persists the session', async () => {
    const calls: string[] = []
    let savedSession: unknown = null

    const result = await handleSsoCallback(
      { code: 'abc123' },
      {
        authClient: {
          login: async (code) => {
            calls.push(code)
            return session
          },
        },
        credentialStore: {
          save: async (value) => {
            savedSession = value
          },
        },
      },
    )

    expect(result).toEqual({ success: true })
    expect(calls).toEqual(['abc123'])
    expect(savedSession).toEqual(session)
  })

  it('returns a failed result when the code exchange fails', async () => {
    const result = await handleSsoCallback(
      { code: 'abc123' },
      {
        authClient: {
          login: async () => {
            throw new Error('invalid_grant')
          },
        },
        credentialStore: {
          save: async () => {
            throw new Error('should not save')
          },
        },
      },
    )

    expect(result).toEqual({ success: false, error: 'invalid_grant' })
  })

  it('clears the persisted SSO session on logout', async () => {
    let clearCalls = 0

    const result = await handleSsoLogout({
      credentialStore: {
        clear: async () => {
          clearCalls += 1
        },
      },
    })

    expect(result).toEqual({ success: true })
    expect(clearCalls).toBe(1)
  })

  it('injects a mock SSO session when the dev bypass flag is enabled in an unpackaged build', async () => {
    let loadCalls = 0
    let refreshCalls = 0
    const savedSessions: SsoSession[] = []

    const result = await handleSsoStartupSession({
      isPackaged: false,
      env: { CRAFT_DISABLE_SSO: '1' } as NodeJS.ProcessEnv,
      credentialStore: {
        load: async () => {
          loadCalls += 1
          return null
        },
        save: async (value) => {
          savedSessions.push(value)
        },
        clear: async () => {},
      },
      authClient: {
        refresh: async () => {
          refreshCalls += 1
          return session
        },
      },
    })

    expect(result).toEqual({
      authenticated: true,
      userName: 'Development User',
      department: 'Development',
    })
    expect(loadCalls).toBe(0)
    expect(refreshCalls).toBe(0)
    expect(savedSessions).toHaveLength(1)
    const mockSession = savedSessions[0]
    expect(mockSession).toMatchObject({
      token: 'dev-sso-bypass-session-token',
      accessToken: 'dev-sso-bypass-access-token',
      idToken: 'dev-sso-bypass-id-token',
      employeeId: 'DEV-EMPLOYEE',
      ystId: 'DEV-YST',
      department: 'Development',
      userName: 'Development User',
    })
    expect(mockSession.expiresAt).toBeGreaterThan(Date.UTC(2099, 0, 1))
  })

  it('ignores the dev bypass flag in packaged builds and runs the normal session check', async () => {
    let saved = false

    const result = await handleSsoStartupSession({
      isPackaged: true,
      env: { CRAFT_DISABLE_SSO: '1' } as NodeJS.ProcessEnv,
      credentialStore: {
        load: async () => session,
        save: async () => {
          saved = true
        },
        clear: async () => {},
      },
      authClient: {
        refresh: async () => {
          throw new Error('refresh should not be called')
        },
      },
      now: () => 1,
    })

    expect(result).toEqual({
      authenticated: true,
      userName: 'Ada Lovelace',
      department: 'Engineering',
    })
    expect(saved).toBe(false)
  })
})
