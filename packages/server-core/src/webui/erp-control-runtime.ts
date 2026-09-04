import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { materializeAccountSkills, setWorkspaceSkillRoots } from '@craft-agent/shared/skills'
import type { AccountStore, PublicAccount } from './accounts'
import { ErpSsoClient, type AccessSnapshot } from './erp-sso'
import { ControlLedger } from './control-ledger'
import { decodeBundle, type Release } from './jonwork-control'
import { rejectUnisolatedAgentExecution } from './execution-isolation'

export interface ExecutionPolicyInput { workspaceId: string; model: string; sources: string[]; skills: string[] }
export interface ExecutionReceipt { complete(status: 'complete' | 'failed' | 'interrupted' | 'unknown'): Promise<void> }
export interface ExecutionPolicy {
  assertAgentExecution(): void
  prepare(workspaceId: string): Promise<void>
  allowedSources(workspaceId: string): Promise<string[]>
  authorize(input: ExecutionPolicyInput): Promise<void>
  begin(input: ExecutionPolicyInput): Promise<ExecutionReceipt | undefined>
}

/** ERP is identity/policy authority; this server is the wallet/execution authority.
 * Neither local users nor desktop-side model execution can enter managed mode.
 */
export class ErpControlRuntime implements ExecutionPolicy {
  assertAgentExecution(): never { return rejectUnisolatedAgentExecution() }
  private cache = new Map<string, { value: AccessSnapshot; expires: number }>()
  private syncPromise?: Promise<void>
  private timer?: ReturnType<typeof setInterval>
  private inFlightRequests = new Map<string, Promise<{accepted:true; messageId:string}>>()
  constructor(readonly client: ErpSsoClient, readonly accounts: AccountStore, readonly ledger = new ControlLedger()) {
    ledger.recoverInterrupted()
    for (const a of accounts.listAccounts()) if (accounts.getExternalMember(a.id)) this.clearSkills(a.id)
  }
  private clearSkills(account: string) {
    const root = this.accounts.getSkillWorkspaceRoot(account)
    setWorkspaceSkillRoots(root, materializeAccountSkills({skills:[]}, join(root, '.erp-skills')))
  }
  async prepare(workspaceId: string) {
    const a = this.accounts.accountForWorkspace(workspaceId)
    if (!a || !this.accounts.getExternalMember(a.id)) throw new Error('此工作区未绑定 ERP')
    this.clearSkills(a.id)
    const releases = await this.catalog(a.id)
    const skills = []
    let size = 0
    for (const release of releases) {
      const bundle = await this.bundle(a.id, release)
      size += Buffer.byteLength(JSON.stringify(bundle))
      if (size > 32*1024*1024) throw new Error('ERP 技能目录过大')
      skills.push(bundle)
    }
    const root = this.accounts.getSkillWorkspaceRoot(a.id)
    setWorkspaceSkillRoots(root, materializeAccountSkills({skills}, join(root, '.erp-skills')))
  }
  async allowedSources(workspaceId: string) {
    const a = this.accounts.accountForWorkspace(workspaceId)
    if (!a) throw new Error('此工作区未绑定 ERP')
    const p = await this.policy(a.id, true)
    if (!p.active) throw new Error('ERP 授权已停用')
    return p.sources
  }
  start() { if (!this.timer) { this.timer = setInterval(() => { void this.sync() }, 15000); this.timer.unref?.(); void this.sync() } }
  dispose() { if (this.timer) clearInterval(this.timer) }
  async provision(identity: { member_id: string; account_id: string }): Promise<PublicAccount> {
    const p = await this.client.access(identity.member_id)
    if (p.account_id !== identity.account_id || p.member_id !== identity.member_id || !p.active) throw new Error('ERP identity or entitlement invalid')
    const account = await this.accounts.provisionExternal(p.account_id, p.member_id, p.role)
    this.ledger.ensure(account.id, p.member_id)
    this.cache.set(account.id, {value:p, expires:Date.now()+p.ttl_seconds*1000})
    await this.syncGrants(account.id, p.member_id)
    await this.prepare(account.workspaceId)
    return this.publicAccount(account)
  }
  publicAccount(a: PublicAccount) { return this.accounts.getExternalMember(a.id) ? {...a, credits:this.ledger.balance(a.id).available, billingMode:'server', executionMode:'server_only'} : a }
  async policy(account: string, force = false): Promise<AccessSnapshot> {
    const member = this.accounts.getExternalMember(account)
    if (!member || !this.accounts.getById(account) || this.accounts.getById(account)!.disabled) throw new Error('请通过 ERP 账号登录')
    const cached = this.cache.get(account)
    if (!force && cached && cached.expires > Date.now()) return cached.value
    const value = await this.client.access(member)
    if (value.member_id !== member || value.account_id !== account) throw new Error('ERP identity mismatch')
    this.cache.set(account, {value, expires:Date.now()+value.ttl_seconds*1000})
    return value
  }
  isActive(account: string) { const c = this.cache.get(account); return !!c && c.expires > Date.now() && c.value.active && !this.accounts.getById(account)?.disabled }
  async authorize(input: ExecutionPolicyInput) {
    const a = this.accounts.accountForWorkspace(input.workspaceId)
    if (!a || !this.accounts.getExternalMember(a.id)) throw new Error('此实例仅允许 ERP 授权账号执行任务')
    // Fresh check at each execution boundary; short cache is for HTTP/WS polling only.
    const p = await this.policy(a.id, true)
    if (!p.active || !p.models.includes(input.model) || input.sources.some(s => !p.sources.includes(s)) || input.skills.some(s => !p.skills.includes(s))) throw new Error('ERP 未授权此模型、技能或数据源')
  }
  async begin(input: ExecutionPolicyInput): Promise<ExecutionReceipt> {
    await this.authorize(input)
    const a = this.accounts.accountForWorkspace(input.workspaceId)!
    const p = await this.policy(a.id)
    await this.syncGrants(a.id, p.member_id)
    const task = randomUUID()
    this.ledger.reserve(a.id, task, input.model, p.task_price, p.max_concurrency)
    // fixed-task-v1 charges a dispatched provider run. Errors after dispatch may
    // still incur provider costs; do not let client "refund" calls mint credits.
    return { complete: async status => { this.ledger.finish(a.id, task, status === 'unknown' ? 0 : p.task_price, status); void this.sync() } }
  }
  async acceptMessage(account: string, args: any[], dispatch: () => Promise<any>) {
    const options = args[4] ?? {}
    const requestId = options.requestId ?? options.optimisticMessageId
    if (typeof requestId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,139}$/.test(requestId)) throw new Error('消息缺少稳定请求标识，请更新客户端')
    const key = createHash('sha256').update(JSON.stringify([account,args[0],requestId])).digest('hex')
    const fingerprint = createHash('sha256').update(JSON.stringify(args)).digest('hex')
    const claim = this.ledger.claimRequest(account,key,fingerprint)
    if (!claim.fresh) {
      if (claim.record.status === 'accepted') return {accepted:true, messageId:claim.record.messageId!}
      const pending = this.inFlightRequests.get(key)
      if (pending) return pending
      // Crash before durable acknowledgement is ambiguous. Do not execute again.
      throw new Error('该请求已受理但未确认完成，请先核对原会话；不会重复执行或扣费')
    }
    const result = Promise.resolve().then(dispatch).then(ack => {
      if (ack?.accepted !== true || typeof ack.messageId !== 'string' || !ack.messageId) throw new Error('Invalid message acknowledgement')
      this.ledger.finishRequest(account,key,ack.messageId)
      return {accepted:true as const,messageId:ack.messageId}
    }).catch(error => {
      this.ledger.finishRequest(account,key)
      throw error
    }).finally(() => { this.inFlightRequests.delete(key) })
    this.inFlightRequests.set(key,result)
    return result
  }
  /** Server-only provider task. Stable key comes from a validated canvas delivery,
   * never from a caller's claimed price or success status. Polls don't reserve again. */
  providerTask(input: ExecutionPolicyInput, task: string) {
    const account = this.accounts.accountForWorkspace(input.workspaceId)
    if (!account || !this.accounts.getExternalMember(account.id)) throw new Error('此工作区未绑定 ERP')
    const existing = () => {
      const record = this.ledger.task(account.id, task)
      if (!record || record.model !== input.model) throw new Error('供应商任务缺少匹配的计费预占，禁止继续')
      return record
    }
    return {
      authorize: () => this.authorize(input),
      reserve: async () => {
        await this.authorize(input)
        const p = await this.policy(account.id)
        await this.syncGrants(account.id, p.member_id)
        // Duplicate creation always rejects; only the durable provider task ID
        // permits polling an already reserved execution.
        this.ledger.reserve(account.id, task, input.model, p.task_price, p.max_concurrency)
      },
      check: async () => { existing() },
      finish: async (status: 'complete' | 'failed' | 'interrupted' | 'unknown') => {
        const record = existing()
        this.ledger.finish(account.id, task, status === 'unknown' ? 0 : record.units, status)
        void this.sync()
      },
    }
  }
  private async syncGrants(account: string, member: string) {
    const response = await this.client.call('pending_grants',{member})
    if (!Array.isArray(response?.grants) || response.grants.length > 100) throw new Error('Invalid grant response')
    for (const g of response.grants) this.ledger.grant(account,g.grant_id,g.units)
  }
  sync(): Promise<void> {
    if (!this.syncPromise) this.syncPromise = this.syncOnce().finally(() => { this.syncPromise = undefined })
    return this.syncPromise
  }
  private async syncOnce() {
      // Account records survive a process restart, including a crash between
      // account provisioning and wallet creation. No balances are imported.
      for (const a of this.accounts.listAccounts()) {
        const member = this.accounts.getExternalMember(a.id)
        if (!member) continue
        try {
          this.ledger.ensure(a.id,member)
          this.ledger.retryCompletions(a.id)
          let active = false
          let syncError = 'ok'
          try {
            const p = await this.policy(a.id, true)
            active = p.active
            if (active) await this.syncGrants(a.id, member)
          } catch { this.cache.delete(a.id); syncError = 'policy_unavailable' }
          // Revoking execution access must never prevent delivery of past usage.
          try {
          for (let n=0;n<50;n++) {
            const e = this.ledger.next(a.id); if (!e) break
            const ack = await this.client.call('ingest_event',{member,event:e})
            if (ack?.event_id !== e.event_id || ack.sequence !== e.sequence) throw new Error('Invalid ERP receipt')
            this.ledger.acknowledge(a.id,e.event_id,e.sequence)
          }
          } catch { syncError = 'event_delivery_failed' }
          try {
            const result = await this.client.call('pending_resolutions',{member})
            if (!Array.isArray(result?.resolutions) || result.resolutions.length > 100) throw new Error('Invalid reconciliation response')
            for (const r of result.resolutions) {
              try { this.ledger.resolveUnknown(a.id,r.task_id,r.resolution_id,r.charged_units,r.outcome) }
              catch { syncError = 'reconciliation_rejected' }
            }
          } catch { if (syncError === 'ok') syncError = 'reconciliation_unavailable' }
          const reconciliation = this.ledger.reconciliation(a.id)
          const pendingSettlements = reconciliation.filter(t => t.status === 'settlement_pending').length
          const unknownTasks = reconciliation.filter(t => t.status === 'unknown').length
          if (unknownTasks) syncError = 'unknown_execution'
          else if (pendingSettlements) syncError = 'settlement_pending'
          const pending = this.ledger.balance(a.id).pending
          await this.client.call('heartbeat',{member,pending_events:pending,client_version:'control-v2.1',
            pending_settlements:pendingSettlements,unknown_tasks:unknownTasks,sync_error:syncError,
            provisioning_status:!active || syncError !== 'ok' ? 'blocked' : pending ? 'syncing' : 'ready'})
        } catch { /* durable outbox retained; expired policy fails closed. Never log tokens/raw ERP errors. */ }
      }
  }
  async catalog(account: string): Promise<Release[]> {
    const p = await this.policy(account,true); if (!p.active) throw new Error('ERP 授权不可用')
    const value = await this.client.call('resources',{member:p.member_id})
    if (value?.schema_version !== 1 || !Array.isArray(value.releases) || value.releases.length>1000) throw new Error('Invalid resource catalog')
    const latest = new Map<string,Release>()
    for (const r of value.releases) {
      if (!r || typeof r.name!=='string' || r.name.length>260 || !p.skills.includes(r.slug) || !/^\d{1,9}\.\d{1,9}\.\d{1,9}$/.test(r.version) || !/^[a-f0-9]{64}$/.test(r.content_hash)) throw new Error('Invalid resource release')
      const old=latest.get(r.slug)
      const numeric=(s:string)=>s.split('.').map(n=>BigInt(n))
      const newer=old ? numeric(r.version).findIndex((n,i)=>n!==numeric(old.version)[i]) : -1
      if (!old || (newer>=0 && numeric(r.version)[newer]!>numeric(old.version)[newer]!)) latest.set(r.slug,{name:r.name,slug:r.slug,version:r.version,content_hash:r.content_hash})
    }
    return [...latest.values()]
  }
  async bundle(account:string,release:Release) {
    const p=await this.policy(account,true)
    if (!p.active || !p.skills.includes(release.slug)) throw new Error('资源未授权')
    const value=await this.client.call('resource_bundle',{member:p.member_id,release:release.name})
    if (value?.slug!==release.slug || value.version!==release.version || value.content_hash!==release.content_hash || typeof value.bundle_json!=='string'
      || createHash('sha256').update(value.bundle_json).digest('hex')!==release.content_hash) throw new Error('Resource integrity check failed')
    return decodeBundle(release,value.bundle_json)
  }
}
