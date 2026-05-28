import { describe, expect, it } from 'bun:test'
import { PiAgent } from '../pi-agent.ts'
import type { BackendConfig } from '../backend/types.ts'

function createConfig(overrides: Partial<BackendConfig> = {}): BackendConfig {
  return {
    provider: 'pi',
    workspace: {
      id: 'ws-test',
      name: 'Test Workspace',
      rootPath: '/tmp/craft-agent-test',
    } as any,
    session: {
      id: 'session-test',
      workspaceRootPath: '/tmp/craft-agent-test',
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    } as any,
    isHeadless: true,
    ...overrides,
  }
}

describe('PiAgent Bedrock env handling', () => {
  it('buildAwsEnv uses AWS env only and never sets CLAUDE_CODE_USE_BEDROCK', () => {
    const agent = new PiAgent(createConfig())

    const env = (agent as any).buildAwsEnv(
      {
        credential: {
          type: 'iam',
          accessKeyId: 'AKIA_TEST',
          secretAccessKey: 'secret',
          sessionToken: 'session',
          region: 'eu-central-1',
        },
      },
      { piAuthProvider: 'amazon-bedrock' },
    ) as Record<string, string>

    expect(env.AWS_ACCESS_KEY_ID).toBe('AKIA_TEST')
    expect(env.AWS_SECRET_ACCESS_KEY).toBe('secret')
    expect(env.AWS_SESSION_TOKEN).toBe('session')
    expect(env.AWS_REGION).toBe('eu-central-1')
    expect(env.AWS_BEDROCK_FORCE_HTTP1).toBe('1')
    expect(env.CLAUDE_CODE_USE_BEDROCK).toBeUndefined()

    agent.destroy()
  })

  it('buildAwsEnv returns empty env for non-Bedrock Pi providers', () => {
    const agent = new PiAgent(createConfig())

    const env = (agent as any).buildAwsEnv(
      {
        credential: {
          type: 'iam',
          accessKeyId: 'AKIA_TEST',
          secretAccessKey: 'secret',
          region: 'eu-central-1',
        },
      },
      { piAuthProvider: 'anthropic' },
    ) as Record<string, string>

    expect(env).toEqual({})

    agent.destroy()
  })
})

describe('PiAgent SSO subprocess env handling', () => {
  it('passes SSO env overrides when the session explicitly provides them', () => {
    const agent = new PiAgent(createConfig({
      envOverrides: {
        CRAFT_LLM_SSO_TOKEN: 'sso-token',
        CRAFT_LLM_SSO_BASE_URL: 'https://llm.example.test/v1',
      },
    }))

    const env = (agent as any).buildSubprocessEnv(null, {}, '/tmp/session') as NodeJS.ProcessEnv

    expect(env.CRAFT_LLM_SSO_TOKEN).toBe('sso-token')
    expect(env.CRAFT_LLM_SSO_BASE_URL).toBe('https://llm.example.test/v1')

    agent.destroy()
  })

  it('strips parent SSO env vars when the session does not explicitly provide them', () => {
    const previousToken = process.env.CRAFT_LLM_SSO_TOKEN
    const previousBaseUrl = process.env.CRAFT_LLM_SSO_BASE_URL
    process.env.CRAFT_LLM_SSO_TOKEN = 'parent-token'
    process.env.CRAFT_LLM_SSO_BASE_URL = 'https://parent.example.test/v1'

    try {
      const agent = new PiAgent(createConfig())

      const env = (agent as any).buildSubprocessEnv(null, {}, '/tmp/session') as NodeJS.ProcessEnv

      expect(env.CRAFT_LLM_SSO_TOKEN).toBeUndefined()
      expect(env.CRAFT_LLM_SSO_BASE_URL).toBeUndefined()

      agent.destroy()
    } finally {
      if (previousToken === undefined) {
        delete process.env.CRAFT_LLM_SSO_TOKEN
      } else {
        process.env.CRAFT_LLM_SSO_TOKEN = previousToken
      }
      if (previousBaseUrl === undefined) {
        delete process.env.CRAFT_LLM_SSO_BASE_URL
      } else {
        process.env.CRAFT_LLM_SSO_BASE_URL = previousBaseUrl
      }
    }
  })
})
