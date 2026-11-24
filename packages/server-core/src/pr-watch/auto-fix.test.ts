import { describe, expect, it } from 'bun:test'
import type { PrMonitorState, PrSummary, PrWatchSessionState } from '@craft-agent/shared/protocol'
import { AUTO_FIX_INTERVAL_MS } from '@craft-agent/shared/pr-watch'
import { AUTO_FIX_CLIENT_ID, createAutoFixMonitor } from './auto-fix'

const ENTRY_ID = 'github.com/acme/app#7'

function summary(overrides: Partial<PrSummary> = {}): PrSummary {
  return {
    number: 7, title: 'Feature', url: 'https://github.com/acme/app/pull/7', state: 'open',
    headRef: 'feat/x', baseRef: 'main', checks: 'success', reviewDecision: 'review_required', mergeState: 'blocked',
    unresolvedThreads: 2, localAhead: 0, localDirty: false, fetchedAt: 1, via: 'gh',
    ...overrides,
  }
}

const ready = (overrides: Partial<PrSummary> = {}): PrWatchSessionState =>
  ({ kind: 'ready', prs: [{ id: ENTRY_ID, origin: 'branch', summary: summary(overrides) }] })

function setup(options: { session?: Record<string, unknown>; autoFix?: boolean; subscribeState?: PrWatchSessionState } = {}) {
  let clock = 1_000_000
  let tokens = ['t:A:1', 't:B:2']
  let wakeResult = true
  let monitors: Record<string, PrMonitorState> = options.autoFix === false ? {} : { [ENTRY_ID]: { autoFix: true } }
  const session = { id: 's1', codingMode: true, isArchived: false, permissionMode: 'allow-all', isProcessing: false, workspaceId: 'ws', workingDirectory: '/work/app', ...options.session }
  const calls = { subscribe: [] as Array<{ clientId: string }>, unsubscribe: [] as string[], fetch: 0, wake: [] as string[], setMonitors: 0 }
  let nextSub = 1

  const registry = {
    subscribe: async (input: { clientId: string }) => { calls.subscribe.push(input); return { subscriptionId: `sub-${nextSub++}`, state: options.subscribeState ?? { kind: 'loading' } } },
    unsubscribe: (id: string) => { calls.unsubscribe.push(id) },
    fetchReviewSignature: async () => { calls.fetch++; return tokens },
    setSessionMonitors: () => { calls.setMonitors++ },
  }
  const sessionManager = {
    getSessionSnapshot: () => session,
    getSessionWorkingDirectory: () => '/work/app',
    getSessionBoundPrs: () => [],
    getSessionPrMonitors: () => monitors,
    getSessions: () => [{ ...session, prMonitors: monitors }],
    recordPrAutoFixRun: (_s: string, prId: string, signature: string[], at: number) => {
      monitors = { ...monitors, [prId]: { ...monitors[prId], lastFixAt: at, lastFixSignature: signature } }
    },
    wakeIdleSessionWithNotice: (_s: string, text: string) => { if (wakeResult) calls.wake.push(text); return wakeResult },
  }
  const monitor = createAutoFixMonitor({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getRegistry: () => registry as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sessionManager: sessionManager as any,
    resolveWorkspaceRootPath: () => '/ws',
    now: () => clock,
  })
  const flush = async () => { for (let i = 0; i < 3; i++) await new Promise(r => setTimeout(r, 0)) }
  return {
    monitor, calls, session, flush,
    advance: (ms: number) => { clock += ms },
    setTokens: (next: string[]) => { tokens = next },
    setWake: (value: boolean) => { wakeResult = value },
    setMonitors: (next: Record<string, PrMonitorState>) => { monitors = next },
    monitors: () => monitors,
    /** Arm, then deliver one push and let the evaluation finish */
    async push(state: PrWatchSessionState) { this.monitor.onState('s1', state); await flush() },
  }
}

describe('auto-fix arming', () => {
  it('arms with its own subscription while auto-fix is on, and disarms when it goes off', async () => {
    const t = setup()
    await t.monitor.sync('s1')
    expect(t.calls.subscribe.map(s => s.clientId)).toEqual([AUTO_FIX_CLIENT_ID])
    expect(t.monitor.armedSessions()).toEqual(['s1'])

    await t.monitor.sync('s1') // already armed for the same folder: no second subscription
    expect(t.calls.subscribe).toHaveLength(1)

    t.setMonitors({})
    await t.monitor.sync('s1')
    expect(t.calls.unsubscribe).toEqual(['sub-1'])
    expect(t.monitor.armedSessions()).toEqual([])
  })

  it('never arms a session outside Coding mode or an archived one', async () => {
    const notCoding = setup({ session: { codingMode: false } })
    await notCoding.monitor.sync('s1')
    expect(notCoding.calls.subscribe).toHaveLength(0)
    const archived = setup({ session: { isArchived: true } })
    await archived.monitor.sync('s1')
    expect(archived.calls.subscribe).toHaveLength(0)
  })

  it('looks right away when it joins a watcher that already has data (no wait for the next poll)', async () => {
    const t = setup({ subscribeState: ready() })
    await t.monitor.sync('s1')
    expect(t.calls.wake).toHaveLength(1)
  })

  it('re-arms every session with auto-fix on at app start', async () => {
    const t = setup()
    await t.monitor.armAll()
    expect(t.monitor.armedSessions()).toEqual(['s1'])
  })

  it('ignores pushes for a session it has not armed', async () => {
    const t = setup()
    await t.push(ready())
    expect(t.calls.fetch).toBe(0)
  })
})

describe('auto-fix firing', () => {
  it('starts one hidden fix turn for new review feedback and records what it acted on', async () => {
    const t = setup()
    await t.monitor.sync('s1')
    await t.push(ready())
    expect(t.calls.wake).toHaveLength(1)
    expect(t.calls.wake[0]).toContain('Auto-fix is on for pull request #7')
    expect(t.monitors()[ENTRY_ID]).toMatchObject({ autoFix: true, lastFixSignature: ['t:A:1', 't:B:2'] })
    expect(t.calls.setMonitors).toBe(1) // the card learns the last-run time
  })

  it('checks at most once per 5 minutes', async () => {
    const t = setup()
    await t.monitor.sync('s1')
    await t.push(ready())
    await t.push(ready())
    await t.push(ready())
    expect(t.calls.fetch).toBe(1)
  })

  it('does not re-fix the same feedback (fixed locally, threads still open on GitHub)', async () => {
    const t = setup()
    await t.monitor.sync('s1')
    await t.push(ready())
    t.advance(AUTO_FIX_INTERVAL_MS + 1)
    await t.push(ready())
    expect(t.calls.fetch).toBe(2)
    expect(t.calls.wake).toHaveLength(1)
  })

  it('fixes again when a reviewer adds feedback', async () => {
    const t = setup()
    await t.monitor.sync('s1')
    await t.push(ready())
    t.advance(AUTO_FIX_INTERVAL_MS + 1)
    t.setTokens(['t:A:1', 't:B:2', 't:C:3'])
    await t.push(ready())
    expect(t.calls.wake).toHaveLength(2)
  })

  it('leaves conflicts, merged/closed PRs and PRs without feedback alone', async () => {
    const t = setup()
    await t.monitor.sync('s1')
    await t.push(ready({ mergeState: 'conflicting' }))
    await t.push(ready({ state: 'merged' }))
    await t.push(ready({ unresolvedThreads: 0 }))
    expect(t.calls.fetch).toBe(0)
    expect(t.calls.wake).toHaveLength(0)
  })

  it('never runs in Explore or while the session is busy', async () => {
    const explore = setup({ session: { permissionMode: 'safe' } })
    await explore.monitor.sync('s1')
    await explore.push(ready())
    expect(explore.calls.fetch).toBe(0)

    const busy = setup({ session: { isProcessing: true } })
    await busy.monitor.sync('s1')
    await busy.push(ready())
    expect(busy.calls.fetch).toBe(0)
  })

  it('retries on the next push when the session turned busy just before the wake', async () => {
    const t = setup()
    await t.monitor.sync('s1')
    t.setWake(false)
    await t.push(ready())
    expect(t.calls.wake).toHaveLength(0)
    expect(t.monitors()[ENTRY_ID]?.lastFixAt).toBeUndefined()
    t.setWake(true)
    await t.push(ready()) // no 5-minute wait: the failed attempt didn't count
    expect(t.calls.wake).toHaveLength(1)
  })

  it('never touches a pinned PR, even with auto-fix stored on for it (its branch isn\'t checked out)', async () => {
    const t = setup()
    await t.monitor.sync('s1')
    await t.push({ kind: 'ready', prs: [{ id: ENTRY_ID, origin: 'bound', summary: summary() }] })
    expect(t.calls.fetch).toBe(0)
    expect(t.calls.wake).toHaveLength(0)
  })

  it('does nothing for a PR whose auto-fix is off', async () => {
    const t = setup()
    await t.monitor.sync('s1')
    t.setMonitors({ 'github.com/other/repo#9': { autoFix: true } })
    await t.push(ready())
    expect(t.calls.fetch).toBe(0)
  })
})
