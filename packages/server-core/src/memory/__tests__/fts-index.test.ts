/**
 * Tests for the M1 FTS5 index (fts-index.ts): roundtrips over a tmp dir,
 * BM25 ranking sanity, dedup/remove identity, and the fail-soft degradation
 * contract (search → null on sqlite errors, empty arrays on never-indexed
 * dirs; upserts/removes never throw).
 */
import { describe, expect, it, afterEach } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { Lesson } from '@craft-agent/shared/memory/types'
import { closeAll, removeLesson, search, upsertContext, upsertHistory, upsertLesson } from '../fts-index'

function lesson(rule: string, scope: 'global' | 'workspace' = 'workspace', ts = '2026-08-06T00:00:00.000Z'): Lesson {
  return { ts, rule, category: 'workflow', scope, source: { trigger: 'explicit' } }
}

const dirs: string[] = []
function tmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fts-idx-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  closeAll()
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('fts-index', () => {
  it('roundtrips lessons/history/context through the on-disk index', () => {
    const dir = tmpDir()
    upsertLesson(dir, lesson('always run tests before shipping', 'global'))
    upsertHistory(dir, '2026-08-01', '# 2026-08-01\n\nshipped the flaky tests fix')
    upsertContext(dir, 'context', 'deploy pipeline uses vercel previews')
    upsertContext(dir, 'preferences', 'prefers concise answers')
    expect(existsSync(join(dir, 'index.db'))).toBe(true)

    const hits = search(dir, 'tests')
    expect(hits).not.toBeNull()
    expect(hits!.lessons.map(h => h.rule)).toEqual(['always run tests before shipping'])
    expect(hits!.lessons[0].scope).toBe('global')
    expect(hits!.history.map(h => h.day)).toEqual(['2026-08-01'])
    expect(hits!.context.map(h => h.kind)).toEqual([])

    const ctxHits = search(dir, 'vercel')
    expect(ctxHits!.context.map(h => h.kind)).toEqual(['context'])
    // persistence: close all handles, reopen from disk — data survives.
    closeAll()
    const after = search(dir, 'concise')
    expect(after!.context).toEqual([expect.objectContaining({ kind: 'preferences' })])
  })

  it('dedups by normalized rule, removes explicitly, and honors day/kind identity', () => {
    const dir = tmpDir()
    upsertLesson(dir, lesson('never store secrets in code'))
    upsertLesson(dir, lesson('Never Store Secrets In Code ')) // same normalized key
    let hits = search(dir, 'secrets')!
    expect(hits.lessons).toHaveLength(1)

    // Re-upserting the same day replaces, never appends a second row.
    upsertHistory(dir, '2026-08-02', '# 2026-08-02\n\nsecrets rotation done')
    upsertHistory(dir, '2026-08-02', '# 2026-08-02\n\nsecrets rotation re-done')
    hits = search(dir, 'rotation')!
    expect(hits.history).toHaveLength(1)
    expect(hits.history[0].text).toContain('re-done')

    // Empty content deletes the row.
    upsertContext(dir, 'context', 'secrets policy: rotate monthly')
    expect(search(dir, 'monthly')!.context).toHaveLength(1)
    upsertContext(dir, 'context', '')
    expect(search(dir, 'monthly')!.context).toHaveLength(0)

    removeLesson(dir, 'NEVER store secrets in CODE')
    expect(search(dir, 'secrets')!.lessons).toHaveLength(0)
  })

  it('BM25-orders better matches first via rank', () => {
    const dir = tmpDir()
    upsertLesson(dir, lesson('run tests, tests, tests — tests before every commit'))
    upsertLesson(
      dir,
      lesson(
        'tests appear once here padded with plenty of unrelated filler words about shipping workflows and pipelines and checks',
      ),
    )
    const hits = search(dir, 'tests')!
    expect(hits.lessons).toHaveLength(2)
    expect(hits.lessons[0].rule).toContain('before every commit')
    expect(hits.lessons[0].rank).toBeLessThan(hits.lessons[1].rank)
    // limit caps the ranked list.
    expect(search(dir, 'tests', { limit: 1 })!.lessons).toHaveLength(1)
  })

  it('never-indexed dirs search empty (without creating the db); broken dbs degrade to null', () => {
    const dir = tmpDir()
    // Missing index: empty result, no db file created on the read path.
    expect(search(dir, 'anything')).toEqual({ lessons: [], history: [], context: [] })
    expect(existsSync(join(dir, 'index.db'))).toBe(false)

    // Corrupt index file: open fails → search null, writes no-op, nothing throws.
    writeFileSync(join(dir, 'index.db'), 'definitely not a sqlite database')
    closeAll()
    expect(search(dir, 'anything')).toBeNull()
    expect(() => upsertLesson(dir, lesson('some rule'))).not.toThrow()
    expect(() => upsertHistory(dir, '2026-08-03', 'text')).not.toThrow()
    expect(() => upsertContext(dir, 'context', 'text')).not.toThrow()
    expect(() => removeLesson(dir, 'some rule')).not.toThrow()
    // removeLesson on a fresh dir with no index must not create one.
    const fresh = tmpDir()
    removeLesson(fresh, 'nope')
    expect(existsSync(join(fresh, 'index.db'))).toBe(false)
  })

  it('handles FTS5-hostile query text without throwing', () => {
    const dir = tmpDir()
    upsertLesson(dir, lesson('quote "heavy" (syntax) AND/OR NOT near/5'))
    const hits = search(dir, '"syntax" AND (OR NOT: "quote" ^near/5, C++?')!
    expect(hits.lessons.length).toBeGreaterThanOrEqual(1)
    expect(search(dir, '   ')).toEqual({ lessons: [], history: [], context: [] })
  })
})
