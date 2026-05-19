import { describe, expect, it } from 'bun:test'
import { buildSsoLoginUrl, handleSsoCallback, handleSsoLogout, handleSsoStartupSession, registerSsoHandlers, startSsoLogin } from './sso'
import { decodeOAuthRelayState } from '@craft-agent/shared/auth'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
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

const RELAY_URL = 'https://relay.example.test/auth/callback'

const ssoEnv = {
  MDP_AUTH_URL: 'https://auth.example.test/oauth/authorize',
  MDP_CLIENT_ID: 'desktop-client',
  MDP_RELAY_URL: RELAY_URL,
} as NodeJS.ProcessEnv

const strictEnv = { ...ssoEnv, MDP_ENABLE_SSO_STATE_CHECK: '1' } as NodeJS.ProcessEnv

function nonceFromAuthUrl(authUrl: string): string {
  return decodeOAuthRelayState(new URL(authUrl).searchParams.get('state') ?? '').innerState
}

describe('SSO RPC handlers', () => {
  it('builds the OIDC authorization URL with a nonce state when MDP_ENABLE_SSO_STATE_CHECK is set', () => {
    const { authUrl, nonce } = buildSsoLoginUrl({
      MDP_AUTH_URL: 'https://auth.example.test/oauth/authorize?prompt=login',
      MDP_CLIENT_ID: 'desktop-client',
      MDP_RELAY_URL: RELAY_URL,
      MDP_ENABLE_SSO_STATE_CHECK: '1',
    } as NodeJS.ProcessEnv)
    const url = new URL(authUrl)
    const state = url.searchParams.get('state')

    expect(url.origin + url.pathname).toBe('https://auth.example.test/oauth/authorize')
    expect(url.searchParams.get('prompt')).toBe('login')
    expect(url.searchParams.get('client_id')).toBe('desktop-client')
    expect(url.searchParams.get('redirect_uri')).toBe(RELAY_URL)
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(nonce).toMatch(/^[a-f0-9]{32}$/)
    expect(state).toStartWith('ca1.')
    expect(decodeOAuthRelayState(state ?? '')).toEqual({
      returnTo: 'mdp://sso-callback',
      innerState: nonce!,
    })
  })

  it('builds the OIDC authorization URL without a state param when MDP_ENABLE_SSO_STATE_CHECK is not set', () => {
    const { authUrl, nonce } = buildSsoLoginUrl({
      MDP_AUTH_URL: 'https://auth.example.test/oauth/authorize',
      MDP_CLIENT_ID: 'desktop-client',
      MDP_RELAY_URL: RELAY_URL,
    } as NodeJS.ProcessEnv)
    const url = new URL(authUrl)

    expect(url.searchParams.get('state')).toBeNull()
    expect(nonce).toBeNull()
  })

  it('requires the auth URL to build an SSO login URL', () => {
    expect(() => buildSsoLoginUrl({
      MDP_CLIENT_ID: 'desktop-client',
    } as NodeJS.ProcessEnv)).toThrow('MDP_AUTH_URL is required to start SSO login')
  })

  it('requires the client ID to build an SSO login URL', () => {
    expect(() => buildSsoLoginUrl({
      MDP_AUTH_URL: 'https://auth.example.test/oauth/authorize',
    } as NodeJS.ProcessEnv)).toThrow('MDP_CLIENT_ID is required to start SSO login')
  })

  it('requires the relay URL to build an SSO login URL', () => {
    expect(() => buildSsoLoginUrl({
      MDP_AUTH_URL: 'https://auth.example.test/oauth/authorize',
      MDP_CLIENT_ID: 'desktop-client',
    } as NodeJS.ProcessEnv)).toThrow('MDP_RELAY_URL is required to start SSO login')
  })

  it('returns only the auth URL from the START_LOGIN RPC handler', async () => {
    const previous = {
      MDP_AUTH_URL: process.env.MDP_AUTH_URL,
      MDP_CLIENT_ID: process.env.MDP_CLIENT_ID,
      MDP_RELAY_URL: process.env.MDP_RELAY_URL,
      MDP_ENABLE_SSO_STATE_CHECK: process.env.MDP_ENABLE_SSO_STATE_CHECK,
    }
    const handlers = new Map<string, (ctx: unknown, ...args: unknown[]) => unknown>()
    const server = {
      handle: (channel: string, handler: (ctx: unknown, ...args: unknown[]) => unknown) => {
        handlers.set(channel, handler)
      },
      push: () => {},
      invokeClient: async () => {},
    }

    try {
      process.env.MDP_AUTH_URL = 'https://auth.example.test/oauth/authorize'
      process.env.MDP_CLIENT_ID = 'desktop-client'
      process.env.MDP_RELAY_URL = RELAY_URL
      process.env.MDP_ENABLE_SSO_STATE_CHECK = '1'
      registerSsoHandlers(server as never, { platform: { isPackaged: false } } as never)

      const authUrl = await handlers.get(RPC_CHANNELS.sso.START_LOGIN)?.({
        clientId: 'client-1',
        workspaceId: null,
        webContentsId: null,
      }) as string

      expect(typeof authUrl).toBe('string')
      expect(new URL(authUrl).searchParams.get('state')).toStartWith('ca1.')
    } finally {
      if (previous.MDP_AUTH_URL === undefined) delete process.env.MDP_AUTH_URL
      else process.env.MDP_AUTH_URL = previous.MDP_AUTH_URL
      if (previous.MDP_CLIENT_ID === undefined) delete process.env.MDP_CLIENT_ID
      else process.env.MDP_CLIENT_ID = previous.MDP_CLIENT_ID
      if (previous.MDP_RELAY_URL === undefined) delete process.env.MDP_RELAY_URL
      else process.env.MDP_RELAY_URL = previous.MDP_RELAY_URL
      if (previous.MDP_ENABLE_SSO_STATE_CHECK === undefined) delete process.env.MDP_ENABLE_SSO_STATE_CHECK
      else process.env.MDP_ENABLE_SSO_STATE_CHECK = previous.MDP_ENABLE_SSO_STATE_CHECK
      await handleSsoCallback(
        { code: 'clear-pending-nonce', state: 'clear-pending-nonce' },
        {
          authClient: {
            login: async () => session,
          },
          credentialStore: {
            save: async () => {},
          },
        },
      )
    }
  })

  it('exchanges an SSO callback code and persists the session', async () => {
    const calls: string[] = []
    let savedSession: unknown = null
    const nonce = nonceFromAuthUrl(startSsoLogin(strictEnv))

    const result = await handleSsoCallback(
      { code: 'abc123', state: nonce },
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

  it('rejects an SSO callback with the wrong nonce when the state check flag is enabled', async () => {
    startSsoLogin(strictEnv)
    let loginCalls = 0

    const result = await handleSsoCallback(
      { code: 'abc123', state: 'wrong-nonce' },
      {
        authClient: {
          login: async () => {
            loginCalls += 1
            return session
          },
        },
        credentialStore: {
          save: async () => {
            throw new Error('should not save')
          },
        },
      },
      strictEnv,
    )

    expect(result).toEqual({ success: false, error: 'Invalid SSO state' })
    expect(loginCalls).toBe(0)
  })

  it('allows an SSO callback with the wrong state when the state check flag is disabled', async () => {
    startSsoLogin(ssoEnv)
    let loginCalls = 0

    const result = await handleSsoCallback(
      { code: 'abc123', state: 'wrong-nonce' },
      {
        authClient: {
          login: async () => {
            loginCalls += 1
            return session
          },
        },
        credentialStore: { save: async () => {} },
      },
      ssoEnv,
    )

    expect(result).toEqual({ success: true })
    expect(loginCalls).toBe(1)
  })

  it('rejects a replayed SSO callback because the nonce is cleared after first use', async () => {
    const nonce = nonceFromAuthUrl(startSsoLogin(strictEnv))
    const calls: string[] = []
    const deps = {
      authClient: {
        login: async (code: string) => {
          calls.push(code)
          return session
        },
      },
      credentialStore: {
        save: async () => {},
      },
    }

    expect(await handleSsoCallback({ code: 'abc123', state: nonce }, deps, strictEnv)).toEqual({ success: true })
    expect(await handleSsoCallback({ code: 'abc123', state: nonce }, deps, strictEnv)).toEqual({ success: false })
    expect(calls).toEqual(['abc123'])
  })

  it('rejects an SSO callback when no login nonce is pending', async () => {
    let loginCalls = 0

    const result = await handleSsoCallback(
      { code: 'abc123', state: 'orphaned-nonce' },
      {
        authClient: {
          login: async () => {
            loginCalls += 1
            return session
          },
        },
        credentialStore: {
          save: async () => {},
        },
      },
      strictEnv,
    )

    expect(result).toEqual({ success: false })
    expect(loginCalls).toBe(0)
  })

  it('clears the pending SSO nonce after a failed validation', async () => {
    const nonce = nonceFromAuthUrl(startSsoLogin(strictEnv))
    let loginCalls = 0
    const deps = {
      authClient: {
        login: async () => {
          loginCalls += 1
          return session
        },
      },
      credentialStore: {
        save: async () => {},
      },
    }

    expect(await handleSsoCallback({ code: 'abc123', state: 'wrong-nonce' }, deps, strictEnv)).toEqual({
      success: false,
      error: 'Invalid SSO state',
    })
    expect(await handleSsoCallback({ code: 'abc123', state: nonce }, deps, strictEnv)).toEqual({ success: false })
    expect(loginCalls).toBe(0)
  })

  it('returns a failed result when the code exchange fails', async () => {
    const nonce = nonceFromAuthUrl(startSsoLogin(strictEnv))

    const result = await handleSsoCallback(
      { code: 'abc123', state: nonce },
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
      strictEnv,
    )

    expect(result).toEqual({ success: false, error: 'invalid_grant' })
  })

  it('keeps only the latest pending SSO nonce', async () => {
    const firstNonce = nonceFromAuthUrl(startSsoLogin(strictEnv))
    const secondNonce = nonceFromAuthUrl(startSsoLogin(strictEnv))
    let loginCalls = 0

    const firstResult = await handleSsoCallback(
      { code: 'abc123', state: firstNonce },
      {
        authClient: {
          login: async () => {
            loginCalls += 1
            return session
          },
        },
        credentialStore: {
          save: async () => {},
        },
      },
      strictEnv,
    )

    expect(firstResult).toEqual({ success: false, error: 'Invalid SSO state' })
    expect(loginCalls).toBe(0)
    expect(firstNonce).not.toBe(secondNonce)
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
