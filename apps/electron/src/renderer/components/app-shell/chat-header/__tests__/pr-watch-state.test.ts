import { describe, expect, it } from 'bun:test'
import {
  checkRowsForCard,
  countChecks,
  fixChecksMessage,
  fixReviewMessage,
  isPrWatchVisible,
  mergeTone,
  mostUrgentStatus,
  prCardAction,
  prCardActionMessage,
  prChipStatus,
  prStateTone,
  resolveConflictsMessage,
  reviewTone,
  shortSha,
  type PrCheck,
  type PrDetails,
  type PrSummary,
} from '../pr-watch/pr-watch-state'

const check = (name: string, status: PrCheck['status']): PrCheck => ({ name, status })

describe('PR watch visibility', () => {
  it('shows only once a PR for the branch is known', () => {
    expect(isPrWatchVisible({ kind: 'loading' })).toBe(false)
    expect(isPrWatchVisible({ kind: 'unavailable', reason: 'not-git' })).toBe(false)
    expect(isPrWatchVisible({ kind: 'none' })).toBe(false)
    expect(isPrWatchVisible({ kind: 'unavailable', reason: 'no-token' })).toBe(false)
    expect(isPrWatchVisible(undefined)).toBe(false)
  })
})

describe('PR watch tones', () => {
  it('follows GitHub: open green, merged purple, closed and draft grey', () => {
    expect(prStateTone('open')).toBe('success')
    expect(prStateTone('merged')).toBe('merged')
    expect(prStateTone('closed')).toBe('neutral')
    expect(prStateTone('draft')).toBe('neutral')
  })
  it('flags what needs attention', () => {
    expect(reviewTone('changes_requested')).toBe('destructive')
    expect(reviewTone('review_required')).toBe('neutral')
    expect(mergeTone('conflicting')).toBe('destructive')
    expect(mergeTone('behind')).toBe('info')
    expect(mergeTone('clean')).toBe('success')
  })
})

describe('PR checks', () => {
  const checks = [
    check('lint', 'success'),
    check('e2e (macos)', 'pending'),
    check('typecheck', 'failure'),
    check('docs', 'skipped'),
    check('unit', 'failure'),
    check('build', 'success'),
  ]

  it('counts by status', () => {
    expect(countChecks(checks)).toEqual({ passed: 2, failed: 2, running: 1, skipped: 1 })
  })

  it('lists failures first, then running checks, and leaves out passed and skipped ones', () => {
    expect(checkRowsForCard(checks).rows.map(c => c.name)).toEqual(['typecheck', 'unit', 'e2e (macos)'])
    expect(checkRowsForCard(checks).overflow).toBe(0)
  })

  it('caps the rows and reports the rest', () => {
    const many = Array.from({ length: 11 }, (_, i) => check(`job-${i}`, i % 2 ? 'failure' : 'pending'))
    const { rows, overflow } = checkRowsForCard(many, 8)
    expect(rows).toHaveLength(8)
    expect(rows.slice(0, 5).every(c => c.status === 'failure')).toBe(true)
    expect(overflow).toBe(3)
  })
})

describe('shortSha', () => {
  it('keeps seven characters', () => {
    expect(shortSha('769558f6a1b2c3')).toBe('769558f')
  })
})

describe('Card actions', () => {
  const summary: PrSummary = {
    number: 481,
    title: 'PR watcher',
    url: 'https://github.com/acme/app/pull/481',
    state: 'open',
    headRef: 'feat/pr-watcher',
    baseRef: 'main',
    checks: 'success',
    reviewDecision: 'changes_requested',
    mergeState: 'blocked',
    unresolvedThreads: 3,
    localAhead: 0,
    localDirty: false,
    fetchedAt: 0,
    via: 'gh',
  }
  const details: PrDetails = {
    lastCommit: { sha: 'abc1234', headline: 'x', author: 'a', committedAt: 0 },
    checks: [],
    reviewers: [
      { login: 'octocat', state: 'changes_requested' },
      { login: 'hubot', state: 'approved' },
    ],
    additions: 1,
    deletions: 1,
    changedFiles: 1,
  }

  const clean: PrSummary = { ...summary, reviewDecision: 'approved', mergeState: 'clean', unresolvedThreads: 0 }

  it('picks one action: Resolve, then Fix, then Fix CI, then the tick', () => {
    // Conflicts win even with review comments and failing checks
    expect(prCardAction({ ...summary, checks: 'failure', mergeState: 'conflicting' })).toBe('resolve')
    // Conflict lifted: review comments next, also over failing checks
    expect(prCardAction({ ...summary, checks: 'failure' })).toBe('fix')
    expect(prCardAction({ ...clean, reviewDecision: 'review_required', unresolvedThreads: 1 })).toBe('fix')
    // Open conversations count even without "changes requested", and even after an approval
    expect(prCardAction({ ...clean, reviewDecision: 'none', unresolvedThreads: 2 })).toBe('fix')
    expect(prCardAction({ ...clean, reviewDecision: 'approved', unresolvedThreads: 1 })).toBe('fix')
    // Review addressed: failing CI
    expect(prCardAction({ ...clean, checks: 'failure' })).toBe('fix-ci')
    // All good: passed or no checks
    expect(prCardAction(clean)).toBe('ok')
    expect(prCardAction({ ...clean, checks: 'none' })).toBe('ok')
  })

  it('turns the tick orange while local work is not in the PR', () => {
    expect(prCardAction({ ...clean, localDirty: true })).toBe('unsynced')
    expect(prCardAction({ ...clean, localAhead: 2 })).toBe('unsynced')
    expect(prChipStatus({ ...clean, localDirty: true })).toBe('unsynced')
    // Anything that needs doing still comes first
    expect(prCardAction({ ...clean, localDirty: true, checks: 'failure' })).toBe('fix-ci')
    expect(prCardAction({ ...clean, localDirty: true, mergeState: 'conflicting' })).toBe('resolve')
    expect(prChipStatus({ ...clean, localDirty: true, checks: 'pending' })).toBe('pending')
    expect(prCardActionMessage('unsynced', clean, details)).toBeNull()
  })

  it('leaves the slot empty for merged/closed PRs and while checks run', () => {
    expect(prCardAction({ ...summary, state: 'merged' })).toBeNull()
    expect(prCardAction({ ...clean, state: 'closed', checks: 'failure' })).toBeNull()
    expect(prCardAction({ ...clean, checks: 'pending' })).toBeNull()
  })

  it('gives the chip the same status as the card: no tick over conflicts', () => {
    expect(prChipStatus({ ...clean, mergeState: 'conflicting' })).toBe('resolve')
    expect(prChipStatus({ ...clean, mergeState: 'conflicting', checks: 'pending' })).toBe('resolve')
    expect(prChipStatus({ ...clean, unresolvedThreads: 2 })).toBe('fix')
    expect(prChipStatus({ ...clean, checks: 'failure' })).toBe('fix-ci')
    expect(prChipStatus({ ...clean, checks: 'pending' })).toBe('pending')
    expect(prChipStatus(clean)).toBe('ok')
    expect(prChipStatus({ ...clean, state: 'merged' })).toBeNull()
  })

  it('maps each action to its prompt, and the tick to none', () => {
    expect(prCardActionMessage('resolve', summary, details)).toBe(resolveConflictsMessage(summary))
    expect(prCardActionMessage('fix', summary, details)).toBe(fixReviewMessage(summary, details))
    expect(prCardActionMessage('fix-ci', summary, details)).toBe(fixChecksMessage(summary, details))
    expect(prCardActionMessage('ok', summary, details)).toBeNull()
  })

  it('asks for a merge of the base branch, never a rebase or push', () => {
    const message = resolveConflictsMessage(summary)
    expect(message).toStartWith('Resolve the merge conflicts between `feat/pr-watcher` and `main` on pull request #481')
    expect(message).toContain("merge it into `feat/pr-watcher`. Don't rebase.")
    expect(message).toEndWith("Don't push unless I ask.")
  })

  it('lists the failing checks with their links', () => {
    const message = fixChecksMessage(summary, {
      ...details,
      checks: [
        { name: 'typecheck', status: 'failure', url: 'https://ci/1' },
        { name: 'lint', status: 'success' },
        { name: 'unit', status: 'failure' },
      ],
    })
    const lines = message.split('\n')
    expect(lines[0]).toBe('Fix the failing CI checks on pull request #481 (https://github.com/acme/app/pull/481):')
    expect(lines.slice(1, 3)).toEqual(['- typecheck (https://ci/1)', '- unit'])
    expect(message).toContain('`gh pr checks https://github.com/acme/app/pull/481`')
  })

  it('names the PR, the feedback and the branch, and keeps the agent local', () => {
    const message = fixReviewMessage(summary, details)
    expect(message).toStartWith('Fix the open review comments on pull request #481 (https://github.com/acme/app/pull/481): 3 unresolved review threads; changes requested by @octocat.')
    expect(message).toContain('`gh pr view https://github.com/acme/app/pull/481 --comments`')
    expect(message).toContain('on `feat/pr-watcher`')
    expect(message).toContain("Don't push, reply on GitHub or resolve threads unless I ask.")
  })

  it('reads naturally with one thread and no named reviewer', () => {
    const message = fixReviewMessage({ ...summary, unresolvedThreads: 1 }, { ...details, reviewers: [] })
    expect(message.split('\n')[0]).toEndWith(': 1 unresolved review thread; changes requested.')
  })
})

describe('mostUrgentStatus (the "+N" of other PRs)', () => {
  const pr = (overrides: Partial<PrSummary> = {}): PrSummary => ({
    number: 1, title: 'T', url: 'https://github.com/acme/app/pull/1', state: 'open', headRef: 'h', baseRef: 'main',
    checks: 'success', reviewDecision: 'none', mergeState: 'clean', unresolvedThreads: 0, localAhead: 0, localDirty: false,
    fetchedAt: 0, via: 'gh', ...overrides,
  })

  it('surfaces only what needs attention, in the card action order: conflicts, review, failing CI', () => {
    expect(mostUrgentStatus([])).toBeNull()
    expect(mostUrgentStatus([pr(), pr({ checks: 'pending' }), pr({ localAhead: 2 })])).toBeNull()
    expect(mostUrgentStatus([pr({ checks: 'failure' }), pr()])).toBe('fix-ci')
    expect(mostUrgentStatus([pr({ checks: 'failure' }), pr({ unresolvedThreads: 2 })])).toBe('fix')
    expect(mostUrgentStatus([pr({ unresolvedThreads: 2 }), pr({ mergeState: 'conflicting' })])).toBe('resolve')
    expect(mostUrgentStatus([pr({ state: 'merged', checks: 'failure' })])).toBeNull() // merged/closed need nothing
  })
})
