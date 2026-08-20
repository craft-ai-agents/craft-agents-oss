/**
 * knowledge-diff.test.ts — TC-1: the KnowledgeDiff action-set invariant.
 *
 * Logic-level `bun:test` (no DOM harness), per repo convention. The
 * KnowledgeDiff footer renders ONLY by mapping over conflictActionsFor(status),
 * so the pure selector IS the rendered contract:
 * - spec 05 §3.5: the conflict face offers EXACTLY rebase / discard /
 *   openInSiyuan;
 * - spec 05 §3.4.2 (acceptance #10): no silent-overwrite action in ANY status;
 * - apply exists on the approved face only — never for non-approved statuses.
 */
import { describe, expect, it } from 'bun:test'
import type { MutationProposalStatus } from '@craft-agent/shared/protocol'
import { conflictActionsFor, type KnowledgeDiffActionId } from '../KnowledgeDiff'

const ALL_STATUSES: MutationProposalStatus[] = [
  'draft',
  'pending_review',
  'approved',
  'applying',
  'conflict',
  'applied',
  'superseded',
  'rolled_back',
]

const ALL_ACTIONS: KnowledgeDiffActionId[] = [
  'approve',
  'reject',
  'apply',
  'rebase',
  'discard',
  'openInSiyuan',
  'rollback',
]

function renderedActions(): Set<KnowledgeDiffActionId> {
  const rendered = new Set<KnowledgeDiffActionId>()
  for (const status of ALL_STATUSES) {
    for (const action of conflictActionsFor(status)) rendered.add(action)
  }
  return rendered
}

describe('conflictActionsFor', () => {
  it('conflict face offers exactly rebase / discard / openInSiyuan', () => {
    expect(conflictActionsFor('conflict')).toEqual(['rebase', 'discard', 'openInSiyuan'])
  })

  it('review faces offer approve / reject', () => {
    expect(conflictActionsFor('draft')).toEqual(['approve', 'reject'])
    expect(conflictActionsFor('pending_review')).toEqual(['approve', 'reject'])
  })

  it('apply exists only on the approved face — never for non-approved statuses', () => {
    expect(conflictActionsFor('approved')).toEqual(['apply'])
    for (const status of ALL_STATUSES) {
      if (status === 'approved') continue
      expect(conflictActionsFor(status)).not.toContain('apply')
    }
  })

  it('applied face offers rollback only', () => {
    expect(conflictActionsFor('applied')).toEqual(['rollback'])
  })

  it('in-flight and terminal faces render no actions', () => {
    for (const status of ['applying', 'superseded', 'rolled_back'] as const) {
      expect(conflictActionsFor(status)).toEqual([])
    }
  })

  it('no status ever renders a silent-overwrite action', () => {
    // If a future edit smuggles in an overwrite action id (e.g. 'overwrite',
    // 'applyAnyway'), it must appear in some status's rendered set — caught here.
    const rendered = renderedActions()
    for (const forbidden of ['overwrite', 'forceApply', 'applyAnyway', 'silentApply']) {
      expect(rendered.has(forbidden as KnowledgeDiffActionId)).toBe(false)
    }
    // And the rendered universe stays exactly the declared action union —
    // a new id (however named) breaks this set equality immediately.
    expect([...rendered].sort()).toEqual([...ALL_ACTIONS].sort())
  })
})
