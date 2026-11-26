import { describe, expect, it } from 'bun:test'
import type { RemoteServerConfig } from '@craft-agent/core/types'
import { RemoteConnections } from '../remote-connections'

class FakeClient {
  status = 'connected'
  destroyed = false
  constructor(readonly server: RemoteServerConfig) {}
  getConnectionState() { return { status: this.status } }
  destroy() { this.destroyed = true }
}

const server: RemoteServerConfig = { url: 'wss://box.example:9100', token: 'one', remoteWorkspaceId: 'remote-ws' }

/** `fail`: how many opens fail before they work. Opens resolve when the test calls `settle`. */
function harness({ fail = 0, deferred = false, idleMs }: { fail?: number; deferred?: boolean; idleMs?: number } = {}) {
  const opened: FakeClient[] = []
  const waiting: Array<() => void> = []
  let failures = fail
  const pool = new RemoteConnections<FakeClient>(async (config) => {
    if (deferred) await new Promise<void>(resolve => waiting.push(resolve))
    if (failures > 0) {
      failures--
      throw new Error('Connection failed')
    }
    const client = new FakeClient(config)
    opened.push(client)
    return client
  }, idleMs)
  const settle = () => { for (const resolve of waiting.splice(0)) resolve() }
  return { pool, opened, settle }
}

describe('RemoteConnections', () => {
  it('shares one connection per workspace', async () => {
    const { pool, opened } = harness()
    const first = await pool.get('ws', server)
    expect(await pool.get('ws', server)).toBe(first)
    expect(opened).toHaveLength(1)
    pool.dispose()
  })

  it('shares a connection that is still being opened', async () => {
    const { pool, opened, settle } = harness({ deferred: true })
    const a = pool.get('ws', server)
    const b = pool.get('ws', server)
    settle()
    expect(await a).toBe(await b)
    expect(opened).toHaveLength(1)
    pool.dispose()
  })

  it('replaces the connection when the token, address or workspace changes', async () => {
    const { pool, opened } = harness()
    const first = await pool.get('ws', server)
    const second = await pool.get('ws', { ...server, token: 'two' })
    expect(second).not.toBe(first)
    expect(first.destroyed).toBe(true)
    expect(second.server.token).toBe('two')
    expect(opened).toHaveLength(2)
    pool.dispose()
  })

  it('opens a new connection once the old one dropped', async () => {
    const { pool } = harness()
    const first = await pool.get('ws', server)
    first.status = 'disconnected'
    const second = await pool.get('ws', server)
    expect(second).not.toBe(first)
    expect(first.destroyed).toBe(true)
    pool.dispose()
  })

  it('reports a failed open and tries again on the next use', async () => {
    const { pool, opened } = harness({ fail: 1 })
    await expect(pool.get('ws', server)).rejects.toThrow('Connection failed')
    const client = await pool.get('ws', server)
    expect(client.status).toBe('connected')
    expect(opened).toHaveLength(1)
    pool.dispose()
  })

  it('drops a connection a request timed out on, not its replacement', async () => {
    const { pool, opened } = harness()
    const first = await pool.get('ws', server)
    pool.discard('ws', first)
    expect(first.destroyed).toBe(true)
    const second = await pool.get('ws', server)
    expect(second).not.toBe(first)
    // A late timeout from the old connection leaves the new one alone
    pool.discard('ws', first)
    expect(second.destroyed).toBe(false)
    expect(await pool.get('ws', server)).toBe(second)
    expect(opened).toHaveLength(2)
    pool.dispose()
  })

  it('closes a connection nobody used for a while', async () => {
    const { pool, opened } = harness({ idleMs: 20 })
    const first = await pool.get('ws', server)
    await new Promise(resolve => setTimeout(resolve, 60))
    expect(first.destroyed).toBe(true)
    const second = await pool.get('ws', server)
    expect(second).not.toBe(first)
    expect(opened).toHaveLength(2)
    pool.dispose()
  })

  it('keeps a connection in use open', async () => {
    const { pool } = harness({ idleMs: 40 })
    const first = await pool.get('ws', server)
    await new Promise(resolve => setTimeout(resolve, 25))
    await pool.get('ws', server)
    await new Promise(resolve => setTimeout(resolve, 25))
    expect(first.destroyed).toBe(false)
    pool.dispose()
  })

  it('closes everything on dispose, also a connection still being opened', async () => {
    const { pool, opened, settle } = harness({ deferred: true })
    const pending = pool.get('ws', server)
    pool.dispose()
    settle()
    const client = await pending
    // Once the open resolves the pool closes it: it was disposed meanwhile
    await Promise.resolve()
    expect(client.destroyed).toBe(true)
    expect(opened).toHaveLength(1)
  })
})
