/**
 * Coding-mode PR watcher: the state the chat header's PR chip renders, and the pure rules it
 * renders it by. The watcher never involves a model: the data comes from GitHub (a GitHub source's
 * token, else `gh auth token`) and local git, fetched on the workspace server.
 *
 * The data shapes are the server contract in `@craft-agent/shared/protocol` (`pr-watch.ts`). The
 * action/status rules and prompt templates live in `@craft-agent/shared/pr-watch` (the server's
 * auto-fix sends the same Fix template), re-exported here; this file adds the UI-only helpers.
 */

import type { PrState, ChecksRollup, ReviewDecision, MergeState, PrCheck, PrSummary, PrWatchState } from '@craft-agent/shared/protocol'
import { prChipStatus, type PrChipStatus } from '@craft-agent/shared/pr-watch'

export type {
  PrState,
  ChecksRollup,
  ReviewDecision,
  MergeState,
  CheckStatus,
  ReviewerState,
  PrSummary,
  PrCheck,
  PrReviewer,
  PrCommit,
  PrDetails,
  PrWatchUnavailableReason,
  PrWatchState,
  PrMergeMethod,
  PrAutoMergeState,
  PrAutoMergeBlock,
  PrEntry,
  PrWatchSessionState,
} from '@craft-agent/shared/protocol'

export {
  AUTO_FIX_INTERVAL_MS,
  autoFixApplies,
  fixChecksMessage,
  fixReviewMessage,
  hasLocalChanges,
  hasReviewFeedback,
  canFixLocally,
  pinnedCheckoutPreface,
  prCardAction,
  prCardActionMessage,
  prChipStatus,
  resolveConflictsMessage,
  type PrCardAction,
  type PrChipStatus,
} from '@craft-agent/shared/pr-watch'

/** Semantic tone; the components map it to role tokens (`merged` to GitHub's fixed purple). */
export type PrTone = 'success' | 'merged' | 'destructive' | 'info' | 'neutral'

/**
 * The chip renders only when an active PR is known (open, draft, merged or closed). Everything
 * else — not a repo, no PR, not GitHub, no credential, first lookup still running — renders nothing.
 */
export function isPrWatchVisible(state: PrWatchState | undefined): boolean {
  return state?.kind === 'pr'
}

/** GitHub's colors for PR states: open green, merged purple, closed and draft grey. */
export function prStateTone(state: PrState): PrTone {
  switch (state) {
    case 'open': return 'success'
    case 'merged': return 'merged'
    case 'closed':
    case 'draft': return 'neutral'
  }
}

export function checksTone(rollup: ChecksRollup): PrTone {
  switch (rollup) {
    case 'success': return 'success'
    case 'failure': return 'destructive'
    case 'pending': return 'info'
    case 'none': return 'neutral'
  }
}

export function reviewTone(decision: ReviewDecision): PrTone {
  switch (decision) {
    case 'approved': return 'success'
    case 'changes_requested': return 'destructive'
    case 'review_required':
    case 'none': return 'neutral'
  }
}

export function mergeTone(state: MergeState): PrTone {
  switch (state) {
    case 'clean': return 'success'
    case 'conflicting': return 'destructive'
    case 'behind':
    case 'blocked':
    case 'unstable': return 'info'
    case 'draft':
    case 'unknown': return 'neutral'
  }
}

export interface CheckCounts {
  passed: number
  failed: number
  running: number
  skipped: number
}

export function countChecks(checks: readonly PrCheck[]): CheckCounts {
  const counts: CheckCounts = { passed: 0, failed: 0, running: 0, skipped: 0 }
  for (const check of checks) {
    if (check.status === 'success') counts.passed++
    else if (check.status === 'failure') counts.failed++
    else if (check.status === 'pending') counts.running++
    else counts.skipped++
  }
  return counts
}

/** How many check rows the card lists before "+N more". */
export const CARD_CHECK_ROWS = 8

/**
 * The check rows worth a line in the card: failures first, then running checks, each group in
 * GitHub's order. Passed and skipped checks only count in the summary. `overflow` is how many
 * failing/running checks didn't fit.
 */
export function checkRowsForCard(checks: readonly PrCheck[], limit = CARD_CHECK_ROWS): { rows: PrCheck[]; overflow: number } {
  const attention = [
    ...checks.filter(check => check.status === 'failure'),
    ...checks.filter(check => check.status === 'pending'),
  ]
  return { rows: attention.slice(0, limit), overflow: Math.max(0, attention.length - limit) }
}

/** GitHub-style short sha. */
export function shortSha(sha: string): string {
  return sha.slice(0, 7)
}

/** Statuses that need attention, most urgent first (the card's action priority, see prCardAction). */
const ATTENTION: readonly PrChipStatus[] = ['resolve', 'fix', 'fix-ci']

/**
 * The most urgent attention status among PRs not in view (the chip's "+N", the card's "+N" tab), or
 * null when none needs attention: a problem on a hidden PR is never silent.
 */
export function mostUrgentStatus(summaries: readonly PrSummary[]): PrChipStatus | null {
  const statuses = new Set(summaries.map(prChipStatus))
  return ATTENTION.find(status => statuses.has(status)) ?? null
}
