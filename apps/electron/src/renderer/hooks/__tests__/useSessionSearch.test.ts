import { describe, it, expect } from 'bun:test'
import { computeCollapsedPagination, paginateFamilies } from '../useSessionSearch'
import { buildSessionFamilies } from '@/utils/session-tree'
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

  describe('per-group windows (#501)', () => {
    const at = (iso: string) => Date.parse(iso)
    // Newest first, as the list hands them over: three recent Done, two old open sessions.
    const sessions = [
      makeSession('done1', { sessionStatus: 'done', lastMessageAt: at('2026-03-10T10:00:00.000Z') }),
      makeSession('done2', { sessionStatus: 'done', lastMessageAt: at('2026-03-09T10:00:00.000Z') }),
      makeSession('done3', { sessionStatus: 'done', lastMessageAt: at('2026-03-08T10:00:00.000Z') }),
      makeSession('open1', { sessionStatus: 'in-progress', lastMessageAt: at('2026-02-01T10:00:00.000Z') }),
      makeSession('open2', { sessionStatus: 'in-progress', lastMessageAt: at('2026-01-15T10:00:00.000Z') }),
    ]

    it('status grouping shows old open sessions and caps each group', () => {
      const result = computeCollapsedPagination(sessions, 2, undefined, 'status')

      expect(result.paginatedItems.map(s => s.id)).toEqual(['done1', 'done2', 'open1', 'open2'])
      expect(result.hasMore).toBe(true)
    })

    it('reports no more items once every group fits', () => {
      const result = computeCollapsedPagination(sessions, 3, undefined, 'status')

      expect(result.paginatedItems).toHaveLength(5)
      expect(result.hasMore).toBe(false)
    })

    it('unread grouping windows each group', () => {
      const unread = sessions.map((s, i) => ({ ...s, hasUnread: i >= 3 }))
      const result = computeCollapsedPagination(unread, 1, undefined, 'unread')

      expect(result.paginatedItems.map(s => s.id)).toEqual(['done1', 'open1'])
      expect(result.hasMore).toBe(true)
    })

    it('project grouping windows each group, sessions without a project included', () => {
      const projects = sessions.map((s, i) => ({ ...s, projectId: i < 3 ? undefined : 'p1' }))
      const result = computeCollapsedPagination(projects, 1, undefined, 'project')

      expect(result.paginatedItems.map(s => s.id)).toEqual(['done1', 'open1'])
    })

    it('a collapsed group is counted, not windowed, and the rest stay per group', () => {
      const result = computeCollapsedPagination(sessions, 1, new Set(['status-done']), 'status')

      expect(result.paginatedItems.map(s => s.id)).toEqual(['open1'])
      expect(result.collapsedGroupsMeta).toEqual([{ key: 'status-done', count: 3 }])
      expect(result.hasMore).toBe(true)
    })

    it('date grouping keeps one global window', () => {
      const result = computeCollapsedPagination(sessions, 2, undefined, 'date')

      expect(result.paginatedItems.map(s => s.id)).toEqual(['done1', 'done2'])
      expect(result.hasMore).toBe(true)
    })
  })
})

describe('paginateFamilies', () => {
  const at = (iso: string) => Date.parse(iso)
  // Newest first, as the list hands them over. The family (parent → child, branch) differs from
  // its root in every grouping: the child is newer, done, unread and in another project.
  const families = buildSessionFamilies([
    makeSession('child', {
      parentSessionId: 'parent', createdAt: 2, lastMessageAt: at('2026-03-06T10:00:00.000Z'),
      sessionStatus: 'done', hasUnread: true, projectId: 'p2',
    }),
    makeSession('solo', { lastMessageAt: at('2026-03-05T10:00:00.000Z') }),
    makeSession('parent', {
      createdAt: 1, lastMessageAt: at('2026-03-04T10:00:00.000Z'), sessionStatus: 'todo', projectId: 'p1',
    }),
    makeSession('branch', { branchFromSessionId: 'parent', createdAt: 3, lastMessageAt: at('2026-03-03T10:00:00.000Z') }),
  ])
  const none = new Set<string>()

  it('places a family by its newest member and keeps it together', () => {
    const page = paginateFamilies(families, 50, undefined, 'date', none)

    expect(page.rows.map(r => `${r.item.id}@${r.depth}`)).toEqual(['parent@0', 'child@1', 'branch@1', 'solo@0'])
    expect(page.rows.slice(0, 3).map(r => r.groupItem.lastMessageAt)).toEqual(Array(3).fill(at('2026-03-06T10:00:00.000Z')))
    expect(page.hasMore).toBe(false)
  })

  it('never splits a family across pages: the one crossing the limit is shown whole', () => {
    const page = paginateFamilies(families, 2, undefined, 'date', none)

    expect(page.rows.map(r => r.item.id)).toEqual(['parent', 'child', 'branch'])
    expect(page.hasMore).toBe(true)
  })

  it('collapses a family with the date group of its newest member, counting its sessions', () => {
    const page = paginateFamilies(families, 50, new Set(['2026-03-06T00:00:00.000Z']), 'date', none)

    expect(page.rows.map(r => r.item.id)).toEqual(['solo'])
    expect(page.collapsedGroupsMeta).toEqual([{ key: '2026-03-06T00:00:00.000Z', count: 3 }])
  })

  it("groups a family by its root's status and project, and as unread when any member is", () => {
    const collapsed = (groupKey: string, mode: 'status' | 'unread' | 'project') =>
      paginateFamilies(families, 50, new Set([groupKey]), mode, none)

    expect(collapsed('status-todo', 'status').collapsedGroupsMeta).toEqual([{ key: 'status-todo', count: 3 }])
    expect(collapsed('status-todo', 'status').rows.map(r => r.item.id)).toEqual(['solo'])
    expect(collapsed('unread-yes', 'unread').collapsedGroupsMeta).toEqual([{ key: 'unread-yes', count: 3 }])
    expect(collapsed('project-p1', 'project').collapsedGroupsMeta).toEqual([{ key: 'project-p1', count: 3 }])
  })

  it('counts families in sessions in per-group windows', () => {
    const page = paginateFamilies(families, 1, undefined, 'status', none)

    // One family per group fits the window of 1, whatever its size.
    expect(page.rows.map(r => r.item.id)).toEqual(['parent', 'child', 'branch', 'solo'])
    expect(page.hasMore).toBe(false)
  })

  it('leaves out the sessions under a collapsed row', () => {
    const page = paginateFamilies(families, 50, undefined, 'date', new Set(['parent']))

    expect(page.rows.map(r => r.item.id)).toEqual(['parent', 'solo'])
    expect(page.rows[0]).toMatchObject({ collapsed: true, descendantCount: 2 })
  })
})
