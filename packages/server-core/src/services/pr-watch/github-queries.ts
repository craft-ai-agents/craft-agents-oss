/**
 * The two GraphQL queries behind the PR watcher, and the response shapes `map-github.ts` reads.
 * Each costs 1 point of GitHub's 5,000/hour GraphQL budget (checked against a live PR).
 */

/**
 * The per-PR selection the chip's status and card action depend on. Shared verbatim by the branch
 * query ({@link SUMMARY_QUERY}) and the pinned-number query ({@link PR_BY_NUMBER_QUERY}) so the two
 * resolution strategies map through the same {@link mapSummary} and can never drift.
 */
const PR_SUMMARY_FIELDS = `
  id number title url state isDraft headRefName baseRefName headRefOid
  headRepositoryOwner { login }
  reviewDecision mergeable mergeStateStatus
  autoMergeRequest { mergeMethod }
  viewerCanEnableAutoMerge
  baseRepository { autoMergeAllowed viewerDefaultMergeMethod mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
  reviewThreads(first: 100) { nodes { isResolved } }`

/**
 * The poll: everything the chip's status and the card's action depend on, for the branch's most
 * recently updated PRs (the caller picks one, see `pickPullRequest`).
 */
export const SUMMARY_QUERY = `query PrSummary($owner: String!, $name: String!, $branch: String!) {
  rateLimit { remaining resetAt }
  repository(owner: $owner, name: $name) {
    pullRequests(headRefName: $branch, states: [OPEN, MERGED, CLOSED], first: 5, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes {${PR_SUMMARY_FIELDS}
      }
    }
  }
}`

/**
 * A single pinned PR by number (pr_bind): the same fields as {@link SUMMARY_QUERY}, so a bound PR
 * maps through {@link mapSummary} exactly like the branch's own PR.
 */
export const PR_BY_NUMBER_QUERY = `query PrByNumber($owner: String!, $name: String!, $number: Int!) {
  rateLimit { remaining resetAt }
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {${PR_SUMMARY_FIELDS}
    }
  }
}`

/**
 * Auto-fix's "is there new review feedback?" probe (see `mapReviewSignature`): unresolved threads
 * with their latest comments, and the opinionated reviews, plus the credential's own login so the
 * viewer's comments (yours, or the agent's as you) never count as feedback. Only runs for PRs with
 * auto-fix on and open feedback, at most every 5 minutes; ~2 points. `authorAssociation` lets the
 * mapper count only the repo's owner, members and collaborators (anyone can comment on a public repo).
 */
export const REVIEW_SIGNATURE_QUERY = `query PrReviewSignature($owner: String!, $name: String!, $number: Int!) {
  rateLimit { remaining resetAt }
  viewer { login }
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) { nodes { id isResolved comments(last: 5) { nodes { id authorAssociation author { login } } } } }
      latestOpinionatedReviews(first: 20) { nodes { id state authorAssociation author { login } } }
    }
  }
}`

/** Enable GitHub auto-merge for a PR (pr_set_auto_merge). Needs the PR's node id. */
export const ENABLE_AUTO_MERGE_MUTATION = `mutation EnableAutoMerge($prId: ID!, $method: PullRequestMergeMethod!) {
  enablePullRequestAutoMerge(input: { pullRequestId: $prId, mergeMethod: $method }) {
    pullRequest { id autoMergeRequest { mergeMethod } }
  }
}`

/** Disable GitHub auto-merge for a PR (pr_set_auto_merge). */
export const DISABLE_AUTO_MERGE_MUTATION = `mutation DisableAutoMerge($prId: ID!) {
  disablePullRequestAutoMerge(input: { pullRequestId: $prId }) {
    pullRequest { id autoMergeRequest { mergeMethod } }
  }
}`

/** The card: last commit, every check context, reviewers, size. */
export const DETAILS_QUERY = `query PrDetails($owner: String!, $name: String!, $number: Int!) {
  rateLimit { remaining resetAt }
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      additions deletions changedFiles
      commits(last: 1) { nodes { commit {
        oid messageHeadline committedDate
        author { name user { login } }
        statusCheckRollup { contexts(first: 100) { nodes {
          __typename
          ... on CheckRun { name status conclusion detailsUrl }
          ... on StatusContext { context state targetUrl }
        } } }
      } } }
      latestOpinionatedReviews(first: 20) { nodes { state author { login } } }
      reviewRequests(first: 20) { nodes { requestedReviewer { __typename ... on User { login } ... on Team { slug } ... on Bot { login } } } }
    }
  }
}`

export interface GqlRateLimit {
  remaining: number
  resetAt: string
}

export type GqlMergeMethod = 'MERGE' | 'SQUASH' | 'REBASE'

/** The base repository's merge settings: whether it has auto-merge, and the methods it allows. */
export interface GqlRepoMergeSettings {
  autoMergeAllowed: boolean
  /** The viewer's last-used method there, else the repository's default */
  viewerDefaultMergeMethod: GqlMergeMethod
  mergeCommitAllowed: boolean
  squashMergeAllowed: boolean
  rebaseMergeAllowed: boolean
}

export interface GqlPullRequestSummary {
  /** GitHub node id — needed by the auto-merge mutations */
  id: string
  number: number
  title: string
  url: string
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  isDraft: boolean
  headRefName: string
  baseRefName: string
  headRefOid: string
  headRepositoryOwner: { login: string } | null
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
  mergeStateStatus: 'BEHIND' | 'BLOCKED' | 'CLEAN' | 'DIRTY' | 'DRAFT' | 'HAS_HOOKS' | 'UNKNOWN' | 'UNSTABLE'
  /** Present only when auto-merge is enabled */
  autoMergeRequest: { mergeMethod: GqlMergeMethod } | null
  /** GitHub would queue auto-merge for this PR now (false while it's already on) */
  viewerCanEnableAutoMerge: boolean
  baseRepository: GqlRepoMergeSettings | null
  commits: { nodes: Array<{ commit: { statusCheckRollup: { state: GqlRollupState } | null } }> }
  reviewThreads: { nodes: Array<{ isResolved: boolean }> }
}

export type GqlRollupState = 'EXPECTED' | 'ERROR' | 'FAILURE' | 'PENDING' | 'SUCCESS'

export interface GqlSummaryResponse {
  rateLimit: GqlRateLimit | null
  repository: { pullRequests: { nodes: GqlPullRequestSummary[] } } | null
}

export interface GqlByNumberResponse {
  rateLimit: GqlRateLimit | null
  repository: { pullRequest: GqlPullRequestSummary | null } | null
}

export interface GqlReviewSignaturePr {
  reviewThreads: {
    nodes: Array<{ id: string; isResolved: boolean; comments: { nodes: Array<{ id: string; authorAssociation: string; author: { login: string } | null }> } }>
  }
  latestOpinionatedReviews: { nodes: Array<{ id: string; state: string; authorAssociation: string; author: { login: string } | null }> }
}

export interface GqlReviewSignatureResponse {
  rateLimit: GqlRateLimit | null
  viewer: { login: string } | null
  repository: { pullRequest: GqlReviewSignaturePr | null } | null
}

/** Shape shared by both auto-merge mutations (the field name differs, the payload doesn't). */
export interface GqlAutoMergeMutationResponse {
  enablePullRequestAutoMerge?: { pullRequest: { id: string; autoMergeRequest: { mergeMethod: GqlMergeMethod } | null } | null } | null
  disablePullRequestAutoMerge?: { pullRequest: { id: string; autoMergeRequest: { mergeMethod: GqlMergeMethod } | null } | null } | null
}

export type GqlCheckContext =
  | { __typename: 'CheckRun'; name: string; status: string; conclusion: string | null; detailsUrl: string | null }
  | { __typename: 'StatusContext'; context: string; state: string; targetUrl: string | null }

export interface GqlPullRequestDetails {
  additions: number
  deletions: number
  changedFiles: number
  commits: {
    nodes: Array<{
      commit: {
        oid: string
        messageHeadline: string
        committedDate: string
        author: { name: string | null; user: { login: string } | null } | null
        statusCheckRollup: { contexts: { nodes: GqlCheckContext[] } } | null
      }
    }>
  }
  latestOpinionatedReviews: { nodes: Array<{ state: string; author: { login: string } | null }> }
  reviewRequests: {
    nodes: Array<{ requestedReviewer: { __typename: string; login?: string; slug?: string } | null }>
  }
}

export interface GqlDetailsResponse {
  rateLimit: GqlRateLimit | null
  repository: { pullRequest: GqlPullRequestDetails | null } | null
}
