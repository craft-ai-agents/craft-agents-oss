import { describe, it, expect } from 'bun:test'
import { computeCollapsedPagination } from '../useSessionSearch'
import type { SessionMeta } from '@/atoms/sessions'

function makeSession(id: string, opts: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id,
    workspaceId: 'ws-1',
    sessionStatus: 'in-progress',
    lastMessageAt: Date.parse('2026-03-05T10:00:00.000Z'),
    ...opts,
  }
}

describe('computeCollapsedPagination', () => {
  it('does not hide items when current view has only one group and that group is collapsed', () => {
    const sessions = [
      makeSession('s1'),
      makeSession('s2'),
    ]

    const result = computeCollapsedPagination(
      sessions,
      50,
      new Set(['2026-03-05T00:00:00.000Z']),
      'date'
    )

    expect(result.paginatedItems.map(s => s.id)).toEqual(['s1', 's2'])
    expect(result.collapsedGroupsMeta).toEqual([])
    expect(result.hasMore).toBe(false)
  })

  it('still collapses normally when multiple groups exist', () => {
    const sessions = [
      makeSession('today', { lastMessageAt: Date.parse('2026-03-06T10:00:00.000Z') }),
      makeSession('yesterday', { lastMessageAt: Date.parse('2026-03-05T10:00:00.000Z') }),
      makeSession('older', { lastMessageAt: Date.parse('2026-03-04T10:00:00.000Z') }),
    ]

    const result = computeCollapsedPagination(
      sessions,
      50,
      new Set(['2026-03-05T00:00:00.000Z']),
      'date'
    )

    expect(result.paginatedItems.map(s => s.id)).toEqual(['today', 'older'])
    expect(result.collapsedGroupsMeta).toEqual([{ key: '2026-03-05T00:00:00.000Z', count: 1 }])
    expect(result.hasMore).toBe(false)
  })

  it('ignores collapsed keys that are not present in current view', () => {
    const sessions = [
      makeSession('a', { sessionStatus: 'in-progress' }),
      makeSession('b', { sessionStatus: 'done' }),
    ]

    const result = computeCollapsedPagination(
      sessions,
      50,
      new Set(['status-todo']),
      'status'
    )

    expect(result.paginatedItems.map(s => s.id)).toEqual(['a', 'b'])
    expect(result.collapsedGroupsMeta).toEqual([])
  })

  it('status grouping surfaces old open-work items regardless of age, capping per group (#501)', () => {
    // 3 recent "done" + 2 much older "in-progress". With a tiny global window
    // (displayLimit=2) the old in-progress items would be sliced out entirely;
    // per-group pagination must still surface them in their group.
    const sessions = [
      makeSession('done1', { sessionStatus: 'done', lastMessageAt: Date.parse('2026-03-10T10:00:00.000Z') }),
      makeSession('done2', { sessionStatus: 'done', lastMessageAt: Date.parse('2026-03-09T10:00:00.000Z') }),
      makeSession('done3', { sessionStatus: 'done', lastMessageAt: Date.parse('2026-03-08T10:00:00.000Z') }),
      makeSession('todoOld1', { sessionStatus: 'in-progress', lastMessageAt: Date.parse('2026-02-01T10:00:00.000Z') }),
      makeSession('todoOld2', { sessionStatus: 'in-progress', lastMessageAt: Date.parse('2026-01-15T10:00:00.000Z') }),
    ]

    const result = computeCollapsedPagination(sessions, 2, undefined, 'status')
    const ids = result.paginatedItems.map(s => s.id)

    // Both old in-progress items appear despite being chronologically last.
    expect(ids).toContain('todoOld1')
    expect(ids).toContain('todoOld2')
    // The "done" group is still capped per group (2 of 3 shown).
    expect(result.paginatedItems.filter(s => s.sessionStatus === 'done')).toHaveLength(2)
    // More remains because the done group overflows its per-group window.
    expect(result.hasMore).toBe(true)
  })

  it('date grouping keeps the single global chronological window (unchanged)', () => {
    const sessions = [
      makeSession('a', { lastMessageAt: Date.parse('2026-03-06T10:00:00.000Z') }),
      makeSession('b', { lastMessageAt: Date.parse('2026-03-05T10:00:00.000Z') }),
      makeSession('c', { lastMessageAt: Date.parse('2026-03-04T10:00:00.000Z') }),
    ]

    const result = computeCollapsedPagination(sessions, 2, undefined, 'date')

    expect(result.paginatedItems.map(s => s.id)).toEqual(['a', 'b'])
    expect(result.hasMore).toBe(true)
  })
})
