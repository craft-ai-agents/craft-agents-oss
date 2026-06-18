import { describe, expect, it } from 'bun:test'
import { PiAgent } from '../pi-agent.ts'
import type { BackendConfig } from '../backend/types.ts'

function createConfig(sessionOverrides?: Record<string, unknown>): BackendConfig {
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
      ...sessionOverrides,
    } as any,
    isHeadless: true,
  }
}

describe('PiAgent branching capability', () => {
  it('reports supportsBranching=true', () => {
    const agent = new PiAgent(createConfig())
    expect(agent.supportsBranching).toBe(true)
    agent.destroy()
  })

  it('throws preflight error for branched session missing branchFromSessionPath', async () => {
    const agent = new PiAgent(createConfig({ branchFromMessageId: 'msg-parent' }))

    await expect(agent.ensureBranchReady()).rejects.toThrow(
      'Pi branch preflight failed: missing branchFromSessionPath metadata'
    )

    agent.destroy()
  })

  it('passes preflight when subprocess reports a valid Pi session id', async () => {
    const agent = new PiAgent(
      createConfig({
        branchFromMessageId: 'msg-parent',
        branchFromSessionPath: '/tmp/craft-agent-test/sessions/parent',
      })
    )

    ;(agent as any).requestEnsureSessionReady = async () => 'pi-session-123'

    await expect(agent.ensureBranchReady()).resolves.toBeUndefined()
    expect(agent.getSessionId()).toBe('pi-session-123')

    agent.destroy()
  })
})
