import { describe, expect, it } from 'bun:test'
import { ENV_CONNECTION_SLUG } from '@craft-agent/shared/config'
import { buildSsoSubprocessEnvOverrides, createManagedSession } from './SessionManager.ts'

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
})

describe('buildSsoSubprocessEnvOverrides', () => {
  it('injects the current SSO token and LLM_BASE_URL for the environment connection', async () => {
    const env = await buildSsoSubprocessEnvOverrides(ENV_CONNECTION_SLUG, {
      env: { LLM_BASE_URL: ' https://llm.example.test/v1 ' },
      loadSsoSession: async () => ({ token: 'sso-token' }),
    })

    expect(env).toEqual({
      CRAFT_LLM_SSO_TOKEN: 'sso-token',
      CRAFT_LLM_SSO_BASE_URL: 'https://llm.example.test/v1',
    })
  })

  it('does not expose SSO env vars for non-environment connections', async () => {
    const env = await buildSsoSubprocessEnvOverrides('default-api', {
      env: { LLM_BASE_URL: 'https://llm.example.test/v1' },
      loadSsoSession: async () => ({ token: 'sso-token' }),
    })

    expect(env.CRAFT_LLM_SSO_TOKEN).toBeUndefined()
    expect(env.CRAFT_LLM_SSO_BASE_URL).toBeUndefined()
  })
})
