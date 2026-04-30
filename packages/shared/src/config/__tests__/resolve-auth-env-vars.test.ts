import { describe, it, expect } from 'bun:test'
import { resolveAuthEnvVars, type LlmConnection } from '../llm-connections'
import type { CredentialManager } from '../../credentials/manager'

function makeConnection(overrides: Partial<LlmConnection>): LlmConnection {
  return {
    slug: 'test-conn',
    name: 'Test Connection',
    providerType: 'anthropic',
    authType: 'api_key',
    createdAt: Date.now(),
    ...overrides,
  }
}

function makeMockCredentialManager(overrides: Partial<CredentialManager> = {}): CredentialManager {
  return {
    getLlmApiKey: async () => null,
    getLlmOAuth: async () => null,
    getLlmIamCredentials: async () => null,
    ...overrides,
  } as unknown as CredentialManager
}

const noopGetValidOAuthToken = async () => ({ accessToken: null })

describe('resolveAuthEnvVars — Bedrock awsProfile', () => {
  it('sets AWS_PROFILE when awsProfile is configured', async () => {
    const connection = makeConnection({
      providerType: 'bedrock',
      authType: 'environment',
      awsRegion: 'us-east-1',
      awsProfile: 'my-sso-profile',
    })
    const result = await resolveAuthEnvVars(
      connection, 'bedrock-profile', makeMockCredentialManager(), noopGetValidOAuthToken,
    )
    expect(result.success).toBe(true)
    expect(result.envVars.AWS_PROFILE).toBe('my-sso-profile')
    expect(result.envVars.AWS_REGION).toBe('us-east-1')
  })

  it('does not set AWS_PROFILE when awsProfile is not configured', async () => {
    const connection = makeConnection({
      providerType: 'bedrock',
      authType: 'environment',
      awsRegion: 'us-east-1',
    })
    const result = await resolveAuthEnvVars(
      connection, 'bedrock-no-profile', makeMockCredentialManager(), noopGetValidOAuthToken,
    )
    expect(result.success).toBe(true)
    expect(result.envVars.AWS_PROFILE).toBeUndefined()
  })
})
