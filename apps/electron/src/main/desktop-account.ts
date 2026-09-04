import { app, BrowserWindow, ipcMain, net, safeStorage, shell, type IpcMainInvokeEvent } from 'electron'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { materializeAccountSkills, setAccountSkillRoots, type AccountSkillSnapshot, type SaveAccountSkillInput } from '@craft-agent/shared/skills'
import { normalizeAccountServerUrl } from '../shared/account-server-url'
import { DESKTOP_RELEASE } from '@craft-agent/shared/deployment'
import { assertDesktopAccount, boundedAccountFetch, isTrustedAccountFrame } from './account-security'
import { desktopErpLogin, managedWebSocketUrl } from './desktop-erp-login'
import { restoreStoredDesktopSession, type StoredDesktopSession } from './desktop-account-session'

const accountFetch = (url: string, init?: RequestInit) => boundedAccountFetch(net.fetch.bind(net) as typeof fetch, url, init)

function accountServerUrl(input: string): string {
  if (typeof input !== 'string' || input.length > 2048) throw new Error('无效的账户服务器地址')
  const url = normalizeAccountServerUrl(input)
  if (app.isPackaged && !DESKTOP_RELEASE.allowCustomAccountServer
    && url !== normalizeAccountServerUrl(DESKTOP_RELEASE.accountServerUrl)) throw new Error('此安装包仅允许连接企业账户服务器')
  return url
}

export interface DesktopAccount {
  id: string
  username: string
  credits: number
  workspaceId: string
  role: 'admin' | 'user'
  executionMode?: 'server_only'
  billingMode?: 'server'
}

let managedConnection: { url: string; token: string; remoteWorkspaceId: string } | null = null
let loginGeneration = 0
let sessionMutation: Promise<unknown> = Promise.resolve()
function mutateSession<T>(operation: () => Promise<T>): Promise<T> {
  const next = sessionMutation.then(operation, operation)
  sessionMutation = next.then(() => undefined, () => undefined)
  return next
}

const sessionPath = () => join(app.getPath('userData'), 'account', 'session.json')
let skillGeneration = 0
let skillQueue: Promise<unknown> = Promise.resolve()

function clearAccountSkills(): void {
  skillGeneration++
  const empty = join(app.getPath('userData'), 'account-skills', 'signed-out')
  setAccountSkillRoots({ publicRoot: empty, privateRoot: empty })
}

async function accountSkillRequest(path: string, method = 'GET', body?: unknown): Promise<any> {
  const session = await loadSession()
  if (!session) throw new Error('请先登录账户')
  const response = await accountFetch(`${session.serverUrl}/api/account/skills${path}`, {
    method,
    headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (response.status === 204) return
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || '账号技能同步失败')
  return data
}

async function syncAccountSkills(): Promise<AccountSkillSnapshot> {
  const generation = skillGeneration
  const sync = async () => {
    const session = await loadSession()
    if (!session) throw new Error('请先登录账户')
    const account = await requestAccount(session.serverUrl, session.token)
    const response = await accountFetch(`${session.serverUrl}/api/account/skills`, {
      headers: { Authorization: `Bearer ${session.token}` },
    })
    if (!response.ok) throw new Error('无法同步账号技能，请确认服务器可用')
    const snapshot = await response.json() as AccountSkillSnapshot
    if (!snapshot || !Array.isArray(snapshot.skills)) throw new Error('服务器返回的技能数据无效')
    const current = await loadSession()
    if (generation !== skillGeneration || current?.token !== session.token || current.serverUrl !== session.serverUrl) throw new Error('账号已切换，请重新加载技能')
    const key = createHash('sha256').update(`${session.serverUrl}\n${account.id}`).digest('hex')
    // Login/logout/bootstrap already empty the local catalog. Do not advance
    // the account generation during a read (concurrent metadata reads are valid).
    if (account.executionMode !== 'server_only') {
      const roots = materializeAccountSkills(snapshot, join(app.getPath('userData'), 'account-skills', key))
      setAccountSkillRoots(roots)
    }
    return snapshot
  }
  const next = skillQueue.then(sync, sync)
  skillQueue = next.then(() => undefined, () => undefined)
  return next
}

async function loadSession(): Promise<{ serverUrl: string; token: string; managed?: StoredDesktopSession['managed'] } | null> {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null
    return restoreStoredDesktopSession(await readFile(sessionPath(), 'utf8'), {
      normalizeServerUrl: accountServerUrl,
      decrypt: value => safeStorage.decryptString(value),
    })
  } catch {
    return null
  }
}

/** Bearer credential used only by the protected Jonwork update origin.
 * The token remains in the main process and is never returned through preload.
 */
export async function getDesktopUpdateAuthorization(): Promise<string | null> {
  const session = await loadSession()
  return session?.managed ? `Bearer ${session.token}` : null
}

async function saveSession(serverUrl: string, token: string, managed?: StoredDesktopSession['managed']): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储不可用，无法保存登录状态')
  const path = sessionPath()
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify({
      serverUrl,
      encryptedToken: safeStorage.encryptString(token).toString('base64'),
      managed,
    } satisfies StoredDesktopSession), { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, path)
  } finally { await rm(temporary, { force: true }).catch(() => {}) }
}

async function requestAccount(serverUrl: string, token: string): Promise<DesktopAccount> {
  const response = await accountFetch(`${serverUrl}/api/account`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await response.json() as DesktopAccount & { error?: string }
  if (!response.ok) throw new Error(data.error || '登录状态已失效')
  assertDesktopAccount(data)
  return data
}

export async function registerDesktopAccountHandlers(): Promise<void> {
  const trusted = (event: IpcMainInvokeEvent) => !!BrowserWindow.fromWebContents(event.sender)
    && event.senderFrame === event.sender.mainFrame
    && isTrustedAccountFrame(event.senderFrame.url, join(__dirname, 'renderer', 'index.html'),
      app.isPackaged ? undefined : process.env.VITE_DEV_SERVER_URL)
  const stored = await loadSession()
  if (stored?.managed) {
    managedConnection = { url: managedWebSocketUrl(stored.serverUrl, stored.managed.wsUrl),
      token: stored.token, remoteWorkspaceId: stored.managed.workspaceId }
  }
  // Preload reads this before creating its transport. Not exposed on electronAPI.
  ipcMain.on('__get-managed-account-connection', (event) => {
    event.returnValue = trusted(event as unknown as IpcMainInvokeEvent) ? managedConnection : null
  })
  const handle = (channel: string, listener: (event: IpcMainInvokeEvent, ...args: any[]) => unknown) => {
    ipcMain.handle(channel, (event, ...args) => {
      if (!trusted(event)) throw new Error('拒绝不可信页面的账户操作')
      return listener(event, ...args)
    })
  }
  // Never expose local personal/project skill catalogs as the account library.
  clearAccountSkills()
  handle('desktop-account:skills', async (_event, operation: string, input?: any) => {
    if (operation === 'list' || operation === 'sync') {
      const snapshot = await syncAccountSkills()
      return { skills: snapshot.skills.map(({ skill, revision }) => ({ skill, revision })) }
    }
    if (!input || typeof input.slug !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(input.slug)) throw new Error('无效的技能标识')
    const path = `/${encodeURIComponent(input.slug)}`
    if (operation === 'get') return accountSkillRequest(path)
    if (operation === 'save') {
      const value = input as SaveAccountSkillInput
      if (typeof value.content !== 'string' || value.content.length > 1_000_000) throw new Error('技能内容无效或过大')
      const result = await accountSkillRequest(path, 'PUT', { content: value.content, expectedRevision: value.expectedRevision })
      await syncAccountSkills()
      return result
    }
    if (operation === 'delete') {
      await accountSkillRequest(path, 'DELETE', { expectedRevision: input.expectedRevision })
      await syncAccountSkills()
      return
    }
    throw new Error('不支持的技能操作')
  })
  handle('desktop-account:get', async () => {
    const session = await loadSession()
    if (!session) return null
    try {
      const account = await requestAccount(session.serverUrl, session.token)
      if ((account.executionMode === 'server_only') !== !!session.managed) throw new Error('账户执行模式已变更，请退出后通过 ERP 重新登录')
      if (account.executionMode !== 'server_only') await syncAccountSkills()
      return { account, serverUrl: session.serverUrl }
    } catch (error) {
      clearAccountSkills()
      // A temporary network/sync failure must not delete the encrypted login.
      throw error
    }
  })

  handle('desktop-account:sso', async (event, serverInput: string) => {
    const serverUrl = accountServerUrl(serverInput)
    const generation = ++loginGeneration
    const cancelled = () => generation !== loginGeneration || event.sender.isDestroyed()
    const result = await desktopErpLogin(serverUrl, { request: accountFetch, open: shell.openExternal, cancelled })
    const account = await requestAccount(serverUrl, result.accessToken)
    if (account.executionMode !== 'server_only' || account.billingMode !== 'server') throw new Error('ERP 账号必须使用服务端执行与计费')
    const config = await accountFetch(`${serverUrl}/api/config`, { headers: { Authorization: `Bearer ${result.accessToken}` } })
    if (!config.ok) throw new Error('无法获取企业执行服务器配置')
    const wsUrl = managedWebSocketUrl(serverUrl, (await config.json()).wsUrl)
    await mutateSession(async () => {
      if (cancelled()) throw new Error('登录已取消')
      await saveSession(serverUrl, result.accessToken, { wsUrl, workspaceId: account.workspaceId })
      managedConnection = { url: wsUrl, token: result.accessToken, remoteWorkspaceId: account.workspaceId }
      clearAccountSkills()
    })
    return { account, serverUrl }
  })

  handle('desktop-account:logout', async () => {
    loginGeneration++
    clearAccountSkills()
    const session = await mutateSession(async () => {
      const current = await loadSession()
      managedConnection = null
      await rm(sessionPath(), { force: true })
      return current
    })
    if (session) {
      await accountFetch(`${session.serverUrl}/api/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.token}` },
      }).catch(() => undefined)
    }
  })

  handle('desktop-account:charge', async (_event, requestId: string) => {
    if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(requestId)) throw new Error('无效的请求幂等标识')
    const session = await loadSession()
    if (!session) throw new Error('请先登录账户')
    const response = await accountFetch(`${session.serverUrl}/api/account/charge`, {
      method: 'POST', headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId }),
    })
    const data = await response.json() as { chargeId?: string; error?: string }
    if (!response.ok || !data.chargeId) throw new Error(data.error || '积分扣减失败')
    return data.chargeId
  })

  handle('desktop-account:refund', async (_event, chargeId: string) => {
    if (typeof chargeId !== 'string' || chargeId.length > 128) throw new Error('无效的退款记录')
    const session = await loadSession()
    if (!session) throw new Error('请登录原账户后重试退款')
    const response = await accountFetch(`${session.serverUrl}/api/account/refund`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ chargeId }),
    })
    if (!response.ok) throw new Error('退款未确认，请联系管理员核对消费流水')
  })
}
