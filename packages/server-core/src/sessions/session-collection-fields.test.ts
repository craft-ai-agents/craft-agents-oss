import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import {
  getSessionFilePath,
  loadSession,
  writeSessionJsonl,
  lexorankValidate,
  type StoredSession,
  sessionPersistenceQueue,
} from '@craft-agent/shared/sessions'
import type { StoredMessage } from '@craft-agent/core/types'
import { SessionManager, createManagedSession } from './SessionManager.ts'

/**
 * B1.3: priority / dueDate / rank setters + getSessions rank backfill.
 * Harness mirrors session-memory-mode.test.ts (cold managed map seed).
 *
 * Default: stub flushSession so getSessions backfill does not race temp-dir
 * cleanup via PersistenceQueue. Tests that assert disk durability restore the
 * real flush for that case only.
 */
describe('session collection fields (B1.3)', () => {
  let tmpRoot: string
  let sm: SessionManager
  const smAny = () => sm as unknown as { sessions: Map<string, unknown> }
  const events: Array<{ type: string; sessionId?: string; changes?: Record<string, unknown> }> = []

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sm-collection-'))
    sm = new SessionManager()
    events.length = 0
    sm.flushSession = async () => {}
    ;(sm as unknown as {
      sendEvent: (e: { type: string; sessionId?: string; changes?: Record<string, unknown> }) => void
    }).sendEvent = (e) => {
      events.push(e)
    }
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  function enableRealFlush() {
    const proto = Object.getPrototypeOf(sm) as SessionManager
    sm.flushSession = proto.flushSession.bind(sm)
  }

  function buildWorkspace(id = 'ws_test') {
    return {
      id,
      name: 'Test Workspace',
      rootPath: tmpRoot,
      createdAt: Date.now(),
    } as never
  }

  function seedSession(
    sessionId: string,
    opts: {
      lastMessageAt?: number
      rank?: string
      priority?: 'none' | 'urgent' | 'high' | 'medium' | 'low'
      dueDate?: number | null
      labels?: string[]
      sessionStatus?: string
      projectId?: string
      isFlagged?: boolean
      isArchived?: boolean
      messages?: StoredMessage[]
    } = {},
  ) {
    const filePath = getSessionFilePath(tmpRoot, sessionId)
    mkdirSync(dirname(filePath), { recursive: true })
    const stored: StoredSession = {
      id: sessionId,
      workspaceRootPath: tmpRoot,
      name: sessionId,
      createdAt: opts.lastMessageAt ?? Date.now(),
      lastUsedAt: opts.lastMessageAt ?? Date.now(),
      lastMessageAt: opts.lastMessageAt,
      messages: opts.messages ?? [],
      ...(opts.rank !== undefined ? { rank: opts.rank } : {}),
      ...(opts.priority !== undefined ? { priority: opts.priority } : {}),
      ...(opts.dueDate !== undefined && opts.dueDate !== null ? { dueDate: opts.dueDate } : {}),
      ...(opts.labels !== undefined ? { labels: opts.labels } : {}),
      ...(opts.sessionStatus !== undefined ? { sessionStatus: opts.sessionStatus } : {}),
      ...(opts.projectId !== undefined ? { projectId: opts.projectId } : {}),
      ...(opts.isFlagged !== undefined ? { isFlagged: opts.isFlagged } : {}),
      ...(opts.isArchived !== undefined ? { isArchived: opts.isArchived } : {}),
    } as StoredSession
    writeSessionJsonl(filePath, stored)

    const managed = createManagedSession(
      {
        id: sessionId,
        name: stored.name,
        createdAt: stored.createdAt,
        lastMessageAt: opts.lastMessageAt ?? Date.now(),
        ...(opts.rank !== undefined ? { rank: opts.rank } : {}),
        ...(opts.priority !== undefined ? { priority: opts.priority } : {}),
        ...(opts.dueDate !== undefined ? { dueDate: opts.dueDate ?? undefined } : {}),
        ...(opts.labels !== undefined ? { labels: opts.labels } : {}),
        ...(opts.sessionStatus !== undefined ? { sessionStatus: opts.sessionStatus } : {}),
        ...(opts.projectId !== undefined ? { projectId: opts.projectId } : {}),
        ...(opts.isFlagged !== undefined ? { isFlagged: opts.isFlagged } : {}),
        ...(opts.isArchived !== undefined ? { isArchived: opts.isArchived } : {}),
      },
      buildWorkspace(),
    )
    smAny().sessions.set(sessionId, managed)
    return managed
  }

  function readDiskHeader(sessionId: string): Record<string, unknown> {
    const path = getSessionFilePath(tmpRoot, sessionId)
    const firstLine = readFileSync(path, 'utf-8').split('\n')[0]
    return JSON.parse(firstLine)
  }

  it('setPriority persists and emits session_metadata_changed', async () => {
    enableRealFlush()
    seedSession('s1')
    await sm.setPriority('s1', 'high')
    const header = readDiskHeader('s1')
    expect(header.priority).toBe('high')
    const reloaded = loadSession(tmpRoot, 's1')
    expect(reloaded?.priority).toBe('high')
    expect(events.some((e) => e.type === 'session_metadata_changed' && e.changes?.priority === 'high')).toBe(true)
  })

  it('setDueDate null clears managed field and emits dueDate: null', async () => {
    enableRealFlush()
    seedSession('s2', { dueDate: Date.UTC(2026, 7, 1, 12, 0, 0) })
    await sm.setDueDate('s2', null)
    const header = readDiskHeader('s2')
    expect(header.dueDate).toBeUndefined()
    const metaEvt = events.find((e) => e.type === 'session_metadata_changed' && e.sessionId === 's2')
    expect(metaEvt?.changes?.dueDate).toBeNull()
  })

  it('setRank rejects invalid ranks', async () => {
    seedSession('s3')
    await expect(sm.setRank('s3', '!!!')).rejects.toThrow(/Invalid rank/)
  })

  it('setRank persists a valid rank', async () => {
    enableRealFlush()
    seedSession('s4')
    await sm.setRank('s4', 'U')
    expect(readDiskHeader('s4').rank).toBe('U')
    expect(lexorankValidate(String(readDiskHeader('s4').rank))).toBe(true)
  })

  it('reorderRank throws RANK_NEIGHBORS_STALE for missing neighbor', async () => {
    seedSession('s5', { rank: 'M' })
    await expect(sm.reorderRank('s5', 'missing-prev')).rejects.toThrow(/RANK_NEIGHBORS_STALE/)
  })

  it('reorderRank places rank between neighbors', async () => {
    enableRealFlush()
    seedSession('a', { rank: 'A' })
    seedSession('b', { rank: 'Z' })
    seedSession('mid', { rank: 'A' })
    await sm.reorderRank('mid', 'a', 'b')
    const midRank = String(readDiskHeader('mid').rank)
    expect(lexorankValidate(midRank)).toBe(true)
    expect(midRank > 'A').toBe(true)
    expect(midRank < 'Z').toBe(true)
  })

  it('getSessions backfills missing ranks ordered by lastMessageAt desc', () => {
    seedSession('old', { lastMessageAt: 1000 })
    seedSession('new', { lastMessageAt: 3000 })
    seedSession('mid', { lastMessageAt: 2000 })

    const first = sm.getSessions('ws_test')
    expect(first).toHaveLength(3)
    for (const s of first) {
      expect(s.rank).toBeTruthy()
      expect(lexorankValidate(s.rank!)).toBe(true)
    }

    const byRankAsc = [...first].sort((a, b) => (a.rank! < b.rank! ? -1 : a.rank! > b.rank! ? 1 : 0))
    expect(byRankAsc.map((s) => s.id)).toEqual(['new', 'mid', 'old'])

    const ranksAfterFirst = Object.fromEntries(first.map((s) => [s.id, s.rank]))
    const second = sm.getSessions('ws_test')
    for (const s of second) {
      expect(s.rank).toBe(ranksAfterFirst[s.id])
    }
  })

  it('managedToSession coerces missing priority/dueDate defaults', () => {
    const managed = createManagedSession({ id: 'coerce', rank: 'M' }, buildWorkspace())
    smAny().sessions.set('coerce', managed)
    const [session] = sm.getSessions('ws_test')
    expect(session.priority).toBe('none')
    expect(session.dueDate).toBeNull()
  })

  it('bulkUpdateSessions persists each accepted target and resolves label deltas per session', async () => {
    seedSession('bulk-a', { labels: ['keep', 'remove'], priority: 'none' })
    seedSession('bulk-b', { labels: ['other'], priority: 'low' })

    const result = await sm.bulkUpdateSessions('ws_test', {
      ids: ['bulk-a', 'bulk-b'],
      patch: {
        addLabels: ['new', 'keep'],
        removeLabels: ['remove'],
        priority: 'high',
        dueDate: 42,
      },
    })

    expect(result).toEqual({ ok: ['bulk-a', 'bulk-b'], failed: [] })
    expect(readDiskHeader('bulk-a')).toMatchObject({
      labels: ['keep', 'new'],
      priority: 'high',
      dueDate: 42,
    })
    expect(readDiskHeader('bulk-b')).toMatchObject({
      labels: ['other', 'new', 'keep'],
      priority: 'high',
      dueDate: 42,
    })
  })

  it('bulkUpdateSessions aborts all mutations when any target is missing', async () => {
    seedSession('valid', { priority: 'none' })

    const result = await sm.bulkUpdateSessions('ws_test', {
      ids: ['valid', 'missing'],
      patch: { priority: 'urgent' },
    })

    expect(result).toEqual({
      ok: [],
      failed: [
        { id: 'valid', error: 'preflight_aborted' },
        { id: 'missing', error: 'not_found' },
      ],
    })
    expect(readDiskHeader('valid').priority).toBe('none')
  })

  it('bulkUpdateSessions reports busy archive targets without blocking eligible targets', async () => {
    seedSession('free')
    const busy = seedSession('busy')
    busy.isProcessing = true

    const result = await sm.bulkUpdateSessions('ws_test', {
      ids: ['free', 'busy'],
      patch: { isArchived: true },
    })

    expect(result.ok).toEqual(['free'])
    expect(result.failed).toEqual([{ id: 'busy', error: 'busy' }])
    expect(readDiskHeader('free').isArchived).toBe(true)
    expect(readDiskHeader('busy').isArchived).toBeUndefined()
  })

  it('does not roll an older failed write over a newer collection mutation', async () => {
    seedSession('overlap', { priority: 'none' })
    const originalUpdateSessionHeader = sessionPersistenceQueue.updateSessionHeader
    let callCount = 0
    let signalFirstStarted: (() => void) | undefined
    let rejectFirst: ((error: Error) => void) | undefined
    const firstStarted = new Promise<void>(resolve => {
      signalFirstStarted = resolve
    })

    sessionPersistenceQueue.updateSessionHeader = async () => {
      callCount += 1
      if (callCount !== 1) return
      signalFirstStarted?.()
      await new Promise<void>((_resolve, reject) => {
        rejectFirst = reject
      })
    }

    try {
      const older = sm.bulkUpdateSessions('ws_test', {
        ids: ['overlap'],
        patch: { priority: 'high' },
      })
      await firstStarted

      const newer = await sm.bulkUpdateSessions('ws_test', {
        ids: ['overlap'],
        patch: { priority: 'low' },
      })
      rejectFirst?.(new Error('disk failed'))
      const olderResult = await older

      expect(newer).toEqual({ ok: ['overlap'], failed: [] })
      expect(olderResult).toEqual({
        ok: [],
        failed: [{ id: 'overlap', error: 'disk failed' }],
      })
      expect(sm.getSessions('ws_test')[0]?.priority).toBe('low')
    } finally {
      sessionPersistenceQueue.updateSessionHeader = originalUpdateSessionHeader
    }
  })
})
