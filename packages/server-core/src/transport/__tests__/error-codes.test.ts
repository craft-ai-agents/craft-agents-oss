/**
 * Transport error-code preservation + capability introspection tests.
 *
 * Spins up a real WsRpcServer + WsRpcClient and verifies that:
 * 1. Handler-thrown `CodedError` values surface on the receiver with `err.code`
 *    set to the original ErrorCode string.
 * 2. `instanceof CodedError` does NOT hold on the receiver (the transport
 *    reconstructs a plain Error; class identity is lost across the wire).
 * 3. `hasClientCapability` / `findClientsWithCapability` reflect the handshake.
 */

import { describe, it, expect, afterEach } from 'bun:test'
import { WsRpcServer } from '../server'
import { WsRpcClient } from '../client'
import { CLIENT_BROWSER_INVOKE } from '../capabilities'
import { CodedError } from '@craft-agent/shared/protocol'

const TEST_TOKEN = 'test-token-with-enough-entropy-to-pass'

const teardown: Array<() => void | Promise<void>> = []

afterEach(async () => {
  for (const fn of teardown.splice(0).reverse()) {
    try { await fn() } catch { /* best-effort */ }
  }
})

async function startPair(opts?: { clientCapabilities?: string[]; workspaceId?: string }) {
  const server = new WsRpcServer({
    host: '127.0.0.1',
    port: 0,
    requireAuth: true,
    validateToken: async (t) => t === TEST_TOKEN,
    serverId: 'test',
  })
  await server.listen()
  teardown.push(() => server.close())

  const client = new WsRpcClient(`ws://127.0.0.1:${server.port}`, {
    token: TEST_TOKEN,
    workspaceId: opts?.workspaceId ?? 'ws-a',
    clientCapabilities: opts?.clientCapabilities ?? [],
    autoReconnect: false,
  })
  client.connect()
  teardown.push(() => client.destroy())

  // Wait for handshake to complete.
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('client never connected')), 2000)
    const off = client.onConnectionStateChanged((state) => {
      if (state.status === 'connected') {
        clearTimeout(t); off(); resolve()
      } else if (state.status === 'failed' || state.status === 'disconnected') {
        clearTimeout(t); off(); reject(new Error(`status=${state.status}`))
      }
    })
  })

  return { server, client }
}

describe('Transport — error code preservation', () => {
  it('preserves `err.code` from server handler → client invoke', async () => {
    const { server, client } = await startPair()
    server.handle('explode', async () => {
      throw new CodedError('BROWSER_INSTANCE_NOT_OWNED', 'nope')
    })

    let caught: unknown
    try {
      await client.invoke('explode')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(Error)
    expect((caught as { code?: string }).code).toBe('BROWSER_INSTANCE_NOT_OWNED')
    // Class identity lost over the wire — receiver must branch on `.code`.
    expect(caught instanceof CodedError).toBe(false)
  })

  it('preserves `err.code` from client handler → server invokeClient', async () => {
    const { server, client } = await startPair({ clientCapabilities: [CLIENT_BROWSER_INVOKE] })

    client.handleCapability(CLIENT_BROWSER_INVOKE, () => {
      throw new CodedError('BROWSER_REMOTE_EVALUATE_BLOCKED', 'denied')
    })

    // Find the client id from server.
    const clientIds = server.findClientsWithCapability(CLIENT_BROWSER_INVOKE)
    expect(clientIds).toHaveLength(1)
    const clientId = clientIds[0]!

    let caught: unknown
    try {
      await server.invokeClient(clientId, CLIENT_BROWSER_INVOKE, { v: 1 })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(Error)
    expect((caught as { code?: string }).code).toBe('BROWSER_REMOTE_EVALUATE_BLOCKED')
  })

  it('falls back to HANDLER_ERROR when handler throws a plain Error', async () => {
    const { server, client } = await startPair()
    server.handle('plain', async () => { throw new Error('boom') })

    let caught: unknown
    try {
      await client.invoke('plain')
    } catch (err) {
      caught = err
    }
    expect((caught as { code?: string }).code).toBe('HANDLER_ERROR')
  })
})

describe('Transport — capability introspection', () => {
  it('hasClientCapability returns true only for advertised capabilities', async () => {
    const { server } = await startPair({ clientCapabilities: [CLIENT_BROWSER_INVOKE] })
    const ids = server.findClientsWithCapability(CLIENT_BROWSER_INVOKE)
    expect(ids).toHaveLength(1)
    expect(server.hasClientCapability(ids[0]!, CLIENT_BROWSER_INVOKE)).toBe(true)
    expect(server.hasClientCapability(ids[0]!, 'unknown-cap')).toBe(false)
    expect(server.hasClientCapability('not-a-real-id', CLIENT_BROWSER_INVOKE)).toBe(false)
  })

  it('findClientsWithCapability filters by workspaceId', async () => {
    const { server } = await startPair({ clientCapabilities: [CLIENT_BROWSER_INVOKE], workspaceId: 'ws-a' })
    expect(server.findClientsWithCapability(CLIENT_BROWSER_INVOKE, { workspaceId: 'ws-a' })).toHaveLength(1)
    expect(server.findClientsWithCapability(CLIENT_BROWSER_INVOKE, { workspaceId: 'ws-other' })).toHaveLength(0)
  })
})
