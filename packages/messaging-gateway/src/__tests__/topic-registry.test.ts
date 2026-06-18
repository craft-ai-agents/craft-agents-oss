/**
 * TopicRegistry tests
 *
 * Covers:
 *   - create-or-reuse semantics by topicName
 *   - persistence across instances (load from disk)
 *   - concurrent findOrCreate calls share one createTopic invocation (mutex)
 *   - case-sensitivity
 *   - remove() drops the entry
 *   - corrupted file → graceful empty load (no throw)
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { TopicRegistry } from '../topic-registry'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'topic-reg-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('TopicRegistry — find-or-create', () => {
  it('returns the existing entry on subsequent calls (no createTopic invocation)', async () => {
    const reg = new TopicRegistry(dir)
    let calls = 0
    const first = await reg.findOrCreate({
      topicName: 'Daily Digest',
      chatId: '-100123',
      createTopic: async (name) => {
        calls++
        return { threadId: 42, name }
      },
    })
    expect(first.threadId).toBe(42)
    expect(calls).toBe(1)

    const second = await reg.findOrCreate({
      topicName: 'Daily Digest',
      chatId: '-100123',
      createTopic: async () => {
        calls++
        return { threadId: 999, name: 'should-not-be-called' }
      },
    })
    expect(second.threadId).toBe(42)
    expect(calls).toBe(1)
  })

  it('treats different names as separate entries', async () => {
    const reg = new TopicRegistry(dir)
    let next = 100
    const a = await reg.findOrCreate({
      topicName: 'Reports',
      chatId: '-100',
      createTopic: async (n) => ({ threadId: next++, name: n }),
    })
    const b = await reg.findOrCreate({
      topicName: 'Errors',
      chatId: '-100',
      createTopic: async (n) => ({ threadId: next++, name: n }),
    })
    expect(a.threadId).toBe(100)
    expect(b.threadId).toBe(101)
  })

  it('is case-sensitive: "Reports" and "reports" are different topics', async () => {
    const reg = new TopicRegistry(dir)
    let next = 200
    const upper = await reg.findOrCreate({
      topicName: 'Reports',
      chatId: '-100',
      createTopic: async (n) => ({ threadId: next++, name: n }),
    })
    const lower = await reg.findOrCreate({
      topicName: 'reports',
      chatId: '-100',
      createTopic: async (n) => ({ threadId: next++, name: n }),
    })
    expect(upper.threadId).not.toBe(lower.threadId)
  })

  it('serializes concurrent calls for the same name (only one createTopic invocation)', async () => {
    const reg = new TopicRegistry(dir)
    let calls = 0
    const work = async () =>
      reg.findOrCreate({
        topicName: 'Same Name',
        chatId: '-100',
        createTopic: async (n) => {
          calls++
          // Simulate some async latency to give the scheduler a chance
          // to interleave the other concurrent calls if the mutex were absent
          await new Promise((r) => setTimeout(r, 5))
          return { threadId: 1, name: n }
        },
      })

    const [r1, r2, r3] = await Promise.all([work(), work(), work()])
    expect(calls).toBe(1)
    expect(r1.threadId).toBe(1)
    expect(r2.threadId).toBe(1)
    expect(r3.threadId).toBe(1)
  })

  it('propagates errors from createTopic and does not cache failed entries', async () => {
    const reg = new TopicRegistry(dir)
    await expect(
      reg.findOrCreate({
        topicName: 'Fail',
        chatId: '-100',
        createTopic: async () => {
          throw new Error('Bot lacks Manage Topics permission')
        },
      }),
    ).rejects.toThrow('Manage Topics')

    expect(reg.get('Fail')).toBeUndefined()

    // A subsequent successful call should now create the entry.
    const ok = await reg.findOrCreate({
      topicName: 'Fail',
      chatId: '-100',
      createTopic: async (n) => ({ threadId: 7, name: n }),
    })
    expect(ok.threadId).toBe(7)
  })
})

describe('TopicRegistry — persistence', () => {
  it('persists entries to disk and restores them on a new instance', async () => {
    const reg1 = new TopicRegistry(dir)
    await reg1.findOrCreate({
      topicName: 'Persisted',
      chatId: '-100',
      createTopic: async (n) => ({ threadId: 55, name: n }),
    })

    const file = join(dir, 'topic-registry.json')
    expect(existsSync(file)).toBe(true)
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    expect(parsed.entries.length).toBe(1)
    expect(parsed.entries[0].threadId).toBe(55)

    // Fresh instance — the cached entry must come back without calling createTopic.
    const reg2 = new TopicRegistry(dir)
    let calls = 0
    const found = await reg2.findOrCreate({
      topicName: 'Persisted',
      chatId: '-100',
      createTopic: async () => {
        calls++
        return { threadId: 0, name: 'unused' }
      },
    })
    expect(found.threadId).toBe(55)
    expect(calls).toBe(0)
  })

  it('survives a corrupted file (graceful empty load, no throw)', async () => {
    const file = join(dir, 'topic-registry.json')
    writeFileSync(file, '{"version":1,"entries":[{"oops":"bad"}]', 'utf8')

    const reg = new TopicRegistry(dir)
    expect(reg.list().length).toBe(0)

    // Should be usable for fresh writes even after a corrupt load.
    const created = await reg.findOrCreate({
      topicName: 'Recovered',
      chatId: '-100',
      createTopic: async (n) => ({ threadId: 9, name: n }),
    })
    expect(created.threadId).toBe(9)
  })
})

describe('TopicRegistry — remove', () => {
  it('drops the entry; subsequent findOrCreate creates a fresh one', async () => {
    const reg = new TopicRegistry(dir)
    let next = 1
    await reg.findOrCreate({
      topicName: 'Drop-me',
      chatId: '-100',
      createTopic: async (n) => ({ threadId: next++, name: n }),
    })
    expect(reg.get('Drop-me')).toBeDefined()

    await reg.remove('Drop-me')
    expect(reg.get('Drop-me')).toBeUndefined()

    const fresh = await reg.findOrCreate({
      topicName: 'Drop-me',
      chatId: '-100',
      createTopic: async (n) => ({ threadId: next++, name: n }),
    })
    expect(fresh.threadId).toBe(2)
  })
})
