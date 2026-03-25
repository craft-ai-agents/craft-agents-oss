import { afterEach, describe, expect, it } from 'bun:test'
import { buildClaudeSubprocessEnv } from '../options.ts'

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

describe('buildClaudeSubprocessEnv', () => {
  it('strips Claude-side Bedrock routing vars but preserves generic AWS env', () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    process.env.AWS_BEARER_TOKEN_BEDROCK = 'bedrock-token'
    process.env.ANTHROPIC_BEDROCK_BASE_URL = 'https://bedrock.example.com'
    process.env.AWS_REGION = 'us-east-1'

    const env = buildClaudeSubprocessEnv({
      ANTHROPIC_API_KEY: 'anthropic-key',
    })

    expect(env.CLAUDE_CODE_USE_BEDROCK).toBeUndefined()
    expect(env.AWS_BEARER_TOKEN_BEDROCK).toBeUndefined()
    expect(env.ANTHROPIC_BEDROCK_BASE_URL).toBeUndefined()
    expect(env.AWS_REGION).toBe('us-east-1')
    expect(env.ANTHROPIC_API_KEY).toBe('anthropic-key')
  })

  it('rejects Bedrock routing vars even when passed via envOverrides', () => {
    const env = buildClaudeSubprocessEnv({
      CLAUDE_CODE_USE_BEDROCK: '1',
      AWS_BEARER_TOKEN_BEDROCK: 'bedrock-token',
      ANTHROPIC_BEDROCK_BASE_URL: 'https://bedrock.example.com',
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth-token',
    })

    expect(env.CLAUDE_CODE_USE_BEDROCK).toBeUndefined()
    expect(env.AWS_BEARER_TOKEN_BEDROCK).toBeUndefined()
    expect(env.ANTHROPIC_BEDROCK_BASE_URL).toBeUndefined()
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('oauth-token')
  })
})
