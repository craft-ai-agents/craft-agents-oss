import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import type { StoredMessage } from '@craft-agent/core/types'
import { readSessionHeader, rewriteSessionHeader, writeSessionJsonl } from '../jsonl'
import { SessionPersistenceQueue, getHeaderMetadataSignature } from '../persistence-queue'
import { getSessionFilePath } from '../storage'
import type { SessionHeader, StoredSession } from '../types'

// Header-only saves for sessions whose messages aren't loaded (project moves): the message lines stay
// byte for byte, and the persistence queue orders a patch with the session's full writes.

describe('session header patches', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'session-header-patch-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function stored(id: string, fields: Partial<StoredSession> = {}, messageCount = 2): StoredSession {
    const messages = Array.from({ length: messageCount }, (_, i) =>
      // A path inside the session folder is stored as a portable token, which must survive
      ({ id: `${id}-m${i}`, type: 'user', content: `see ${join(root, 'sessions', id, 'plans', 'p.md')}`, timestamp: 1 }) as StoredMessage)
    return { id, workspaceRootPath: root, name: id, createdAt: 1, lastUsedAt: 1, messages, ...fields } as StoredSession
  }

  function seedFile(session: StoredSession): string {
    const file = getSessionFilePath(root, session.id)
    mkdirSync(dirname(file), { recursive: true })
    writeSessionJsonl(file, session)
    return file
  }

  const headerOf = (file: string) => JSON.parse(readFileSync(file, 'utf-8').split('\n')[0]!)
  const messageBytes = (file: string) => readFileSync(file, 'utf-8').split('\n').slice(1).join('\n')

  /**
   * How often `file` was missing while `work` ran. Polls between event-loop turns, while the file
   * operations run on other threads, so a moment without the file is hard to miss.
   */
  async function timesMissingDuring(file: string, work: Promise<unknown>): Promise<number> {
    let settled = false
    void work.then(() => { settled = true }, () => { settled = true })
    let missing = 0
    while (!settled) {
      await new Promise(resolve => setImmediate(resolve))
      const until = performance.now() + 2
      while (performance.now() < until) if (!existsSync(file)) missing++
    }
    await work
    return missing
  }

  describe('rewriteSessionHeader', () => {
    it('changes and removes header fields and keeps every message line as it was', async () => {
      const file = seedFile(stored('s1', { projectId: 'old', projectOverride: true, labels: ['keep'] }))
      const before = messageBytes(file)
      expect(before).toContain('{{SESSION_PATH}}')

      expect(await rewriteSessionHeader(file, { projectId: 'new', projectOverride: undefined })).toBe(true)

      const header = headerOf(file)
      expect(header.projectId).toBe('new')
      expect('projectOverride' in header).toBe(false)
      expect(header.labels).toEqual(['keep'])
      expect(header.messageCount).toBe(2)
      expect(messageBytes(file)).toBe(before)
      expect(existsSync(`${file}.header.tmp`)).toBe(false)
    })

    it('reads a header longer than one read chunk', async () => {
      const file = seedFile(stored('long', { name: 'x'.repeat(200_000) }))
      const before = messageBytes(file)
      expect(await rewriteSessionHeader(file, { projectId: 'p' })).toBe(true)
      expect(headerOf(file)).toMatchObject({ projectId: 'p', name: 'x'.repeat(200_000) })
      expect(messageBytes(file)).toBe(before)
    })

    it('handles a file that is only a header, and leaves a missing or unreadable one alone', async () => {
      const headerOnly = join(root, 'header-only.jsonl')
      writeFileSync(headerOnly, JSON.stringify({ id: 'h' }))
      expect(await rewriteSessionHeader(headerOnly, { projectId: 'p' })).toBe(true)
      expect(readFileSync(headerOnly, 'utf-8')).toBe('{"id":"h","projectId":"p"}\n')

      expect(await rewriteSessionHeader(join(root, 'missing.jsonl'), { projectId: 'p' })).toBe(false)

      const broken = join(root, 'broken.jsonl')
      writeFileSync(broken, '{"id": "b", trunc\n{"id":"m"}\n')
      expect(await rewriteSessionHeader(broken, { projectId: 'p' })).toBe(false)
      expect(readFileSync(broken, 'utf-8')).toBe('{"id": "b", trunc\n{"id":"m"}\n')
    })

    it('replaces the file in one step: it is never missing, so a chat opened meanwhile loads in full', async () => {
      const file = seedFile(stored('big', {}, 2000))
      const before = messageBytes(file)

      expect(await timesMissingDuring(file, rewriteSessionHeader(file, { projectId: 'p' }))).toBe(0)

      expect(headerOf(file).projectId).toBe('p')
      expect(messageBytes(file)).toBe(before)
    })

    it('gives beforeReplace the new header as readers will see it, while the file still has the old one', async () => {
      // Stored with a permission mode's display name, which readers normalize
      const file = seedFile(stored('s', { permissionMode: 'explore' as never, sessionStatus: 'todo' }))
      let given: SessionHeader | undefined
      let onDiskThen: unknown = 'not called'

      await rewriteSessionHeader(file, { projectId: 'p' }, (header) => {
        given = header
        onDiskThen = headerOf(file).projectId
      })

      expect(onDiskThen).toBeUndefined()
      expect(given).toEqual(readSessionHeader(file)!)
      expect(given).toMatchObject({ projectId: 'p', permissionMode: 'safe', sessionStatus: 'todo' })
    })

    it('leaves the file as it was and removes its temp file when the rewrite fails before the swap', async () => {
      const file = seedFile(stored('s'))
      const original = readFileSync(file, 'utf-8')

      await expect(rewriteSessionHeader(file, { projectId: 'p' }, () => { throw new Error('refused') })).rejects.toThrow('refused')

      expect(readFileSync(file, 'utf-8')).toBe(original)
      expect(existsSync(`${file}.header.tmp`)).toBe(false)
    })
  })

  describe('SessionPersistenceQueue.patchHeader', () => {
    it('patches the header of a session with nothing queued', async () => {
      const queue = new SessionPersistenceQueue(10_000)
      const file = seedFile(stored('cold'))
      const before = messageBytes(file)

      await queue.patchHeader(root, 'cold', () => ({ projectId: 'p' }))

      expect(headerOf(file).projectId).toBe('p')
      expect(messageBytes(file)).toBe(before)
    })

    it('records the signature the watcher will read, so the patch counts as its own write', async () => {
      const queue = new SessionPersistenceQueue(10_000)
      // Never written in this run: before the patch the queue knows no signature for it
      const file = seedFile(stored('cold', { sessionStatus: 'todo', labels: ['a'], permissionMode: 'explore' as never }))
      expect(queue.getLastWrittenSignature('cold')).toBeUndefined()

      await queue.patchHeader(root, 'cold', () => ({ projectId: 'p' }))

      expect(queue.getLastWrittenSignature('cold')).toBe(getHeaderMetadataSignature(readSessionHeader(file)!))
    })

    it('writes a snapshot still pending first, then the patch on top of it', async () => {
      const queue = new SessionPersistenceQueue(10_000)
      const file = seedFile(stored('s', {}, 1))
      // A full write from an earlier change, carrying an older project and one more message
      queue.enqueue(stored('s', { projectId: 'older' }, 2))

      await queue.patchHeader(root, 's', () => ({ projectId: 'newer' }))

      expect(headerOf(file).projectId).toBe('newer')
      expect(messageBytes(file).trim().split('\n')).toHaveLength(2)
      expect(queue.hasPending('s')).toBe(false)
    })

    it('makes a flush wait for a patch in progress, so the patch never lands under a newer full write', async () => {
      const queue = new SessionPersistenceQueue(10_000)
      const file = seedFile(stored('s', {}, 1))
      let value = 'patched'
      let patched = false
      const patch = queue.patchHeader(root, 's', () => ({ projectId: value })).then(() => { patched = true })
      // Queued while the patch runs: the session was opened and changed again
      value = 'from-full-write'
      queue.enqueue(stored('s', { projectId: 'from-full-write' }, 3))
      await queue.flush('s')

      // The flush ran after the patch, not alongside it
      expect(patched).toBe(true)
      expect(headerOf(file).projectId).toBe('from-full-write')
      expect(messageBytes(file).trim().split('\n')).toHaveLength(3)
      await patch
    })

    it('flushAll waits for patches that have no snapshot pending', async () => {
      const queue = new SessionPersistenceQueue(10_000)
      const file = seedFile(stored('s'))
      void queue.patchHeader(root, 's', () => ({ projectId: 'p' }))
      await queue.flushAll()
      expect(headerOf(file).projectId).toBe('p')
    })
  })
})
