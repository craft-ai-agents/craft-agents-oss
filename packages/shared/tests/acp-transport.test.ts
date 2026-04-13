/**
 * Task 2: AcpTransport interface + InProcessAcpTransport
 *
 * InProcessAcpTransport is an in-memory implementation for unit testing.
 * It connects two sides (server/client) directly without spawning real processes.
 */
import { describe, it, expect, afterEach } from 'bun:test'
import {
  InProcessAcpTransport,
  createLinkedTransports,
} from '../src/agent/acp-transport'

// ============================================================
// Helper: drain a transport's pending messages
// ============================================================

describe('InProcessAcpTransport — sendRequest / response', () => {
  it('resolves when the peer sends a response', async () => {
    const [client, server] = createLinkedTransports()

    // Server echoes requests
    server.onRequest(async (method, params, id) => {
      return { echo: method, params, id }
    })

    const result = await client.sendRequest('ping', { hello: 'world' }) as any
    expect(result.echo).toBe('ping')
    expect(result.params).toEqual({ hello: 'world' })

    await client.dispose()
    await server.dispose()
  })

  it('rejects if the peer handler throws', async () => {
    const [client, server] = createLinkedTransports()

    server.onRequest(async () => {
      throw Object.assign(new Error('handler failed'), { code: -32001 })
    })

    await expect(client.sendRequest('boom')).rejects.toThrow('handler failed')

    await client.dispose()
    await server.dispose()
  })
})

describe('InProcessAcpTransport — onNotification', () => {
  it('delivers notifications from server to client', async () => {
    const [client, server] = createLinkedTransports()

    const received: Array<{ method: string; params: unknown }> = []
    client.onNotification((method, params) => {
      received.push({ method, params })
    })

    server.triggerNotification('session/update', { status: 'running' })

    // Notifications are delivered asynchronously via microtask/macrotask
    await new Promise(r => setTimeout(r, 10))

    expect(received).toHaveLength(1)
    expect(received[0]!.method).toBe('session/update')
    expect(received[0]!.params).toEqual({ status: 'running' })

    await client.dispose()
    await server.dispose()
  })
})

describe('InProcessAcpTransport — onRequest (server → client)', () => {
  it('delivers requests from server to client and sends back response', async () => {
    const [client, server] = createLinkedTransports()

    // Client handles FS requests from the server
    client.onRequest(async (method, params, id) => {
      expect(method).toBe('fs/readFile')
      return { content: 'file content' }
    })

    const result = await server.triggerRequest('fs/readFile', { path: '/foo.txt' }) as any
    expect(result.content).toBe('file content')

    await client.dispose()
    await server.dispose()
  })

  it('propagates errors from client handler back to server caller', async () => {
    const [client, server] = createLinkedTransports()

    client.onRequest(async () => {
      throw Object.assign(new Error('read denied'), { code: -32000 })
    })

    await expect(server.triggerRequest('fs/readFile', {})).rejects.toThrow('read denied')

    await client.dispose()
    await server.dispose()
  })
})

describe('InProcessAcpTransport — dispose', () => {
  it('dispose resolves and rejects in-flight requests', async () => {
    const [client, server] = createLinkedTransports()

    // Server never responds — we'll dispose client while request is pending
    server.onRequest(async () => {
      await new Promise(r => setTimeout(r, 10_000)) // never resolves in test
      return {}
    })

    const requestPromise = client.sendRequest('slow')

    // Dispose client immediately — should reject the pending request
    await client.dispose()

    await expect(requestPromise).rejects.toThrow()

    await server.dispose()
  })

  it('is safe to call dispose multiple times', async () => {
    const [client, server] = createLinkedTransports()
    await client.dispose()
    await expect(client.dispose()).resolves.toBeUndefined()
    await server.dispose()
  })
})
