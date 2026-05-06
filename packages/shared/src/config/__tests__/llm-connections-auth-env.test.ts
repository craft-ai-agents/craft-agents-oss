import { afterEach, describe, expect, it } from 'bun:test'
import type { LlmConnection } from '../storage.ts'
import {
  clearClaudeBedrockRoutingEnvVars,
  resolveAuthEnvVars,
  resetManagedAnthropicAuthEnvVars,
} from '../llm-connections.ts'

const ENV_KEYS = [
  'CLAUDE_CODE_USE_BEDROCK',
  'AWS_BEARER_TOKEN_BEDROCK',
  'ANTHROPIC_BEDROCK_BASE_URL',
  'AWS_REGION',
] as const

const originalEnv = new Map<string, string | undefined>(
  ENV_KEYS.map((key) => [key, process.env[key]]),
)

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key)
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

afterEach(() => {
  restoreEnv()
})

function createBedrockConnection(
  overrides: Partial<LlmConnection> = {},
): LlmConnection {
  return {
    slug: 'bedrock-test',
    name: 'Bedrock Test',
    providerType: 'bedrock',
    authType: 'bearer_token',
    awsRegion: 'us-east-1',
    createdAt: Date.now(),
    ...overrides,
  } as LlmConnection
}

describe('Bedrock auth env handling', () => {
  it('resolveAuthEnvVars does not enable Claude Bedrock routing for bedrock connections', async () => {
    // Per packages/shared/CLAUDE.md: "Pi Bedrock uses its own AWS env path
    // instead." resolveAuthEnvVars is Anthropic-SDK-only and short-circuits
    // for non-Anthropic providers (including bedrock); the Pi backend wires
    // AWS credentials in its own postInit() path. The contract this test
    // protects is that none of the Claude-specific Bedrock routing env vars
    // — which would mis-route the Claude SDK subprocess at AWS — leak out.
    const connection = createBedrockConnection()
    const credentialManager = {
      getLlmApiKey: async () => 'bedrock-bearer-token',
      getLlmIamCredentials: async () => null,
    }

    const result = await resolveAuthEnvVars(
      connection,
      connection.slug,
      credentialManager as any,
      async () => ({}),
    )

    expect(result.success).toBe(true)
    expect(result.envVars.CLAUDE_CODE_USE_BEDROCK).toBeUndefined()
    expect(result.envVars.AWS_BEARER_TOKEN_BEDROCK).toBeUndefined()
    expect(result.envVars.ANTHROPIC_BEDROCK_BASE_URL).toBeUndefined()
  })

  it('clearClaudeBedrockRoutingEnvVars removes only Claude-specific Bedrock routing vars', () => {
    const env: Record<string, string | undefined> = {
      CLAUDE_CODE_USE_BEDROCK: '1',
      AWS_BEARER_TOKEN_BEDROCK: 'token',
      ANTHROPIC_BEDROCK_BASE_URL: 'https://bedrock.example.com',
      AWS_REGION: 'us-east-1',
    }

    clearClaudeBedrockRoutingEnvVars(env)

    expect(env.CLAUDE_CODE_USE_BEDROCK).toBeUndefined()
    expect(env.AWS_BEARER_TOKEN_BEDROCK).toBeUndefined()
    expect(env.ANTHROPIC_BEDROCK_BASE_URL).toBeUndefined()
    expect(env.AWS_REGION).toBe('us-east-1')
  })

  it('resetManagedAnthropicAuthEnvVars clears Bedrock routing vars from process env', () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    process.env.AWS_BEARER_TOKEN_BEDROCK = 'token'
    process.env.ANTHROPIC_BEDROCK_BASE_URL = 'https://bedrock.example.com'
    process.env.AWS_REGION = 'us-east-1'

    resetManagedAnthropicAuthEnvVars()

    expect(process.env.CLAUDE_CODE_USE_BEDROCK).toBeUndefined()
    expect(process.env.AWS_BEARER_TOKEN_BEDROCK).toBeUndefined()
    expect(process.env.ANTHROPIC_BEDROCK_BASE_URL).toBeUndefined()

    const originalRegion = originalEnv.get('AWS_REGION')
    if (originalRegion === undefined) {
      expect(process.env.AWS_REGION).toBeUndefined()
    } else {
      expect(process.env.AWS_REGION).toBe(originalRegion)
    }
  })
})
