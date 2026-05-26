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

  it('normalizes legacy thinkingEnabled=think on restore', () => {
    const managed = createManagedSession({
      id: 'session_legacy',
      thinkingEnabled: 'think' as any,
    }, workspace as any)

    expect(managed.thinkingEnabled).toBe(true)
  })

  it('normalizes legacy thinkingEnabled=off on restore', () => {
    const managed = createManagedSession({
      id: 'session_off',
      thinkingEnabled: 'off' as any,
    }, workspace as any)

    expect(managed.thinkingEnabled).toBe(false)
  })

  it('migrates legacy thinkingLevel=off on restore', () => {
    const managed = createManagedSession({
      id: 'session_legacy_off',
      thinkingLevel: 'off',
    } as any, workspace as any)

    expect(managed.thinkingEnabled).toBe(false)
    expect((managed as Record<string, unknown>).thinkingLevel).toBeUndefined()
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
