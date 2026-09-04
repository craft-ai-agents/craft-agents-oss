import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { CONFIG_DIR } from '@craft-agent/shared/config'
import { AccountDatabaseFile } from './account-database'

const MAX = 2_000_000_000
const id = (s: string) => typeof s === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,139}$/.test(s)
function units(n: number, min = 0) { if (!Number.isSafeInteger(n) || n < min || n > MAX) throw new Error('Invalid ledger units'); return n }
export interface ControlEvent {
  event_id: string; sequence: number; event_type: 'grant' | 'reserve' | 'settle' | 'release'
  units: number; reference_id: string; available_units: number; reserved_units: number
  occurred_at: string; status: 'approved' | 'running' | 'complete' | 'failed' | 'interrupted' | 'unknown'; model: string
}
type TerminalStatus = 'complete' | 'failed' | 'interrupted'
interface Task { units: number; remaining: number; model: string; status: 'running' | TerminalStatus | 'unknown'; completion?: { charged: number; status: TerminalStatus }; resolutionId?: string }
interface RequestRecord { fingerprint: string; status: 'started' | 'accepted' | 'failed'; messageId?: string }
interface Wallet { member: string; available: number; reserved: number; sequence: number; grants: Record<string, number>; tasks: Record<string, Task>; pending: ControlEvent[]; history: ControlEvent[]; lastAck: number; requests?: Record<string, RequestRecord> }
interface State { version: 1; accounts: []; wallets: Record<string, Wallet> }
function validate(input: unknown): State {
  const value = input as State
  if (!value || value.version !== 1 || !Array.isArray(value.accounts)) throw new Error('Invalid control ledger')
  value.wallets ??= {}
  for (const [account, w] of Object.entries(value.wallets)) {
    if (!id(account) || !id(w.member) || !Array.isArray(w.pending) || !Array.isArray(w.history)) throw new Error('Invalid control wallet')
    units(w.available); units(w.reserved); units(w.sequence)
    let held = 0
    for (const [task, t] of Object.entries(w.tasks)) {
      if (!id(task)) throw new Error('Invalid task')
      units(t.units); units(t.remaining); held += t.remaining
      if (t.completion) {
        units(t.completion.charged)
        if (!['complete','failed','interrupted'].includes(t.completion.status) || (t.remaining > 0 && t.completion.charged > t.remaining)) throw new Error('Invalid completion intent')
      }
    }
    if (held !== w.reserved) throw new Error('Reserved ledger mismatch')
  }
  return value
}

/** Single-server transactional wallet + outbox. Never silently imports legacy balances.
 * Restarted in-flight tasks remain reserved/unknown until an operator reconciles
 * them; guessing that a timeout means "not charged by provider" loses money.
 */
export class ControlLedger {
  private db: AccountDatabaseFile<State>
  constructor(path = join(CONFIG_DIR, 'control-ledger-v2.json')) { this.db = new AccountDatabaseFile(path, validate) }
  ensure(account: string, member: string) {
    if (!id(account) || !id(member)) throw new Error('Invalid wallet identity')
    this.db.transaction(s => {
      if (Object.hasOwn(s.wallets, account)) { if (s.wallets[account]!.member !== member) throw new Error('Wallet identity mismatch'); return }
      s.wallets[account] = { member, available: 0, reserved: 0, sequence: 0, grants: {}, tasks: {}, pending: [], history: [], lastAck: 0 }
    })
  }
  private wallet(s: State, account: string) { if (!Object.hasOwn(s.wallets, account)) throw new Error('Wallet not provisioned'); return s.wallets[account]! }
  private headroom(w: Wallet, extra: number) {
    // Every running reservation may need both a settle and a release event.
    // Grants/new tasks must never consume capacity promised to terminal events.
    if (w.pending.length + Object.values(w.tasks).filter(t => t.remaining > 0).length * 2 + extra > 10000) throw new Error('ERP outbox full; paid execution paused')
  }
  private emit(w: Wallet, type: ControlEvent['event_type'], n: number, reference: string, status: ControlEvent['status'], model = '') {
    if (w.pending.length >= 10000) throw new Error('ERP outbox full; paid execution paused')
    units(w.available); units(w.reserved)
    const e: ControlEvent = { event_id: randomUUID(), sequence: ++w.sequence, event_type: type, units: n, reference_id: reference,
      available_units: w.available, reserved_units: w.reserved, occurred_at: new Date().toISOString(), status, model }
    w.pending.push(e); w.history.push(e); w.history = w.history.slice(-1000)
  }
  grant(account: string, grant: string, amount: number) {
    if (!id(grant)) throw new Error('Invalid grant'); units(amount, 1)
    this.db.transaction(s => { const w = this.wallet(s, account)
      if (Object.hasOwn(w.grants, grant)) { if (w.grants[grant] !== amount) throw new Error('Conflicting grant'); return }
      this.headroom(w, 1)
      w.available = units(w.available + amount); w.grants[grant] = amount
      this.emit(w, 'grant', amount, grant, 'approved')
    })
  }
  reserve(account: string, task: string, model: string, amount: number, concurrency: number) {
    if (!id(task) || typeof model !== 'string' || model.length > 128) throw new Error('Invalid execution'); units(amount, 1); units(concurrency, 1)
    return this.db.transaction(s => { const w = this.wallet(s, account)
      if (Object.hasOwn(w.tasks, task)) throw new Error('Execution request already accepted')
      this.headroom(w, 3)
      if (Object.values(w.tasks).filter(t => t.remaining > 0).length >= concurrency) throw new Error('任务并发数已达上限')
      if (w.available < amount) throw new Error('积分不足，请联系管理员充值')
      w.available -= amount; w.reserved += amount; w.tasks[task] = { units: amount, remaining: amount, model, status: 'running' }
      this.emit(w, 'reserve', amount, task, 'running', model)
    })
  }
  task(account: string, task: string): Readonly<Task> | undefined {
    const w = this.wallet(this.db.read(), account)
    return Object.hasOwn(w.tasks, task) ? structuredClone(w.tasks[task]) : undefined
  }
  finish(account: string, task: string, charged: number, status: Task['status']) {
    units(charged)
    if (!['complete','failed','interrupted','unknown'].includes(status)) throw new Error('Invalid completion status')
    // Persist the provider result BEFORE attempting outbox writes. A full legacy
    // queue or a later transaction failure cannot lose the settlement obligation.
    this.db.transaction(s => { const w = this.wallet(s, account); const t = w.tasks[task]
      if (!t || !Object.hasOwn(w.tasks, task)) throw new Error('Unknown reservation')
      if (!t.remaining) { if (t.status !== status || t.units !== charged) throw new Error('Conflicting completion'); return }
      if (status === 'unknown') { if (t.completion) throw new Error('Conflicting completion'); t.status = status; return }
      if (charged > t.remaining) throw new Error('Settlement exceeds reservation')
      if (t.completion && (t.completion.charged !== charged || t.completion.status !== status)) throw new Error('Conflicting completion')
      t.completion = {charged, status: status as TerminalStatus}
    })
    this.retryCompletions(account)
  }
  retryCompletions(account: string) {
    this.db.transaction(s => { const w = this.wallet(s, account)
      for (const [task, t] of Object.entries(w.tasks)) {
        if (!t.remaining || !t.completion) continue
        const {charged, status} = t.completion; const release = t.remaining - charged
        if (w.pending.length + Number(charged > 0) + Number(release > 0) > 10000) continue
        if (charged) { w.reserved -= charged; this.emit(w, 'settle', charged, task, status, t.model) }
        if (release) { w.reserved -= release; w.available += release; this.emit(w, 'release', release, task, status, t.model) }
        t.units = charged; t.remaining = 0; t.status = status
      }
    })
  }
  /** Called once at process startup, never when merely opening a second reader. */
  recoverInterrupted() {
    this.db.transaction(s => {
      for (const w of Object.values(s.wallets)) for (const t of Object.values(w.tasks)) {
        if (t.remaining && !t.completion) t.status = 'unknown'
      }
    })
    for (const {account} of this.accounts()) this.retryCompletions(account)
  }
  reconciliation(account: string) {
    const w = this.wallet(this.db.read(), account)
    return Object.entries(w.tasks).filter(([,t]) => t.remaining > 0 && (t.completion || t.status === 'unknown'))
      .map(([task,t]) => ({task, reserved:t.remaining, model:t.model, status:t.completion ? 'settlement_pending' : 'unknown'}))
  }
  claimRequest(account: string, key: string, fingerprint: string): {fresh: boolean; record: RequestRecord} {
    if (!/^[a-f0-9]{64}$/.test(key) || !/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('Invalid request key')
    return this.db.transaction(s => {
      const w = this.wallet(s, account); w.requests ??= {}
      const existing = w.requests[key]
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new Error('请求标识已用于其他内容')
        return {fresh:false, record:existing}
      }
      const record: RequestRecord = {fingerprint, status:'started'}
      w.requests[key] = record
      return {fresh:true, record}
    })
  }
  resolveUnknown(account: string, task: string, resolution: string, charged: number, status: TerminalStatus) {
    units(charged)
    if (!id(task) || !id(resolution) || !['complete','failed','interrupted'].includes(status)) throw new Error('Invalid reconciliation')
    this.db.transaction(s => {
      const w = this.wallet(s,account); const t = w.tasks[task]
      if (!t || !Object.hasOwn(w.tasks,task)) throw new Error('Unknown reservation')
      if (t.resolutionId) {
        if (t.resolutionId !== resolution || t.completion?.charged !== charged || t.completion?.status !== status) throw new Error('Conflicting reconciliation')
        return
      }
      if (t.status !== 'unknown' || !t.remaining || t.completion || charged > t.remaining) throw new Error('Only unknown executions can be reconciled')
      t.resolutionId = resolution; t.completion = {charged,status}
    })
    this.retryCompletions(account)
  }
  finishRequest(account: string, key: string, messageId?: string) {
    this.db.transaction(s => {
      const r = this.wallet(s, account).requests?.[key]
      if (!r || r.status !== 'started') throw new Error('Invalid request acknowledgement')
      r.status = messageId ? 'accepted' : 'failed'; r.messageId = messageId
    })
  }
  balance(account: string) { const w = this.wallet(this.db.read(), account); return { available: w.available, reserved: w.reserved, pending: w.pending.length, sequence: w.sequence, lastAck: w.lastAck } }
  accounts() { return Object.entries(this.db.read().wallets).map(([account, w]) => ({ account, member: w.member })) }
  next(account: string) { const w = this.wallet(this.db.read(), account); return w.pending[0] ?? null }
  acknowledge(account: string, event: string, sequence: number) {
    this.db.transaction(s => { const w = this.wallet(s, account); const first = w.pending[0]
      if (!first || first.event_id !== event || first.sequence !== sequence) throw new Error('Invalid outbox acknowledgement')
      w.pending.shift(); w.lastAck = Date.now()
    })
    this.retryCompletions(account)
  }
  history(account: string) { return this.wallet(this.db.read(), account).history.slice(-100).reverse() }
}
