import { describe, it, expect } from 'bun:test'
import { startOfDay } from 'date-fns'
import {
  buildSessionFamilies,
  groupIntoFamilyUnits,
  buildFamilyRowMeta,
  familyCollapseKey,
  familyCollapseKeys,
  type FamilySessionLike,
  type FamilyUnit,
} from '../../../utils/session-families'
import type { FamilyRowMetaEntry } from '../../../utils/session-families'

/**
 * SessionList family behavior tests. SessionList's render tree is too heavy
 * for this harness (atoms, navigation, focus zones), so these tests drive the
 * exact pure pipeline SessionList.tsx consumes: buildSessionFamilies →
 * groupIntoFamilyUnits → per-bucket ordering → buildFamilyRowMeta. The date
 * bucketer below mirrors SessionList's date grouping branch one-to-one.
 */

type Item = FamilySessionLike & { hasUnread?: boolean; projectId?: string }

const s = (
  id: string,
  opts: { parent?: string; createdAt?: number; lastMessageAt?: number; hasUnread?: boolean; projectId?: string } = {},
): Item => ({
  id,
  branchFromSessionId: opts.parent,
  createdAt: opts.createdAt,
  lastMessageAt: opts.lastMessageAt,
  hasUnread: opts.hasUnread,
  projectId: opts.projectId,
})

const DAY = 24 * 60 * 60 * 1000
const BASE = startOfDay(new Date(2026, 7, 6)).getTime()

interface RenderedRow { id: string; meta?: FamilyRowMetaEntry }

/** Mirrors SessionList date-mode: family units → day buckets (by bucketItem) → sort by lastActivity desc → flatten. */
function bucketByDate(items: Item[], collapsed: Set<string>): RenderedRow[] {
  const { familyBySessionId } = buildSessionFamilies(items)
  const units = groupIntoFamilyUnits(items, familyBySessionId, collapsed)
  const byKey = new Map<string, FamilyUnit<Item>[]>()
  for (const unit of units) {
    const key = startOfDay(new Date(unit.bucketItem.lastMessageAt || 0)).toISOString()
    const bucket = byKey.get(key)
    if (bucket) bucket.push(unit)
    else byKey.set(key, [unit])
  }
  const orderedKeys = [...byKey.entries()]
    .sort(([a], [b]) => new Date(b).getTime() - new Date(a).getTime())
    .map(([key]) => key)
  const meta = buildFamilyRowMeta(units)
  const rows: RenderedRow[] = []
  for (const key of orderedKeys) {
    for (const unit of byKey.get(key)!.sort((a, b) => b.lastActivity - a.lastActivity)) {
      for (const row of unit.rows) rows.push({ id: row.id, meta: meta.get(row.id) })
    }
  }
  return rows
}

describe('SessionList family behavior (date mode)', () => {
  it('renders a branch directly below its root', () => {
    const rows = bucketByDate([
      s('root', { createdAt: 1, lastMessageAt: BASE + 100 }),
      s('b1', { parent: 'root', createdAt: 2, lastMessageAt: BASE + 200 }),
      s('other', { createdAt: 3, lastMessageAt: BASE + 300 }),
    ], new Set())
    expect(rows.map(r => r.id)).toEqual(['other', 'root', 'b1'])
    expect(rows[1].meta?.familyHead?.collapseKey).toBe('family:root')
    expect(rows[2].meta?.isFamilyBranch).toBe(true)
  })

  it('collapsing a family hides branches but keeps the root', () => {
    const items = [
      s('root', { createdAt: 1, lastMessageAt: BASE + 100 }),
      s('b1', { parent: 'root', createdAt: 2, lastMessageAt: BASE + 200 }),
    ]
    const rows = bucketByDate(items, new Set([familyCollapseKey('root')]))
    expect(rows.map(r => r.id)).toEqual(['root'])
    expect(rows[0].meta?.familyHead?.collapsed).toBe(true)
    expect(rows[0].meta?.familyHead?.branchCount).toBe(1)
  })

  it('expanding restores branch rows', () => {
    const items = [
      s('root', { createdAt: 1, lastMessageAt: BASE + 100 }),
      s('b1', { parent: 'root', createdAt: 2, lastMessageAt: BASE + 200 }),
    ]
    const expanded = bucketByDate(items, new Set())
    expect(expanded.map(r => r.id)).toEqual(['root', 'b1'])
  })

  it('family bucket is determined by the latest activity across members', () => {
    // Root is quiet on day 1, the branch is active on day 2 → the whole
    // family lands in day 2's bucket, never split across days.
    const rows = bucketByDate([
      s('root', { createdAt: 1, lastMessageAt: BASE - DAY }), // yesterday
      s('b1', { parent: 'root', createdAt: 2, lastMessageAt: BASE }), // today
      s('today-chat', { createdAt: 3, lastMessageAt: BASE + 50 }),
    ], new Set())
    expect(rows.map(r => r.id)).toEqual(['today-chat', 'root', 'b1'])
    // root and branch stayed consecutive in the today bucket
    const idx = rows.findIndex(r => r.id === 'root')
    expect(rows[idx + 1].id).toBe('b1')
  })

  it('a singleton session renders as a plain row (no chevron)', () => {
    const rows = bucketByDate([s('solo', { createdAt: 1, lastMessageAt: BASE })], new Set())
    expect(rows).toHaveLength(1)
    expect(rows[0].meta?.familyHead).toBeUndefined()
    expect(rows[0].meta?.isFamilyBranch).toBeUndefined()
  })

  it('legacy branch (no branchFromSessionId) renders as a plain chat', () => {
    const rows = bucketByDate([
      s('root', { createdAt: 1, lastMessageAt: BASE }),
      s('legacy-branch', { createdAt: 2, lastMessageAt: BASE - DAY }), // pre-feature: no parent id
    ], new Set())
    expect(rows.map(r => r.id)).toEqual(['root', 'legacy-branch'])
    expect(rows.every(r => !r.meta?.familyHead && !r.meta?.isFamilyBranch)).toBe(true)
  })

  it('Collapse All includes family keys; Expand All clears them', () => {
    const items = [
      s('root', { createdAt: 1, lastMessageAt: BASE }),
      s('b1', { parent: 'root', createdAt: 2, lastMessageAt: BASE + 1 }),
      s('solo', { createdAt: 3, lastMessageAt: BASE + 2 }),
    ]
    const { familyBySessionId } = buildSessionFamilies(items)
    // SessionList seeds collapseAllGroups with familyCollapseKeys(...)
    const allKeys = new Set([
      ...familyCollapseKeys(familyBySessionId),
      ...items.map(i => startOfDay(new Date(i.lastMessageAt || 0)).toISOString()),
    ])
    expect(allKeys.has('family:root')).toBe(true)
    expect([...allKeys].some(k => k.startsWith('family:') && k !== 'family:root')).toBe(false)
    const rows = bucketByDate(items, allKeys)
    expect(rows.find(r => r.id === 'root')?.meta?.familyHead?.collapsed).toBe(true)
    // Expand All = empty set
    const expanded = bucketByDate(items, new Set())
    expect(expanded.map(r => r.id)).toContain('b1')
  })
})

describe('SessionList family behavior (status/unread/project bucketing)', () => {
  it('unread mode: whole family lands in the bucket of its latest-activity member', () => {
    const items = [
      s('root', { createdAt: 1, lastMessageAt: BASE, hasUnread: false }),
      s('b1', { parent: 'root', createdAt: 2, lastMessageAt: BASE + 1, hasUnread: true }),
    ]
    const { familyBySessionId } = buildSessionFamilies(items)
    const units = groupIntoFamilyUnits(items, familyBySessionId, new Set())
    expect(units).toHaveLength(1)
    expect(units[0].bucketItem.hasUnread).toBe(true) // unread bucket gets the family
  })

  it('project mode: family bucketed by the project of its latest-activity member', () => {
    const items = [
      s('root', { createdAt: 1, lastMessageAt: BASE, projectId: 'p1' }),
      s('b1', { parent: 'root', createdAt: 2, lastMessageAt: BASE + 1, projectId: 'p2' }),
    ]
    const { familyBySessionId } = buildSessionFamilies(items)
    const units = groupIntoFamilyUnits(items, familyBySessionId, new Set())
    expect(units[0].bucketItem.projectId).toBe('p2')
  })
})

describe('SessionList family behavior (search mode)', () => {
  it('non-matching members are absent; matching branch without root has no chevron', () => {
    const allItems = [
      s('root', { createdAt: 1, lastMessageAt: BASE }),
      s('b1', { parent: 'root', createdAt: 2, lastMessageAt: BASE + 1 }),
      s('b2', { parent: 'root', createdAt: 3, lastMessageAt: BASE + 2 }),
    ]
    const { familyBySessionId } = buildSessionFamilies(allItems)
    // Search matched only the branches — root absent.
    const matching = allItems.filter(i => i.id !== 'root')
    const units = groupIntoFamilyUnits(matching, familyBySessionId, new Set())
    expect(units).toHaveLength(1)
    expect(units[0].head).toBeNull() // visible head renders WITHOUT chevron/count
    const meta = buildFamilyRowMeta(units)
    const rows = units.flatMap(u => u.rows)
    expect(rows.map(r => r.id)).toEqual(['b1', 'b2'])
    expect(meta.get('b1')).toBeUndefined()
    expect(meta.get('b2')?.isFamilyBranch).toBe(true)
  })
})
