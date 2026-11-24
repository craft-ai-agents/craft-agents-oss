/**
 * GitHub GraphQL responses → the PR watcher contract (`@craft-agent/shared/protocol` pr-watch).
 * Pure, so every mapping rule is unit-tested against recorded responses.
 */

import type {
  CheckStatus,
  ChecksRollup,
  MergeState,
  PrAutoMergeBlock,
  PrCheck,
  PrDetails,
  PrMergeMethod,
  PrReviewer,
  PrState,
  PrSummary,
  ReviewDecision,
  ReviewerState,
} from '@craft-agent/shared/protocol'
import type { GqlCheckContext, GqlMergeMethod, GqlPullRequestDetails, GqlPullRequestSummary, GqlRepoMergeSettings, GqlReviewSignaturePr, GqlRollupState } from './github-queries'

/**
 * The branch's PR among GitHub's matches (newest first): `headRefName` alone also matches same-named
 * branches pushed from other forks, so only PRs whose head lives in `headOwner` count (a deleted head
 * repo reports no owner and is kept). An open PR wins over newer closed/merged ones.
 */
export function pickPullRequest(nodes: readonly GqlPullRequestSummary[], headOwner: string): GqlPullRequestSummary | null {
  const owner = headOwner.toLowerCase()
  const ours = nodes.filter(node => !node.headRepositoryOwner || node.headRepositoryOwner.login.toLowerCase() === owner)
  return ours.find(node => node.state === 'OPEN') ?? ours[0] ?? null
}

export function mapPrState(node: Pick<GqlPullRequestSummary, 'state' | 'isDraft'>): PrState {
  if (node.state === 'MERGED') return 'merged'
  if (node.state === 'CLOSED') return 'closed'
  return node.isDraft ? 'draft' : 'open'
}

export function mapRollup(state: GqlRollupState | null | undefined): ChecksRollup {
  switch (state) {
    case 'SUCCESS': return 'success'
    case 'FAILURE':
    case 'ERROR': return 'failure'
    case 'PENDING':
    case 'EXPECTED': return 'pending'
    default: return 'none'
  }
}

export function mapReviewDecision(decision: GqlPullRequestSummary['reviewDecision']): ReviewDecision {
  switch (decision) {
    case 'APPROVED': return 'approved'
    case 'CHANGES_REQUESTED': return 'changes_requested'
    case 'REVIEW_REQUIRED': return 'review_required'
    default: return 'none'
  }
}

/** `mergeable: CONFLICTING` is authoritative for conflicts; `mergeStateStatus` says the rest. */
export function mapMergeState(node: Pick<GqlPullRequestSummary, 'mergeable' | 'mergeStateStatus'>): MergeState {
  if (node.mergeable === 'CONFLICTING' || node.mergeStateStatus === 'DIRTY') return 'conflicting'
  switch (node.mergeStateStatus) {
    case 'CLEAN':
    case 'HAS_HOOKS': return 'clean'
    case 'BEHIND': return 'behind'
    case 'BLOCKED': return 'blocked'
    case 'UNSTABLE': return 'unstable'
    case 'DRAFT': return 'draft'
    default: return 'unknown'
  }
}

export function mapMergeMethod(method: GqlMergeMethod): PrMergeMethod {
  switch (method) {
    case 'SQUASH': return 'squash'
    case 'REBASE': return 'rebase'
    default: return 'merge'
  }
}

/**
 * Why GitHub won't turn auto-merge on (`viewerCanEnableAutoMerge` is false), or undefined when it
 * would, when it's already on (it can be turned off) or when the PR isn't open. GitHub only queues a
 * merge while required checks or reviews are pending, so a PR it could merge now is refused too.
 */
export function mapAutoMergeBlock(
  node: Pick<GqlPullRequestSummary, 'state' | 'isDraft' | 'mergeStateStatus' | 'autoMergeRequest' | 'viewerCanEnableAutoMerge' | 'baseRepository'>,
): PrAutoMergeBlock | undefined {
  if (node.autoMergeRequest || node.viewerCanEnableAutoMerge || node.state !== 'OPEN') return undefined
  if (node.baseRepository && !node.baseRepository.autoMergeAllowed) return 'repo-disabled'
  if (node.isDraft) return 'draft'
  if (node.mergeStateStatus === 'CLEAN' || node.mergeStateStatus === 'HAS_HOOKS' || node.mergeStateStatus === 'UNSTABLE') return 'mergeable'
  return 'unavailable'
}

const AUTO_MERGE_BLOCK_REASON: Record<PrAutoMergeBlock, string> = {
  'repo-disabled': 'auto-merge is off for this repository (turn on "Allow auto-merge" in its GitHub settings)',
  draft: 'it is a draft (mark it ready for review first)',
  mergeable: 'nothing is pending: GitHub only queues auto-merge while required checks or reviews are outstanding, and this PR can be merged now',
  unavailable: 'GitHub won\'t enable it with this credential (it may lack write access)',
}

/** The refusal `setAutoMerge` reports (the agent's tool and the card show it). */
export function autoMergeBlockMessage(block: PrAutoMergeBlock, pr: string): string {
  return `Can't turn on auto-merge for ${pr}: ${AUTO_MERGE_BLOCK_REASON[block]}.`
}

const MERGE_METHOD_ALLOWED: Record<PrMergeMethod, keyof GqlRepoMergeSettings> = {
  merge: 'mergeCommitAllowed',
  squash: 'squashMergeAllowed',
  rebase: 'rebaseMergeAllowed',
}

export function allowedMergeMethods(repo: GqlRepoMergeSettings): PrMergeMethod[] {
  return (['merge', 'squash', 'rebase'] as const).filter(method => repo[MERGE_METHOD_ALLOWED[method]])
}

/**
 * The method auto-merge uses: the one asked for when the repository allows it, else the viewer's
 * default there (their last-used method, else the repository's), else the first it allows. Null when
 * the requested method is off there, or the repository allows none.
 */
export function pickMergeMethod(repo: GqlRepoMergeSettings | null, requested?: PrMergeMethod): PrMergeMethod | null {
  if (!repo) return requested ?? 'merge'
  const allowed = allowedMergeMethods(repo)
  if (requested) return allowed.includes(requested) ? requested : null
  const preferred = mapMergeMethod(repo.viewerDefaultMergeMethod)
  return allowed.includes(preferred) ? preferred : allowed[0] ?? null
}

export interface LocalStatus {
  localAhead: number
  localDirty: boolean
}

export function mapSummary(node: GqlPullRequestSummary, local: LocalStatus, meta: { fetchedAt: number; via: string }): PrSummary {
  const autoMergeBlocked = mapAutoMergeBlock(node)
  return {
    number: node.number,
    title: node.title,
    url: node.url,
    state: mapPrState(node),
    headRef: node.headRefName,
    baseRef: node.baseRefName,
    checks: mapRollup(node.commits.nodes[0]?.commit.statusCheckRollup?.state),
    reviewDecision: mapReviewDecision(node.reviewDecision),
    mergeState: mapMergeState(node),
    unresolvedThreads: node.reviewThreads.nodes.filter(thread => !thread.isResolved).length,
    localAhead: local.localAhead,
    localDirty: local.localDirty,
    fetchedAt: meta.fetchedAt,
    via: meta.via,
    // Present only when GitHub auto-merge is enabled; omitted (off) otherwise
    ...(node.autoMergeRequest ? { autoMerge: { enabled: true, method: mapMergeMethod(node.autoMergeRequest.mergeMethod) } } : {}),
    ...(autoMergeBlocked ? { autoMergeBlocked } : {}),
  }
}

const FAILED_CONCLUSIONS = new Set(['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'])

export function mapCheck(context: GqlCheckContext): PrCheck {
  if (context.__typename === 'CheckRun') {
    let status: CheckStatus
    if (context.status !== 'COMPLETED') status = 'pending'
    else if (context.conclusion && FAILED_CONCLUSIONS.has(context.conclusion)) status = 'failure'
    else if (context.conclusion === 'SKIPPED' || context.conclusion === 'STALE') status = 'skipped'
    else status = 'success'
    return { name: context.name, status, url: context.detailsUrl ?? undefined }
  }
  const status: CheckStatus = context.state === 'SUCCESS'
    ? 'success'
    : context.state === 'FAILURE' || context.state === 'ERROR' ? 'failure' : 'pending'
  return { name: context.context, status, url: context.targetUrl ?? undefined }
}

const REVIEW_STATE: Record<string, ReviewerState> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes_requested',
  COMMENTED: 'commented',
}

/**
 * Each reviewer once: their latest opinionated review, overridden by a pending request (a re-request
 * after a review means they are expected to look again). Dismissed reviews drop out.
 */
export function mapReviewers(details: Pick<GqlPullRequestDetails, 'latestOpinionatedReviews' | 'reviewRequests'>): PrReviewer[] {
  const byLogin = new Map<string, ReviewerState>()
  for (const review of details.latestOpinionatedReviews.nodes) {
    const state = REVIEW_STATE[review.state]
    if (review.author && state) byLogin.set(review.author.login, state)
  }
  for (const request of details.reviewRequests.nodes) {
    const name = request.requestedReviewer?.login ?? request.requestedReviewer?.slug
    if (name) byLogin.set(name, 'pending')
  }
  return [...byLogin].map(([login, state]) => ({ login, state }))
}

export function mapDetails(details: GqlPullRequestDetails): PrDetails | null {
  const commit = details.commits.nodes[0]?.commit
  if (!commit) return null
  return {
    lastCommit: {
      sha: commit.oid,
      headline: commit.messageHeadline,
      author: commit.author?.name ?? commit.author?.user?.login ?? 'unknown',
      committedAt: Date.parse(commit.committedDate),
    },
    checks: (commit.statusCheckRollup?.contexts.nodes ?? []).map(mapCheck),
    reviewers: mapReviewers(details),
    additions: details.additions,
    deletions: details.deletions,
    changedFiles: details.changedFiles,
  }
}

/**
 * Who may trigger auto-fix: the repository's owner, members and collaborators. Anyone can comment on
 * a public repo's PR, and auto-fix turns feedback into an unattended agent turn — a stranger's comment
 * must never start one.
 */
const TRUSTED_ASSOCIATIONS: ReadonlySet<string> = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])

/**
 * A PR's review feedback as comparable tokens, for auto-fix's "anything new since the last run?"
 * (`hasNewReviewFeedback`): one `t:<thread>:<comment>` per unresolved thread, naming its latest
 * comment by a trusted reviewer other than the viewer, and one `r:<review>` per changes-requested
 * review by a trusted reviewer other than the viewer. The viewer's own replies (the user's, or the
 * agent's as them) never create a token, so the agent answering on GitHub can't re-trigger auto-fix;
 * untrusted authors never create one either. Sorted, so equal feedback compares equal.
 */
export function mapReviewSignature(pr: GqlReviewSignaturePr, viewerLogin: string | null): string[] {
  const viewer = viewerLogin?.toLowerCase() ?? null
  const counts = (login: string | undefined, association: string) =>
    TRUSTED_ASSOCIATIONS.has(association) && !(viewer && login?.toLowerCase() === viewer)
  const tokens: string[] = []
  for (const thread of pr.reviewThreads.nodes) {
    if (thread.isResolved) continue
    const latestTrusted = [...thread.comments.nodes].reverse().find(comment => counts(comment.author?.login, comment.authorAssociation))
    if (latestTrusted) tokens.push(`t:${thread.id}:${latestTrusted.id}`)
  }
  for (const review of pr.latestOpinionatedReviews.nodes) {
    if (review.state === 'CHANGES_REQUESTED' && counts(review.author?.login, review.authorAssociation)) tokens.push(`r:${review.id}`)
  }
  return tokens.sort()
}
