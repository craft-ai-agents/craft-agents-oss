import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AccountStore } from '../accounts'
import { AccountDatabaseFile } from '../account-database'

const roots: string[] = []
function fixture(credits = 3) {
  const root = mkdtempSync(join(tmpdir(), 'jonwork-ledger-')); roots.push(root)
  const options = { filePath: join(root, 'accounts.json'), usersRoot: join(root, 'users'), initialCredits: credits,
    createWorkspace: () => ({ id: crypto.randomUUID() }) }
  return { options, store: new AccountStore(options) }
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('durable account ledger', () => {
  it('serializes writes from independent service processes', async () => {
    const { options, store } = fixture(10)
    const account = await store.register('alice', 'test-password')
    const request = crypto.randomUUID()
    const children = Array.from({ length: 4 }, () => Bun.spawn([process.execPath,
      join(import.meta.dir, 'account-ledger-worker.fixture.ts'), options.filePath, account.id, request],
      { stdout: 'ignore', stderr: 'pipe' }))
    const codes = await Promise.all(children.map(child => child.exited))
    const errors = await Promise.all(children.map(child => new Response(child.stderr).text()))
    expect(errors).toEqual(['', '', '', ''])
    expect(codes).toEqual([0, 0, 0, 0])
    expect(store.getById(account.id)?.credits).toBe(9)
    expect(store.listCharges(account.id)).toHaveLength(1)
  }, 20_000)
  it('deduplicates concurrent charges across store instances and survives restart', async () => {
    const { options, store } = fixture()
    const account = await store.register('alice', 'test-password')
    const other = new AccountStore(options)
    const request = crypto.randomUUID()
    const results = await Promise.all([store.charge(account.id, request), other.charge(account.id, request)])
    expect(results[0]!.chargeId).toBe(results[1]!.chargeId)
    expect(new AccountStore(options).getById(account.id)?.credits).toBe(2)
    expect(other.listCharges(account.id)).toHaveLength(1)
  })
  it('refunds once after restart, rejects cross-account refunds and refunded replay', async () => {
    const { options, store } = fixture()
    const alice = await store.register('alice', 'test-password')
    const bob = await store.register('bobby', 'test-password')
    const request = crypto.randomUUID()
    const charge = await store.charge(alice.id, request)
    const restarted = new AccountStore(options)
    await expect(restarted.refund(bob.id, charge.chargeId)).rejects.toThrow('无效')
    await restarted.refund(alice.id, charge.chargeId)
    await store.refund(alice.id, charge.chargeId)
    expect(store.getById(alice.id)?.credits).toBe(3)
    expect(store.listCharges(alice.id)[0]?.status).toBe('refunded')
    expect(store.listCharges(bob.id)).toHaveLength(0)
    await expect(store.charge(alice.id, request)).rejects.toThrow('已退款')
  })
  it('does not overspend or leave a ledger entry on insufficient funds', async () => {
    const { options, store } = fixture(1)
    const alice = await store.register('alice', 'test-password')
    const results = await Promise.allSettled([store.charge(alice.id, crypto.randomUUID()), new AccountStore(options).charge(alice.id, crypto.randomUUID())])
    expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1)
    expect(store.getById(alice.id)?.credits).toBe(0)
    expect(store.listCharges(alice.id)).toHaveLength(1)
    await expect(store.charge(alice.id, 'bad')).rejects.toThrow('幂等')
  })
  it('migrates legacy JSON without altering the backup and rolls back failed transactions', () => {
    const { options } = fixture()
    const legacy = JSON.stringify({ version: 1, accounts: [] })
    writeFileSync(options.filePath, legacy)
    const db = new AccountDatabaseFile<any>(options.filePath, value => value)
    expect(() => db.transaction(state => { state.accounts.push({ id: 'invalid' }); throw new Error('failure') })).toThrow('failure')
    expect(db.read().accounts).toEqual([])
    db.transaction(state => { state.migrated = true })
    expect(db.read().migrated).toBe(true)
    expect(readFileSync(options.filePath, 'utf8')).toBe(legacy)
  })
  it('fails closed on corrupt legacy data', () => {
    const { options, store } = fixture()
    writeFileSync(options.filePath, '{broken')
    expect(() => store.listAccounts()).toThrow()
  })
  it('persists hashed token revocation without storing the token', async () => {
    const { options, store } = fixture()
    const token = 'test-only-revocation-token'
    await store.revokeToken(token, Date.now() + 60_000)
    expect(new AccountStore(options).isTokenRevoked(token)).toBe(true)
    expect(store.isTokenRevoked('other-token')).toBe(false)
    expect(readFileSync(`${options.filePath}.sqlite`).includes(Buffer.from(token))).toBe(false)
  })
})
