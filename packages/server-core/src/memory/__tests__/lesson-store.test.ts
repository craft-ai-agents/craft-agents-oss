/**
 * LessonStore tests — dedup, limits/pruning, resilient parsing, atomic
 * rewrite, mtime caching, forContext ordering and negative-flag passthrough.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, statSync, utimesSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { LESSON_LIMITS } from '@craft-agent/shared/memory/types'
import { LessonStore, lessonKey, parseLessons } from '../LessonStore'
import type { Lesson } from '@craft-agent/shared/memory/types'

let dir: string
let file: string
let store: LessonStore

function makeLesson(rule: string, ts = '2026-08-06T00:00:00.000Z'): Lesson {
  return { ts, rule, category: 'preference', scope: 'workspace', source: { trigger: 'explicit' } }
}

function rawLines(): string[] {
  return readFileSync(file, 'utf8').split('\n').filter(l => l.length > 0)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lesson-store-'))
  file = join(dir, 'lessons.jsonl')
  store = new LessonStore(file, 'workspace')
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('lessonKey / parseLessons', () => {
  it('normalizes case and whitespace for dedup', () => {
    expect(lessonKey('  Always Run TESTS ')).toBe(lessonKey('always run tests'))
  })

  it('skips corrupt lines without throwing', () => {
    writeFileSync(file, '{"rule":"ok"}\nnot json at all\n{"rule":123}\n{"broken"\n\n')
    const lessons = store.list()
    expect(lessons).toHaveLength(1)
    expect(lessons[0].rule).toBe('ok')
  })

  it('lists empty when file does not exist', () => {
    expect(store.list()).toEqual([])
    expect(store.forContext()).toEqual([])
  })
})

describe('add', () => {
  it('appends lessons and creates parent dirs', () => {
    store.add(makeLesson('first'))
    store.add(makeLesson('second'))
    expect(rawLines()).toHaveLength(2)
  })

  it('dedups case-insensitively, refreshing ts/source', () => {
    store.add(makeLesson('Always run tests', '2026-08-01T00:00:00.000Z'))
    const dup = makeLesson('  always run TESTS', '2026-08-06T00:00:00.000Z')
    dup.source = { trigger: 'branch', sessionId: 's1' }
    store.add(dup)
    const lessons = store.list()
    expect(lessons).toHaveLength(1)
    expect(lessons[0].ts).toBe('2026-08-06T00:00:00.000Z')
    expect(lessons[0].source.sessionId).toBe('s1')
    expect(lessons[0].rule).toBe('Always run tests') // original casing kept
  })

  it('passes the negative flag through', () => {
    const lesson = makeLesson('commit without asking')
    lesson.negative = true
    store.add(lesson)
    expect(store.list()[0].negative).toBe(true)
    expect(store.forContext()[0].negative).toBe(true)
  })

  it('prunes the oldest lessons beyond LESSON_LIMITS.total', () => {
    for (let i = 0; i < LESSON_LIMITS.total; i++) store.add(makeLesson(`rule ${i}`))
    store.add(makeLesson('overflow rule'))
    const lessons = store.list()
    expect(lessons).toHaveLength(LESSON_LIMITS.total)
    expect(lessons[0].rule).toBe('rule 1') // 'rule 0' pruned
    expect(lessons[lessons.length - 1].rule).toBe('overflow rule')
    expect(rawLines()).toHaveLength(LESSON_LIMITS.total)
  })
})

describe('update / delete', () => {
  it('updates by rule match and by index with an atomic rewrite', () => {
    store.add(makeLesson('alpha'))
    store.add(makeLesson('beta'))
    const patched = store.update(' ALPHA ', { rule: 'alpha v2', negative: true })
    expect(patched?.rule).toBe('alpha v2')
    const byIndex = store.update(1, { category: 'correction' })
    expect(byIndex?.category).toBe('correction')
    expect(store.list().map(l => l.rule)).toEqual(['alpha v2', 'beta'])
    // no tmp file left behind
    expect(existsSync(file)).toBe(true)
    for (const entry of readdirSync(dir)) {
      expect(entry.endsWith('.tmp')).toBe(false)
    }
  })

  it('returns null for unknown update targets', () => {
    expect(store.update('nope', { rule: 'x' })).toBeNull()
    expect(store.update(9, { rule: 'x' })).toBeNull()
  })

  it('deletes by rule match and by index', () => {
    store.add(makeLesson('one'))
    store.add(makeLesson('two'))
    expect(store.delete('ONE')).toBe(true)
    expect(store.list().map(l => l.rule)).toEqual(['two'])
    expect(store.delete(0)).toBe(true)
    expect(store.list()).toEqual([])
    expect(store.delete('missing')).toBe(false)
    for (const entry of readdirSync(dir)) {
      expect(entry.endsWith('.tmp')).toBe(false)
    }
  })
})

describe('forContext', () => {
  it('returns the most recent LESSON_LIMITS.context lessons, most recent first', () => {
    for (let i = 0; i < LESSON_LIMITS.context + 10; i++) store.add(makeLesson(`ctx rule ${i}`))
    const ctx = store.forContext()
    expect(ctx).toHaveLength(LESSON_LIMITS.context)
    expect(ctx[0].rule).toBe(`ctx rule ${LESSON_LIMITS.context + 9}`)
    expect(ctx[LESSON_LIMITS.context - 1].rule).toBe('ctx rule 10')
  })
})

describe('mtime cache', () => {
  it('caches by mtime and re-reads only when the file mtime changes', () => {
    store.add(makeLesson('cached'))
    // Normalize to a round second (utimesSync truncates sub-ms fractions).
    const mtime = Math.floor(statSync(file).mtimeMs / 1000) * 1000
    utimesSync(file, new Date(mtime), new Date(mtime))
    store.list() // prime the mtime cache (first read populates it)
    // External write with the SAME mtime → cached value is served.
    writeFileSync(file, '{"rule":"external"}\n')
    utimesSync(file, new Date(mtime), new Date(mtime))
    expect(store.list().map(l => l.rule)).toEqual(['cached'])
    // Bump the mtime → store re-reads and sees the external change.
    const bumped = mtime + 1000
    utimesSync(file, new Date(bumped), new Date(bumped))
    expect(store.list().map(l => l.rule)).toEqual(['external'])
  })
})
