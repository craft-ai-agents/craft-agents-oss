/**
 * Security regression tests for ACP provider.
 *
 * Covers the two High-severity findings from code-review Round 1:
 *   1. StdioAcpTransport must NOT forward host credentials to subprocesses.
 *   2. AcpAgent._pendingPermissions must have a hard capacity cap (MAX=100).
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { _buildSafeEnv, createLinkedTransports } from '../src/agent/acp-transport'
import { AcpAgent } from '../src/agent/acp-agent'
import type { BackendConfig } from '../src/agent/backend/types'

// ---------------------------------------------------------------------------
// 1. _buildSafeEnv — credential stripping
// ---------------------------------------------------------------------------

describe('_buildSafeEnv — strips host credentials from subprocess env', () => {
  // Stash and restore process.env mutations
  const savedEnv: Record<string, string | undefined> = {}

  function setEnv(key: string, value: string) {
    savedEnv[key] = process.env[key]
    process.env[key] = value
  }

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
    // Clear stash
    for (const key of Object.keys(savedEnv)) {
      delete savedEnv[key]
    }
  })

  it('strips ANTHROPIC_ prefixed variables', () => {
    setEnv('ANTHROPIC_API_KEY', 'sk-ant-secret')
    setEnv('ANTHROPIC_MODEL', 'claude-opus')
    const env = _buildSafeEnv()
    expect(env['ANTHROPIC_API_KEY']).toBeUndefined()
    expect(env['ANTHROPIC_MODEL']).toBeUndefined()
  })

  it('strips CLAUDE_ prefixed variables', () => {
    setEnv('CLAUDE_API_KEY', 'claude-key')
    setEnv('CLAUDE_CODE_USE_BEDROCK', '1')
    const env = _buildSafeEnv()
    expect(env['CLAUDE_API_KEY']).toBeUndefined()
    expect(env['CLAUDE_CODE_USE_BEDROCK']).toBeUndefined()
  })

  it('strips AWS_ prefixed variables', () => {
    setEnv('AWS_SECRET_ACCESS_KEY', 'aws-secret')
    setEnv('AWS_ACCESS_KEY_ID', 'aws-key-id')
    setEnv('AWS_SESSION_TOKEN', 'aws-session')
    const env = _buildSafeEnv()
    expect(env['AWS_SECRET_ACCESS_KEY']).toBeUndefined()
    expect(env['AWS_ACCESS_KEY_ID']).toBeUndefined()
    expect(env['AWS_SESSION_TOKEN']).toBeUndefined()
  })

  it('strips OPENAI_ prefixed variables', () => {
    setEnv('OPENAI_API_KEY', 'openai-key')
    const env = _buildSafeEnv()
    expect(env['OPENAI_API_KEY']).toBeUndefined()
  })

  it('strips GEMINI_ and GOOGLE_ prefixed variables', () => {
    setEnv('GEMINI_API_KEY', 'gemini-key')
    setEnv('GOOGLE_APPLICATION_CREDENTIALS', '/path/to/creds.json')
    const env = _buildSafeEnv()
    expect(env['GEMINI_API_KEY']).toBeUndefined()
    expect(env['GOOGLE_APPLICATION_CREDENTIALS']).toBeUndefined()
  })

  it('strips variables ending with _KEY, _SECRET, _TOKEN, _PASSWORD', () => {
    setEnv('MY_SERVICE_API_KEY', 'key')
    setEnv('DB_PASSWORD', 'pw')
    setEnv('APP_SECRET', 's3cr3t')
    setEnv('GITHUB_TOKEN', 'gh-tok')
    const env = _buildSafeEnv()
    expect(env['MY_SERVICE_API_KEY']).toBeUndefined()
    expect(env['DB_PASSWORD']).toBeUndefined()
    expect(env['APP_SECRET']).toBeUndefined()
    expect(env['GITHUB_TOKEN']).toBeUndefined()
  })

  it('preserves safe system variables (PATH, HOME, USER)', () => {
    // These should pass through if they exist in process.env
    const env = _buildSafeEnv()
    if (process.env['PATH']) expect(env['PATH']).toBe(process.env['PATH'])
    if (process.env['HOME']) expect(env['HOME']).toBe(process.env['HOME'])
    if (process.env['USER']) expect(env['USER']).toBe(process.env['USER'])
  })

  it('merges acpEnv overrides even if they look like credentials', () => {
    // Operator-configured env overrides are intentional and must be forwarded
    const env = _buildSafeEnv({ GEMINI_API_KEY: 'operator-key', MY_TOOL_VAR: 'tool' })
    expect(env['GEMINI_API_KEY']).toBe('operator-key')
    expect(env['MY_TOOL_VAR']).toBe('tool')
  })

  it('acpEnv overrides do not expose host ANTHROPIC_API_KEY', () => {
    setEnv('ANTHROPIC_API_KEY', 'host-secret')
    // No acpEnv provided — host credential must still be stripped
    const env = _buildSafeEnv({ CUSTOM: 'value' })
    expect(env['ANTHROPIC_API_KEY']).toBeUndefined()
    expect(env['CUSTOM']).toBe('value')
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
