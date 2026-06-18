/**
 * Regression test for the PiAgent stderr ring buffer.
 *
 * When an LLM connection test times out we have historically had zero context:
 * stderr was routed only to this.debug() which requires CRAFT_DEBUG=1.
 * The ring buffer exposes the most recent stderr chunks unconditionally so
 * callers (factory.ts testBackendConnection timeout path) can surface them.
 */
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

// Private method `recordStderr` is accessed via an unknown-cast to match the
// pattern used in other pi-agent tests (see pi-agent-error-handling.test.ts).
const record = (agent: PiAgent, chunk: string): void => {
  ;(agent as unknown as { recordStderr: (chunk: string) => void }).recordStderr(chunk)
}

describe('PiAgent stderr ring buffer', () => {
  it('returns empty string when nothing has been recorded', () => {
    const agent = new PiAgent(createConfig())
    expect(agent.getRecentStderr()).toBe('')
    agent.destroy()
  })

  it('buffers single and multiple chunks in order', () => {
    const agent = new PiAgent(createConfig())
    record(agent, 'first\n')
    record(agent, 'second\n')
    record(agent, 'third')
    expect(agent.getRecentStderr()).toBe('first\nsecond\nthird')
    agent.destroy()
  })

  it('ignores empty chunks', () => {
    const agent = new PiAgent(createConfig())
    record(agent, '')
    record(agent, 'only')
    record(agent, '')
    expect(agent.getRecentStderr()).toBe('only')
    agent.destroy()
  })

  it('drops oldest chunks when total bytes exceed the 8KB cap', () => {
    const agent = new PiAgent(createConfig())
    const kb = 'x'.repeat(1024)
    // 10 KB total across 10 chunks; cap is 8 KB, so the earliest chunks must be dropped.
    for (let i = 0; i < 10; i++) {
      record(agent, kb)
    }
    const recent = agent.getRecentStderr()
    expect(recent.length).toBeLessThanOrEqual(8 * 1024)
    expect(recent.length).toBeGreaterThan(6 * 1024)
    // Last chunks are retained — after trimming, the buffer should still end with 'x'.
    expect(recent.endsWith('x')).toBe(true)
    agent.destroy()
  })

  it('keeps the tail of a single oversized chunk instead of discarding it', () => {
    const agent = new PiAgent(createConfig())
    const small = 'start'
    const huge = 'y'.repeat(12 * 1024)
    record(agent, small)
    record(agent, huge)
    const recent = agent.getRecentStderr()
    // Chunk is pre-truncated to the cap so we always retain the most recent
    // bytes even when a single write exceeds the buffer size.
    expect(recent.length).toBe(8 * 1024)
    expect(recent.startsWith('y')).toBe(true)
    expect(recent.endsWith('y')).toBe(true)
    agent.destroy()
  })
})
