import { describe, expect, it } from 'bun:test'
import type { PrSummary, PrWatchState } from '@craft-agent/shared/protocol'
import { nextPollDelay, POLL } from './schedule'

const summary: PrSummary = {
  number: 1, title: 't', url: 'u', state: 'open', headRef: 'h', baseRef: 'main', checks: 'success',
  reviewDecision: 'none', mergeState: 'clean', unresolvedThreads: 0, localAhead: 0, localDirty: false,
  fetchedAt: 0, via: 'gh',
}
const pr = (overrides: Partial<PrSummary> = {}): PrWatchState => ({ kind: 'pr', summary: { ...summary, ...overrides } })
const NOW = 1_000_000_000
const at = (state: PrWatchState, extra: Partial<Parameters<typeof nextPollDelay>[0]> = {}) =>
  nextPollDelay({ state, now: NOW, lastChangeAt: NOW - 60 * 60_000, consecutiveErrors: 0, ...extra })

describe('nextPollDelay', () => {
  it('polls fast while checks run', () => {
    expect(at(pr({ checks: 'pending' }))).toBe(POLL.checksRunning)
  })

  it('polls every 30 s right after a change, then every 2 min', () => {
    expect(at(pr(), { lastChangeAt: NOW - 60_000 })).toBe(POLL.recentChange)
    expect(at(pr())).toBe(POLL.quiet)
  })

  it('stops for merged and closed PRs and when the watcher cannot run', () => {
    expect(at(pr({ state: 'merged' }))).toBeNull()
    expect(at(pr({ state: 'closed' }))).toBeNull()
    expect(at({ kind: 'unavailable', reason: 'not-git' })).toBeNull()
    expect(at({ kind: 'unavailable', reason: 'no-token' })).toBeNull()
  })

  it('keeps looking for a PR on a branch without one', () => {
    expect(at({ kind: 'none' })).toBe(POLL.quiet)
  })

  it('backs off exponentially on errors, capped', () => {
    expect(at(pr(), { consecutiveErrors: 1 })).toBe(30_000)
    expect(at(pr(), { consecutiveErrors: 3 })).toBe(120_000)
    expect(at(pr(), { consecutiveErrors: 20 })).toBe(POLL.errorMax)
  })

  it('waits for the rate-limit reset when the budget runs low', () => {
    const resetAt = NOW + 20 * 60_000
    expect(at(pr({ checks: 'pending' }), { rateLimit: { remaining: 50, resetAt } })).toBe(20 * 60_000)
    expect(at(pr({ checks: 'pending' }), { rateLimit: { remaining: 4000, resetAt } })).toBe(POLL.checksRunning)
  })
})
