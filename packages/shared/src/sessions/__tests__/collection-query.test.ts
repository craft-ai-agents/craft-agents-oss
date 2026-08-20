import { describe, expect, it } from 'bun:test'
import {
  compareSessions,
  dueBucket,
  filterSessionMeta,
  priorityWeight,
  querySessionMetas,
  type CollectionFilters,
  type CollectionSessionMeta,
} from '../collection-query.ts'

function meta(partial: Partial<CollectionSessionMeta> & { id: string }): CollectionSessionMeta {
  return {
    lastMessageAt: 0,
    createdAt: 0,
    ...partial,
  }
}

describe('priorityWeight', () => {
  it('orders urgent > high > medium > low > none', () => {
    expect(priorityWeight('urgent')).toBeGreaterThan(priorityWeight('high'))
    expect(priorityWeight('high')).toBeGreaterThan(priorityWeight('medium'))
    expect(priorityWeight('medium')).toBeGreaterThan(priorityWeight('low'))
    expect(priorityWeight('low')).toBeGreaterThan(priorityWeight('none'))
    expect(priorityWeight(undefined)).toBe(priorityWeight('none'))
  })
})

describe('dueBucket', () => {
  it('classifies none/overdue/today/later', () => {
    const now = Date.now()
    const d = new Date(now)
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
    expect(dueBucket(null, now)).toBe('none')
    expect(dueBucket(undefined, now)).toBe('none')
    expect(dueBucket(start - 1, now)).toBe('overdue')
    expect(dueBucket(start + 12 * 3600_000, now)).toBe('today')
    expect(dueBucket(start + 40 * 24 * 3600_000, now)).toBe('later')
  })
})

describe('filterSessionMeta', () => {
  it('AND across chips, OR within multi-value status', () => {
    const s = meta({ id: '1', sessionStatus: 'todo', priority: 'high', isFlagged: true })
    expect(filterSessionMeta(s, { status: ['todo', 'done'] }, true)).toBe(true)
    expect(filterSessionMeta(s, { status: ['done'] }, true)).toBe(false)
    expect(filterSessionMeta(s, { status: ['todo'], priority: ['low'] }, true)).toBe(false)
    expect(filterSessionMeta(s, { status: ['todo'], priority: ['high'], flagged: true }, true)).toBe(true)
    expect(filterSessionMeta(s, { flagged: false }, true)).toBe(false)
  })

  it('EC-5: showCompleted=false hides done unless chip includes done', () => {
    const done = meta({ id: 'd', sessionStatus: 'done' })
    const todo = meta({ id: 't', sessionStatus: 'todo' })
    expect(filterSessionMeta(done, {}, false)).toBe(false)
    expect(filterSessionMeta(todo, {}, false)).toBe(true)
    expect(filterSessionMeta(done, { status: ['done'] }, false)).toBe(true)
    expect(filterSessionMeta(done, { status: ['todo'] }, false)).toBe(false)
  })

  it('custom status with category=closed is terminal when statusById provided', () => {
    const shipped = meta({ id: 's', sessionStatus: 'shipped' })
    const statusById = new Map([['shipped', { category: 'closed' }], ['todo', { category: 'open' }]])
    expect(filterSessionMeta(shipped, {}, { showCompleted: false, statusById })).toBe(false)
    expect(filterSessionMeta(shipped, {}, { showCompleted: true, statusById })).toBe(true)
    expect(
      filterSessionMeta(shipped, { status: ['shipped'] }, { showCompleted: false, statusById }),
    ).toBe(true)
    // Without statusById, custom id is not terminal
    expect(filterSessionMeta(shipped, {}, false)).toBe(true)
  })

  it('querySessionMetas forwards statusById for terminal filtering', () => {
    const metas = [
      meta({ id: 'a', sessionStatus: 'todo' }),
      meta({ id: 'b', sessionStatus: 'closed' }),
    ]
    const statusById = new Map([['closed', { category: 'closed' }]])
    const out = querySessionMetas(
      metas,
      {},
      { orderBy: 'rank', orderDir: 'asc', showCompleted: false },
      Date.now(),
      statusById,
    )
    expect(out.map((m) => m.id)).toEqual(['a'])
  })


  it('label chip matches any label', () => {
    const s = meta({ id: '1', labels: ['a', 'b'] })
    expect(filterSessionMeta(s, { labels: ['b'] }, true)).toBe(true)
    expect(filterSessionMeta(s, { labels: ['c'] }, true)).toBe(false)
  })
})

describe('compareSessions', () => {
  it('sorts by rank asc with id tie-break', () => {
    const a = meta({ id: 'b', rank: 'A' })
    const b = meta({ id: 'a', rank: 'A' })
    const c = meta({ id: 'c', rank: 'Z' })
    const list = [c, a, b].sort((x, y) => compareSessions(x, y, 'rank', 'asc'))
    expect(list.map((s) => s.id)).toEqual(['a', 'b', 'c'])
  })

  it('sorts priority desc (urgent first)', () => {
    const list = [
      meta({ id: 'n', priority: 'none' }),
      meta({ id: 'u', priority: 'urgent' }),
      meta({ id: 'h', priority: 'high' }),
    ].sort((x, y) => compareSessions(x, y, 'priority', 'desc'))
    expect(list.map((s) => s.id)).toEqual(['u', 'h', 'n'])
  })

  it('dueDate nulls last on asc', () => {
    const list = [
      meta({ id: 'none', dueDate: null }),
      meta({ id: 'early', dueDate: 100 }),
      meta({ id: 'late', dueDate: 200 }),
    ].sort((x, y) => compareSessions(x, y, 'dueDate', 'asc'))
    expect(list.map((s) => s.id)).toEqual(['early', 'late', 'none'])
  })
})

describe('querySessionMetas', () => {
  it('filters then sorts', () => {
    const items = [
      meta({ id: '1', sessionStatus: 'todo', rank: 'C', priority: 'low' }),
      meta({ id: '2', sessionStatus: 'done', rank: 'A', priority: 'urgent' }),
      meta({ id: '3', sessionStatus: 'todo', rank: 'B', priority: 'high' }),
    ]
    const filters: CollectionFilters = { status: ['todo'] }
    const out = querySessionMetas(items, filters, {
      orderBy: 'rank',
      orderDir: 'asc',
      showCompleted: true,
    })
    expect(out.map((s) => s.id)).toEqual(['3', '1'])
  })
})
