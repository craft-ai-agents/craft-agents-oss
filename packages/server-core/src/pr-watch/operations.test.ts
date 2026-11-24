import { describe, expect, it } from 'bun:test'
import type { BoundPr, PrMonitorState, PrSummary, PrWatchSessionState } from '@craft-agent/shared/protocol'
import type { RepoInfo } from '../services/pr-watch/local-git'
import { createPrWatchOps } from './operations'

const SUMMARY: PrSummary = {
  number: 7, title: 'Feature', url: 'https://github.com/acme/app/pull/7', state: 'open',
  headRef: 'f', baseRef: 'main', checks: 'success', reviewDecision: 'none', mergeState: 'clean',
  unresolvedThreads: 0, localAhead: 0, localDirty: false, fetchedAt: 1, via: 'gh',
}

const PINNED: PrSummary = { ...SUMMARY, number: 9, url: 'https://github.com/acme/lib/pull/9' }

/** The live aggregate: the branch's PR #7 plus a pinned PR #9 from another repo. */
const BRANCH_AND_PINNED: PrWatchSessionState = {
  kind: 'ready',
  prs: [
    { id: 'github.com/acme/app#7', origin: 'branch', summary: SUMMARY },
    { id: 'github.com/acme/lib#9', origin: 'bound', summary: PINNED },
  ],
}

function fakes(options: { verifyThrows?: boolean; boundPrs?: BoundPr[]; cached?: PrWatchSessionState | null; codingMode?: boolean; monitors?: Record<string, PrMonitorState>; checkout?: RepoInfo | null } = {}) {
  const calls = { verifyPr: 0, fetchOnce: 0, bind: [] as BoundPr[], unbind: 0, setSessionBoundPrs: 0, setSessionMonitors: 0, setAutoMerge: 0, nudge: 0, monitorsChanged: [] as string[] }
  let bound: BoundPr[] = options.boundPrs ?? []
  let monitors: Record<string, PrMonitorState> = options.monitors ?? {}
  const registry = {
    verifyPr: async () => { calls.verifyPr++; if (options.verifyThrows) throw new Error('PR #7 not found in acme/app.'); return SUMMARY },
    fetchOnce: async (): Promise<PrWatchSessionState> => { calls.fetchOnce++; return { kind: 'ready', prs: [{ id: 'github.com/acme/app#7', origin: 'branch', summary: SUMMARY }] } },
    setSessionBoundPrs: () => { calls.setSessionBoundPrs++ },
    setSessionMonitors: () => { calls.setSessionMonitors++ },
    cachedSessionState: () => options.cached ?? null,
    setAutoMerge: async () => { calls.setAutoMerge++; return { enabled: true, method: 'squash' as const } },
    nudge: async () => { calls.nudge++ },
  }
  const sessionManager = {
    // A non-existent dir: resolveRepo (used only for bare-number fallback) returns null, so URL refs parse fine.
    getSessionSnapshot: () => ({ workspaceId: 'ws', workingDirectory: '/work/app', codingMode: options.codingMode ?? true }),
    getSessionWorkingDirectory: () => '/work/app',
    getSessionBoundPrs: () => bound,
    bindPrToSession: (_s: string, pr: BoundPr) => { calls.bind.push(pr); bound = [...bound, pr]; return bound },
    unbindPrFromSession: () => { calls.unbind++; bound = []; return bound },
    getSessionPrMonitors: () => monitors,
    setSessionPrAutoFix: (_s: string, prId: string, enabled: boolean) => { monitors = { ...monitors, [prId]: { autoFix: enabled || undefined } }; return monitors },
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ops = createPrWatchOps(registry as any, sessionManager as any, {
    resolveWorkspaceRootPath: () => '/ws',
    onMonitorsChanged: sessionId => { calls.monitorsChanged.push(sessionId) },
    resolveRepo: async () => options.checkout ?? null,
  })
  return { ops, calls, monitors: () => monitors }
}

describe('PR watch operations', () => {
  it('bind verifies, then persists and reconciles', async () => {
    const { ops, calls } = fakes()
    const result = await ops.bind('s1', 'https://github.com/acme/app/pull/7')
    expect(result.ok).toBe(true)
    expect(result.pr?.number).toBe(7)
    expect(result.pr?.id).toBe('github.com/acme/app#7')
    expect(calls.verifyPr).toBe(1)
    expect(calls.bind).toHaveLength(1)
    expect(calls.setSessionBoundPrs).toBe(1)
  })

  it('bind does NOT persist when verify fails (R1)', async () => {
    const { ops, calls } = fakes({ verifyThrows: true })
    const result = await ops.bind('s1', 'https://github.com/acme/app/pull/7')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('not found')
    expect(calls.verifyPr).toBe(1)
    expect(calls.bind).toHaveLength(0)
    expect(calls.setSessionBoundPrs).toBe(0)
  })

  it("bind with skipBranchPr (the post-tool hook) leaves out the folder's own branch PR", async () => {
    const checkout: RepoInfo = {
      root: '/work/app', gitDir: '/work/app/.git', commonDir: '/work/app/.git', branch: 'f', pushRemote: 'origin', remoteBranch: 'f',
      repo: { host: 'github.com', owner: 'Acme', repo: 'App' }, upstreamRepo: null,
    }
    const own = fakes({ checkout })
    expect(await own.ops.bind('s1', 'https://github.com/acme/app/pull/7', { skipBranchPr: true })).toMatchObject({ ok: true, skipped: 'branch-pr' })
    expect(own.calls.bind).toHaveLength(0)

    const otherBranch = fakes({ checkout: { ...checkout, branch: 'main', remoteBranch: 'main' } })
    expect((await otherBranch.ops.bind('s1', 'https://github.com/acme/app/pull/7', { skipBranchPr: true })).skipped).toBeUndefined()
    expect(otherBranch.calls.bind).toHaveLength(1)

    const viaTool = fakes({ checkout }) // pr_bind itself always pins
    await viaTool.ops.bind('s1', 'https://github.com/acme/app/pull/7')
    expect(viaTool.calls.bind).toHaveLength(1)
  })

  it('bind rejects an unparseable ref without touching GitHub', async () => {
    const { ops, calls } = fakes()
    const result = await ops.bind('s1', 'not-a-pr')
    expect(result.ok).toBe(false)
    expect(calls.verifyPr).toBe(0)
  })

  it('status for the current session fetches live', async () => {
    const { ops, calls } = fakes()
    const result = await ops.status('s1', { forceFetch: true })
    expect(result.kind).toBe('ready')
    expect(result.cached).toBe(false)
    expect(calls.fetchOnce).toBe(1)
  })

  it('cross-session status is cache-only — never fetches (R3)', async () => {
    const bp: BoundPr = { host: 'github.com', owner: 'Acme', repo: 'App', number: 7, addedAt: 1 }
    const { ops, calls } = fakes({ boundPrs: [bp] })
    const result = await ops.status('other', { forceFetch: false })
    expect(calls.fetchOnce).toBe(0)
    expect(result.cached).toBe(true)
    expect(result.prs.map(p => p.number)).toEqual([7])
    expect(result.prs[0]?.id).toBe('github.com/acme/app#7') // canonical, case-insensitive id
  })

  it('setAutoMerge changes GitHub and nudges the chip', async () => {
    const { ops, calls } = fakes()
    const result = await ops.setAutoMerge('s1', 'https://github.com/acme/app/pull/7', true, 'squash')
    expect(result).toMatchObject({ ok: true, enabled: true, method: 'squash' })
    expect(calls.setAutoMerge).toBe(1)
    expect(calls.nudge).toBe(1)
  })

  it('unbind reconciles bindings and monitors, and re-syncs auto-fix', async () => {
    const bp: BoundPr = { host: 'github.com', owner: 'acme', repo: 'app', number: 7, addedAt: 1 }
    const { ops, calls } = fakes({ boundPrs: [bp] })
    const result = await ops.unbind('s1', 'https://github.com/acme/app/pull/7')
    expect(result.ok).toBe(true)
    expect(result.removed).toBe(true)
    expect(calls.unbind).toBe(1)
    expect(calls.setSessionBoundPrs).toBe(1)
    expect(calls.setSessionMonitors).toBe(1)
    expect(calls.monitorsChanged).toEqual(['s1'])
  })
})

describe('PR watch operations — auto-fix toggle', () => {
  it('persists the toggle by canonical id, pushes it, and re-syncs the monitor', async () => {
    const { ops, calls, monitors } = fakes({ cached: BRANCH_AND_PINNED })
    const result = await ops.setAutoFix('s1', 'github.com/Acme/App#7', true)
    expect(result).toEqual({ ok: true, enabled: true })
    expect(monitors()).toEqual({ 'github.com/acme/app#7': { autoFix: true } })
    expect(calls.setSessionMonitors).toBe(1)
    expect(calls.monitorsChanged).toEqual(['s1'])
  })

  it('refuses outside Coding mode and for something that is not a PR id', async () => {
    expect((await fakes({ codingMode: false }).ops.setAutoFix('s1', 'github.com/acme/app#7', true)).ok).toBe(false)
    const { ops, calls } = fakes()
    expect((await ops.setAutoFix('s1', 'not-an-id', true)).ok).toBe(false)
    expect(calls.monitorsChanged).toEqual([])
  })

  it('turns on only for the branch PR: a pinned PR\'s fix would switch the folder\'s branch', async () => {
    const { ops, calls, monitors } = fakes({ cached: BRANCH_AND_PINNED })
    const pinned = await ops.setAutoFix('s1', 'github.com/acme/lib#9', true)
    expect(pinned.ok).toBe(false)
    expect(pinned.error).toContain("branch's own PR")
    expect((await ops.setAutoFix('s1', 'github.com/acme/other#1', true)).ok).toBe(false) // not tracked
    expect((await fakes().ops.setAutoFix('s1', 'github.com/acme/app#7', true)).ok).toBe(false) // nothing watched yet
    expect(monitors()).toEqual({})
    expect(calls.monitorsChanged).toEqual([])
  })

  it('always turns off, so a toggle left on a PR that is pinned now can be cleared', async () => {
    const { ops, monitors } = fakes({ cached: BRANCH_AND_PINNED, monitors: { 'github.com/acme/lib#9': { autoFix: true } } })
    expect(await ops.setAutoFix('s1', 'github.com/acme/lib#9', false)).toEqual({ ok: true, enabled: false })
    expect(monitors()['github.com/acme/lib#9']?.autoFix).toBeUndefined()
  })

  it('status reports auto-fix on the branch PR only', async () => {
    const both = { 'github.com/acme/app#7': { autoFix: true }, 'github.com/acme/lib#9': { autoFix: true } }
    const { ops } = fakes({ cached: BRANCH_AND_PINNED, monitors: both })
    const result = await ops.status('s1', { forceFetch: false })
    expect(result.prs.map(p => `${p.origin}:${p.autoFix ?? false}`)).toEqual(['branch:true', 'bound:false'])
  })
})
