import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AccountStore } from '../accounts'
import { createWebuiHandler, type WebuiHandler } from '../http-server'
import { createSessionToken, validateSession, isEstablishedAccountSessionActive } from '../auth'

const secret = 'test-lifecycle-signing-secret'
const password = 'test-password-1234'
describe('enterprise account lifecycle', () => {
  let root: string
  let store: AccountStore
  const handlers: WebuiHandler[] = []
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'jonwork-lifecycle-'))
    let n = 0
    store = new AccountStore({ filePath: join(root, 'accounts.json'), usersRoot: join(root, 'users'), createWorkspace: () => ({ id: `ws-${++n}` }) })
  })
  afterEach(() => { handlers.splice(0).forEach(handler => handler.dispose()); rmSync(root, { recursive: true, force: true }) })
  function handler(allowRegistration?: boolean) {
    const result = createWebuiHandler({ webuiDir: root, secret, wsProtocol: 'ws', wsPort: 0, getHealthCheck: () => ({ status: 'ok' }), logger: { info() {}, warn() {}, error() {} } as any, accountStore: store, allowRegistration, jonworkControl: null })
    handlers.push(result)
    return result
  }
  function request(path: string, method = 'GET', body?: unknown, token?: string, cookie = false) {
    return new Request(`http://localhost${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? cookie ? { cookie: `craft_session=${token}` } : { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  }

  test('public registration is opt-in and cannot bootstrap an administrator', async () => {
    const policy = await handler().fetch(request('/api/auth/policy'))
    expect(policy.headers.get('cache-control')).toBe('no-store')
    expect(await policy.json()).toEqual({ allowRegistration: false })
    expect((await handler().fetch(request('/api/auth/register', 'POST', { username: 'outsider', password }))).status).toBe(403)
    const open = handler(true)
    expect(await (await open.fetch(request('/api/auth/policy'))).json()).toEqual({ allowRegistration: true })
    expect((await open.fetch(request('/api/auth/register', 'POST', { username: 'outsider', password }))).status).toBe(409)
    const results = await Promise.allSettled([store.register('admin-one', password, { bootstrap: true }), store.register('admin-two', password, { bootstrap: true })])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const registered = await open.fetch(request('/api/auth/register', 'POST', { username: 'customer', password, role: 'admin' }))
    expect(registered.status).toBe(201)
    expect((await registered.json() as any).account.role).toBe('user')
  })

  test('disabling and resetting invalidate sessions across restart; re-enable does not resurrect old tokens', async () => {
    const admin = await store.register('admin', password, { bootstrap: true })
    const user = await store.register('customer', password, { actorId: admin.id })
    const token = await createSessionToken(secret, user.id, user.authVersion)
    const api = handler()
    await store.setDisabled(user.id, true, admin.id)
    expect(await store.authenticate('customer', password)).toBeNull()
    expect((await api.fetch(request('/api/account', 'GET', undefined, token))).status).toBe(401)
    await expect(store.charge(user.id, crypto.randomUUID())).rejects.toThrow('停用')
    await store.setDisabled(user.id, false, admin.id)
    const reopened = new AccountStore({ filePath: join(root, 'accounts.json') })
    expect(reopened.isSessionActive(user.id, 0)).toBe(false)
    await store.resetPassword(user.id, 'new-test-password-1234', admin.id)
    expect(await store.authenticate('customer', password)).toBeNull()
    const current = await store.authenticate('customer', 'new-test-password-1234')
    expect(current).not.toBeNull()
    const fresh = await createSessionToken(secret, user.id, current!.authVersion)
    expect((await api.fetch(request('/api/account', 'GET', undefined, fresh))).status).toBe(200)
    expect(JSON.stringify(reopened.listAudit())).not.toContain('password-1234')
  })

  test('only an active administrator can manage accounts and last active admin is protected', async () => {
    const admin = await store.register('admin', password, { bootstrap: true })
    const user = await store.register('customer', password, { actorId: admin.id })
    await expect(store.setDisabled(admin.id, true, admin.id)).rejects.toThrow('有效管理员')
    await expect(store.resetPassword(admin.id, 'changed-test-password', user.id)).rejects.toThrow('管理员')
    await store.setRole(user.id, 'admin', admin.id)
    await store.setDisabled(user.id, true, admin.id)
    await expect(store.setRole(admin.id, 'user', admin.id)).rejects.toThrow('管理员')
    expect(store.isAdmin(user.id)).toBe(false)
  })

  test('cookie logout is durable and same-second logins have independent tokens', async () => {
    const admin = await store.register('admin', password, { bootstrap: true })
    const first = await createSessionToken(secret, admin.id)
    const second = await createSessionToken(secret, admin.id)
    expect(first).not.toBe(second)
    const api = handler()
    expect((await api.fetch(request('/api/auth/logout', 'POST', undefined, first, true))).status).toBe(204)
    expect((await handler().fetch(request('/api/account', 'GET', undefined, first, true))).status).toBe(401)
    expect((await api.fetch(request('/api/account', 'GET', undefined, second, true))).status).toBe(200)
    expect((await validateSession(`craft_session=${second}`, secret))?.sub).toBe(admin.id)
    expect(isEstablishedAccountSessionActive(`craft_session=${first}`, admin.id, store)).toBe(false)
    expect(isEstablishedAccountSessionActive(`craft_session=${second}`, admin.id, store)).toBe(true)
  })

  test('admin HTTP endpoints enforce roles and provide allowlisted audit records', async () => {
    const admin = await store.register('admin', password, { bootstrap: true })
    const token = await createSessionToken(secret, admin.id)
    const api = handler()
    const created = await api.fetch(request('/api/admin/users', 'POST', { username: 'customer', password }, token))
    expect(created.status).toBe(201)
    const user = (await created.json() as any).account
    const userToken = await createSessionToken(secret, user.id)
    expect((await api.fetch(request(`/api/admin/users/${admin.id}/status`, 'PATCH', { disabled: true }, userToken))).status).toBe(403)
    expect((await api.fetch(request(`/api/admin/users/${user.id}/password`, 'PATCH', { password: 'new-password-for-test' }, token))).status).toBe(204)
    expect((await api.fetch(request('/api/account', 'GET', undefined, userToken))).status).toBe(401)
    const audit = await api.fetch(request('/api/admin/audit', 'GET', undefined, token))
    expect(audit.status).toBe(200)
    expect(audit.headers.get('cache-control')).toBe('no-store')
    const events = (await audit.json() as any).events
    expect(events[0].action).toBe('password_reset')
    expect(Object.keys(events[0]).sort()).toEqual(['action', 'actorId', 'at', 'id', 'targetId'])
  })

  test('operator bootstrap reads protected stdin and refuses reinitialization without leaking input', async () => {
    const profile = join(root, 'operator-profile')
    const command = join(import.meta.dir, '../../../../server/src/bootstrap-account-admin.ts')
    const run = async () => {
      const process = Bun.spawn([Bun.which('bun')!, command], {
        env: { ...globalThis.process.env, JONWORK_CONFIG_DIR: profile, CRAFT_CONFIG_DIR: profile },
        stdin: 'pipe', stdout: 'pipe', stderr: 'pipe',
      })
      process.stdin.write(JSON.stringify({ username: 'operator-admin', password }))
      process.stdin.end()
      const [code, stdout, stderr] = await Promise.all([process.exited, new Response(process.stdout).text(), new Response(process.stderr).text()])
      expect(stdout + stderr).not.toContain(password)
      return code
    }
    expect(await run()).toBe(0)
    expect(await run()).toBe(1)
    const provisioned = new AccountStore({ filePath: join(profile, 'webui-accounts.json') }).listAccounts()
    expect(provisioned).toHaveLength(1)
    expect(provisioned[0]?.role).toBe('admin')
    const config = JSON.parse(readFileSync(join(profile, 'config.json'), 'utf8'))
    expect(config.workspaces).toHaveLength(1)
    expect(config.workspaces[0].id).toBe(provisioned[0]?.workspaceId)
  })

  test('operator bootstrap does not overwrite a corrupt existing workspace registry', async () => {
    const configPath = join(root, 'config.json')
    const original = '{"workspaces": [corrupt existing registry'
    writeFileSync(configPath, original)
    const child = Bun.spawn([Bun.which('bun')!, join(import.meta.dir, '../../../../server/src/bootstrap-account-admin.ts')], {
      env: { ...process.env, JONWORK_CONFIG_DIR: root, CRAFT_CONFIG_DIR: root },
      stdin: 'pipe', stdout: 'pipe', stderr: 'pipe',
    })
    child.stdin.write(JSON.stringify({ username: 'operator-admin', password }))
    child.stdin.end()
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    expect(code).toBe(1)
    expect(stdout + stderr).not.toContain(password)
    expect(readFileSync(configPath, 'utf8')).toBe(original)
  })
})
