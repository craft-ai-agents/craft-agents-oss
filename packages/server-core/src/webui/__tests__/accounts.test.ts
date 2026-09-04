import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AccountStore } from '../accounts'

const temporaryDirectories: string[] = []

function createStore(initialCredits = 300): AccountStore {
  const root = mkdtempSync(join(tmpdir(), 'jonwork-accounts-'))
  temporaryDirectories.push(root)
  let workspaceSequence = 0
  return new AccountStore({
    filePath: join(root, 'accounts.json'),
    usersRoot: join(root, 'users'),
    initialCredits,
    createWorkspace: () => ({ id: `workspace-${++workspaceSequence}` }),
  })
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true })
  }
})

describe('AccountStore', () => {
  it('registers an isolated account with 300 credits and authenticates it', async () => {
    const store = createStore()
    const account = await store.register('alice', 'password123')

    expect(account.credits).toBe(300)
    expect(account.role).toBe('admin')
    expect(account.workspaceId).toBe('workspace-1')
    expect((await store.authenticate('ALICE', 'password123'))?.id).toBe(account.id)
    expect(await store.authenticate('alice', 'wrong-password')).toBeNull()
  })

  it('makes later users standard users and lets admins recharge/change roles', async () => {
    const store = createStore()
    const admin = await store.register('admin', 'password123')
    const user = await store.register('bob', 'password123')

    expect(admin.role).toBe('admin')
    expect(user.role).toBe('user')
    expect((await store.recharge(user.id, 500)).credits).toBe(800)
    expect((await store.setRole(user.id, 'admin')).role).toBe('admin')
    expect((await store.setRole(admin.id, 'user')).role).toBe('user')
    await expect(store.setRole(user.id, 'user')).rejects.toThrow('至少需要保留一名管理员')
  })

  it('prevents duplicate users and atomically debits/refunds credits', async () => {
    const store = createStore(2)
    const account = await store.register('alice', 'password123')

    await expect(store.register('Alice', 'password456')).rejects.toThrow('已被注册')
    expect((await store.debit(account.id)).credits).toBe(1)
    expect((await store.debit(account.id)).credits).toBe(0)
    await expect(store.debit(account.id)).rejects.toThrow('积分不足')
    expect((await store.credit(account.id)).credits).toBe(1)
  })
})
