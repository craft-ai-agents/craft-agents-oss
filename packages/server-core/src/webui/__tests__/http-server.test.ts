import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startWebuiHttpServer } from '../http-server'
import { AccountStore } from '../accounts'

const SECRET = 'test-server-secret'
const PASSWORD = 'test-password'
const TEMP_DIRS: string[] = []
const SERVERS: Array<{ stop: () => void }> = []

const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as any

function createTestWebuiDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'craft-webui-test-'))
  TEMP_DIRS.push(dir)
  writeFileSync(join(dir, 'login.html'), '<!doctype html><html><body>login</body></html>')
  writeFileSync(join(dir, 'index.html'), '<!doctype html><html><body>app</body></html>')
  return dir
}

async function createServer(overrides?: {
  secureCookies?: boolean
  publicWsUrl?: string
  wsProtocol?: 'ws' | 'wss'
  wsPort?: number
  accountStore?: AccountStore
  allowRegistration?: boolean
  trustedProxies?: string[]
}) {
  const server = await startWebuiHttpServer({
    port: 0,
    webuiDir: createTestWebuiDir(),
    secret: SECRET,
    password: PASSWORD,
    secureCookies: overrides?.secureCookies,
    publicWsUrl: overrides?.publicWsUrl,
    wsProtocol: overrides?.wsProtocol ?? 'wss',
    wsPort: overrides?.wsPort ?? 9100,
    getHealthCheck: () => ({ status: 'ok' }),
    logger,
    accountStore: overrides?.accountStore,
    allowRegistration: overrides?.allowRegistration,
    trustedProxies: overrides?.trustedProxies,
  })

  SERVERS.push(server)

  return {
    server,
    baseUrl: `http://127.0.0.1:${server.port}`,
  }
}

function extractSessionCookie(res: Response): string {
  const setCookie = res.headers.get('set-cookie')
  expect(setCookie).toBeTruthy()
  return setCookie!.split(';')[0]!
}

afterEach(() => {
  while (SERVERS.length > 0) {
    SERVERS.pop()?.stop()
  }

  while (TEMP_DIRS.length > 0) {
    const dir = TEMP_DIRS.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('startWebuiHttpServer', () => {
  it('allows plain-http login even when the RPC transport is wss', async () => {
    const { baseUrl } = await createServer({ wsProtocol: 'wss', wsPort: 9100 })

    const authRes = await fetch(`${baseUrl}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    })

    expect(authRes.status).toBe(200)
    const setCookie = authRes.headers.get('set-cookie')
    expect(setCookie).toContain('craft_session=')
    expect(setCookie).not.toContain('Secure')

    const configRes = await fetch(`${baseUrl}/api/config`, {
      headers: {
        cookie: extractSessionCookie(authRes),
      },
    })

    expect(configRes.status).toBe(200)
    expect(await configRes.json()).toEqual({
      wsUrl: 'wss://127.0.0.1:9100',
    })
  })

  it('rejects invalid credentials', async () => {
    const { baseUrl } = await createServer()

    const res = await fetch(`${baseUrl}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong-password' }),
    })

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Invalid credentials' })
  })

  it('honors an explicit secure-cookie override', async () => {
    const { baseUrl } = await createServer({ secureCookies: true, wsProtocol: 'ws', wsPort: 9100 })

    const res = await fetch(`${baseUrl}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toContain('Secure')
  })

  it('infers secure cookies from proxy https headers when no override is set', async () => {
    const { baseUrl } = await createServer({ wsProtocol: 'wss', wsPort: 9100, trustedProxies: ['127.0.0.1'] })

    const res = await fetch(`${baseUrl}/api/auth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-Proto': 'https',
      },
      body: JSON.stringify({ password: PASSWORD }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toContain('Secure')
  })

  it('derives a browser-facing websocket URL from forwarded public host headers', async () => {
    const { baseUrl } = await createServer({ wsProtocol: 'wss', wsPort: 9100, trustedProxies: ['127.0.0.1'] })

    const authRes = await fetch(`${baseUrl}/api/auth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-Host': 'craft.example.com:3100',
      },
      body: JSON.stringify({ password: PASSWORD }),
    })

    const configRes = await fetch(`${baseUrl}/api/config`, {
      headers: {
        cookie: extractSessionCookie(authRes),
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-Host': 'craft.example.com:3100',
      },
    })

    expect(configRes.status).toBe(200)
    expect(await configRes.json()).toEqual({
      wsUrl: 'wss://craft.example.com:9100',
    })
  })

  it('returns an explicit public websocket URL override from /api/config', async () => {
    const { baseUrl } = await createServer({
      publicWsUrl: 'wss://craft.example.com/ws',
      wsProtocol: 'wss',
      wsPort: 9100,
    })

    const authRes = await fetch(`${baseUrl}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    })

    const configRes = await fetch(`${baseUrl}/api/config`, {
      headers: {
        cookie: extractSessionCookie(authRes),
      },
    })

    expect(configRes.status).toBe(200)
    expect(await configRes.json()).toEqual({
      wsUrl: 'wss://craft.example.com/ws',
    })
  })

  it('registers isolated roles and allows only admins to recharge users', async () => {
    const root = mkdtempSync(join(tmpdir(), 'jonwork-http-accounts-'))
    TEMP_DIRS.push(root)
    let workspaceNumber = 0
    const accountStore = new AccountStore({
      filePath: join(root, 'accounts.json'),
      usersRoot: join(root, 'users'),
      createWorkspace: () => ({ id: `ws-${++workspaceNumber}` }),
    })
    await accountStore.register('admin', 'test-password123', { bootstrap: true })
    const { baseUrl } = await createServer({ accountStore, allowRegistration: true })

    const adminRegistration = await fetch(`${baseUrl}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'test-password123' }),
    })
    expect(adminRegistration.status).toBe(200)
    const adminCookie = extractSessionCookie(adminRegistration)

    const userRegistration = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'normal-user', password: 'test-password123' }),
    })
    const userBody = await userRegistration.json() as any
    expect(userBody.account.credits).toBe(300)
    expect(userBody.account.role).toBe('user')
    const userCookie = extractSessionCookie(userRegistration)

    const denied = await fetch(`${baseUrl}/api/admin/users`, { headers: { cookie: userCookie } })
    expect(denied.status).toBe(403)

    const recharge = await fetch(`${baseUrl}/api/admin/users/${userBody.account.id}/recharge`, {
      method: 'POST',
      headers: { cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 700 }),
    })
    expect(recharge.status).toBe(200)
    expect(((await recharge.json()) as any).account.credits).toBe(1_000)
  })

  it('supports desktop bearer login, account lookup, and revocation on logout', async () => {
    const root = mkdtempSync(join(tmpdir(), 'jonwork-desktop-account-'))
    TEMP_DIRS.push(root)
    const accountStore = new AccountStore({
      filePath: join(root, 'accounts.json'),
      usersRoot: join(root, 'users'),
      createWorkspace: () => ({ id: 'desktop-workspace' }),
    })
    await accountStore.register('desktop-user', 'password123')
    const { baseUrl } = await createServer({ accountStore })

    const login = await fetch(`${baseUrl}/api/auth/desktop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'desktop-user', password: 'password123' }),
    })
    expect(login.status).toBe(200)
    const { accessToken } = await login.json() as { accessToken: string }
    expect(accessToken).toBeTruthy()

    const account = await fetch(`${baseUrl}/api/account`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    expect(account.status).toBe(200)
    expect(((await account.json()) as any).username).toBe('desktop-user')

    const charge = await fetch(`${baseUrl}/api/account/charge`, {
      method: 'POST', headers: { Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ requestId: crypto.randomUUID() }),
    })
    const charged = await charge.json() as any
    expect(charged.account.credits).toBe(299)
    const refund = await fetch(`${baseUrl}/api/account/refund`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ chargeId: charged.chargeId }),
    })
    expect(((await refund.json()) as any).account.credits).toBe(300)
    expect((await fetch(`${baseUrl}/api/account/refund`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ chargeId: charged.chargeId }),
    })).status).toBe(200)

    expect((await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    })).status).toBe(204)
    expect((await fetch(`${baseUrl}/api/account`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })).status).toBe(401)
  })
})
