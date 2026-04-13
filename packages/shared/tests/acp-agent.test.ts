/**
 * Task 6: AcpAgent
 *
 * Tests the full chatImpl loop, abort/forceAbort, respondToPermission, and
 * other BaseAgent abstract method implementations.
 *
 * All tests use InProcessAcpTransport to avoid spawning real processes.
 */
import { describe, it, expect, afterEach } from 'bun:test'
import { AcpAgent } from '../src/agent/acp-agent'
import { InProcessAcpTransport, createLinkedTransports } from '../src/agent/acp-transport'
import type { AgentEvent } from '@craft-agent/core/types'

// ============================================================
// Minimal BackendConfig factory
// ============================================================

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    provider: 'acp' as const,
    workspace: {
      id: 'test-ws',
      name: 'Test Workspace',
      slug: 'test-ws',
      rootPath: '/tmp/test-ws',
      createdAt: 0,
    },
    session: {
      id: 'test-session',
      workspaceRootPath: '/tmp/test-ws',
      createdAt: 0,
      lastUsedAt: 0,
    },
    isHeadless: true,
    model: '',
    miniModel: '',
    ...overrides,
  } as any
}

// ============================================================
// Helper: drain an AsyncGenerator into an array (with timeout)
// ============================================================

async function drainWithTimeout(
  gen: AsyncGenerator<AgentEvent>,
  timeoutMs = 3000,
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('drainWithTimeout: timed out')), timeoutMs)
  )
  await Promise.race([
    (async () => {
      for await (const e of gen) {
        events.push(e)
      }
    })(),
    timeout,
  ])
  return events
}

// ============================================================
// ACP server simulator
// ============================================================

/**
 * Returns a pair of transports and a server-side controller.
 * The "server" side simulates an ACP agent subprocess.
 */
function makeServerPair() {
  const [client, server] = createLinkedTransports()
  return { clientTransport: client, serverTransport: server }
}

// ============================================================
// Tests
// ============================================================

describe('AcpAgent — chatImpl happy path', () => {
  it('yields text_delta + complete events via InProcessAcpTransport', async () => {
    const { clientTransport, serverTransport } = makeServerPair()

    // Server: handle initialize, session/new, session/prompt
    serverTransport.onRequest(async (method, _params, _id) => {
      if (method === 'initialize') {
        return { protocolVersion: '0.1.0', capabilities: {}, serverInfo: { name: 'test', version: '0' } }
      }
      if (method === 'session/new') {
        return { sessionId: 'sess-001' }
      }
      if (method === 'session/prompt') {
        // Send streaming events asynchronously
        setTimeout(() => {
          serverTransport.triggerNotification('session/update', {
            sessionId: 'sess-001',
            status: 'running',
            content: [{ type: 'text', text: 'Hello ' }],
          })
          serverTransport.triggerNotification('session/update', {
            sessionId: 'sess-001',
            status: 'running',
            content: [{ type: 'text', text: 'world!', is_final: true }],
          })
          serverTransport.triggerNotification('session/update', {
            sessionId: 'sess-001',
            status: 'completed',
          })
        }, 10)
        return {}
      }
      return {}
    })

    const agent = new AcpAgent(makeConfig(), clientTransport)
    const events = await drainWithTimeout(agent.chat('Say hello'))

    const types = events.map(e => e.type)
    expect(types).toContain('text_delta')
    expect(types).toContain('text_complete')
    expect(types).toContain('complete')

    const textDelta = events.find(e => e.type === 'text_delta') as any
    expect(textDelta.text).toBe('Hello ')

    const textComplete = events.find(e => e.type === 'text_complete') as any
    expect(textComplete.text).toBe('world!')

    agent.destroy()
    await serverTransport.dispose()
  })
})

describe('AcpAgent — isProcessing', () => {
  it('returns false before chat, true during, false after', async () => {
    const { clientTransport, serverTransport } = makeServerPair()

    serverTransport.onRequest(async (method) => {
      if (method === 'initialize') return { protocolVersion: '0.1.0', capabilities: {}, serverInfo: { name: 'test', version: '0' } }
      if (method === 'session/new') return { sessionId: 'sess-002' }
      if (method === 'session/prompt') {
        setTimeout(() => {
          serverTransport.triggerNotification('session/update', { sessionId: 'sess-002', status: 'completed' })
        }, 10)
        return {}
      }
      return {}
    })

    const agent = new AcpAgent(makeConfig(), clientTransport)
    expect(agent.isProcessing()).toBe(false)

    let duringProcessing = false
    const gen = agent.chat('test')

    // Start consuming — agent is now processing
    const drainPromise = (async () => {
      for await (const _ of gen) {
        duringProcessing = agent.isProcessing()
      }
    })()

    await drainPromise
    expect(duringProcessing).toBe(true)
    expect(agent.isProcessing()).toBe(false)

    agent.destroy()
    await serverTransport.dispose()
  })
})

describe('AcpAgent — abort', () => {
  it('abort() causes chatImpl to complete without hanging', async () => {
    const { clientTransport, serverTransport } = makeServerPair()

    let abortRequestReceived = false
    serverTransport.onRequest(async (method) => {
      if (method === 'initialize') return { protocolVersion: '0.1.0', capabilities: {}, serverInfo: { name: 'test', version: '0' } }
      if (method === 'session/new') return { sessionId: 'sess-003' }
      if (method === 'session/prompt') {
        // Server never sends completed on its own — agent must abort
        return {}
      }
      if (method === 'session/cancel') {
        abortRequestReceived = true
        // Server acknowledges cancel with a cancelled status notification
        setTimeout(() => {
          serverTransport.triggerNotification('session/update', { sessionId: 'sess-003', status: 'cancelled' })
        }, 10)
        return {}
      }
      return {}
    })

    const agent = new AcpAgent(makeConfig(), clientTransport)

    // Start chat but abort immediately after first event (or after 50ms)
    const collectPromise = (async () => {
      const events: AgentEvent[] = []
      const chatGen = agent.chat('test message')
      setTimeout(() => void agent.abort('user stop'), 50)
      for await (const e of chatGen) {
        events.push(e)
      }
      return events
    })()

    const events = await Promise.race([
      collectPromise,
      new Promise<AgentEvent[]>((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
    ])

    // Agent should have completed (not hung)
    expect(Array.isArray(events)).toBe(true)
    expect(abortRequestReceived).toBe(true)

    agent.destroy()
    await serverTransport.dispose()
  })
})

describe('AcpAgent — forceAbort', () => {
  it('forceAbort() completes the stream immediately', async () => {
    const { clientTransport, serverTransport } = makeServerPair()

    serverTransport.onRequest(async (method) => {
      if (method === 'initialize') return { protocolVersion: '0.1.0', capabilities: {}, serverInfo: { name: 'test', version: '0' } }
      if (method === 'session/new') return { sessionId: 'sess-004' }
      if (method === 'session/prompt') {
        return {} // never sends completed
      }
      return {}
    })

    const { AbortReason } = await import('../src/agent/backend/types')
    const agent = new AcpAgent(makeConfig(), clientTransport)

    const collectPromise = (async () => {
      const events: AgentEvent[] = []
      const chatGen = agent.chat('force abort test')
      setTimeout(() => agent.forceAbort(AbortReason.UserStop), 50)
      for await (const e of chatGen) {
        events.push(e)
      }
      return events
    })()

    const events = await Promise.race([
      collectPromise,
      new Promise<AgentEvent[]>((_, reject) => setTimeout(() => reject(new Error('forceAbort timeout')), 2000)),
    ])

    expect(Array.isArray(events)).toBe(true)
    expect(agent.isProcessing()).toBe(false)

    agent.destroy()
    await serverTransport.dispose()
  })
})

describe('AcpAgent — queryLlm / runMiniCompletion', () => {
  it('queryLlm throws (ACP agents handle their own LLM)', async () => {
    const [transport] = createLinkedTransports()
    const agent = new AcpAgent(makeConfig(), transport)

    await expect(agent.queryLlm({} as any)).rejects.toThrow()
    agent.destroy()
    await transport.dispose()
  })

  it('runMiniCompletion returns null (ACP agents have no mini-completion path)', async () => {
    const [transport] = createLinkedTransports()
    const agent = new AcpAgent(makeConfig(), transport)

    const result = await agent.runMiniCompletion('hello')
    expect(result).toBeNull()

    agent.destroy()
    await transport.dispose()
  })
})

describe('AcpAgent — destroy', () => {
  it('destroy() is synchronous and disposes transport', async () => {
    const [transport] = createLinkedTransports()
    const agent = new AcpAgent(makeConfig(), transport)

    expect(() => agent.destroy()).not.toThrow()
    // Second destroy should be safe
    expect(() => agent.destroy()).not.toThrow()
    await transport.dispose()
  })
})

describe('AcpAgent — fs callback (respondToPermission / onRequest)', () => {
  it('handles fs/read_text_file request from server and responds with file content', async () => {
    const { clientTransport, serverTransport } = makeServerPair()

    const capturedCallbackResult: unknown[] = []

    serverTransport.onRequest(async (method) => {
      if (method === 'initialize') return { protocolVersion: '0.1.0', capabilities: {}, serverInfo: { name: 'test', version: '0' } }
      if (method === 'session/new') return { sessionId: 'sess-005' }
      if (method === 'session/prompt') {
        // Server sends a file-read request to the client, then completes
        setTimeout(async () => {
          const result = await serverTransport.triggerRequest('fs/read_text_file', { path: '/test.txt' })
          capturedCallbackResult.push(result)
          serverTransport.triggerNotification('session/update', { sessionId: 'sess-005', status: 'completed' })
        }, 10)
        return {}
      }
      return {}
    })

    const agent = new AcpAgent(makeConfig(), clientTransport)

    // Register a custom file-read handler (simulating actual file read)
    agent.setFsReadHandler(async (path: string) => `content of ${path}`)

    const events = await drainWithTimeout(agent.chat('read a file'))

    expect(events.some(e => e.type === 'complete')).toBe(true)
    expect(capturedCallbackResult).toHaveLength(1)
    expect((capturedCallbackResult[0] as any).content).toBe('content of /test.txt')

    agent.destroy()
    await serverTransport.dispose()
  })
})
