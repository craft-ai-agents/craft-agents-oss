import { describe, expect, it } from 'bun:test'
import type { BoundPr, PrEntry, PrWatchSessionState } from '@craft-agent/shared/protocol'
import { GitHubRequestError } from './github-client'
import type { GqlPullRequestSummary, GqlRepoMergeSettings } from './github-queries'
import type { LocalStatus, RepoInfo } from './local-git'
import { PrWatchRegistry, type PrWatchDeps } from './registry'
import { POLL } from './schedule'

const REPO: RepoInfo = {
  root: '/work/app',
  gitDir: '/work/app/.git',
  commonDir: '/work/app/.git',
  branch: 'feat/x',
  pushRemote: 'origin',
  remoteBranch: 'feat/x',
  repo: { host: 'github.com', owner: 'acme', repo: 'app' },
  upstreamRepo: null,
}

/** A repository that allows auto-merge and every merge method, defaulting to squash for the viewer. */
const MERGE_SETTINGS: GqlRepoMergeSettings = {
  autoMergeAllowed: true, viewerDefaultMergeMethod: 'SQUASH', mergeCommitAllowed: true, squashMergeAllowed: true, rebaseMergeAllowed: true,
}

const PR: GqlPullRequestSummary = {
  id: 'PR_7', number: 7, title: 'Feature X', url: 'https://github.com/acme/app/pull/7', state: 'OPEN', isDraft: false,
  headRefName: 'feat/x', baseRefName: 'main', headRefOid: 'abc', headRepositoryOwner: { login: 'acme' },
  reviewDecision: null, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', autoMergeRequest: null,
  viewerCanEnableAutoMerge: true, baseRepository: MERGE_SETTINGS,
  commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] },
  reviewThreads: { nodes: [] },
}

/** A different PR in another repo, used for bound-PR (by-number) scenarios. */
const DEP_PR: GqlPullRequestSummary = {
  id: 'PR_42', number: 42, title: 'Bound dependency', url: 'https://github.com/other/dep/pull/42', state: 'OPEN', isDraft: false,
  headRefName: 'fix/y', baseRefName: 'main', headRefOid: 'def', headRepositoryOwner: { login: 'other' },
  reviewDecision: null, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', autoMergeRequest: null,
  viewerCanEnableAutoMerge: true, baseRepository: MERGE_SETTINGS,
  commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] },
  reviewThreads: { nodes: [] },
}

const bound = (number: number, owner = 'other', repo = 'dep', host = 'github.com'): BoundPr => ({ host, owner, repo, number, addedAt: number })

/** The entries of a 'ready' aggregate, or [] otherwise. */
function entriesOf(state: PrWatchSessionState | undefined): PrEntry[] {
  return state?.kind === 'ready' ? state.prs : []
}
function firstPr(state: PrWatchSessionState | undefined): PrEntry | undefined {
  return entriesOf(state)[0]
}

function setup(options: { repos?: Record<string, RepoInfo | null>; prs?: GqlPullRequestSummary[]; byNumber?: Record<number, GqlPullRequestSummary>; local?: LocalStatus } = {}) {
  let now = 1_000_000
  let nextTimer = 1
  const timers = new Map<number, { at: number; fn: () => void }>()
  const pushes: Array<{ clientId: string; sessionId: string; state: PrWatchSessionState }> = []
  const calls: Array<{ query: string; variables: Record<string, unknown> }> = []
  const refWatchers = new Map<string, () => void>()
  let stoppedRefWatchers = 0
  const repos: Record<string, RepoInfo | null> = { '/work/app': REPO, ...options.repos }
  let prs = options.prs ?? [PR]
  const byNumber = options.byNumber ?? { 7: PR, 42: DEP_PR }
  let failNext: Error | null = null
  let local = options.local ?? { localAhead: 0, localDirty: false }

  const deps: PrWatchDeps = {
    graphql: async <T,>(_host: string, _token: string, query: string, variables: Record<string, unknown>) => {
      calls.push({ query, variables })
      if (failNext) {
        const error = failNext
        failNext = null
        throw error
      }
      if (query.includes('PrDetails')) {
        return {
          rateLimit: null,
          repository: { pullRequest: {
            additions: 1, deletions: 2, changedFiles: 3,
            commits: { nodes: [{ commit: { oid: 'abc', messageHeadline: 'h', committedDate: '2026-10-17T00:00:00Z', author: { name: 'A', user: null }, statusCheckRollup: null } }] },
            latestOpinionatedReviews: { nodes: [] },
            reviewRequests: { nodes: [] },
          } },
        } as T
      }
      if (query.includes('mutation EnableAutoMerge')) {
        return { enablePullRequestAutoMerge: { pullRequest: { id: 'PR_7', autoMergeRequest: { mergeMethod: variables.method } } } } as T
      }
      if (query.includes('mutation DisableAutoMerge')) {
        return { disablePullRequestAutoMerge: { pullRequest: { id: 'PR_7', autoMergeRequest: null } } } as T
      }
      if (query.includes('PrReviewSignature')) {
        return {
          rateLimit: null,
          viewer: { login: 'Me' },
          repository: { pullRequest: {
            reviewThreads: { nodes: [
              // a collaborator's comment, then my reply: the collaborator's comment is the feedback
              { id: 'T1', isResolved: false, comments: { nodes: [{ id: 'C1', authorAssociation: 'COLLABORATOR', author: { login: 'rev' } }, { id: 'C2', authorAssociation: 'OWNER', author: { login: 'me' } }] } },
              // resolved: never feedback
              { id: 'T2', isResolved: true, comments: { nodes: [{ id: 'C3', authorAssociation: 'COLLABORATOR', author: { login: 'rev' } }] } },
              // only my own comments: not feedback
              { id: 'T3', isResolved: false, comments: { nodes: [{ id: 'C4', authorAssociation: 'OWNER', author: { login: 'me' } }] } },
              // a stranger on a public repo: never triggers auto-fix
              { id: 'T4', isResolved: false, comments: { nodes: [{ id: 'C5', authorAssociation: 'NONE', author: { login: 'stranger' } }] } },
            ] },
            latestOpinionatedReviews: { nodes: [
              { id: 'R1', state: 'CHANGES_REQUESTED', authorAssociation: 'MEMBER', author: { login: 'rev' } },
              { id: 'R2', state: 'APPROVED', authorAssociation: 'MEMBER', author: { login: 'x' } },
              { id: 'R3', state: 'CHANGES_REQUESTED', authorAssociation: 'OWNER', author: { login: 'me' } },
              { id: 'R4', state: 'CHANGES_REQUESTED', authorAssociation: 'CONTRIBUTOR', author: { login: 'drive-by' } },
            ] },
          } },
        } as T
      }
      if (query.includes('PrByNumber')) {
        const node = byNumber[variables.number as number] ?? null
        return { rateLimit: { remaining: 4000, resetAt: '2030-01-01T00:00:00Z' }, repository: node ? { pullRequest: node } : { pullRequest: null } } as T
      }
      return { rateLimit: { remaining: 4000, resetAt: '2030-01-01T00:00:00Z' }, repository: { pullRequests: { nodes: prs } } } as T
    },
    candidates: async () => [{ id: 'gh', label: 'gh', getToken: async () => 'token' }],
    push: (clientId, sessionId, state) => pushes.push({ clientId, sessionId, state }),
    resolveRepo: async dir => repos[dir] ?? null,
    localStatus: async () => local,
    watchRefs: (repo, onChange) => {
      refWatchers.set(repo.root, onChange)
      return () => { stoppedRefWatchers++ }
    },
    now: () => now,
    setTimer: (fn, ms) => {
      const id = nextTimer++
      timers.set(id, { at: now + ms, fn })
      return id
    },
    clearTimer: handle => { timers.delete(handle as number) },
  }
  const registry = new PrWatchRegistry(deps)
  const flush = () => new Promise(r => setTimeout(r, 0))
  return {
    registry, pushes, calls, timers, refWatchers, repos,
    get stoppedRefWatchers() { return stoppedRefWatchers },
    setPrs: (next: GqlPullRequestSummary[]) => { prs = next },
    setLocal: (next: LocalStatus) => { local = next },
    failNextWith: (error: Error) => { failNext = error },
    flush,
    /** Advances the clock and runs due timers */
    async advance(ms: number) {
      now += ms
      for (const [id, timer] of [...timers]) {
        if (timer.at > now) continue
        timers.delete(id)
        timer.fn()
      }
      await flush()
      await flush()
    },
    nextDelay: () => Math.min(...[...timers.values()].map(t => t.at - now)),
  }
}

const sub = (sessionId = 's1', clientId = 'c1', dir = '/work/app', boundPrs: BoundPr[] = []) => ({ clientId, sessionId, dir, workspaceRootPath: '/ws', boundPrs })

describe('PrWatchRegistry gating', () => {
  it('never asks GitHub for a folder that is not a git repo', async () => {
    const t = setup({ repos: { '/tmp/notes': null } })
    const { state } = await t.registry.subscribe(sub('s1', 'c1', '/tmp/notes'))
    expect(state).toEqual({ kind: 'unavailable', reason: 'not-git' })
    expect(t.calls).toHaveLength(0)
    expect(t.timers.size).toBe(0)
  })

  it('shows nothing on a detached HEAD or a non-GitHub remote, without calls', async () => {
    const t = setup({ repos: {
      '/work/detached': { ...REPO, root: '/work/detached', branch: null, remoteBranch: null },
      '/work/gitlab': { ...REPO, root: '/work/gitlab', repo: null },
    } })
    expect((await t.registry.subscribe(sub('a', 'c1', '/work/detached'))).state).toEqual({ kind: 'none' })
    expect((await t.registry.subscribe(sub('b', 'c1', '/work/gitlab'))).state).toEqual({ kind: 'unavailable', reason: 'not-github' })
    expect(t.calls).toHaveLength(0)
  })

  it('reports none when the branch has no PR and keeps looking every 2 min', async () => {
    const t = setup({ prs: [] })
    await t.registry.subscribe(sub())
    await t.flush()
    expect(t.pushes.at(-1)?.state).toEqual({ kind: 'none' })
    expect(t.nextDelay()).toBe(POLL.quiet)
  })
})

describe('PrWatchRegistry fetching and pushing', () => {
  it('starts loading, then pushes the branch PR as a ready aggregate', async () => {
    const t = setup({ local: { localAhead: 1, localDirty: true } })
    const { state } = await t.registry.subscribe(sub())
    expect(state).toEqual({ kind: 'loading' })
    await t.flush()
    const pushed = t.pushes.at(-1)
    expect(pushed?.sessionId).toBe('s1')
    expect(pushed?.state.kind).toBe('ready')
    const entry = firstPr(pushed?.state)
    expect(entry?.origin).toBe('branch')
    expect(entry?.summary).toMatchObject({ number: 7, checks: 'success', localAhead: 1, localDirty: true, via: 'gh' })
    expect(t.calls[0]?.variables).toEqual({ owner: 'acme', name: 'app', branch: 'feat/x' })
    // Just changed: next poll in 30 s
    expect(t.nextDelay()).toBe(POLL.recentChange)
  })

  it('shares one branch watcher between subscriptions and returns the current state to a newcomer', async () => {
    const t = setup()
    await t.registry.subscribe(sub('s1', 'c1'))
    await t.flush()
    // Same folder, second session/client: no new fetch, and the newcomer gets the ready state back.
    const second = await t.registry.subscribe(sub('s2', 'c2'))
    expect(t.calls).toHaveLength(1)
    expect(second.state.kind).toBe('ready')
    expect(firstPr(second.state)?.summary.number).toBe(7)
  })

  it('does not re-push an unchanged aggregate, but pushes changes', async () => {
    const t = setup()
    await t.registry.subscribe(sub())
    await t.flush()
    const count = t.pushes.length
    await t.advance(POLL.recentChange)
    expect(t.calls).toHaveLength(2)
    expect(t.pushes.length).toBe(count)
    t.setPrs([{ ...PR, commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE' } } }] } }])
    await t.advance(POLL.recentChange)
    expect(firstPr(t.pushes.at(-1)?.state)?.summary.checks).toBe('failure')
  })

  it('refetches at once on a nudge (agent turn end)', async () => {
    const t = setup()
    await t.registry.subscribe(sub())
    await t.flush()
    await t.registry.nudge('s1')
    expect(t.calls).toHaveLength(2)
  })

  it('keeps the last good state on errors and backs off', async () => {
    const t = setup()
    await t.registry.subscribe(sub())
    await t.flush()
    const count = t.pushes.length
    t.failNextWith(new GitHubRequestError('offline'))
    await t.registry.nudge('s1')
    expect(t.pushes.length).toBe(count)
    expect(t.nextDelay()).toBe(POLL.errorBase)
  })

  it('hides the chip when the very first fetch fails', async () => {
    const t = setup()
    t.failNextWith(new GitHubRequestError('offline'))
    await t.registry.subscribe(sub())
    await t.flush()
    expect(t.pushes.at(-1)?.state).toEqual({ kind: 'unavailable', reason: 'error' })
  })

  it('honours Retry-After', async () => {
    const t = setup()
    await t.registry.subscribe(sub())
    await t.flush()
    t.failNextWith(new GitHubRequestError('rate limit', 403, 5 * 60_000))
    await t.registry.nudge('s1')
    expect(t.nextDelay()).toBe(5 * 60_000)
  })
})

describe('PrWatchRegistry bound PRs (multi-PR)', () => {
  it('resolves a bound PR by number and shows it after the branch PR', async () => {
    const t = setup()
    const { state } = await t.registry.subscribe(sub('s1', 'c1', '/work/app', [bound(42)]))
    expect(state).toEqual({ kind: 'loading' })
    await t.flush()
    const entries = entriesOf(t.pushes.at(-1)?.state)
    expect(entries.map(e => `${e.origin}:${e.summary.number}`)).toEqual(['branch:7', 'bound:42'])
    // The bound PR is fetched by number
    expect(t.calls.some(c => c.query.includes('PrByNumber') && c.variables.number === 42)).toBe(true)
  })

  it('dedupes a bound PR that is the branch PR (branch entry wins)', async () => {
    // Bind acme/app#7 — the same PR the branch already resolves.
    const t = setup({ byNumber: { 7: PR } })
    await t.registry.subscribe(sub('s1', 'c1', '/work/app', [bound(7, 'acme', 'app')]))
    await t.flush()
    const entries = entriesOf(t.pushes.at(-1)?.state)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ origin: 'branch', summary: { number: 7 } })
  })

  it('keeps a bound PR available when the folder is not a git repo (per-entry availability)', async () => {
    const t = setup({ repos: { '/tmp/notes': null } })
    await t.registry.subscribe(sub('s1', 'c1', '/tmp/notes', [bound(42)]))
    await t.flush()
    const entries = entriesOf(t.pushes.at(-1)?.state)
    expect(entries.map(e => `${e.origin}:${e.summary.number}`)).toEqual(['bound:42'])
  })

  it('setSessionBoundPrs adds and removes bound watchers live', async () => {
    const t = setup()
    await t.registry.subscribe(sub('s1', 'c1'))
    await t.flush()
    t.registry.setSessionBoundPrs('s1', [bound(42)])
    await t.flush()
    expect(entriesOf(t.pushes.at(-1)?.state).map(e => e.summary.number)).toEqual([7, 42])
    t.registry.setSessionBoundPrs('s1', [])
    await t.flush()
    expect(entriesOf(t.pushes.at(-1)?.state).map(e => e.summary.number)).toEqual([7])
  })

  it('verifyPr returns the summary for an existing PR and throws for a missing one', async () => {
    const t = setup()
    const summary = await t.registry.verifyPr({ coords: { host: 'github.com', owner: 'other', repo: 'dep' }, number: 42, workspaceRootPath: '/ws' })
    expect(summary).toMatchObject({ number: 42, title: 'Bound dependency' })
    await expect(
      t.registry.verifyPr({ coords: { host: 'github.com', owner: 'other', repo: 'dep' }, number: 999, workspaceRootPath: '/ws' }),
    ).rejects.toThrow(/not found/)
  })

  it('cachedSessionState returns a live aggregate only while subscribed (no fetch)', async () => {
    const t = setup()
    expect(t.registry.cachedSessionState('s1')).toBeNull()
    await t.registry.subscribe(sub('s1', 'c1'))
    await t.flush()
    const callsBefore = t.calls.length
    const cached = t.registry.cachedSessionState('s1')
    expect(firstPr(cached ?? undefined)?.summary.number).toBe(7)
    expect(t.calls).toHaveLength(callsBefore) // cache read triggers no GitHub call
  })

  it('setAutoMerge enables via GitHub and returns the new state', async () => {
    const t = setup()
    const state = await t.registry.setAutoMerge({ coords: { host: 'github.com', owner: 'acme', repo: 'app' }, number: 7, workspaceRootPath: '/ws', enabled: true, method: 'squash' })
    expect(state).toEqual({ enabled: true, method: 'squash' })
    expect(t.calls.some(c => c.query.includes('mutation EnableAutoMerge'))).toBe(true)
  })

  const ACME_7 = { coords: { host: 'github.com', owner: 'acme', repo: 'app' }, number: 7, workspaceRootPath: '/ws' }

  it('setAutoMerge says why GitHub won\'t take it, without trying the mutation', async () => {
    const t = setup({ byNumber: { 7: { ...PR, viewerCanEnableAutoMerge: false, baseRepository: { ...MERGE_SETTINGS, autoMergeAllowed: false } } } })
    const error = await t.registry.setAutoMerge({ ...ACME_7, enabled: true }).then(() => null, (e: Error) => e)
    expect(error?.message).toBe('Can\'t turn on auto-merge for acme/app #7: auto-merge is off for this repository (turn on "Allow auto-merge" in its GitHub settings).')
    expect(t.calls.some(c => c.query.includes('mutation EnableAutoMerge'))).toBe(false)
  })

  it('setAutoMerge uses the repository\'s default method and refuses one it has off', async () => {
    const noSquash = { ...MERGE_SETTINGS, viewerDefaultMergeMethod: 'MERGE' as const, squashMergeAllowed: false }
    const t = setup({ byNumber: { 7: { ...PR, baseRepository: noSquash } } })
    expect(await t.registry.setAutoMerge({ ...ACME_7, enabled: true })).toEqual({ enabled: true, method: 'merge' })
    expect(t.calls.find(c => c.query.includes('mutation EnableAutoMerge'))?.variables.method).toBe('MERGE')
    const error = await t.registry.setAutoMerge({ ...ACME_7, enabled: true, method: 'squash' }).then(() => null, (e: Error) => e)
    expect(error?.message).toBe('acme/app doesn\'t allow squash merges (it allows merge, rebase).')
  })
})

describe('PrWatchRegistry lifecycle', () => {
  it('stops polling and the ref watcher when the last subscriber leaves', async () => {
    const t = setup()
    const a = await t.registry.subscribe(sub('s1', 'c1'))
    const b = await t.registry.subscribe(sub('s1', 'c2'))
    await t.flush()
    t.registry.unsubscribe(a.subscriptionId)
    expect(t.timers.size).toBe(1)
    t.registry.unsubscribe(b.subscriptionId)
    expect(t.timers.size).toBe(0)
    expect(t.stoppedRefWatchers).toBe(1)
  })

  it('drops a disconnected client', async () => {
    const t = setup()
    await t.registry.subscribe(sub('s1', 'c1'))
    await t.flush()
    t.registry.dropClient('c1')
    expect(t.timers.size).toBe(0)
  })

  it('follows a branch switch seen by the ref watcher', async () => {
    const t = setup()
    await t.registry.subscribe(sub())
    await t.flush()
    t.repos['/work/app'] = { ...REPO, branch: 'feat/y', remoteBranch: 'feat/y' }
    t.setPrs([])
    t.refWatchers.get('/work/app')?.()
    await t.flush()
    await t.flush()
    expect(t.calls.at(-1)?.variables).toMatchObject({ branch: 'feat/y' })
    expect(t.pushes.at(-1)?.state).toEqual({ kind: 'none' })
    expect(t.stoppedRefWatchers).toBe(1)
  })
})

describe('PrWatchRegistry details', () => {
  const PR_ID = 'github.com/acme/app#7'

  it('fetches details once per 10 s and refreshes the local state', async () => {
    const t = setup()
    await t.registry.subscribe(sub())
    await t.flush()
    t.setLocal({ localAhead: 0, localDirty: true })
    const details = await t.registry.getDetails('s1', PR_ID, 'c1')
    expect(details).toMatchObject({ additions: 1, deletions: 2, changedFiles: 3, lastCommit: { sha: 'abc', author: 'A' } })
    expect(firstPr(t.pushes.at(-1)?.state)?.summary.localDirty).toBe(true)
    await t.registry.getDetails('s1', PR_ID, 'c1')
    expect(t.calls.filter(c => c.query.includes('PrDetails'))).toHaveLength(1)
  })

  it('returns null for an unknown entry id', async () => {
    const t = setup({ prs: [] })
    await t.registry.subscribe(sub())
    await t.flush()
    expect(await t.registry.getDetails('s1', PR_ID, 'c1')).toBeNull()
  })
})

describe('PrWatchRegistry auto-fix support', () => {
  const PR_ID = 'github.com/acme/app#7'

  it('stamps auto-fix onto entries and pushes when it changes', async () => {
    const t = setup()
    await t.registry.subscribe(sub())
    await t.flush()
    expect(firstPr(t.pushes.at(-1)?.state)?.autoFix).toBeUndefined()
    t.registry.setSessionMonitors('s1', { [PR_ID]: { autoFix: true, lastFixAt: 123 } })
    expect(firstPr(t.pushes.at(-1)?.state)).toMatchObject({ autoFix: true, autoFixLastRunAt: 123 })
    t.registry.setSessionMonitors('s1', {})
    expect(firstPr(t.pushes.at(-1)?.state)?.autoFix).toBeUndefined()
  })

  it('stamps auto-fix on the branch PR only, never on a pinned one', async () => {
    const t = setup()
    await t.registry.subscribe(sub('s1', 'c1', '/work/app', [bound(42)]))
    await t.flush()
    t.registry.setSessionMonitors('s1', { [PR_ID]: { autoFix: true }, 'github.com/other/dep#42': { autoFix: true } })
    const entries = entriesOf(t.pushes.at(-1)?.state)
    expect(entries.map(e => `${e.origin}:${e.autoFix ?? false}`)).toEqual(['branch:true', 'bound:false'])
  })

  it('dedupes a bound PR against the branch PR regardless of owner/repo case', async () => {
    const t = setup({ byNumber: { 7: PR } })
    await t.registry.subscribe(sub('s1', 'c1', '/work/app', [bound(7, 'Acme', 'App')]))
    await t.flush()
    const entries = entriesOf(t.pushes.at(-1)?.state)
    expect(entries.map(e => `${e.origin}:${e.id}`)).toEqual([`branch:${PR_ID}`])
  })

  it('builds the review signature from trusted reviewers\' open feedback only', async () => {
    const t = setup()
    const signature = await t.registry.fetchReviewSignature({ coords: { host: 'github.com', owner: 'acme', repo: 'app' }, number: 7, workspaceRootPath: '/ws' })
    expect(signature).toEqual(['r:R1', 't:T1:C1'])
  })
})
