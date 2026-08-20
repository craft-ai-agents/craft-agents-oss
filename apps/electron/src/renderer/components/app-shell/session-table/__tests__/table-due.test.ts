import { describe, expect, it } from 'bun:test'
import { isDueOverdue } from '../table-due'

const NOW = Date.UTC(2026, 7, 8, 15, 0, 0)
const YESTERDAY_NOON = Date.UTC(2026, 7, 7, 12, 0, 0)

describe('isDueOverdue', () => {
  it('marks an actionable session due before today as overdue', () => {
    expect(isDueOverdue(YESTERDAY_NOON, 'todo', NOW)).toBe(true)
  })

  it('does not mark terminal done or cancelled sessions as overdue', () => {
    expect(isDueOverdue(YESTERDAY_NOON, 'done', NOW)).toBe(false)
    expect(isDueOverdue(YESTERDAY_NOON, 'cancelled', NOW)).toBe(false)
  })
})
