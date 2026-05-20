import { describe, expect, it } from 'bun:test'
import {
  ENV_CONNECTION_SLUG,
  isEnvironmentConnectionSlug,
  rejectEnvironmentConnectionMutation,
  synthesizeEnvConnectionWithStatus,
} from './llm-connections'

describe('Environment LLM connection helpers', () => {
  it('builds the protected status entry from LLM_BASE_URL and an active SSO token', () => {
    const connection = synthesizeEnvConnectionWithStatus({
      LLM_BASE_URL: 'https://env.example.test/v1',
      LLM_MODEL: 'env-model',
    }, 'sso-token')

    expect(connection).toMatchObject({
      slug: ENV_CONNECTION_SLUG,
      name: 'Environment',
      isEnvironmentConnection: true,
      isDefault: true,
      isAuthenticated: true,
      baseUrl: 'https://env.example.test/v1',
      defaultModel: 'env-model',
    })
  })

  it('does not build the protected status entry without LLM_BASE_URL or an active SSO token', () => {
    expect(synthesizeEnvConnectionWithStatus({}, 'sso-token')).toBeNull()
    expect(synthesizeEnvConnectionWithStatus({
      LLM_BASE_URL: 'https://env.example.test/v1',
    }, undefined)).toBeNull()
  })

  it('identifies and rejects mutations for the reserved env-provider slug', () => {
    expect(isEnvironmentConnectionSlug('env-provider')).toBe(true)
    expect(isEnvironmentConnectionSlug('user-provider')).toBe(false)
    expect(rejectEnvironmentConnectionMutation()).toEqual({
      success: false,
      error: 'The Environment connection is managed by process environment variables and cannot be modified.',
    })
  })
})
