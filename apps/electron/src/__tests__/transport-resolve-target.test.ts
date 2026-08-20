import { describe, test, expect, afterEach } from 'bun:test'
import { WsRpcServer } from '../transport/server'
import { WsRpcClient } from '../transport/client'

let servers: WsRpcServer[] = []
let clients: WsRpcClient[] = []
afterEach(() => {
  for (const c of clients) c.destroy()
  for (const s of servers) s.close()
  clients = []
  servers = []
})

async function makeServer(): Promise<WsRpcServer> {
  const s = new WsRpcServer({ host: '127.0.0.1', port: 0 })
  servers.push(s)
  await s.listen()
  return s
}

async function waitConnected(client: WsRpcClient, timeoutMs = 3000) {
  const start = Date.now()
  while (client.getConnectionState().status !== 'connected') {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`connect timeout, status=${client.getConnectionState().status}`)
    }
    await new Promise((r) => setTimeout(r, 10))
  }
}

describe('WsRpcClient resolveTarget', () => {
  test('resolves the target url before the first connect', async () => {
    const server = await makeServer()
    let resolveCalls = 0
    const client = new WsRpcClient('ws://127.0.0.1:1', {
      autoReconnect: false,
      workspaceId: 'w',
      resolveTarget: async () => {
        resolveCalls++
        return { url: `ws://127.0.0.1:${server.port}`, token: 'tok' }
      },
    })
    clients.push(client)
    client.connect()
    await waitConnected(client)
    expect(resolveCalls).toBe(1)
    expect(client.getConnectionState().url).toBe(`ws://127.0.0.1:${server.port}`)
  })

  test('re-dials a NEW port on reconnect (simulates tunnel moving ports)', async () => {
    const first = await makeServer()
    const second = await makeServer()
    expect(first.port).not.toBe(second.port)

    // First resolve → first server; after it dies, resolve → second server.
    let dead = false
    let lastResolvedPort = 0
    const client = new WsRpcClient('ws://127.0.0.1:1', {
      autoReconnect: true,
      workspaceId: 'w',
      maxReconnectDelay: 50,
      resolveTarget: async () => {
        const port = dead ? second.port : first.port
        lastResolvedPort = port
        return { url: `ws://127.0.0.1:${port}`, token: 'tok' }
      },
    })
    clients.push(client)
    client.connect()
    await waitConnected(client)
    expect(lastResolvedPort).toBe(first.port)

    // Kill the first server → client should reconnect and re-resolve to the second.
    dead = true
    first.close()
    servers = servers.filter((s) => s !== first)

    // Wait for the client to land on the second port.
    const start = Date.now()
    while (client.getConnectionState().url !== `ws://127.0.0.1:${second.port}` ||
           client.getConnectionState().status !== 'connected') {
      if (Date.now() - start > 5000) {
        throw new Error(`did not re-dial new port; url=${client.getConnectionState().url} status=${client.getConnectionState().status}`)
      }
      await new Promise((r) => setTimeout(r, 20))
    }
    expect(lastResolvedPort).toBe(second.port)
    expect(client.getConnectionState().url).toBe(`ws://127.0.0.1:${second.port}`)
  })

  test('stale resolve settling after a newer connect does nothing', async () => {
    const server = await makeServer()

    // First connect gets a resolve promise we control; second connect resolves
    // immediately to the real server.
    let call = 0
    let settleStale: ((target: { url: string; token?: string }) => void) | null = null
    let rejectStale: ((err: Error) => void) | null = null
    const client = new WsRpcClient('ws://127.0.0.1:1', {
      autoReconnect: false,
      workspaceId: 'w',
      resolveTarget: () => {
        call++
        if (call === 1) {
          return new Promise((resolve, reject) => {
            settleStale = resolve
            rejectStale = reject
          })
        }
        return Promise.resolve({ url: `ws://127.0.0.1:${server.port}`, token: 'tok' })
      },
    })
    clients.push(client)

    client.connect() // hangs on the first resolve
    await new Promise((r) => setTimeout(r, 20))
    expect(client.getConnectionState().status).toBe('connecting')

    client.connect() // newer attempt — resolves fast and connects
    await waitConnected(client)
    const goodUrl = `ws://127.0.0.1:${server.port}`
    expect(client.getConnectionState().url).toBe(goodUrl)

    // The stale resolve now settles with a bogus target — must be ignored.
    settleStale!({ url: 'ws://127.0.0.1:2', token: 'stale' })
    await new Promise((r) => setTimeout(r, 50))
    expect(client.getConnectionState().status).toBe('connected')
    expect(client.getConnectionState().url).toBe(goodUrl)

    // A stale rejection must not mark the healthy connection failed either.
    rejectStale!(new Error('stale boom'))
    await new Promise((r) => setTimeout(r, 50))
    expect(client.getConnectionState().status).toBe('connected')
    expect(client.getConnectionState().url).toBe(goodUrl)
  })

  test('hung resolveTarget times out, fails, and schedules a reconnect', async () => {
    let calls = 0
    const client = new WsRpcClient('ws://127.0.0.1:1', {
      autoReconnect: true,
      workspaceId: 'w',
      connectTimeout: 30, // resolve phase is bounded at 3x this
      maxReconnectDelay: 50,
      resolveTarget: () => {
        calls++
        return new Promise(() => {}) // never settles
      },
    })
    clients.push(client)
    client.connect()

    // Wait for the timeout to fire and the failure to surface.
    const start = Date.now()
    while (!client.getConnectionState().lastError) {
      if (Date.now() - start > 2000) {
        throw new Error(`resolve timeout never surfaced; status=${client.getConnectionState().status}`)
      }
      await new Promise((r) => setTimeout(r, 10))
    }
    expect(client.getConnectionState().lastError?.code).toBe('RESOLVE_TARGET_TIMEOUT')
    expect(client.getConnectionState().lastError?.kind).toBe('timeout')

    // The normal reconnect loop takes over — resolveTarget is called again.
    while (calls < 2) {
      if (Date.now() - start > 3000) throw new Error('reconnect never re-resolved')
      await new Promise((r) => setTimeout(r, 10))
    }
    expect(calls).toBeGreaterThanOrEqual(2)
  })
})
