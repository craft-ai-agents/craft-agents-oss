import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { addWorkspace, CONFIG_DIR } from '@craft-agent/shared/config'
import { AccountDatabaseFile } from './account-database'

export const DEFAULT_SIGNUP_CREDITS = 300
export const DEFAULT_MESSAGE_CREDIT_COST = 1
export type AccountRole = 'admin' | 'user'

export interface PublicAccount {
  id: string
  username: string
  credits: number
  workspaceId: string
  createdAt: number
  role: AccountRole
  disabled?: boolean
  authVersion?: number
}

interface StoredAccount extends PublicAccount {
  passwordHash: string
  normalizedUsername: string
  externalMember?: string
}

interface AccountDatabase {
  version: 1
  accounts: StoredAccount[]
  charges?: AccountCharge[]
  revokedTokens?: Array<{ hash: string; expiresAt: number }>
  audit?: AccountAuditEvent[]
}

export interface AccountAuditEvent {
  id: string
  action: 'bootstrap' | 'register' | 'password_reset' | 'disable' | 'enable' | 'role_change'
  actorId: string
  targetId: string
  at: number
}

function isAdminAccount(account: StoredAccount, database: AccountDatabase): boolean {
  return !account.disabled && (account.role ?? (database.accounts[0]?.id === account.id ? 'admin' : 'user')) === 'admin'
}

function assertAdmin(database: AccountDatabase, actorId: string): void {
  const actor = database.accounts.find(item => item.id === actorId)
  if (!actor || !isAdminAccount(actor, database)) throw new Error('需要有效的管理员权限')
}

function recordAudit(database: AccountDatabase, action: AccountAuditEvent['action'], actorId: string, targetId: string): void {
  ;(database.audit ??= []).push({ id: randomUUID(), action, actorId, targetId, at: Date.now() })
}

export interface AccountCharge {
  id: string
  accountId: string
  requestId: string
  amount: number
  status: 'charged' | 'refunded'
  createdAt: number
  refundedAt?: number
}

function validateDatabase(value: unknown): AccountDatabase {
  const data = value as AccountDatabase
  if (!data || data.version !== 1 || !Array.isArray(data.accounts)
    || (data.charges !== undefined && !Array.isArray(data.charges))
    || (data.revokedTokens !== undefined && !Array.isArray(data.revokedTokens))
    || (data.audit !== undefined && !Array.isArray(data.audit))) throw new Error('Unsupported account database')
  const ids = new Set<string>()
  const names = new Set<string>()
  for (const account of data.accounts) {
    if (!account || typeof account.id !== 'string' || !account.id || typeof account.passwordHash !== 'string'
      || typeof account.normalizedUsername !== 'string' || !account.normalizedUsername
      || typeof account.workspaceId !== 'string' || !Number.isSafeInteger(account.credits) || account.credits < 0
      || (account.disabled !== undefined && typeof account.disabled !== 'boolean')
      || (account.authVersion !== undefined && (!Number.isSafeInteger(account.authVersion) || account.authVersion < 0))
      || ids.has(account.id) || names.has(account.normalizedUsername)) throw new Error('Invalid account database')
    ids.add(account.id); names.add(account.normalizedUsername)
  }
  const chargeIds = new Set<string>()
  const requests = new Set<string>()
  for (const charge of data.charges ?? []) {
    if (!charge || typeof charge.id !== 'string' || typeof charge.requestId !== 'string'
      || !ids.has(charge.accountId) || !Number.isSafeInteger(charge.amount) || charge.amount <= 0
      || !['charged', 'refunded'].includes(charge.status) || !Number.isSafeInteger(charge.createdAt)
      || chargeIds.has(charge.id) || requests.has(`${charge.accountId}:${charge.requestId}`)) throw new Error('Invalid account ledger')
    chargeIds.add(charge.id); requests.add(`${charge.accountId}:${charge.requestId}`)
  }
  for (const token of data.revokedTokens ?? []) {
    if (!token || !/^[a-f0-9]{64}$/.test(token.hash) || !Number.isSafeInteger(token.expiresAt)) throw new Error('Invalid token revocation record')
  }
  for (const event of data.audit ?? []) {
    if (!event || typeof event.id !== 'string' || typeof event.actorId !== 'string' || typeof event.targetId !== 'string'
      || !Number.isSafeInteger(event.at) || !['bootstrap', 'register', 'password_reset', 'disable', 'enable', 'role_change'].includes(event.action)) throw new Error('Invalid account audit')
  }
  return data
}

export interface AccountStoreOptions {
  filePath?: string
  usersRoot?: string
  initialCredits?: number
  createWorkspace?: (input: { name: string; rootPath: string }) => { id: string }
}

function publicAccount(account: StoredAccount): PublicAccount {
  const { id, username, credits, workspaceId, createdAt, role } = account
  return { id, username, credits, workspaceId, createdAt, role: role ?? 'user', disabled: account.disabled ?? false, authVersion: account.authVersion ?? 0 }
}

function normalizeUsername(username: string): string {
  return username.trim().toLocaleLowerCase('en-US')
}

export class AccountStore {
  private readonly filePath: string
  private readonly usersRoot: string
  private readonly initialCredits: number
  private readonly createWorkspace: (input: { name: string; rootPath: string }) => { id: string }
  private readonly database: AccountDatabaseFile<AccountDatabase>

  constructor(options: AccountStoreOptions = {}) {
    this.filePath = options.filePath ?? join(CONFIG_DIR, 'webui-accounts.json')
    this.usersRoot = options.usersRoot ?? join(CONFIG_DIR, 'users')
    this.initialCredits = options.initialCredits ?? DEFAULT_SIGNUP_CREDITS
    this.createWorkspace = options.createWorkspace ?? (input => addWorkspace(input))
    if (!Number.isSafeInteger(this.initialCredits) || this.initialCredits < 0) throw new Error('Invalid initial credits')
    this.database = new AccountDatabaseFile(this.filePath, validateDatabase)
  }

  private load(): AccountDatabase {
    try {
      return this.database.read()
    } catch (error) {
      throw new Error(`Unable to read WebUI accounts: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async mutate<T>(operation: (database: AccountDatabase) => T): Promise<T> {
    return this.database.transaction(operation)
  }

  async register(usernameInput: string, password: string, policy?: { public?: boolean; bootstrap?: boolean; actorId?: string }): Promise<PublicAccount> {
    const username = usernameInput.trim()
    const normalizedUsername = normalizeUsername(username)
    if (!/^[\p{L}\p{N}_.-]{3,32}$/u.test(username)) {
      throw new Error('用户名需为 3–32 个字符，只能包含字母、数字、下划线、点或短横线')
    }
    if (password.length < 8 || password.length > 128) {
      throw new Error('密码长度需为 8–128 个字符')
    }
    if (policy && password.length < 12) throw new Error('新开户密码至少需要 12 个字符')

    // Never hold a SQLite write lock while hashing or awaiting external work.
    const passwordHash = await Bun.password.hash(password, { algorithm: 'argon2id' })
    return this.mutate(database => {
      if (policy?.bootstrap && database.accounts.length > 0) throw new Error('管理员已初始化，不能重复引导')
      if (policy?.public && !database.accounts.some(item => isAdminAccount(item, database))) throw new Error('请先由运维初始化管理员')
      if (policy?.actorId) assertAdmin(database, policy.actorId)
      if (database.accounts.some(account => account.normalizedUsername === normalizedUsername)) {
        throw new Error('该用户名已被注册')
      }

      const id = randomUUID()
      const rootPath = join(this.usersRoot, id, 'workspace')
      mkdirSync(rootPath, { recursive: true })
      const workspace = this.createWorkspace({ name: `${username} 的工作区`, rootPath })
      const account: StoredAccount = {
        id,
        username,
        normalizedUsername,
        passwordHash,
        credits: this.initialCredits,
        workspaceId: workspace.id,
        createdAt: Date.now(),
        role: policy?.public || policy?.actorId ? 'user' : database.accounts.length === 0 ? 'admin' : 'user',
        disabled: false,
        authVersion: 0,
      }
      database.accounts.push(account)
      recordAudit(database, account.role === 'admin' ? 'bootstrap' : 'register', policy?.actorId ?? (policy?.public ? account.id : 'operator'), account.id)
      return publicAccount(account)
    })
  }

  async authenticate(username: string, password: string): Promise<PublicAccount | null> {
    const account = this.load().accounts.find(item => item.normalizedUsername === normalizeUsername(username))
    if (!account || account.externalMember || account.disabled || !await Bun.password.verify(password, account.passwordHash)) return null
    // Reset/disable may race an expensive password verification.
    const current = this.load().accounts.find(item => item.id === account.id)
    if (!current || current.disabled || current.passwordHash !== account.passwordHash) return null
    return publicAccount(current)
  }

  getById(id: string): PublicAccount | null {
    const accounts = this.load().accounts
    const account = accounts.find(item => item.id === id)
    if (!account) return null
    const result = publicAccount(account)
    // Backward-compatible migration: the oldest legacy account is the admin.
    if (!(account as Partial<StoredAccount>).role && accounts[0]?.id === id) result.role = 'admin'
    return result
  }

  /** ERP identity comes only from the verified OAuth callback. Never email-match
   * or reuse an existing local account; an explicit migration is a separate task. */
  async provisionExternal(id: string, member: string, role: AccountRole = 'user'): Promise<PublicAccount> {
    if (!/^erp-[A-Za-z0-9-]{16,64}$/.test(id) || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,139}$/.test(member)) throw new Error('Invalid ERP identity')
    if (role !== 'admin' && role !== 'user') throw new Error('Invalid ERP role')
    return this.mutate(database => {
      const existing = database.accounts.find(a => a.id === id)
      if (existing) {
        if (existing.externalMember !== member || existing.disabled) throw new Error('ERP account binding unavailable')
        if ((existing.role ?? 'user') !== role) {
          existing.role = role
          existing.authVersion = (existing.authVersion ?? 0) + 1
          recordAudit(database, 'role_change', 'erp-sso', id)
        }
        return publicAccount(existing)
      }
      if (database.accounts.some(a => a.externalMember === member || a.normalizedUsername === id)) throw new Error('ERP identity already bound')
      const rootPath = join(this.usersRoot, id, 'workspace')
      mkdirSync(rootPath, { recursive: true })
      const workspace = this.createWorkspace({ name: `${id} 的工作区`, rootPath })
      const account: StoredAccount = { id, username: id, normalizedUsername: id, passwordHash: '', externalMember: member,
        credits: 0, workspaceId: workspace.id, createdAt: Date.now(), role, disabled: false, authVersion: 0 }
      database.accounts.push(account)
      recordAudit(database, 'register', 'erp-sso', id)
      return publicAccount(account)
    })
  }

  getExternalMember(id: string): string | undefined { return this.load().accounts.find(a => a.id === id)?.externalMember }

  accountForWorkspace(workspaceId: string): PublicAccount | null { return this.listAccounts().find(a => a.workspaceId === workspaceId) ?? null }

  listAccounts(): PublicAccount[] {
    const database = this.load()
    return database.accounts.map((account, index) => {
      const result = publicAccount(account)
      if (!(account as Partial<StoredAccount>).role && index === 0) result.role = 'admin'
      return result
    })
  }

  isAdmin(id: string): boolean {
    const account = this.getById(id)
    return !!account && !account.disabled && account.role === 'admin'
  }

  getWorkspaceId(id: string): string | null {
    const account = this.getById(id)
    return account && !account.disabled ? account.workspaceId : null
  }

  /** Derived from the authenticated account, never a client-supplied path. */
  getSkillWorkspaceRoot(id: string): string {
    if (!this.getById(id)) throw new Error('账户不存在');
    return join(this.usersRoot, id, 'workspace');
  }

  getAllWorkspaceIds(): Set<string> {
    return new Set(this.load().accounts.map(account => account.workspaceId))
  }

  async debit(id: string, amount = DEFAULT_MESSAGE_CREDIT_COST): Promise<PublicAccount> {
    if (this.getExternalMember(id)) throw new Error('ERP 账号只能通过服务端任务账本扣费')
    return this.mutate(database => {
      const account = database.accounts.find(item => item.id === id)
      if (!account) throw new Error('账户不存在')
      if (account.disabled) throw new Error('账户已停用')
      if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('无效的积分扣减')
      if (account.credits < amount) throw new Error('积分不足，请充值后继续使用')
      account.credits -= amount
      return publicAccount(account)
    })
  }

  async credit(id: string, amount = DEFAULT_MESSAGE_CREDIT_COST): Promise<PublicAccount> {
    if (this.getExternalMember(id)) throw new Error('ERP 账号只能通过额度审批发放积分')
    return this.mutate(database => {
      const account = database.accounts.find(item => item.id === id)
      if (!account) throw new Error('账户不存在')
      if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('无效的积分增加')
      if (!Number.isSafeInteger(account.credits + amount)) throw new Error('积分余额超过上限')
      account.credits += amount
      return publicAccount(account)
    })
  }

  async recharge(id: string, amount: number): Promise<PublicAccount> {
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 10_000_000) {
      throw new Error('充值积分需为 1–10000000 的整数')
    }
    return this.credit(id, amount)
  }

  async setRole(id: string, role: AccountRole, actorId?: string): Promise<PublicAccount> {
    if (this.getExternalMember(id)) throw new Error('ERP 账号角色由中台管理')
    if (role !== 'admin' && role !== 'user') throw new Error('无效的用户角色')
    return this.mutate(database => {
      if (actorId) assertAdmin(database, actorId)
      const account = database.accounts.find(item => item.id === id)
      if (!account) throw new Error('账户不存在')
      const currentRole = account.role ?? (database.accounts[0]?.id === id ? 'admin' : 'user')
      if (currentRole === 'admin' && role === 'user') {
        const adminCount = database.accounts.filter(item => isAdminAccount(item, database)).length
        if (adminCount <= 1) throw new Error('系统至少需要保留一名管理员')
      }
      account.role = role
      account.authVersion = (account.authVersion ?? 0) + 1
      recordAudit(database, 'role_change', actorId ?? 'operator', id)
      return publicAccount(account)
    })
  }

  async setDisabled(id: string, disabled: boolean, actorId: string): Promise<PublicAccount> {
    if (typeof disabled !== 'boolean') throw new Error('无效的账号状态')
    return this.mutate(database => {
      assertAdmin(database, actorId)
      const account = database.accounts.find(item => item.id === id)
      if (!account) throw new Error('账户不存在')
      if (disabled && isAdminAccount(account, database) && database.accounts.filter(item => isAdminAccount(item, database)).length <= 1) throw new Error('系统至少需要保留一名有效管理员')
      if (!!account.disabled !== disabled) {
        account.disabled = disabled
        account.authVersion = (account.authVersion ?? 0) + 1
        recordAudit(database, disabled ? 'disable' : 'enable', actorId, id)
      }
      return publicAccount(account)
    })
  }

  async resetPassword(id: string, password: string, actorId: string): Promise<void> {
    if (this.getExternalMember(id)) throw new Error('请在 ERPNext 管理此账号密码')
    if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw new Error('新密码长度需为 12–128 个字符')
    if (!this.isAdmin(actorId)) throw new Error('需要有效的管理员权限')
    const passwordHash = await Bun.password.hash(password, { algorithm: 'argon2id' })
    await this.mutate(database => {
      assertAdmin(database, actorId)
      const account = database.accounts.find(item => item.id === id)
      if (!account) throw new Error('账户不存在')
      account.passwordHash = passwordHash
      account.authVersion = (account.authVersion ?? 0) + 1
      recordAudit(database, 'password_reset', actorId, id)
    })
  }

  isSessionActive(id: string, authVersion = 0): boolean {
    const account = this.getById(id)
    return !!account && !account.disabled && (account.authVersion ?? 0) === authVersion
  }

  listAudit(limit = 100): AccountAuditEvent[] {
    const count = Number.isSafeInteger(limit) ? Math.max(1, Math.min(100, limit)) : 100
    return (this.load().audit ?? []).slice(-count).reverse().map(({ id, action, actorId, targetId, at }) => ({ id, action, actorId, targetId, at }))
  }

  async charge(id: string, requestId: string): Promise<{ account: PublicAccount; chargeId: string }> {
    if (this.getExternalMember(id)) throw new Error('ERP 账号不接受客户端扣费请求')
    if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(requestId)) throw new Error('无效的请求幂等标识')
    return this.mutate(database => {
      const account = database.accounts.find(item => item.id === id)
      if (!account) throw new Error('账户不存在')
      if (account.disabled) throw new Error('账户已停用')
      const charges = database.charges ??= []
      const existing = charges.find(item => item.accountId === id && item.requestId === requestId)
      if (existing) {
        if (existing.status === 'refunded') throw new Error('该请求已退款，请使用新的请求标识')
        return { account: publicAccount(account), chargeId: existing.id }
      }
      if (account.credits < DEFAULT_MESSAGE_CREDIT_COST) throw new Error('积分不足，请充值后继续使用')
      const charge: AccountCharge = { id: randomUUID(), accountId: id, requestId, amount: DEFAULT_MESSAGE_CREDIT_COST,
        status: 'charged', createdAt: Date.now() }
      account.credits -= charge.amount
      charges.push(charge)
      return { account: publicAccount(account), chargeId: charge.id }
    })
  }

  async refund(id: string, chargeId: string): Promise<PublicAccount> {
    if (this.getExternalMember(id)) throw new Error('ERP 账号不接受客户端退款请求')
    return this.mutate(database => {
      const charge = database.charges?.find(item => item.id === chargeId && item.accountId === id)
      const account = database.accounts.find(item => item.id === id)
      if (!charge || !account) throw new Error('无效的退款记录')
      if (charge.status === 'refunded') return publicAccount(account)
      if (!Number.isSafeInteger(account.credits + charge.amount)) throw new Error('积分余额超过上限')
      account.credits += charge.amount
      charge.status = 'refunded'
      charge.refundedAt = Date.now()
      return publicAccount(account)
    })
  }

  listCharges(id: string, limit = 50): AccountCharge[] {
    const count = Number.isSafeInteger(limit) ? Math.max(1, Math.min(100, limit)) : 50
    return (this.load().charges ?? []).filter(item => item.accountId === id).slice(-count).reverse()
  }

  async revokeToken(token: string, expiresAt: number): Promise<void> {
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) return
    const hash = createHash('sha256').update(token).digest('hex')
    await this.mutate(database => {
      database.revokedTokens = (database.revokedTokens ?? []).filter(item => item.expiresAt > Date.now() && item.hash !== hash)
      database.revokedTokens.push({ hash, expiresAt })
    })
  }

  isTokenRevoked(token: string): boolean {
    const hash = createHash('sha256').update(token).digest('hex')
    return (this.load().revokedTokens ?? []).some(item => item.hash === hash && item.expiresAt > Date.now())
  }
}
