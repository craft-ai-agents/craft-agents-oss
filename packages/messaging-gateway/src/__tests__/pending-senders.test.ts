/**
 * PendingSendersStore — bounded LRU + TTL behaviour.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PendingSendersStore } from '../pending-senders'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pending-senders-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('PendingSendersStore', () => {
  it('records a fresh rejection with attemptCount=1', () => {
    const store = new PendingSendersStore(dir)
    const entry = store.recordRejection({
      platform: 'telegram',
      senderId: '999',
      senderName: 'Alex',
      senderUsername: 'alex_m',
    })
    expect(entry.attemptCount).toBe(1)
    expect(entry.platform).toBe('telegram')
    expect(entry.userId).toBe('999')
    expect(entry.displayName).toBe('Alex')
    expect(entry.username).toBe('alex_m')
  })

  it('merges repeat rejections (same platform + userId) and increments attemptCount', () => {
    const store = new PendingSendersStore(dir)
    store.recordRejection({ platform: 'telegram', senderId: '999' })
    const second = store.recordRejection({ platform: 'telegram', senderId: '999' })
    expect(second.attemptCount).toBe(2)
    expect(store.list().length).toBe(1)
  })

  it('refreshes display metadata on repeat rejections when newer values arrive', () => {
    const store = new PendingSendersStore(dir)
    store.recordRejection({ platform: 'telegram', senderId: '999' })
    const merged = store.recordRejection({
      platform: 'telegram',
      senderId: '999',
      senderName: 'Alex',
      senderUsername: 'alex_m',
    })
    expect(merged.displayName).toBe('Alex')
    expect(merged.username).toBe('alex_m')
  })

  it('keeps separate rows per platform even with the same userId', () => {
    const store = new PendingSendersStore(dir)
    store.recordRejection({ platform: 'telegram', senderId: '999' })
    store.recordRejection({ platform: 'whatsapp', senderId: '999' })
    expect(store.list().length).toBe(2)
    expect(store.list('telegram').length).toBe(1)
    expect(store.list('whatsapp').length).toBe(1)
  })

  it('returns entries sorted by lastAttemptAt descending', async () => {
    const store = new PendingSendersStore(dir)
    store.recordRejection({ platform: 'telegram', senderId: 'first' })
    await new Promise((r) => setTimeout(r, 5))
    store.recordRejection({ platform: 'telegram', senderId: 'second' })
    const list = store.list()
    expect(list[0]!.userId).toBe('second')
    expect(list[1]!.userId).toBe('first')
  })

  it('caps the store at 50 entries and evicts the oldest first', () => {
    const store = new PendingSendersStore(dir)
    for (let i = 0; i < 60; i++) {
      store.recordRejection({ platform: 'telegram', senderId: `user-${i}` })
    }
    const list = store.list()
    expect(list.length).toBe(50)
    // The most recent 50 are user-10..user-59 (user-0..user-9 were evicted).
    expect(list.some((e) => e.userId === 'user-59')).toBe(true)
    expect(list.some((e) => e.userId === 'user-0')).toBe(false)
  })

  it('dismiss removes the matching entry and persists', () => {
    const store = new PendingSendersStore(dir)
    store.recordRejection({ platform: 'telegram', senderId: '999' })
    expect(store.dismiss('telegram', '999')).toBe(true)
    expect(store.list().length).toBe(0)

    // Persistence: re-instantiating reads from disk.
    const reloaded = new PendingSendersStore(dir)
    expect(reloaded.list().length).toBe(0)
  })

  it('dismiss returns false when the entry does not exist', () => {
    const store = new PendingSendersStore(dir)
    expect(store.dismiss('telegram', '404')).toBe(false)
  })

  it('clearPlatform removes only entries for the named platform', () => {
    const store = new PendingSendersStore(dir)
    store.recordRejection({ platform: 'telegram', senderId: 'a' })
    store.recordRejection({ platform: 'whatsapp', senderId: 'b' })
    expect(store.clearPlatform('telegram')).toBe(1)
    expect(store.list().length).toBe(1)
    expect(store.list()[0]!.platform).toBe('whatsapp')
  })

  it('persists across instances', () => {
    const a = new PendingSendersStore(dir)
    a.recordRejection({ platform: 'telegram', senderId: '999', senderName: 'Alex' })
    const b = new PendingSendersStore(dir)
    expect(b.list().length).toBe(1)
    expect(b.list()[0]!.displayName).toBe('Alex')
  })

  it('writes valid JSON to disk', () => {
    const store = new PendingSendersStore(dir)
    store.recordRejection({ platform: 'telegram', senderId: '999' })
    const raw = readFileSync(join(dir, 'pending.json'), 'utf-8')
    const parsed = JSON.parse(raw)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed[0].userId).toBe('999')
  })

  it('TTL: entries older than 7 days are evicted on next read', () => {
    const store = new PendingSendersStore(dir)
    // Manually insert a row with a stale timestamp by recording then mutating
    // the persisted file. Re-read via a fresh instance to apply the TTL.
    store.recordRejection({ platform: 'telegram', senderId: 'fresh' })
    const path = join(dir, 'pending.json')
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as Array<Record<string, unknown>>
    raw.push({
      platform: 'telegram',
      userId: 'stale',
      lastAttemptAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
      attemptCount: 99,
    })
    require('node:fs').writeFileSync(path, JSON.stringify(raw))

    const reloaded = new PendingSendersStore(dir)
    const ids = reloaded.list().map((e) => e.userId)
    expect(ids).toContain('fresh')
    expect(ids).not.toContain('stale')
  })

  it('change listener fires on every persisted mutation', () => {
    const store = new PendingSendersStore(dir)
    let calls = 0
    store.onChange(() => {
      calls++
    })
    store.recordRejection({ platform: 'telegram', senderId: '1' })
    store.recordRejection({ platform: 'telegram', senderId: '2' })
    store.dismiss('telegram', '1')
    expect(calls).toBeGreaterThanOrEqual(3)
  })

  // ---------------------------------------------------------------------------
  // Composite-key behaviour — same sender hitting different reasons / bindings
  // produces separate rows so the operator can decide on each. Regression for
  // PR #348 review item "Block #5: pending requests conflate workspace-owner
  // rejects and binding allow-list rejects".
  // ---------------------------------------------------------------------------

  it('keeps separate rows for same userId with different reasons', () => {
    const store = new PendingSendersStore(dir)
    store.recordRejection({
      platform: 'telegram',
      senderId: 'bob',
      reason: 'not-owner',
    })
    store.recordRejection({
      platform: 'telegram',
      senderId: 'bob',
      reason: 'not-on-binding-allowlist',
      bindingId: 'binding-A',
    })
    expect(store.list()).toHaveLength(2)
  })

  it('keeps separate rows for same userId on different bindings', () => {
    const store = new PendingSendersStore(dir)
    store.recordRejection({
      platform: 'telegram',
      senderId: 'bob',
      reason: 'not-on-binding-allowlist',
      bindingId: 'binding-A',
    })
    store.recordRejection({
      platform: 'telegram',
      senderId: 'bob',
      reason: 'not-on-binding-allowlist',
      bindingId: 'binding-B',
    })
    expect(store.list()).toHaveLength(2)
  })

  it('merges repeats with matching (reason, bindingId)', () => {
    const store = new PendingSendersStore(dir)
    store.recordRejection({
      platform: 'telegram',
      senderId: 'bob',
      reason: 'not-on-binding-allowlist',
      bindingId: 'binding-A',
    })
    const second = store.recordRejection({
      platform: 'telegram',
      senderId: 'bob',
      reason: 'not-on-binding-allowlist',
      bindingId: 'binding-A',
    })
    expect(second.attemptCount).toBe(2)
    expect(store.list()).toHaveLength(1)
  })

  it('dismiss with composite key drops only the matching row', () => {
    const store = new PendingSendersStore(dir)
    store.recordRejection({
      platform: 'telegram',
      senderId: 'bob',
      reason: 'not-owner',
    })
    store.recordRejection({
      platform: 'telegram',
      senderId: 'bob',
      reason: 'not-on-binding-allowlist',
      bindingId: 'binding-A',
    })

    expect(store.dismiss('telegram', 'bob', { reason: 'not-owner' })).toBe(true)
    const remaining = store.list()
    expect(remaining).toHaveLength(1)
    expect(remaining[0]!.reason).toBe('not-on-binding-allowlist')
  })

  it('dismiss without composite key drops every row for the sender (used after promotion)', () => {
    const store = new PendingSendersStore(dir)
    store.recordRejection({ platform: 'telegram', senderId: 'bob', reason: 'not-owner' })
    store.recordRejection({
      platform: 'telegram',
      senderId: 'bob',
      reason: 'not-on-binding-allowlist',
      bindingId: 'binding-A',
    })
    expect(store.dismiss('telegram', 'bob')).toBe(true)
    expect(store.list().filter((e) => e.userId === 'bob')).toHaveLength(0)
  })
})
