import { describe, it, expect } from 'bun:test'
import {
  buildSessionFamilies,
  groupIntoFamilyUnits,
  buildFamilyRowMeta,
  familyCollapseKey,
  familyCollapseKeys,
  type FamilySessionLike,
} from '../session-families'

const s = (
  id: string,
  opts: { parent?: string; createdAt?: number; lastMessageAt?: number } = {},
): FamilySessionLike => ({
  id,
  branchFromSessionId: opts.parent,
  createdAt: opts.createdAt,
  lastMessageAt: opts.lastMessageAt,
})

const NO_COLLAPSED = new Set<string>()

describe('buildSessionFamilies', () => {
  it('builds a basic family: root first, branches after', () => {
    const { families, familyBySessionId } = buildSessionFamilies([
      s('root', { createdAt: 1, lastMessageAt: 10 }),
      s('b1', { parent: 'root', createdAt: 2, lastMessageAt: 20 }),
    ])
    expect(families).toHaveLength(1)
    const fam = familyBySessionId.get('b1')!
    expect(fam.rootId).toBe('root')
    expect(fam.memberIds).toEqual(['root', 'b1'])
    expect(fam.isSingleton).toBe(false)
    expect(familyBySessionId.get('root')).toBe(fam)
  })

  it('flattens branch-of-branch into the top root family', () => {
    const { familyBySessionId } = buildSessionFamilies([
      s('root', { createdAt: 1 }),
      s('b1', { parent: 'root', createdAt: 2 }),
      s('b2', { parent: 'b1', createdAt: 3 }),
    ])
    expect(familyBySessionId.size).toBe(3)
    const fam = familyBySessionId.get('b2')!
    expect(fam.rootId).toBe('root')
    expect(fam.memberIds).toEqual(['root', 'b1', 'b2'])
    expect(familyBySessionId.get('b1')).toBe(fam)
  })

  it('orphan branch (parent missing from items) becomes its own root', () => {
    const { families, familyBySessionId } = buildSessionFamilies([
      s('orphan', { parent: 'deleted-parent', createdAt: 1 }),
    ])
    expect(families).toHaveLength(1)
    expect(families[0].rootId).toBe('orphan')
    expect(families[0].isSingleton).toBe(true)
    expect(familyBySessionId.get('orphan')!.memberIds).toEqual(['orphan'])
  })

  it('cuts cycles: node in the cycle becomes the root', () => {
    const { familyBySessionId } = buildSessionFamilies([
      s('a', { parent: 'b', createdAt: 1 }),
      s('b', { parent: 'a', createdAt: 2 }),
    ])
    // Both resolve to a root within the cycle; no crash, no infinite walk.
    const famA = familyBySessionId.get('a')!
    const famB = familyBySessionId.get('b')!
    expect(famA).toBe(famB)
    expect(famA.memberIds).toHaveLength(2)

    const { familyBySessionId: self } = buildSessionFamilies([
      s('self', { parent: 'self', createdAt: 1 }),
    ])
    expect(self.get('self')!.rootId).toBe('self')
    expect(self.get('self')!.isSingleton).toBe(true)
  })

  it('legacy branch without branchFromSessionId is a singleton', () => {
    const { familyBySessionId } = buildSessionFamilies([
      s('root', { createdAt: 1 }),
      s('legacy', { createdAt: 2 }), // pre-feature branch: no parent id
    ])
    expect(familyBySessionId.get('legacy')!.isSingleton).toBe(true)
    expect(familyBySessionId.get('root')!.isSingleton).toBe(true)
  })

  it('orders branches by createdAt asc with id tie-break', () => {
    const { familyBySessionId } = buildSessionFamilies([
      s('root', { createdAt: 1 }),
      s('b-late', { parent: 'root', createdAt: 5 }),
      s('b-early-2', { parent: 'root', createdAt: 2 }),
      s('b-early-1', { parent: 'root', createdAt: 2 }),
    ])
    expect(familyBySessionId.get('root')!.memberIds).toEqual([
      'root', 'b-early-1', 'b-early-2', 'b-late',
    ])
  })

  it('aggregates lastActivity as the max lastMessageAt across members', () => {
    const { familyBySessionId } = buildSessionFamilies([
      s('root', { lastMessageAt: 100 }),
      s('b1', { parent: 'root', lastMessageAt: 500 }),
      s('b2', { parent: 'root' }), // no activity → 0
    ])
    expect(familyBySessionId.get('root')!.lastActivity).toBe(500)
  })
})

describe('groupIntoFamilyUnits', () => {
  const fam = () => buildSessionFamilies([
    s('root', { createdAt: 1, lastMessageAt: 100 }),
    s('b1', { parent: 'root', createdAt: 2, lastMessageAt: 200 }),
    s('b2', { parent: 'root', createdAt: 3, lastMessageAt: 300 }),
  ]).familyBySessionId

  it('keeps family members consecutive: root first, branches below', () => {
    const units = groupIntoFamilyUnits(
      [s('other', { lastMessageAt: 999 }), s('b2', { createdAt: 3, lastMessageAt: 300 }), s('root', { createdAt: 1, lastMessageAt: 100 })],
      fam(),
      NO_COLLAPSED,
    )
    const famUnit = units.find(u => u.head)!
    expect(famUnit.rows.map(r => r.id)).toEqual(['root', 'b2']) // b1 not present → skipped
    expect(famUnit.branchIds).toEqual(['b2'])
    expect(famUnit.head!.collapseKey).toBe('family:root')
    expect(famUnit.head!.branchCount).toBe(1)
  })

  it('bucketItem is the member with the latest activity (family stays in one bucket)', () => {
    const units = groupIntoFamilyUnits(
      [s('root', { createdAt: 1, lastMessageAt: 100 }), s('b1', { createdAt: 2, lastMessageAt: 200 })],
      fam(),
      NO_COLLAPSED,
    )
    const famUnit = units.find(u => u.head)!
    expect(famUnit.bucketItem.id).toBe('b1')
    expect(famUnit.lastActivity).toBe(200)
  })

  it('collapsed family hides branches, keeps the root', () => {
    const units = groupIntoFamilyUnits(
      [s('root', { createdAt: 1, lastMessageAt: 100 }), s('b1', { createdAt: 2, lastMessageAt: 200 })],
      fam(),
      new Set([familyCollapseKey('root')]),
    )
    const famUnit = units.find(u => u.head)!
    expect(famUnit.rows.map(r => r.id)).toEqual(['root'])
    expect(famUnit.head!.collapsed).toBe(true)
    expect(famUnit.branchIds).toEqual([])
  })

  it('expanding restores branch rows', () => {
    const all = [s('root', { createdAt: 1, lastMessageAt: 100 }), s('b1', { createdAt: 2, lastMessageAt: 200 })]
    const families = fam()
    const collapsed = groupIntoFamilyUnits(all, families, new Set([familyCollapseKey('root')]))
    const expanded = groupIntoFamilyUnits(all, families, NO_COLLAPSED)
    expect(collapsed.find(u => u.head)!.rows).toHaveLength(1)
    expect(expanded.find(u => u.head)!.rows.map(r => r.id)).toEqual(['root', 'b1'])
  })

  it('root absent (search): first present branch is visible head without chevron', () => {
    const units = groupIntoFamilyUnits(
      [s('b1', { createdAt: 2, lastMessageAt: 200 }), s('b2', { createdAt: 3, lastMessageAt: 300 })],
      fam(),
      NO_COLLAPSED,
    )
    expect(units).toHaveLength(1)
    expect(units[0].head).toBeNull()
    expect(units[0].rows.map(r => r.id)).toEqual(['b1', 'b2'])
    expect(units[0].branchIds).toEqual(['b2'])
  })

  it('root-absent families ignore collapse state', () => {
    const units = groupIntoFamilyUnits(
      [s('b1', { createdAt: 2, lastMessageAt: 200 })],
      fam(),
      NO_COLLAPSED,
    )
    expect(units[0].head).toBeNull()
    expect(units[0].rows.map(r => r.id)).toEqual(['b1'])
  })

  it('singleton unit: no head, no branches (renders as plain chat)', () => {
    const units = groupIntoFamilyUnits([s('solo', { createdAt: 1 })], fam(), NO_COLLAPSED)
    expect(units[0]).toMatchObject({ head: null, branchIds: [], rows: [{ id: 'solo' }] })
  })
})

describe('buildFamilyRowMeta', () => {
  it('marks the head row and branch rows', () => {
    const families = buildSessionFamilies([
      s('root', { createdAt: 1 }),
      s('b1', { parent: 'root', createdAt: 2 }),
    ]).familyBySessionId
    const units = groupIntoFamilyUnits(
      [s('root', { createdAt: 1 }), s('b1', { createdAt: 2 })],
      families,
      NO_COLLAPSED,
    )
    const meta = buildFamilyRowMeta(units)
    expect(meta.get('root')!.familyHead!.collapseKey).toBe('family:root')
    expect(meta.get('b1')!.isFamilyBranch).toBe(true)
  })
})

describe('familyCollapseKeys', () => {
  it('returns keys only for multi-member families', () => {
    const { familyBySessionId } = buildSessionFamilies([
      s('root', { createdAt: 1 }),
      s('b1', { parent: 'root', createdAt: 2 }),
      s('solo', { createdAt: 3 }),
    ])
    expect(familyCollapseKeys(familyBySessionId)).toEqual(['family:root'])
  })
})
