import { describe, expect, it } from 'bun:test'
import { PiAgent } from '../pi-agent.ts'
import type { BackendConfig } from '../backend/types.ts'

function createConfig(): BackendConfig {
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
