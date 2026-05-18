import { describe, expect, it } from 'bun:test'
import { buildSsoLoginUrl, handleSsoCallback, handleSsoLogout } from './sso'
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
})
