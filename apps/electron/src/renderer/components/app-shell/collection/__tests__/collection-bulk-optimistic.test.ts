import { describe, expect, it } from 'bun:test'
import type { SessionMeta } from '@/atoms/sessions'
import {
  applyOptimisticCollectionBulkOperation,
  assessBulkUpdateOutcome,
  createCollectionBulkOperationRegistry,
  createOptimisticCollectionBulkOperation,
  rollbackMatchingCollectionBulkOperation,
  snapshotVisibleEligibleSelection,
} from '../collection-bulk-optimistic'

function meta(id: string, patch: Partial<SessionMeta> = {}): SessionMeta {
  return { id, workspaceId: 'workspace-1', ...patch }
}

describe('collection bulk optimistic lifecycle', () => {
  it('snapshots only selected eligible IDs in exact visual order', () => {
    const selected = new Set(['hidden', 'b', 'a'])

    expect(snapshotVisibleEligibleSelection(selected, ['b', 'a', 'b', 'visible'])).toEqual({
      ids: ['b', 'a'],
      count: 2,
    })
  })

  it('projects label deltas and rolls back only the exact failed projection', () => {
    const before = meta('a', {
      labels: ['keep', 'remove'],
      priority: 'none',
      dueDate: null,
    })
    const source = new Map([['a', before]])
    const operation = createOptimisticCollectionBulkOperation(
      1,
      source,
      ['a'],
      {
        addLabels: ['new'],
        removeLabels: ['remove'],
        priority: 'high',
        dueDate: 42,
      },
    )

    expect(operation).not.toBeNull()
    const applied = applyOptimisticCollectionBulkOperation(source, operation!)
    const projected = applied.get('a')!
    expect(source.get('a')).toBe(before)
    expect(projected).toMatchObject({
      labels: ['keep', 'new'],
      priority: 'high',
      dueDate: 42,
    })

    const snapshot = operation!.snapshotsById.get('a')!
    expect(rollbackMatchingCollectionBulkOperation(projected, snapshot, projected)).toEqual({
      labels: ['keep', 'remove'],
      priority: 'none',
      dueDate: null,
    })
    expect(
      rollbackMatchingCollectionBulkOperation({ ...projected }, snapshot, projected),
    ).toEqual({})
  })

  it('keeps newer overlapping operations current when an older one resolves', () => {
    const source = new Map([['a', meta('a', { priority: 'none' })]])
    const first = createOptimisticCollectionBulkOperation(1, source, ['a'], { priority: 'high' })!
    const second = createOptimisticCollectionBulkOperation(2, source, ['a'], { priority: 'low' })!
    const registry = createCollectionBulkOperationRegistry()
    expect(registry.hasCurrentTargets()).toBe(false)

    registry.begin(first)
    registry.begin(second)
    expect(registry.hasCurrentTargets()).toBe(true)
    expect(registry.isCurrent(first, 'a')).toBe(false)
    expect(registry.isCurrent(second, 'a')).toBe(true)

    registry.resolve(first, 'a')
    expect(registry.isCurrent(second, 'a')).toBe(true)
    registry.resolve(second, 'a')
    expect(registry.isCurrent(second, 'a')).toBe(false)
    expect(registry.hasCurrentTargets()).toBe(false)
  })

  it('accepts only complete one-to-one outcomes', () => {
    expect(
      assessBulkUpdateOutcome(['a', 'b'], {
        ok: ['a'],
        failed: [{ id: 'b', error: 'busy' }],
      }),
    ).toEqual({ valid: true, okIds: ['a'], failedIds: ['b'] })

    expect(assessBulkUpdateOutcome(['a', 'b'], { ok: ['a'], failed: [] })).toEqual({
      valid: false,
      reason: 'bulk_outcome_malformed',
    })
    expect(
      assessBulkUpdateOutcome(['a', 'b'], {
        ok: ['a'],
        failed: [{ id: 'a', error: 'duplicate' }],
      }),
    ).toEqual({ valid: false, reason: 'bulk_outcome_malformed' })
    expect(
      assessBulkUpdateOutcome(['a'], {
        ok: ['foreign'],
        failed: [],
      }),
    ).toEqual({ valid: false, reason: 'bulk_outcome_malformed' })
  })
})
