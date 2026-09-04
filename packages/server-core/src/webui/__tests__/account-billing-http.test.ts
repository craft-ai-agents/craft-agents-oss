import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AccountStore } from '../accounts'
import { createSessionToken } from '../auth'
import { createWebuiHandler } from '../http-server'

const roots: string[] = [], disposers: Array<() => void> = []
afterEach(() => { disposers.splice(0).forEach(dispose => dispose()); roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })) })

describe('billing HTTP persistence', () => {
  it('preserves idempotency, refund and logout revocation across handler restarts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'jonwork-billing-http-')); roots.push(root)
    const options = { filePath: join(root, 'accounts.json'), usersRoot: join(root, 'users'), createWorkspace: () => ({ id: crypto.randomUUID() }) }
    const store = new AccountStore(options)
    const account = await store.register('alice', 'test-password')
    const secret = 'test-only-billing-secret'
    const token = await createSessionToken(secret, account.id)
    const makeHandler = () => {
      const handler = createWebuiHandler({ webuiDir: root, secret, accountStore: new AccountStore(options), jonworkControl: null,
        wsProtocol: 'ws', wsPort: 9100, getHealthCheck: () => ({ status: 'ok' }), logger: { info() {}, warn() {}, error() {} } as any })
      disposers.push(handler.dispose); return handler
    }
    let handler = makeHandler()
    const request = (path: string, body?: unknown, extraHeaders?: Record<string, string>) => handler.fetch(new Request(`http://localhost${path}`, {
      method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extraHeaders },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }))
    expect((await request('/api/account/charge', {})).status).toBe(400)
    expect((await request('/api/account/charge', { requestId: crypto.randomUUID() }, { Origin: 'https://untrusted.test' })).status).toBe(403)
    const requestId = crypto.randomUUID()
    const first = await (await request('/api/account/charge', { requestId })).json() as any
    handler.dispose(); handler = makeHandler()
    const second = await (await request('/api/account/charge', { requestId })).json() as any
    expect(second.chargeId).toBe(first.chargeId)
    expect(second.account.credits).toBe(299)
    expect((await request('/api/account/refund', { chargeId: first.chargeId })).status).toBe(200)
    expect((await request('/api/account/refund', { chargeId: first.chargeId })).status).toBe(200)
    expect(store.getById(account.id)?.credits).toBe(300)
    const ledger = await request('/api/account/charges')
    expect(ledger.headers.get('cache-control')).toBe('no-store')
    expect((await ledger.json() as any).charges).toHaveLength(1)
    expect((await request('/api/auth/logout', {})).status).toBe(204)
    handler.dispose(); handler = makeHandler()
    expect((await request('/api/account')).status).toBe(401)
    expect((await handler.fetch(new Request('http://localhost/api/account', { headers: { Cookie: `craft_session=${token}` } }))).status).toBe(401)
  })
})
