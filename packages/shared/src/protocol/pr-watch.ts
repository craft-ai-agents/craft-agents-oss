/**
 * PR watcher contract (Coding mode): what the workspace server's watcher pushes to the chat header's
 * PR chip and returns for its card. Pure types, safe to import from the renderer.
 *
 * Server: packages/server-core/src/services/pr-watch/. UI rules (chip status, card action, prompts):
 * apps/electron/src/renderer/components/app-shell/chat-header/pr-watch/pr-watch-state.ts.
 */

export type PrState = 'open' | 'draft' | 'merged' | 'closed'
/** GitHub's check rollup for the head commit; `none` when the commit has no checks. */
export type ChecksRollup = 'pending' | 'success' | 'failure' | 'none'
export type ReviewDecision = 'approved' | 'changes_requested' | 'review_required' | 'none'
/** GitHub's `mergeStateStatus`, collapsed to what the card says. */
export type MergeState = 'clean' | 'behind' | 'blocked' | 'conflicting' | 'unstable' | 'draft' | 'unknown'
export type CheckStatus = 'success' | 'failure' | 'pending' | 'skipped'
export type ReviewerState = 'approved' | 'changes_requested' | 'commented' | 'pending'
/** How GitHub will merge the PR (auto-merge, or what the agent's tool requests). */
export type PrMergeMethod = 'merge' | 'squash' | 'rebase'

/** GitHub auto-merge (`autoMergeRequest`): set when a merge is queued to fire once checks pass. */
export interface PrAutoMergeState {
  enabled: boolean
  /** The method GitHub will use when it fires, when known */
  method?: PrMergeMethod
}

/**
 * Why GitHub won't turn auto-merge on for a PR right now (`viewerCanEnableAutoMerge` is false): the
 * repository has auto-merge off, the PR is a draft, it can be merged as it is (GitHub only queues a
 * merge while required checks or reviews are pending), or a reason GitHub doesn't give (e.g. no
 * write access).
 */
export type PrAutoMergeBlock = 'repo-disabled' | 'draft' | 'mergeable' | 'unavailable'

/**
 * What the poll fetches: everything the chip's status glyph and the card's action depend on, so the
 * two always agree (see {@link prCardAction}). One small GraphQL query.
 */
export interface PrSummary {
  number: number
  title: string
  url: string
  state: PrState
  headRef: string
  baseRef: string
  checks: ChecksRollup
  reviewDecision: ReviewDecision
  mergeState: MergeState
  /** Review threads not marked resolved */
  unresolvedThreads: number
  /** Local commits on the branch that the PR head doesn't have yet (local git, no GitHub call) */
  localAhead: number
  /** The working folder has uncommitted changes (local git) */
  localDirty: boolean
  /** Epoch ms of the fetch */
  fetchedAt: number
  /** Which credential answered ("gh", or the GitHub source's name): shown in the card footer */
  via: string
  /** GitHub auto-merge state, when the fetch includes it; absent means off/unknown */
  autoMerge?: PrAutoMergeState
  /** Set while auto-merge is off and GitHub won't turn it on: the card disables its switch and says why */
  autoMergeBlocked?: PrAutoMergeBlock
}

export interface PrCheck {
  name: string
  status: CheckStatus
  url?: string
}

export interface PrReviewer {
  login: string
  state: ReviewerState
}

export interface PrCommit {
  sha: string
  headline: string
  author: string
  /** Epoch ms */
  committedAt: number
}

/** What the card adds when it opens. */
export interface PrDetails {
  lastCommit: PrCommit
  checks: PrCheck[]
  reviewers: PrReviewer[]
  additions: number
  deletions: number
  changedFiles: number
}

export type PrWatchUnavailableReason = 'not-git' | 'not-github' | 'no-token' | 'error'

export type PrWatchState =
  /** First lookup in flight: renders nothing, like `none` */
  | { kind: 'loading' }
  /** The branch has no PR */
  | { kind: 'none' }
  | { kind: 'unavailable'; reason: PrWatchUnavailableReason }
  /** `details` is absent until the card has loaded them; `refreshing` while a refetch runs */
  | { kind: 'pr'; summary: PrSummary; details?: PrDetails; refreshing?: boolean }

// ── Multi-PR (a session can track its branch PR plus several bound PRs) ───────

/**
 * A PR pinned to a session, persisted on the session record (`Session.boundPrs`). Minimal
 * coordinates only — the live state is refetched by the watcher. Ordering/dedup use `addedAt`.
 */
export interface BoundPr {
  /** Lower-cased host, e.g. `github.com` */
  host: string
  owner: string
  repo: string
  number: number
  /** Epoch ms when bound: orders the carousel after the branch PR */
  addedAt: number
}

/**
 * One PR in a session's carousel: a resolved {@link PrSummary} plus where it came from. `id` is
 * stable across pushes (`host/owner/repo#number`), so the renderer can keep the active entry and
 * merge lazily-loaded `details` / local `refreshing` onto it.
 */
export interface PrEntry {
  id: string
  /** `branch` = discovered from the checkout's branch; `bound` = pinned via pr_bind */
  origin: 'branch' | 'bound'
  summary: PrSummary
  /** Auto-fix (the card's Fix toggle) is on for this PR in this session */
  autoFix?: boolean
  /** Epoch ms of the last auto-fix run for this PR, when one ran */
  autoFixLastRunAt?: number
  /** Filled by the renderer from prWatch:getDetails when the card opens */
  details?: PrDetails
  /** Renderer-side: a refetch is in flight */
  refreshing?: boolean
}

/**
 * A session's per-PR monitor state, persisted on the session record (`Session.prMonitors`, keyed by
 * the PR's `PrEntry.id`): it covers the branch PR and bound PRs alike. `lastFixSignature` is the
 * review feedback the last auto-fix acted on (see `hasNewReviewFeedback`), so a restart never
 * re-fixes feedback that was already handled.
 */
export interface PrMonitorState {
  /** Auto-fix new review feedback (checked every 5 min while the app runs) */
  autoFix?: boolean
  /** Epoch ms of the last auto-fix run */
  lastFixAt?: number
  /** Review signature tokens the last run acted on */
  lastFixSignature?: string[]
}

/** Result of `prWatch:setAutoFix` (the card's Fix toggle). */
export interface PrAutoFixResult {
  ok: boolean
  error?: string
  enabled?: boolean
}

/**
 * What the server pushes per session (`prWatch:changed`): every PR the session tracks, deduped by
 * `id`. `ready` carries ≥1 resolved entry (branch PR first, then bound PRs by `addedAt`). The other
 * kinds mean nothing resolved and mirror the branch target's state, so the chip stays hidden exactly
 * as it does today for a single PR.
 */
export type PrWatchSessionState =
  | { kind: 'loading' }
  | { kind: 'none' }
  | { kind: 'unavailable'; reason: PrWatchUnavailableReason }
  | { kind: 'ready'; prs: PrEntry[] }
