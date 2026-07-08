import { describe, it, expect } from 'bun:test'
import { resolveNodeStatePill } from '../node-state-pill'
import en from '../../../../../../../../packages/shared/src/i18n/locales/en.json'

const messages = en as Record<string, string>

describe('resolveNodeStatePill', () => {
  it('renders done and failed with distinguishable classes and distinct localized labels', () => {
    const done = resolveNodeStatePill('done')
    const failed = resolveNodeStatePill('failed')

    // Color distinction: a failed node must not look like a done node.
    expect(done.className).not.toBe(failed.className)
    expect(done.className).toContain('emerald')
    expect(failed.className).toContain('red')

    // Distinct label keys, both resolvable to the expected EN strings.
    expect(done.labelKey).toBe('tasks.nodeStateDone')
    expect(failed.labelKey).toBe('tasks.nodeStateFailed')
    expect(done.labelKey).not.toBe(failed.labelKey)
    expect(messages[done.labelKey!]).toBe('Done')
    expect(messages[failed.labelKey!]).toBe('Failed')
  })

  it('keeps cancelled neutral (not red) so it never reads as a failure', () => {
    const cancelled = resolveNodeStatePill('cancelled')
    const pending = resolveNodeStatePill('pending')

    expect(cancelled.className).toBe(pending.className)
    expect(cancelled.className).not.toContain('red')
    expect(cancelled.className).not.toContain('emerald')
    expect(cancelled.className).not.toContain('amber')
    expect(cancelled.labelKey).toBe('tasks.nodeStateCancelled')
    expect(messages[cancelled.labelKey!]).toBe('Cancelled')
  })

  it('falls back to a neutral pill with no label key for unknown states', () => {
    const unknown = resolveNodeStatePill('some-future-state')
    const pending = resolveNodeStatePill('pending')

    expect(unknown.className).toBe(pending.className)
    expect(unknown.labelKey).toBeNull()
  })

  it('maps every NodeRunState literal to an existing en.json label', () => {
    for (const state of ['pending', 'running', 'done', 'failed', 'cancelled', 'skipped']) {
      const { labelKey } = resolveNodeStatePill(state)
      expect(labelKey).not.toBeNull()
      expect(messages[labelKey!]).toBeTruthy()
    }
  })
})
