/**
 * Workspace-scoped connector pool.
 *
 * McpClientPool is created per SESSION (SessionManager.ts:3404) and torn down
 * on close, so nothing is connected when a user simply opens a saved page. This
 * owns a pool whose lifetime is the workspace instead.
 *
 * Tested against an injected pool factory: standing up real MCP subprocesses in
 * a unit test would test the SDK, not this.
 */
import { describe, expect, it, beforeEach } from 'bun:test'
import { WorkspaceSourcePool } from './source-pool.ts'

interface FakePool {
  connected: string[]
  calls: Array<{ name: string; args: Record<string, unknown> }>
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>
  disconnectAll: () => Promise<void>
  disposed: boolean
}

let built: FakePool[]
let buildDelayMs: number
let callResult: unknown
let callError: Error | null

function makeFakePool(): FakePool {
  const p: FakePool = {
    connected: ['gmail', 'linear'],
    calls: [],
    disposed: false,
    callTool: async (name, args) => {
      p.calls.push({ name, args })
      if (callError) throw callError
      return callResult
    },
    disconnectAll: async () => { p.disposed = true },
  }
  return p
}

function pool(overrides: Record<string, unknown> = {}) {
  return new WorkspaceSourcePool({
    workspaceRootPath: '/ws',
    buildPool: async () => {
      if (buildDelayMs) await new Promise(r => setTimeout(r, buildDelayMs))
      const p = makeFakePool()
      built.push(p)
      return p as never
    },
    ...overrides,
  })
}

beforeEach(() => {
  built = []
  buildDelayMs = 0
  callResult = { ok: 1 }
  callError = null
})

describe('lazy start', () => {
  it('does not connect anything until a query arrives', async () => {
    const p = pool()
    expect(built).toHaveLength(0)
    await p.callTool('gmail', 'list_messages', {})
    expect(built).toHaveLength(1)
  })

  it('reuses the pool across calls', async () => {
    const p = pool()
    await p.callTool('gmail', 'list_messages', {})
    await p.callTool('gmail', 'list_labels', {})
    expect(built).toHaveLength(1)
  })

  it('does not build twice under concurrent first calls', async () => {
    // Two page loads at once would otherwise each spawn a full set of stdio
    // MCP subprocesses, and one set would leak with no reference held.
    buildDelayMs = 30
    const p = pool()
    await Promise.all([
      p.callTool('gmail', 'list_messages', {}),
      p.callTool('gmail', 'list_labels', {}),
      p.callTool('linear', 'list_issues', {}),
    ])
    expect(built).toHaveLength(1)
  })
})

describe('dispatch', () => {
  it('calls the proxy-named tool', async () => {
    const p = pool()
    await p.callTool('gmail', 'list_messages', { q: 'x' })
    expect(built[0]!.calls[0]!.name).toContain('gmail')
    expect(built[0]!.calls[0]!.name).toContain('list_messages')
    expect(built[0]!.calls[0]!.args).toEqual({ q: 'x' })
  })

  it('propagates connector errors for the bridge to redact', async () => {
    callError = new Error('401 Unauthorized')
    const p = pool()
    await expect(p.callTool('gmail', 'list_messages', {})).rejects.toThrow('401')
  })
})

describe('idle shutdown', () => {
  it('disconnects after the idle timeout so subprocesses do not linger', async () => {
    const p = pool({ idleTimeoutMs: 40 })
    await p.callTool('gmail', 'list_messages', {})
    expect(built[0]!.disposed).toBe(false)
    await new Promise(r => setTimeout(r, 90))
    expect(built[0]!.disposed).toBe(true)
  })

  it('resets the idle timer on each call', async () => {
    const p = pool({ idleTimeoutMs: 80 })
    await p.callTool('gmail', 'list_messages', {})
    await new Promise(r => setTimeout(r, 50))
    await p.callTool('gmail', 'list_labels', {})
    await new Promise(r => setTimeout(r, 50))
    expect(built[0]!.disposed).toBe(false)
    await p.dispose()
  })

  it('rebuilds after an idle shutdown', async () => {
    const p = pool({ idleTimeoutMs: 30 })
    await p.callTool('gmail', 'list_messages', {})
    await new Promise(r => setTimeout(r, 80))
    await p.callTool('gmail', 'list_messages', {})
    expect(built).toHaveLength(2)
  })
})

describe('dispose', () => {
  it('tears the pool down and cancels the idle timer', async () => {
    const p = pool({ idleTimeoutMs: 10_000 })
    await p.callTool('gmail', 'list_messages', {})
    await p.dispose()
    expect(built[0]!.disposed).toBe(true)
  })

  it('is safe when nothing was ever built', async () => {
    await expect(pool().dispose()).resolves.toBeUndefined()
  })
})
