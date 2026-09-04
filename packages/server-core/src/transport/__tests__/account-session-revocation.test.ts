import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import WebSocket from 'ws'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WsRpcServer } from '../server'
import { AccountStore } from '../../webui/accounts'
import { createSessionToken, validateSession, isEstablishedAccountSessionActive } from '../../webui/auth'
import { PROTOCOL_VERSION } from '@craft-agent/shared/protocol'

const secret = 'test-ws-session-revocation-secret'
describe('established account socket revocation', () => {
  let root: string
  let store: AccountStore
  let server: WsRpcServer
  let accountId: string
  let token: string
  const sockets: WebSocket[] = []
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'jonwork-ws-revocation-'))
    store = new AccountStore({ filePath: join(root, 'accounts.json'), usersRoot: join(root, 'users'), createWorkspace: () => ({ id: 'workspace' }) })
    const admin = await store.register('admin', 'test-password-for-ws', { bootstrap: true })
    accountId = admin.id
    token = await createSessionToken(secret, accountId)
    server = new WsRpcServer({
      host: '127.0.0.1', port: 0, requireAuth: true,
      validateSessionCookie: async cookie => {
        const claims = await validateSession(cookie, secret)
        return claims && isEstablishedAccountSessionActive(cookie, claims.sub, store) ? claims.sub : null
      },
      isSessionActive: (cookie, principal) => isEstablishedAccountSessionActive(cookie, principal, store),
      resolvePrincipalWorkspace: id => store.getWorkspaceId(id),
    })
    await server.listen()
  })
  afterEach(() => { sockets.splice(0).forEach(ws => ws.terminate()); server.close(); rmSync(root, { recursive: true, force: true }) })

  async function connect(authToken = token, reconnect?: { reconnectClientId: string; lastSeq: number }, bearer = false) {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { headers: bearer ? {} : { cookie: `craft_session=${authToken}` } })
    sockets.push(ws)
    const messages: any[] = []
    ws.on('message', data => messages.push(JSON.parse(data.toString())))
    const closed = new Promise<number>(resolve => ws.once('close', code => resolve(code)))
    const ack = await new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => { ws.terminate(); reject(new Error('Handshake timed out')) }, 2000)
      ws.once('open', () => ws.send(JSON.stringify({ id: 'handshake', type: 'handshake', protocolVersion: PROTOCOL_VERSION, clientCapabilities: ['test:cap'], ...(bearer ? { token: authToken, workspaceId: 'forged-other-workspace' } : {}), ...reconnect })))
      ws.on('message', data => {
        const message = JSON.parse(data.toString())
        if (message.type === 'handshake_ack') { clearTimeout(timeout); resolve(message) }
      })
      ws.once('close', () => { clearTimeout(timeout); reject(new Error('Handshake rejected')) })
      ws.once('error', error => { clearTimeout(timeout); reject(error) })
    })
    return { ws, messages, ack, closed }
  }

  test('desktop account bearer is scoped to its principal and revoked on existing sockets', async () => {
    const client = await connect(token, undefined, true)
    let observed: any
    server.handle('test:identity', ctx => { observed = ctx; return true })
    client.ws.send(JSON.stringify({ id: 'identity', type: 'request', channel: 'test:identity', args: [] }))
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('RPC timeout')), 2000)
      client.ws.on('message', raw => {
        if (JSON.parse(raw.toString()).id === 'identity') { clearTimeout(timer); resolve() }
      })
    })
    expect(observed.principalId).toBe(accountId)
    expect(observed.workspaceId).toBe('workspace')
    await store.revokeToken(token, Date.now() + 60_000)
    client.ws.send(JSON.stringify({ id: 'revoked', type: 'request', channel: 'test:identity', args: [] }))
    expect(await client.closed).toBe(4005)
    await expect(connect(token, undefined, true)).rejects.toThrow()
  })

  test('revoked cookie cannot invoke a handler on an already open connection', async () => {
    let calls = 0
    server.handle('test:private', () => { calls++; return 'private' })
    const client = await connect()
    await store.revokeToken(token, Date.now() + 60_000)
    client.ws.send(JSON.stringify({ id: 'request', type: 'request', channel: 'test:private', args: [] }))
    expect(await client.closed).toBe(4005)
    expect(calls).toBe(0)
    expect(client.messages.some(message => message.type === 'response')).toBe(false)
    await expect(connect()).rejects.toThrow('rejected')
  })

  test('password reset suppresses a late handler response', async () => {
    let release!: () => void
    let entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    server.handle('test:slow', async () => {
      entered()
      await new Promise<void>(resolve => { release = resolve })
      return 'sensitive-result'
    })
    const client = await connect()
    client.ws.send(JSON.stringify({ id: 'request', type: 'request', channel: 'test:slow', args: [] }))
    await started
    await store.resetPassword(accountId, 'new-test-password-for-ws', accountId)
    release()
    expect(await client.closed).toBe(4005)
    expect(client.messages.some(message => message.result === 'sensitive-result')).toBe(false)
  })

  test('pushes close revoked sockets and do not buffer private events for replay', async () => {
    const client = await connect()
    await store.revokeToken(token, Date.now() + 60_000)
    server.push('test:private', { to: 'all' }, 'sensitive-push')
    expect(await client.closed).toBe(4005)
    expect(client.messages.some(message => message.type === 'event')).toBe(false)
    const freshToken = await createSessionToken(secret, accountId)
    const fresh = await connect(freshToken, { reconnectClientId: client.ack.clientId, lastSeq: 0 })
    expect(fresh.ack.reconnected).not.toBe(true)
    expect(fresh.messages.some(message => message.type === 'event')).toBe(false)
  })

  test('new login cannot replay the event buffer of a disconnected, revoked login', async () => {
    const old = await connect()
    old.ws.close()
    await old.closed
    server.push('test:private', { to: 'all' }, 'buffered-for-old-login')
    await store.revokeToken(token, Date.now() + 60_000)
    const nextToken = await createSessionToken(secret, accountId)
    const next = await connect(nextToken, { reconnectClientId: old.ack.clientId, lastSeq: 0 })
    expect(next.ack.reconnected).not.toBe(true)
    expect(next.messages.some(message => message.type === 'event')).toBe(false)
  })

  test('another connection cannot forge a response to a server invocation', async () => {
    const a = await connect()
    const b = await connect()
    server.handle('test:barrier', () => true)
    const nextMessage = (ws: WebSocket, predicate: (message: any) => boolean) => new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => { ws.off('message', receive); reject(new Error('Message timeout')) }, 2000)
      const receive = (raw: WebSocket.RawData) => {
        const message = JSON.parse(raw.toString())
        if (predicate(message)) { clearTimeout(timeout); ws.off('message', receive); resolve(message) }
      }
      ws.on('message', receive)
    })
    const incoming = nextMessage(a.ws, message => message.type === 'request')
    const result = server.invokeClient(a.ack.clientId, 'test:cap')
    const call = await incoming
    b.ws.send(JSON.stringify({ id: call.id, type: 'response', result: 'forged' }))
    const barrier = nextMessage(b.ws, message => message.id === 'barrier')
    b.ws.send(JSON.stringify({ id: 'barrier', type: 'request', channel: 'test:barrier' }))
    await barrier
    a.ws.send(JSON.stringify({ id: call.id, type: 'response', result: 'correct' }))
    expect(await result).toBe('correct')
  })
})
