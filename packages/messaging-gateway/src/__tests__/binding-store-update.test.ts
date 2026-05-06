/**
 * BindingStore.updateBindingConfig — verifies the in-place update method
 * preserves identity (id, createdAt, channelId) where bind() would have
 * rotated them. Regression for PR #348 review item "Major.1".
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { BindingStore } from '../binding-store'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bs-update-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('BindingStore.updateBindingConfig', () => {
  it('preserves id and createdAt across config patch', () => {
    const store = new BindingStore(dir)
    const original = store.bind('ws1', 'sess-A', 'telegram', 'chat-1')
    const next = store.updateBindingConfig(original.id, {
      accessMode: 'allow-list',
      allowedSenderIds: ['42'],
    })
    expect(next).not.toBeNull()
    expect(next!.id).toBe(original.id)
    expect(next!.createdAt).toBe(original.createdAt)
    expect(next!.config.accessMode).toBe('allow-list')
    expect(next!.config.allowedSenderIds).toEqual(['42'])
  })

  it('returns null when binding id does not exist', () => {
    const store = new BindingStore(dir)
    const result = store.updateBindingConfig('does-not-exist', {
      accessMode: 'open',
    })
    expect(result).toBeNull()
  })

  it('persists across a fresh BindingStore instance', () => {
    const a = new BindingStore(dir)
    const original = a.bind('ws1', 'sess-A', 'telegram', 'chat-1')
    a.updateBindingConfig(original.id, { accessMode: 'allow-list', allowedSenderIds: ['7'] })

    const b = new BindingStore(dir)
    const reloaded = b.getAll().find((x) => x.id === original.id)
    expect(reloaded).toBeDefined()
    expect(reloaded!.config.accessMode).toBe('allow-list')
    expect(reloaded!.config.allowedSenderIds).toEqual(['7'])
    expect(reloaded!.createdAt).toBe(original.createdAt)
  })

  it('fires onChange listener after persisting', () => {
    const store = new BindingStore(dir)
    const original = store.bind('ws1', 'sess-A', 'telegram', 'chat-1')
    let calls = 0
    store.onChange(() => {
      calls++
    })
    store.updateBindingConfig(original.id, { accessMode: 'open' })
    expect(calls).toBeGreaterThanOrEqual(1)
  })

  it('does not affect unrelated bindings', () => {
    const store = new BindingStore(dir)
    const a = store.bind('ws1', 'sess-A', 'telegram', 'chat-A')
    const b = store.bind('ws1', 'sess-B', 'telegram', 'chat-B')
    store.updateBindingConfig(a.id, { accessMode: 'open' })
    const all = store.getAll()
    expect(all).toHaveLength(2)
    const aReloaded = all.find((x) => x.id === a.id)!
    const bReloaded = all.find((x) => x.id === b.id)!
    expect(aReloaded.config.accessMode).toBe('open')
    expect(bReloaded.config.accessMode).toBe('inherit')
  })
})
