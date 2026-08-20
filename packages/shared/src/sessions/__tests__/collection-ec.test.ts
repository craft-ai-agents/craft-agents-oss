import { describe, expect, it } from 'bun:test'
import {
  dueBucket,
  filterSessionMeta,
  compareSessions,
  type CollectionSessionMeta,
} from '../collection-query.ts'

function meta(partial: Partial<CollectionSessionMeta> & { id: string }): CollectionSessionMeta {
  return { lastMessageAt: 0, createdAt: 0, ...partial }
}

describe('EC cases for sessions collection (B* superset)', () => {
  it('EC-5 explicit done chip wins when showCompleted=false', () => {
    const done = meta({ id: 'd', sessionStatus: 'done' })
    expect(filterSessionMeta(done, {}, false)).toBe(false)
    expect(filterSessionMeta(done, { status: ['done'] }, false)).toBe(true)
  })

  it('EC-9 overdue carries through dueBucket regardless of status (renderer masks terminal)', () => {
    const yesterday = Date.now() - 24 * 3600_000
    expect(dueBucket(yesterday, Date.now())).toBe('overdue')
    // filterSessionMeta doesn't special-case status for due — terminal masking is renderer-side
    expect(filterSessionMeta(meta({ id: 'x', sessionStatus: 'done', dueDate: yesterday }), { due: { type: 'overdue' } }, true)).toBe(true)
  })

  it('due range respects Date range inclusive bounds', () => {
    const t = 1_780_000_000_000
    const m = meta({ id: 'r', dueDate: t })
    expect(filterSessionMeta(m, { due: { type: 'range', start: t, end: t } }, true)).toBe(true)
    expect(filterSessionMeta(m, { due: { type: 'range', start: t + 1, end: t + 60 } }, true)).toBe(false)
  })

  it('compareSessions name ignores case with id tie-break', () => {
    const list = [
      meta({ id: 'b', name: 'Alpha' }),
      meta({ id: 'a', name: 'alpha' }),
      meta({ id: 'c', name: 'bravo' }),
    ]
    const out = [...list].sort((x, y) => compareSessions(x, y, 'name', 'asc'))
    expect(out[0]!.id).toBe('a')
    expect(out[1]!.id).toBe('b')
    expect(out[2]!.id).toBe('c')
  })

  it('rank reorder strict ordering emerges from lexorank between', () => {
    const A = meta({ id: 'A', rank: 'A' })
    const B = meta({ id: 'B', rank: 'Z' })
    const M = meta({ id: 'M', rank: 'M' })
    const out = [B, A, M].sort((x, y) => compareSessions(x, y, 'rank', 'asc'))
    expect(out.map((s) => s.id)).toEqual(['A', 'M', 'B'])
  })
})
