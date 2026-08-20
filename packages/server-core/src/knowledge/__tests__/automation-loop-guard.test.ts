/**
 * AutomationLoopGuard — loop-safety for knowledge automations (P6 / K-10).
 */
import { describe, expect, it } from 'bun:test'
import { AutomationLoopGuard } from '../automation-loop-guard'

describe('AutomationLoopGuard', () => {
  it('suppresses same automation+ref within TTL', () => {
    let now = 1_000_000
    const guard = new AutomationLoopGuard({ ttlMs: 120_000, now: () => now })

    guard.noteWrite({
      connectionId: 'c1',
      refId: 'doc-1',
      automationId: 'auto-a',
      ts: now,
    })

    expect(
      guard.shouldSuppress({
        connectionId: 'c1',
        refId: 'doc-1',
        automationId: 'auto-a',
        now,
      }),
    ).toBe(true)

    // Different automation is not suppressed
    expect(
      guard.shouldSuppress({
        connectionId: 'c1',
        refId: 'doc-1',
        automationId: 'auto-b',
        now,
      }),
    ).toBe(false)

    // Different ref is not suppressed
    expect(
      guard.shouldSuppress({
        connectionId: 'c1',
        refId: 'doc-2',
        automationId: 'auto-a',
        now,
      }),
    ).toBe(false)
  })

  it('suppresses attribute writes and content marker', () => {
    const now = 5_000_000
    const guard = new AutomationLoopGuard({ ttlMs: 120_000, now: () => now })

    guard.noteWrite({
      connectionId: 'c1',
      refId: 'blk-1',
      attrName: 'knowledge-workflow_status',
      automationId: 'auto-a',
      ts: now,
    })

    expect(
      guard.shouldSuppress({
        connectionId: 'c1',
        refId: 'blk-1',
        attrName: 'knowledge-workflow_status',
        automationId: 'auto-a',
        now,
      }),
    ).toBe(true)

    // Content-level marker also set so DocumentUpdated after set_attribute can suppress
    expect(
      guard.shouldSuppress({
        connectionId: 'c1',
        refId: 'blk-1',
        automationId: 'auto-a',
        now,
      }),
    ).toBe(true)
  })

  it('expires after TTL', () => {
    let now = 10_000_000
    const guard = new AutomationLoopGuard({ ttlMs: 120_000, now: () => now })

    guard.noteWrite({
      connectionId: 'c1',
      refId: 'doc-1',
      automationId: 'auto-a',
      ts: now,
    })

    now += 120_001
    expect(
      guard.shouldSuppress({
        connectionId: 'c1',
        refId: 'doc-1',
        automationId: 'auto-a',
        now,
      }),
    ).toBe(false)
    expect(guard.size()).toBe(0)
  })

  it('shouldSuppressRef suppresses without automationId (watcher emit path)', () => {
    const now = 20_000_000
    const guard = new AutomationLoopGuard({ ttlMs: 120_000, now: () => now })

    guard.noteWrite({
      connectionId: 'c1',
      refId: 'doc-1',
      attrName: 'workflow_status',
      automationId: 'auto-a',
      ts: now,
    })

    // Watcher has no automationId on payload — still suppress
    expect(
      guard.shouldSuppressRef({
        connectionId: 'c1',
        refId: 'doc-1',
        attrName: 'workflow_status',
        now,
      }),
    ).toBe(true)

    // Content-level (DocumentUpdated) also suppressed via wildcard content marker
    expect(
      guard.shouldSuppressRef({
        connectionId: 'c1',
        refId: 'doc-1',
        now,
      }),
    ).toBe(true)

    // Different attr not suppressed by exact attr note alone... content * marker
    // is set, so any attr on this ref is suppressed when attrName provided and *
    // matches — shouldSuppressRef treats * as match for any attrName.
    expect(
      guard.shouldSuppressRef({
        connectionId: 'c1',
        refId: 'doc-1',
        attrName: 'other_attr',
        now,
      }),
    ).toBe(true)

    // Different ref not suppressed
    expect(
      guard.shouldSuppressRef({
        connectionId: 'c1',
        refId: 'doc-2',
        attrName: 'workflow_status',
        now,
      }),
    ).toBe(false)
  })
})
