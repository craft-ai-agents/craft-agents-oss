/**
 * Tests for ACP provider security and capacity limits.
 *
 * Covers:
 *   1. _buildSafeEnv inherits full parent env; acpEnv overrides take precedence.
 *   2. AcpAgent._pendingPermissions must have a hard capacity cap (MAX=100).
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { _buildSafeEnv, createLinkedTransports } from '../src/agent/acp-transport'
import { AcpAgent } from '../src/agent/acp-agent'
import type { BackendConfig } from '../src/agent/backend/types'

// ---------------------------------------------------------------------------
// 1. _buildSafeEnv — credential stripping
// ---------------------------------------------------------------------------

describe('_buildSafeEnv — inherits parent env, acpEnv overrides take precedence', () => {
  const savedEnv: Record<string, string | undefined> = {}

  function setEnv(key: string, value: string) {
    savedEnv[key] = process.env[key]
    process.env[key] = value
  }

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    for (const key of Object.keys(savedEnv)) delete savedEnv[key]
  })

  it('inherits full parent env including credential vars (ACP agents need their own keys)', () => {
    setEnv('ANTHROPIC_API_KEY', 'sk-ant-secret')
    setEnv('GEMINI_API_KEY', 'gemini-key')
    const env = _buildSafeEnv()
    // ACP agents (e.g. claude-code) need their own API keys from the environment
    expect(env['ANTHROPIC_API_KEY']).toBe('sk-ant-secret')
    expect(env['GEMINI_API_KEY']).toBe('gemini-key')
  })

  it('preserves safe system variables (PATH, HOME, USER)', () => {
    const env = _buildSafeEnv()
    if (process.env['PATH']) expect(env['PATH']).toBe(process.env['PATH'])
    if (process.env['HOME']) expect(env['HOME']).toBe(process.env['HOME'])
    if (process.env['USER']) expect(env['USER']).toBe(process.env['USER'])
  })

  it('acpEnv overrides take precedence over inherited env', () => {
    setEnv('ANTHROPIC_API_KEY', 'host-key')
    const env = _buildSafeEnv({ ANTHROPIC_API_KEY: 'override-key', MY_TOOL_VAR: 'tool' })
    expect(env['ANTHROPIC_API_KEY']).toBe('override-key')
    expect(env['MY_TOOL_VAR']).toBe('tool')
  })

  it('acpEnv-only keys are forwarded', () => {
    const env = _buildSafeEnv({ CUSTOM_VAR: 'hello', ANOTHER: 'world' })
    expect(env['CUSTOM_VAR']).toBe('hello')
    expect(env['ANOTHER']).toBe('world')
  })

  it('without acpEnv, returns copy of process.env', () => {
    setEnv('TEST_ONLY_VAR', 'present')
    const env = _buildSafeEnv()
    expect(env['TEST_ONLY_VAR']).toBe('present')
  })
})

// ---------------------------------------------------------------------------
// 2. AcpAgent._pendingPermissions capacity cap (MAX_PENDING_PERMISSIONS = 100)
// ---------------------------------------------------------------------------

function makeBackendConfig(): BackendConfig {
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
  } as BackendConfig
}

describe('AcpAgent — _pendingPermissions capacity cap', () => {
  it('denies permission/request immediately when map is at capacity (100)', async () => {
    const [clientTransport, serverTransport] = createLinkedTransports()
    const agent = new AcpAgent(makeBackendConfig(), clientTransport)

    // Collect server-side response promises
    const responses: Array<Promise<unknown>> = []

    // Fill the map to capacity (100 requests)
    for (let i = 0; i < 100; i++) {
      // Server sends permission/request — client suspends waiting for respondToPermission()
      responses.push(serverTransport.triggerRequest('permission/request', { requestId: `req-${i}` }))
    }
    // Let them all land
    await new Promise(r => setTimeout(r, 50))

    // 101st request: must be denied immediately (not suspended)
    const overflow = serverTransport.triggerRequest('permission/request', { requestId: 'overflow' })
    const result = await overflow as any
    expect(result.allowed).toBe(false)

    // Clean up: resolve the pending 100 before disposing
    for (let i = 0; i < 100; i++) {
      agent.respondToPermission(`req-${i}`, true)
    }
    await Promise.all(responses)

    agent.destroy()
    await serverTransport.dispose()
  }, 5000)

  it('allows permission/request again after pending count drops below cap', async () => {
    const [clientTransport, serverTransport] = createLinkedTransports()
    const agent = new AcpAgent(makeBackendConfig(), clientTransport)

    // Fill exactly one slot
    const p1 = serverTransport.triggerRequest('permission/request', { requestId: 'single' })
    await new Promise(r => setTimeout(r, 20))

    // Resolve it — slot freed
    agent.respondToPermission('single', true)
    const r1 = await p1 as any
    expect(r1.allowed).toBe(true)

    // Now send another — should succeed (not at cap)
    const p2 = serverTransport.triggerRequest('permission/request', { requestId: 'after' })
    await new Promise(r => setTimeout(r, 20))
    agent.respondToPermission('after', false)
    const r2 = await p2 as any
    expect(r2.allowed).toBe(false)

    agent.destroy()
    await serverTransport.dispose()
  }, 5000)
})
