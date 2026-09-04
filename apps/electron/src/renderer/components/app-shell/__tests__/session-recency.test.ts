import { describe, expect, it } from 'bun:test'

import { getSessionDateGroupKey, isWithinRecency, OLDER_SESSION_GROUP_KEY } from '../session-recency'

const NOW = Date.parse('2026-08-28T12:00:00+08:00')

describe('date recency filters', () => {
  it('keeps the latest 30 calendar days expanded and aggregates earlier dates', () => {
    expect(getSessionDateGroupKey(Date.parse('2026-07-30T09:00:00+08:00'), 30, NOW)).not.toBe(OLDER_SESSION_GROUP_KEY)
    expect(getSessionDateGroupKey(Date.parse('2026-07-29T23:59:59+08:00'), 30, NOW)).toBe(OLDER_SESSION_GROUP_KEY)
  })

  it('supports seven days and all time', () => {
    const timestamp = Date.parse('2026-08-20T09:00:00+08:00')
    expect(isWithinRecency(timestamp, 7, NOW)).toBe(false)
    expect(isWithinRecency(timestamp, 30, NOW)).toBe(true)
    expect(isWithinRecency(timestamp, null, NOW)).toBe(true)
    expect(getSessionDateGroupKey(timestamp, null, NOW)).not.toBe(OLDER_SESSION_GROUP_KEY)
  })
})
