/**
 * Lesson schema v2 tests (spec F1) — back-compat reads of v1 files, generated
 * flagging by trigger, touchUsed usage counters, recordConflict capping, and
 * the store's internal audit seam (spec F2) with actor propagation through
 * LessonStore, SkillPendingQueue and MemoryService.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { LESSON_LIMITS } from '@craft-agent/shared/memory/types'
import type { Lesson } from '@craft-agent/shared/memory/types'
import { LessonStore } from '../LessonStore'
import { AuditLog } from '../AuditLog'
import { MemoryFileStore } from '../MemoryFileStore'
import { MemoryService } from '../MemoryService'
import { SkillPendingQueue } from '../SkillPendingQueue'

let dir: string
let file: string
let store: LessonStore

function makeLesson(rule: string, trigger: Lesson['source']['trigger'] = 'explicit'): Lesson {
  return { ts: '2026-08-06T00:00:00.000Z', rule, category: 'preference', scope: 'workspace', source: { trigger } }
}

const tmpDirs: string[] = []

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lesson-store-v2-'))
  tmpDirs.push(dir)
  file = join(dir, 'lessons.jsonl')
  store = new LessonStore(file, 'workspace')
})

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true })
})

describe('schema v2 back-compat (F1)', () => {
  it('loads v1 files without any v2 fields (no migration needed)', () => {
    writeFileSync(
      file,
      JSON.stringify({ ts: '2026-08-01T00:00:00.000Z', rule: 'old rule', category: 'preference', scope: 'workspace', source: { trigger: 'explicit' } }) + '\n',
    )
    const lessons = store.list()
    expect(lessons).toHaveLength(1)
    expect(lessons[0].rule).toBe('old rule')
    expect(lessons[0].usageCount).toBeUndefined()
    expect(lessons[0].lastUsedAt).toBeUndefined()
    expect(lessons[0].conflicts).toBeUndefined()
    expect(lessons[0].promoted).toBeUndefined()
    expect(lessons[0].generated).toBeUndefined()
  })

  it('round-trips v2 fields and passes unknown future keys through untouched', () => {
    writeFileSync(
      file,
      JSON.stringify({
        ts: '2026-08-01T00:00:00.000Z',
        rule: 'v2 rule',
        category: 'knowledge',
        scope: 'workspace',
        source: { trigger: 'distillation' },
        usageCount: 3,
        lastUsedAt: '2026-08-05T00:00:00.000Z',
        conflicts: [{ sessionId: 's1', ts: '2026-08-04T00:00:00.000Z', reason: 'branch' }],
        promoted: { fromScope: 'workspace', workspaceIds: ['ws-1'], ts: '2026-08-05T00:00:00.000Z' },
        generated: true,
        futureField: { notInSchema: true },
      }) + '\n',
    )
    const [l] = store.list() as Array<Lesson & { futureField?: unknown }>
    expect(l.usageCount).toBe(3)
    expect(l.lastUsedAt).toBe('2026-08-05T00:00:00.000Z')
    expect(l.conflicts).toHaveLength(1)
    expect(l.promoted?.workspaceIds).toEqual(['ws-1'])
    expect(l.generated).toBe(true)
    expect(l.futureField).toEqual({ notInSchema: true })
    // Update path keeps both the v2 fields and the unknown key.
    store.touchUsed(['v2 rule'])
    const [u] = store.list() as Array<Lesson & { futureField?: unknown }>
    expect(u.usageCount).toBe(4)
    expect(u.futureField).toEqual({ notInSchema: true })
  })

  it('drops malformed v2 fields without breaking the parse', () => {
    writeFileSync(
      file,
      JSON.stringify({
        ts: '2026-08-01T00:00:00.000Z',
        rule: 'hand-edited',
        category: 'knowledge',
        scope: 'workspace',
        source: { trigger: 'explicit' },
        usageCount: 'lots',
        lastUsedAt: 42,
        generated: 'yes',
        conflicts: 'nope',
        promoted: { fromScope: 'global' },
      }) + '\n',
    )
    const [l] = store.list()
    expect(l.rule).toBe('hand-edited')
    expect(l.usageCount).toBeUndefined()
    expect(l.lastUsedAt).toBeUndefined()
    expect(l.generated).toBeUndefined()
    expect(l.conflicts).toBeUndefined()
    expect(l.promoted).toBeUndefined()
  })

  it('marks non-explicit lessons as generated; explicit lessons stay unmarked', () => {
    expect(store.add(makeLesson('distilled rule', 'distillation')).generated).toBe(true)
    expect(store.add(makeLesson('branch rule', 'branch')).generated).toBe(true)
    expect(store.add(makeLesson('interrupted rule', 'interrupted')).generated).toBe(true)
    expect(store.add(makeLesson('explicit rule')).generated).toBeUndefined()
    const all = store.list()
    expect(all.find(l => l.rule === 'distilled rule')?.generated).toBe(true)
    expect(all.find(l => l.rule === 'explicit rule')?.generated).toBeUndefined()
    // Re-adding an existing lesson with a distillation trigger marks it too.
    store.add(makeLesson('explicit rule', 'distillation'))
    expect(store.list().find(l => l.rule === 'explicit rule')?.generated).toBe(true)
  })
})

describe('touchUsed (F1)', () => {
  it('increments usageCount and stamps lastUsedAt on case-insensitive matches', () => {
    store.add(makeLesson('always run tests'))
    store.add(makeLesson('other rule'))
    expect(store.touchUsed([])).toBe(0)
    expect(store.touchUsed(['  Always Run TESTS '])).toBe(1)
    let lesson = store.list().find(l => l.rule === 'always run tests')!
    expect(lesson.usageCount).toBe(1)
    expect(typeof lesson.lastUsedAt).toBe('string')
    expect(Number.isNaN(Date.parse(lesson.lastUsedAt!))).toBe(false)
    // Duplicate rules in one call touch the lesson once.
    expect(store.touchUsed(['always run tests', 'ALWAYS RUN TESTS'])).toBe(1)
    lesson = store.list().find(l => l.rule === 'always run tests')!
    expect(lesson.usageCount).toBe(2)
    expect(store.list().find(l => l.rule === 'other rule')!.usageCount).toBeUndefined()
    expect(store.touchUsed(['missing rule'])).toBe(0)
  })

  it('starts counting from zero on v1 lessons without usageCount', () => {
    writeFileSync(
      file,
      JSON.stringify({ ts: '2026-08-01T00:00:00.000Z', rule: 'v1 lesson', category: 'preference', scope: 'workspace', source: { trigger: 'explicit' } }) + '\n',
    )
    store.invalidate()
    expect(store.touchUsed(['v1 lesson'])).toBe(1)
    expect(store.list()[0].usageCount).toBe(1)
  })
})

describe('recordConflict (F1)', () => {
  it('appends conflict events capped at the most recent 20', () => {
    store.add(makeLesson('never push on friday'))
    for (let i = 0; i < 25; i++) {
      store.recordConflict('NEVER push on friday', { sessionId: `s${i}`, ts: `2026-08-06T00:${String(i).padStart(2, '0')}:00.000Z`, reason: 'branch' })
    }
    const lesson = store.list()[0]
    expect(lesson.conflicts).toHaveLength(LESSON_LIMITS.conflicts)
    expect(lesson.conflicts![0].sessionId).toBe('s5') // oldest dropped past the cap
    expect(lesson.conflicts![LESSON_LIMITS.conflicts - 1].sessionId).toBe('s24')
  })

  it('returns null and writes nothing for an unknown rule', () => {
    store.add(makeLesson('real rule'))
    expect(store.recordConflict('missing rule', { sessionId: 's1', ts: '2026-08-06T00:00:00.000Z', reason: 'error' })).toBeNull()
    expect(store.list()[0].conflicts).toBeUndefined()
    expect(store.auditLog.read().some(e => e.action === 'conflict')).toBe(false)
  })

  it('audits conflicts with the conflict action', () => {
    store.add(makeLesson('rule c'))
    store.recordConflict('rule c', { sessionId: 'sess-9', ts: '2026-08-06T00:00:00.000Z', reason: 'interrupted' })
    const conflicts = store.auditLog.read().filter(e => e.action === 'conflict')
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].target).toBe('rule c')
    expect(conflicts[0].detail).toContain('interrupted')
    expect(conflicts[0].detail).toContain('sess-9')
  })
})

describe('audit seam (F2)', () => {
  it('audits add/update/promote/delete with actor propagation (default rpc)', () => {
    store.add(makeLesson('rule one')) // default actor
    store.add(makeLesson('rule two', 'distillation'), 'distill')
    store.update('rule two', { negative: true }, 'distill')
    store.update('rule one', { promoted: { fromScope: 'workspace', workspaceIds: ['ws-1'], ts: '2026-08-06T01:00:00.000Z' } })
    store.delete('rule one')
    const entries = store.auditLog.read()
    expect(entries.map(e => [e.action, e.actor])).toEqual([
      ['delete', 'rpc'],
      ['promote', 'rpc'],
      ['update', 'distill'],
      ['add', 'distill'],
      ['add', 'rpc'],
    ])
    expect(entries[1].target).toBe('rule one')
    expect(entries[3].target).toBe('rule two')
    expect(entries.every(e => e.scope === 'workspace')).toBe(true)
    expect(entries.every(e => typeof e.ts === 'string' && !Number.isNaN(Date.parse(e.ts)))).toBe(true)
  })

  it('does not audit touchUsed', () => {
    store.add(makeLesson('quiet rule'))
    store.touchUsed(['quiet rule'])
    expect(store.auditLog.read().map(e => e.action)).toEqual(['add'])
  })

  it('SkillPendingQueue audits approve/dismiss with actor queue', () => {
    const wsRoot = mkdtempSync(join(tmpdir(), 'skill-pending-audit-'))
    tmpDirs.push(wsRoot)
    const queue = new SkillPendingQueue(wsRoot)
    queue.enqueue({ slug: 'skill-one', description: 'desc one', body: 'body', source: { ts: '2026-08-06T00:00:00.000Z' } })
    queue.dismiss('skill-one')
    queue.enqueue({ slug: 'skill-two', description: 'desc two', body: 'body', source: { ts: '2026-08-06T00:00:00.000Z' } })
    queue.approve('skill-two')
    const entries = new AuditLog('workspace', wsRoot).read()
    expect(entries.map(e => [e.action, e.actor, e.target])).toEqual([
      ['approved', 'queue', 'skill-two'],
      ['dismissed', 'queue', 'skill-one'],
    ])
    expect(entries.every(e => e.scope === 'workspace')).toBe(true)
  })

  it('MemoryService distillation audits lesson adds and context.md writes with actor distill', async () => {
    const root = mkdtempSync(join(tmpdir(), 'memory-audit-svc-'))
    tmpDirs.push(root)
    const wsFiles = new MemoryFileStore('workspace', root)
    const wsLessons = new LessonStore(wsFiles.lessonsPath, 'workspace')
    let fire: ((evt: { sessionId: string; reason: 'complete' }) => void) | null = null
    const svc = new MemoryService({
      workspaceRoot: root,
      workspaceId: 'ws-1',
      lessonStoreFactory: () => wsLessons,
      fileStore: wsFiles,
      skillQueue: { enqueue: () => false } as never,
      distiller: async () =>
        JSON.stringify({
          history_entry: null,
          memory_update: 'ws context paragraph',
          lessons: [{ rule: 'distilled rule', category: 'workflow' }],
          skill_candidate: null,
        }),
      logger: { warn: () => {} },
      readMessages: () => [],
      getConfig: () => ({ enabled: true, distillIdleHours: 3, distillMsgCount: 30, negativeFirst: true, redactExtraPatterns: [], ftsLimit: 20, semantic: false }),
    })
    svc.attachSessionCompletion((cb) => {
      fire = cb as typeof fire
      return () => {}
    })
    fire!({ sessionId: 's1', reason: 'complete' })
    await svc.whenIdle()

    // The distilled lesson came out generated, and its add was audited.
    expect(wsLessons.list()[0]?.generated).toBe(true)
    expect(wsFiles.readContext()).toBe('ws context paragraph')
    const entries = new AuditLog('workspace', root).read()
    expect(entries.map(e => [e.action, e.actor, e.target])).toEqual([
      ['update', 'distill', 'context.md'],
      ['add', 'distill', 'distilled rule'],
    ])
    // The raw file lives next to lessons.jsonl.
    expect(readFileSync(join(root, 'memory', 'audit.jsonl'), 'utf8').trim().split('\n')).toHaveLength(2)
  })
})
