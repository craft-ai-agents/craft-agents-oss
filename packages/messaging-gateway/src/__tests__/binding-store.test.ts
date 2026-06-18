/**
 * BindingStore tests
 *
 * Covers:
 *   - bind / findByChannel / findBySession / getAll roundtrip
 *   - one-channel-one-session invariant (second bind evicts first)
 *   - unbind and unbindSession counts
 *   - change listener fires on mutation
 *   - legacy directory migration (one-shot copy forward)
 *   - persistence across instances via file on disk
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { BindingStore } from '../binding-store'

let dir: string
let legacyDir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bind-'))
  legacyDir = mkdtempSync(join(tmpdir(), 'bind-legacy-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  rmSync(legacyDir, { recursive: true, force: true })
})

describe('BindingStore', () => {
  it('binds and finds a channel', () => {
    const store = new BindingStore(dir)
    const b = store.bind('ws1', 'session-A', 'telegram', 'chat-1', 'Alice')

    expect(b.sessionId).toBe('session-A')
    expect(b.platform).toBe('telegram')
    expect(b.channelId).toBe('chat-1')
    expect(b.channelName).toBe('Alice')
    expect(b.enabled).toBe(true)

    const hit = store.findByChannel('telegram', 'chat-1')
    expect(hit?.sessionId).toBe('session-A')
    expect(store.findByChannel('telegram', 'unknown')).toBeUndefined()
  })

  it('evicts prior binding when same channel binds again', () => {
    const store = new BindingStore(dir)
    store.bind('ws1', 'sess-1', 'telegram', 'chat-1')
    store.bind('ws1', 'sess-2', 'telegram', 'chat-1')

    const hit = store.findByChannel('telegram', 'chat-1')
    expect(hit?.sessionId).toBe('sess-2')
    expect(store.getAll()).toHaveLength(1)
  })

  it('lists bindings by session, only enabled', () => {
    const store = new BindingStore(dir)
    store.bind('ws1', 'sess', 'telegram', 'c1')
    store.bind('ws1', 'sess', 'whatsapp', 'c2')
    store.bind('ws1', 'other', 'telegram', 'c3')

    const mine = store.findBySession('sess')
    expect(mine).toHaveLength(2)
    expect(new Set(mine.map((b) => b.platform))).toEqual(new Set(['telegram', 'whatsapp']))
  })

  it('unbind returns true only when a row was removed', () => {
    const store = new BindingStore(dir)
    store.bind('ws1', 'sess', 'telegram', 'c1')

    expect(store.unbind('telegram', 'c1')).toBe(true)
    expect(store.unbind('telegram', 'c1')).toBe(false)
    expect(store.getAll()).toHaveLength(0)
  })

  it('unbindSession removes correct count with optional platform filter', () => {
    const store = new BindingStore(dir)
    store.bind('ws1', 'sess', 'telegram', 'c1')
    store.bind('ws1', 'sess', 'whatsapp', 'c2')
    store.bind('ws1', 'other', 'telegram', 'c3')

    expect(store.unbindSession('sess', 'telegram')).toBe(1)
    expect(store.getAll()).toHaveLength(2)

    expect(store.unbindSession('sess')).toBe(1)
    expect(store.getAll()).toHaveLength(1)
    expect(store.getAll()[0]?.sessionId).toBe('other')
  })

  it('unbindById removes only the selected binding row', () => {
    const store = new BindingStore(dir)
    const a = store.bind('ws1', 'sess', 'telegram', 'c1')
    const b = store.bind('ws1', 'sess', 'whatsapp', 'c2')

    expect(store.unbindById(a.id)).toBe(true)
    expect(store.findByChannel('telegram', 'c1')).toBeUndefined()
    expect(store.findByChannel('whatsapp', 'c2')?.id).toBe(b.id)
    expect(store.unbindById(a.id)).toBe(false)
  })

  it('forces WhatsApp bindings to use desktop-only approvals', () => {
    const store = new BindingStore(dir)
    const binding = store.bind('ws1', 'sess', 'whatsapp', 'c2')
    expect(binding.config.approvalChannel).toBe('app')
  })

  it('fires change listener after mutation', () => {
    const store = new BindingStore(dir)
    let calls = 0
    store.onChange(() => calls++)

    store.bind('ws1', 'sess', 'telegram', 'c1')
    store.unbind('telegram', 'c1')

    expect(calls).toBe(2)
  })

  it('persists across instances via bindings.json', () => {
    const a = new BindingStore(dir)
    a.bind('ws1', 'sess', 'telegram', 'c1', 'name')

    const b = new BindingStore(dir)
    const hit = b.findByChannel('telegram', 'c1')
    expect(hit?.channelName).toBe('name')
  })

  it('migrates legacy bindings.json one-shot on construction', () => {
    const legacyFile = join(legacyDir, 'bindings.json')
    const sample = [
      {
        id: 'legacy-1',
        workspaceId: 'ws1',
        sessionId: 'sess',
        platform: 'telegram',
        channelId: 'c1',
        enabled: true,
        createdAt: 1,
        config: {},
      },
    ]
    writeFileSync(legacyFile, JSON.stringify(sample))

    const store = new BindingStore(dir, legacyDir)
    expect(store.findByChannel('telegram', 'c1')?.id).toBe('legacy-1')
    expect(existsSync(join(dir, 'bindings.json'))).toBe(true)
  })

  it('does not overwrite existing file when legacy is also present', () => {
    // Pre-populate new location
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'bindings.json'),
      JSON.stringify([
        {
          id: 'new-1',
          workspaceId: 'ws1',
          sessionId: 'sess-new',
          platform: 'telegram',
          channelId: 'c1',
          enabled: true,
          createdAt: 2,
          config: {},
        },
      ]),
    )
    // Legacy has different content
    writeFileSync(
      join(legacyDir, 'bindings.json'),
      JSON.stringify([
        {
          id: 'legacy-1',
          workspaceId: 'ws1',
          sessionId: 'sess-legacy',
          platform: 'telegram',
          channelId: 'c1',
          enabled: true,
          createdAt: 1,
          config: {},
        },
      ]),
    )

    const store = new BindingStore(dir, legacyDir)
    expect(store.findByChannel('telegram', 'c1')?.sessionId).toBe('sess-new')
  })

  it('recovers from corrupt bindings.json as an empty store', () => {
    writeFileSync(join(dir, 'bindings.json'), 'not-json')
    const store = new BindingStore(dir)
    expect(store.getAll()).toEqual([])
    // Subsequent write should succeed
    store.bind('ws1', 'sess', 'telegram', 'c1')
    const raw = readFileSync(join(dir, 'bindings.json'), 'utf-8')
    expect(JSON.parse(raw)).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Telegram supergroup forum topics (Phase A)
// ---------------------------------------------------------------------------

describe('BindingStore — threadId (Telegram supergroup topics)', () => {
  it('treats different topics in the same supergroup as separate bindings', () => {
    const store = new BindingStore(dir)
    const a = store.bind('ws1', 'sess-A', 'telegram', '-1001', undefined, undefined, 5)
    const b = store.bind('ws1', 'sess-B', 'telegram', '-1001', undefined, undefined, 7)

    expect(store.getAll()).toHaveLength(2)
    expect(store.findByChannel('telegram', '-1001', 5)?.id).toBe(a.id)
    expect(store.findByChannel('telegram', '-1001', 7)?.id).toBe(b.id)
  })

  it('rebinding the same (chat, topic) tuple evicts only that tuple', () => {
    const store = new BindingStore(dir)
    store.bind('ws1', 'sess-A', 'telegram', '-1001', undefined, undefined, 5)
    store.bind('ws1', 'sess-B', 'telegram', '-1001', undefined, undefined, 7)
    store.bind('ws1', 'sess-C', 'telegram', '-1001', undefined, undefined, 5)

    // Topic 5: latest binding wins (sess-C). Topic 7: untouched (sess-B).
    expect(store.findByChannel('telegram', '-1001', 5)?.sessionId).toBe('sess-C')
    expect(store.findByChannel('telegram', '-1001', 7)?.sessionId).toBe('sess-B')
    expect(store.getAll()).toHaveLength(2)
  })

  it('a DM binding in the same chatId does not collide with a topic binding', () => {
    const store = new BindingStore(dir)
    // DM (no threadId) and a topic in the same chatId — implausible in real
    // life (DMs and supergroups have disjoint chatIds) but the eviction key
    // must still treat them as distinct.
    store.bind('ws1', 'sess-DM', 'telegram', 'shared', undefined, undefined, undefined)
    store.bind('ws1', 'sess-Topic', 'telegram', 'shared', undefined, undefined, 9)

    expect(store.findByChannel('telegram', 'shared')?.sessionId).toBe('sess-DM')
    expect(store.findByChannel('telegram', 'shared', 9)?.sessionId).toBe('sess-Topic')
    expect(store.getAll()).toHaveLength(2)
  })

  it('findByChannel without threadId does not match topic-bound entries', () => {
    const store = new BindingStore(dir)
    store.bind('ws1', 'sess-Topic', 'telegram', '-1001', undefined, undefined, 5)

    // The Telegram General topic (no message_thread_id) → no DM binding here
    expect(store.findByChannel('telegram', '-1001')).toBeUndefined()
    expect(store.findByChannel('telegram', '-1001', 5)?.sessionId).toBe('sess-Topic')
  })

  it('persists threadId across BindingStore instances', () => {
    const a = new BindingStore(dir)
    a.bind('ws1', 'sess-T', 'telegram', '-1001', 'topic-name', undefined, 12)

    const b = new BindingStore(dir)
    const hit = b.findByChannel('telegram', '-1001', 12)
    expect(hit?.sessionId).toBe('sess-T')
    expect(hit?.threadId).toBe(12)
  })

  it('unbind targeted at a specific topic leaves sibling topics intact', () => {
    const store = new BindingStore(dir)
    store.bind('ws1', 'sess-A', 'telegram', '-1001', undefined, undefined, 5)
    store.bind('ws1', 'sess-B', 'telegram', '-1001', undefined, undefined, 7)

    expect(store.unbind('telegram', '-1001', 5)).toBe(true)
    expect(store.findByChannel('telegram', '-1001', 5)).toBeUndefined()
    expect(store.findByChannel('telegram', '-1001', 7)?.sessionId).toBe('sess-B')
    expect(store.unbind('telegram', '-1001', 5)).toBe(false)
  })

  it('legacy bindings without threadId continue to match DM lookups', () => {
    // Pre-topics-feature data on disk: no threadId field.
    writeFileSync(
      join(dir, 'bindings.json'),
      JSON.stringify([
        {
          id: 'legacy-1',
          workspaceId: 'ws1',
          sessionId: 'sess-old',
          platform: 'telegram',
          channelId: 'dm-chat',
          enabled: true,
          createdAt: 1,
          config: {},
        },
      ]),
    )
    const store = new BindingStore(dir)
    expect(store.findByChannel('telegram', 'dm-chat')?.sessionId).toBe('sess-old')
    expect(store.findByChannel('telegram', 'dm-chat', 5)).toBeUndefined()
  })
})
