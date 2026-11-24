/**
 * PR watcher fixtures for the chat header playground entries: one `PrWatchState` per scenario the
 * Coding-mode PR chip and its card have to handle. Timestamps are relative to when the module loads.
 */

import * as React from 'react'
import type {
  PrCheck,
  PrDetails,
  PrEntry,
  PrSummary,
  PrWatchState,
} from '@/components/app-shell/chat-header/pr-watch/pr-watch-state'
import type { PrAutoMergeChange, PrNavEntry, PrWatch } from '@/hooks/usePrWatch'

const MINUTE = 60_000
const now = Date.now()

const REPO = 'https://github.com/craft-ai-agents/craft-agents'

const passingChecks: PrCheck[] = [
  { name: 'typecheck:all', status: 'success', url: `${REPO}/actions/runs/1` },
  { name: 'unit (bun test)', status: 'success', url: `${REPO}/actions/runs/2` },
  { name: 'lint', status: 'success', url: `${REPO}/actions/runs/3` },
  { name: 'e2e (macos)', status: 'success', url: `${REPO}/actions/runs/4` },
  { name: 'e2e (windows)', status: 'success', url: `${REPO}/actions/runs/5` },
  { name: 'docs-site preview', status: 'skipped' },
]

const runningChecks: PrCheck[] = [
  { name: 'typecheck:all', status: 'success', url: `${REPO}/actions/runs/1` },
  { name: 'lint', status: 'success', url: `${REPO}/actions/runs/3` },
  { name: 'unit (bun test)', status: 'pending', url: `${REPO}/actions/runs/2` },
  { name: 'e2e (macos)', status: 'pending', url: `${REPO}/actions/runs/4` },
  { name: 'e2e (windows)', status: 'pending', url: `${REPO}/actions/runs/5` },
]

const failingChecks: PrCheck[] = [
  { name: 'typecheck:all', status: 'failure', url: `${REPO}/actions/runs/1` },
  { name: 'unit (bun test)', status: 'success', url: `${REPO}/actions/runs/2` },
  { name: 'lint', status: 'success', url: `${REPO}/actions/runs/3` },
  { name: 'e2e (macos)', status: 'pending', url: `${REPO}/actions/runs/4` },
  { name: 'e2e (windows)', status: 'success', url: `${REPO}/actions/runs/5` },
  { name: 'i18n locale parity', status: 'failure', url: `${REPO}/actions/runs/6` },
]

function summary(overrides: Partial<PrSummary> = {}): PrSummary {
  // The link follows the number, so each sample PR copies and opens its own URL
  const number = overrides.number ?? 481
  return {
    number,
    title: 'Coding mode: PR watcher in the chat header',
    url: `${REPO}/pull/${number}`,
    state: 'open',
    headRef: 'feat/coding-mode',
    baseRef: 'main',
    checks: 'success',
    reviewDecision: 'review_required',
    mergeState: 'blocked',
    unresolvedThreads: 0,
    localAhead: 0,
    localDirty: false,
    fetchedAt: now - 12_000,
    via: 'gh',
    ...overrides,
  }
}

function details(overrides: Partial<PrDetails> = {}): PrDetails {
  return {
    lastCommit: {
      sha: '769558f6a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
      headline: 'chore(sdk): Claude Agent SDK 0.3.296 -> 0.3.302',
      author: 'Mona Lisa',
      committedAt: now - 14 * MINUTE,
    },
    checks: passingChecks,
    reviewers: [
      { login: 'octocat', state: 'pending' },
      { login: 'monalisa', state: 'commented' },
    ],
    additions: 412,
    deletions: 88,
    changedFiles: 26,
    ...overrides,
  }
}

export type PrScenario =
  | 'open-passing'
  | 'open-running'
  | 'open-failing'
  | 'changes-requested'
  | 'open-threads'
  | 'approved-with-threads'
  | 'approved'
  | 'unpushed'
  | 'draft'
  | 'merged'
  | 'closed'
  | 'conflicting'
  | 'everything-wrong'
  | 'details-loading'
  | 'long-title'
  | 'carousel'
  | 'carousel-many'
  | 'carousel-long-numbers'
  | 'auto-fix-on'
  | 'auto-fix-watching'
  | 'auto-merge-blocked'
  | 'auto-merge-refused'
  | 'loading'
  | 'none'
  | 'no-token'
  | 'not-git'

export const PR_SCENARIOS: Record<PrScenario, PrWatchState> = {
  'open-passing': { kind: 'pr', summary: summary(), details: details() },
  'open-running': {
    kind: 'pr',
    summary: summary({ checks: 'pending', mergeState: 'unknown' }),
    details: details({ checks: runningChecks }),
  },
  'open-failing': {
    kind: 'pr',
    summary: summary({ checks: 'failure', mergeState: 'unstable' }),
    details: details({ checks: failingChecks }),
  },
  'changes-requested': {
    kind: 'pr',
    summary: summary({ reviewDecision: 'changes_requested', unresolvedThreads: 3, via: 'GitHub (source)' }),
    details: details({
      reviewers: [
        { login: 'octocat', state: 'changes_requested' },
        { login: 'monalisa', state: 'approved' },
        { login: 'hubot', state: 'commented' },
      ],
    }),
  },
  'open-threads': {
    kind: 'pr',
    summary: summary({ reviewDecision: 'review_required', unresolvedThreads: 2 }),
    details: details({
      reviewers: [
        { login: 'octocat', state: 'commented' },
        { login: 'monalisa', state: 'commented' },
      ],
    }),
  },
  'approved-with-threads': {
    kind: 'pr',
    summary: summary({ reviewDecision: 'approved', mergeState: 'clean', unresolvedThreads: 1 }),
    details: details({ reviewers: [{ login: 'octocat', state: 'approved' }] }),
  },
  approved: {
    kind: 'pr',
    summary: summary({ reviewDecision: 'approved', mergeState: 'clean' }),
    details: details({ reviewers: [{ login: 'octocat', state: 'approved' }] }),
  },
  unpushed: {
    kind: 'pr',
    summary: summary({ mergeState: 'behind', localAhead: 2, localDirty: true }),
    details: details(),
  },
  draft: {
    kind: 'pr',
    summary: summary({ state: 'draft', checks: 'pending', title: 'WIP: PR watcher RPCs and token chain' }),
    details: details({ checks: runningChecks, reviewers: [] }),
  },
  merged: {
    kind: 'pr',
    summary: summary({ state: 'merged', reviewDecision: 'approved', mergeState: 'clean' }),
    details: details({ reviewers: [{ login: 'octocat', state: 'approved' }] }),
  },
  closed: {
    kind: 'pr',
    summary: summary({ state: 'closed', checks: 'failure', reviewDecision: 'none', mergeState: 'unknown' }),
    details: details({ checks: failingChecks, reviewers: [] }),
  },
  conflicting: {
    kind: 'pr',
    summary: summary({ mergeState: 'conflicting' }),
    details: details(),
  },
  'everything-wrong': {
    kind: 'pr',
    summary: summary({ checks: 'failure', reviewDecision: 'changes_requested', unresolvedThreads: 2, mergeState: 'conflicting' }),
    details: details({
      checks: failingChecks,
      reviewers: [{ login: 'octocat', state: 'changes_requested' }],
    }),
  },
  'details-loading': { kind: 'pr', summary: summary({ checks: 'pending' }) },
  // Auto-fix on (see AUTO_FIX_ON): with open comments the Fix button works and its wrench turns;
  // with nothing to fix the turning wrench alone says it's watching.
  'auto-fix-on': {
    kind: 'pr',
    summary: summary({ reviewDecision: 'review_required', unresolvedThreads: 2 }),
    details: details({ reviewers: [{ login: 'octocat', state: 'commented' }] }),
  },
  'auto-fix-watching': {
    kind: 'pr',
    summary: summary({ reviewDecision: 'approved', mergeState: 'clean' }),
    details: details({ reviewers: [{ login: 'octocat', state: 'approved' }] }),
  },
  // GitHub won't take auto-merge here: the switch is off and says why
  'auto-merge-blocked': {
    kind: 'pr',
    summary: summary({ reviewDecision: 'approved', mergeState: 'clean', autoMergeBlocked: 'repo-disabled' }),
    details: details({ reviewers: [{ login: 'octocat', state: 'approved' }] }),
  },
  // Checks still running, so the switch is on offer, but GitHub refuses (see AUTO_MERGE_REFUSAL)
  'auto-merge-refused': {
    kind: 'pr',
    summary: summary({ checks: 'pending', mergeState: 'blocked' }),
    details: details({ checks: runningChecks }),
  },
  // The carousel scenario's first (branch) PR; the other two come from PR_MULTI below.
  carousel: {
    kind: 'pr',
    summary: summary({ checks: 'failure', mergeState: 'unstable' }),
    details: details({ checks: failingChecks }),
  },
  // The many-PR scenarios' first (branch) PRs; the rest come from PR_MULTI below.
  'carousel-many': { kind: 'pr', summary: summary({ number: 510 }), details: details() },
  'carousel-long-numbers': { kind: 'pr', summary: summary({ number: 48213 }), details: details() },
  'long-title': {
    kind: 'pr',
    summary: summary({
      number: 12873,
      title: 'Session continuation: keep the stale-auth retry and the path asymmetry fix together so the follow-up PR stays reviewable',
      headRef: 'bugfix/session-continuation-stale-auth-and-path-asymmetry',
    }),
    details: details(),
  },
  loading: { kind: 'loading' },
  none: { kind: 'none' },
  'no-token': { kind: 'unavailable', reason: 'no-token' },
  'not-git': { kind: 'unavailable', reason: 'not-git' },
}

export const PR_SCENARIO_OPTIONS: Array<{ label: string; value: PrScenario }> = [
  { label: 'Open · checks passing', value: 'open-passing' },
  { label: 'Open · checks running', value: 'open-running' },
  { label: 'Open · checks failing', value: 'open-failing' },
  { label: 'Changes requested (3 threads)', value: 'changes-requested' },
  { label: 'Comments only (2 open threads)', value: 'open-threads' },
  { label: 'Approved, 1 open thread', value: 'approved-with-threads' },
  { label: 'Approved · ready to merge', value: 'approved' },
  { label: 'Unpushed commits + dirty tree', value: 'unpushed' },
  { label: 'Draft', value: 'draft' },
  { label: 'Merged', value: 'merged' },
  { label: 'Closed', value: 'closed' },
  { label: 'Merge conflicts', value: 'conflicting' },
  { label: 'Conflicts + review + failing CI', value: 'everything-wrong' },
  { label: 'Card details loading', value: 'details-loading' },
  { label: 'Long title + branch', value: 'long-title' },
  { label: 'Carousel · 3 PRs (branch + 2 bound)', value: 'carousel' },
  { label: 'Carousel · 7 PRs (tabs overflow, hidden ✗)', value: 'carousel-many' },
  { label: 'Carousel · 5 PRs, 5-digit numbers', value: 'carousel-long-numbers' },
  { label: 'Auto-fix on · comments to fix', value: 'auto-fix-on' },
  { label: 'Auto-fix on · watching (nothing to fix)', value: 'auto-fix-watching' },
  { label: 'Auto-merge off for the repository', value: 'auto-merge-blocked' },
  { label: 'Auto-merge refused by GitHub (click it)', value: 'auto-merge-refused' },
  { label: 'First lookup running (hidden)', value: 'loading' },
  { label: 'No PR for the branch (hidden)', value: 'none' },
  { label: 'Not a git repo (hidden)', value: 'not-git' },
  { label: 'No GitHub credential (hidden)', value: 'no-token' },
]

/**
 * What GitHub answers the 'auto-merge-refused' scenario's switch with: its recorded refusal, as when the
 * repository's setting was turned off after the last poll (the card passes GitHub's message through).
 */
const AUTO_MERGE_REFUSAL = 'Auto merge is not allowed for this repository'

/** Scenarios that start with auto-fix on (the card's Fix toggle). */
const AUTO_FIX_ON: ReadonlySet<PrScenario> = new Set(['auto-fix-on', 'auto-fix-watching'])

interface MockEntry {
  origin: PrEntry['origin']
  state: PrWatchState
}

/** Scenarios that show more than one PR (the carousel): a branch PR plus bound PRs. */
const PR_MULTI: Partial<Record<PrScenario, MockEntry[]>> = {
  carousel: [
    { origin: 'branch', state: { kind: 'pr', summary: summary({ checks: 'failure', mergeState: 'unstable' }), details: details({ checks: failingChecks }) } },
    {
      origin: 'bound',
      state: {
        kind: 'pr',
        summary: summary({ number: 502, title: 'Bump dependency X to 2.0', headRef: 'deps/x-2', reviewDecision: 'approved', mergeState: 'clean', autoMerge: { enabled: true, method: 'squash' } }),
        details: details({ reviewers: [{ login: 'octocat', state: 'approved' }] }),
      },
    },
    {
      origin: 'bound',
      state: {
        kind: 'pr',
        summary: summary({ number: 468, title: 'Docs: coding mode guide', headRef: 'docs/coding', unresolvedThreads: 2 }),
        details: details(),
      },
    },
  ],
  // More PRs than the card's tabs fit: three tabs, then "+4" carrying the hidden failing PR's ✗
  'carousel-many': [
    { origin: 'branch', state: PR_SCENARIOS['carousel-many'] },
    bound(502, 'Bump dependency X to 2.0', { reviewDecision: 'approved', mergeState: 'clean' }),
    bound(468, 'Docs: coding mode guide', { state: 'draft', mergeState: 'draft' }),
    bound(491, 'chore(deps): bump Claude Agent SDK'),
    bound(493, 'feat(webui): session list filters', { checks: 'failure', mergeState: 'unstable' }),
    bound(494, 'docs: worktree picker guide', { state: 'draft', mergeState: 'draft' }),
    bound(495, 'fix(pi): retry on 529', { checks: 'pending', mergeState: 'unknown' }),
  ],
  // Long numbers: fewer tabs fit; one hidden PR has review feedback, one is merged
  'carousel-long-numbers': [
    { origin: 'branch', state: PR_SCENARIOS['carousel-long-numbers'] },
    bound(48215, 'Upgrade the session store schema'),
    bound(48220, 'Experimental: streaming diffs', { state: 'draft', mergeState: 'draft' }),
    bound(48231, 'Fix flaky upload test', { unresolvedThreads: 2 }),
    bound(48240, 'Release 4.2', { state: 'merged' }),
  ],
}

/** A pinned PR for the many-PR scenarios. */
function bound(number: number, title: string, overrides: Partial<PrSummary> = {}): MockEntry {
  return { origin: 'bound', state: { kind: 'pr', summary: summary({ number, title, headRef: `pr/${number}`, ...overrides }), details: details() } }
}

/**
 * The playground's stand-in for the `usePrWatch` hook: the active entry's state, a Refresh that shows
 * `refreshing` for a moment, (for multi-PR scenarios) working tabs, and an auto-merge switch that
 * answers like GitHub after a moment (refused in 'auto-merge-refused'). Unpin is a no-op here.
 */
export function useMockPrWatch(scenario: PrScenario): PrWatch {
  const entries = React.useMemo<MockEntry[]>(
    () => PR_MULTI[scenario] ?? [{ origin: 'branch', state: PR_SCENARIOS[scenario] }],
    [scenario],
  )
  const [index, setIndex] = React.useState(0)
  const [refreshing, setRefreshing] = React.useState(false)
  const [autoFixOn, setAutoFixOn] = React.useState(() => AUTO_FIX_ON.has(scenario))
  React.useEffect(() => { setAutoFixOn(AUTO_FIX_ON.has(scenario)) }, [scenario])
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  React.useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])
  React.useEffect(() => { setIndex(0) }, [scenario])
  // Auto-merge as the mock "GitHub" last set it, per active PR; null shows the scenario's own state
  const [autoMergeOn, setAutoMergeOn] = React.useState<boolean | null>(null)
  React.useEffect(() => { setAutoMergeOn(null) }, [scenario, index])

  const refresh = React.useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setRefreshing(true)
    timerRef.current = setTimeout(() => setRefreshing(false), 900)
  }, [])

  const activeIndex = Math.min(index, entries.length - 1)
  const activeEntry = entries[activeIndex]!
  const navEntries = React.useMemo<PrNavEntry[]>(() => entries.flatMap((entry, i) => (
    entry.state.kind === 'pr' ? [{ id: `github.com/acme/app#${entry.state.summary.number}-${i}`, origin: entry.origin, summary: entry.state.summary }] : []
  )), [entries])

  const state = React.useMemo<PrWatchState>(() => {
    if (activeEntry.state.kind !== 'pr') return activeEntry.state
    const { autoMerge: scenarioAutoMerge, ...rest } = activeEntry.state.summary
    const autoMerge = autoMergeOn === null ? scenarioAutoMerge : autoMergeOn ? { enabled: true, method: 'merge' as const } : undefined
    const summary = { ...rest, ...(autoMerge ? { autoMerge } : {}) }
    return refreshing
      ? { ...activeEntry.state, summary, refreshing: true, details: undefined }
      : { ...activeEntry.state, summary: { ...summary, fetchedAt: Date.now() - 12_000 } }
  }, [activeEntry, refreshing, autoMergeOn])

  const setAutoMerge = React.useCallback(async (_ref: string, enabled: boolean): Promise<PrAutoMergeChange> => {
    await new Promise(resolve => setTimeout(resolve, 400))
    if (scenario === 'auto-merge-refused') return { ok: false, error: AUTO_MERGE_REFUSAL }
    setAutoMergeOn(enabled)
    return { ok: true }
  }, [scenario])

  return {
    state,
    nav: {
      index: activeIndex,
      count: entries.length,
      entries: navEntries,
      onSelect: (next: number) => setIndex(Math.max(0, Math.min(next, entries.length - 1))),
    },
    activeOrigin: activeEntry.origin,
    refresh,
    onCardOpenChange: NOOP,
    unbind: NOOP,
    setAutoMerge,
    autoFix: autoFixOn ? { enabled: true, lastRunAt: now - 4 * MINUTE } : { enabled: false },
    setAutoFix: setAutoFixOn,
  }
}

const NOOP = () => {}

