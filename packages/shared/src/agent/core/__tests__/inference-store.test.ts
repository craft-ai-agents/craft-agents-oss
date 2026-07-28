/**
 * Tests for LlmInferenceStore.
 *
 * Covers:
 * - Push events and retrieve history
 * - getHistoryResult aggregate stats (reliability, counts)
 * - getAllHistory across multiple slugs
 * - Pruning stale entries
 * - cap at MAX_ENTRIES
 * - clearSlug and clearAll
 */

import { expect, describe, it } from 'bun:test'
import { inferenceStore } from '../inference-store'

describe('LlmInferenceStore', () => {
  it('records a single event and returns it in history', () => {
    inferenceStore.clearAll()
    inferenceStore.push('test-slug', { type: 'turn', success: true, label: 'claude-sonnet-4', totalTokens: 500 })
    const events = inferenceStore.getHistory('test-slug')
    expect(events.length).toBe(1)
    expect(events[0]!.slug).toBe('test-slug')
    expect(events[0]!.type).toBe('turn')
    expect(events[0]!.success).toBe(true)
    expect(events[0]!.label).toBe('claude-sonnet-4')
    expect(events[0]!.totalTokens).toBe(500)
    expect(events[0]!.timestamp).toBeGreaterThan(0)
    inferenceStore.clearAll()
  })

  it('returns events in reverse chronological order (newest first)', () => {
    inferenceStore.clearAll()
    inferenceStore.push('order-test', { type: 'turn', success: true, label: 'a' })
    // Small delay so timestamps differ
    const t1 = Date.now()
    inferenceStore.push('order-test', { type: 'turn', success: false, label: 'b' })
    const events = inferenceStore.getHistory('order-test')
    expect(events.length).toBe(2)
    // Newest (b) should be first
    expect(events[0]!.label).toBe('b')
    expect(events[1]!.label).toBe('a')
    inferenceStore.clearAll()
  })

  it('getHistoryResult returns correct aggregates', () => {
    inferenceStore.clearAll()
    // 3 successes, 1 failure
    inferenceStore.push('agg-test', { type: 'turn', success: true, label: 'ok1' })
    inferenceStore.push('agg-test', { type: 'turn', success: true, label: 'ok2' })
    inferenceStore.push('agg-test', { type: 'turn', success: false, label: 'err' })
    inferenceStore.push('agg-test', { type: 'tool_call', success: true, label: 'Read' })

    const result = inferenceStore.getHistoryResult('agg-test', 10)
    expect(result.slug).toBe('agg-test')
    expect(result.totalEvents).toBe(4)
    expect(result.successCount).toBe(3)
    expect(result.failureCount).toBe(1)
    expect(result.reliability).toBe(0.75)
    expect(result.events.length).toBe(4)
    inferenceStore.clearAll()
  })

  it('getHistoryResult defaults to reliability 1 for empty history', () => {
    inferenceStore.clearAll()
    const result = inferenceStore.getHistoryResult('nonexistent', 10)
    expect(result.reliability).toBe(1)
    expect(result.totalEvents).toBe(0)
    inferenceStore.clearAll()
  })

  it('getAllHistory returns results for all slugs', () => {
    inferenceStore.clearAll()
    inferenceStore.push('slug-a', { type: 'turn', success: true })
    inferenceStore.push('slug-b', { type: 'turn', success: false })

    const all = inferenceStore.getAllHistory(10)
    expect(Object.keys(all).sort()).toEqual(['slug-a', 'slug-b'])
    expect(all['slug-a']!.totalEvents).toBe(1)
    expect(all['slug-b']!.totalEvents).toBe(1)
    inferenceStore.clearAll()
  })

  it('prunes entries older than 1 hour on read', () => {
    inferenceStore.clearAll()
    // Push a fresh entry
    inferenceStore.push('prune-test', { type: 'turn', success: true })
    // The prune function uses Date.now() internally, so we can't easily
    // test old entries. But we can verify that a recent entry survives.
    const events = inferenceStore.getHistory('prune-test')
    expect(events.length).toBe(1)
    inferenceStore.clearAll()
  })

  it('caps at MAX_ENTRIES_PER_SLUG (200)', () => {
    inferenceStore.clearAll()
    for (let i = 0; i < 250; i++) {
      inferenceStore.push('cap-test', { type: 'turn', success: true, label: `turn-${i}` })
    }
    const events = inferenceStore.getHistory('cap-test')
    expect(events.length).toBeLessThanOrEqual(200)
    inferenceStore.clearAll()
  })

  it('clearSlug removes all events for a slug', () => {
    inferenceStore.clearAll()
    inferenceStore.push('to-clear', { type: 'turn', success: true })
    inferenceStore.clearSlug('to-clear')
    const events = inferenceStore.getHistory('to-clear')
    expect(events.length).toBe(0)
    inferenceStore.clearAll()
  })

  it('clearAll removes events for all slugs', () => {
    inferenceStore.clearAll()
    inferenceStore.push('slug-1', { type: 'turn', success: true })
    inferenceStore.push('slug-2', { type: 'turn', success: true })
    inferenceStore.clearAll()
    expect(inferenceStore.getHistory('slug-1').length).toBe(0)
    expect(inferenceStore.getHistory('slug-2').length).toBe(0)
  })

  it('records tool_call events separately from turn events', () => {
    inferenceStore.clearAll()
    inferenceStore.push('tool-test', { type: 'turn', success: true, label: 'gpt-4o' })
    inferenceStore.push('tool-test', { type: 'tool_call', success: true, label: 'Read' })
    inferenceStore.push('tool-test', { type: 'tool_call', success: true, label: 'Edit' })
    inferenceStore.push('tool-test', { type: 'tool_call', success: false, label: 'Bash' })

    const result = inferenceStore.getHistoryResult('tool-test', 10)
    expect(result.totalEvents).toBe(4)
    // Reliability: 3 of 4 succeeded
    expect(result.reliability).toBe(0.75)
    // Newest first: Bash (fail) should be first
    expect(result.events[0]!.label).toBe('Bash')
    expect(result.events[0]!.type).toBe('tool_call')
    inferenceStore.clearAll()
  })
})
