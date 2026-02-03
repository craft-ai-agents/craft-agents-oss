/**
 * Tests for schedule utility functions.
 *
 * Covers:
 * - formatTime: formatting a ScheduleTime to a readable string
 * - formatTimes: formatting an array of ScheduleTimes
 * - getNextRunTime: calculating when a schedule will next run
 * - formatRelativeTime: formatting a date as relative time
 * - formatLastRunTime: formatting a timestamp as relative past time
 */

import { describe, it, expect } from 'bun:test'
import {
  formatTime,
  formatTimes,
  getNextRunTime,
  formatRelativeTime,
  formatLastRunTime,
  formatScheduleDescription,
} from '../utils.ts'
import type { ScheduledPromptConfig, ScheduleTime } from '../types.ts'

// ============================================
// formatTime
// ============================================

describe('formatTime', () => {
  it('formats morning hour without minutes', () => {
    expect(formatTime({ hour: 8, minute: 0 })).toBe('8am')
  })

  it('formats afternoon hour without minutes', () => {
    expect(formatTime({ hour: 15, minute: 0 })).toBe('3pm')
  })

  it('formats time with minutes', () => {
    expect(formatTime({ hour: 9, minute: 30 })).toBe('9:30am')
  })

  it('formats midnight as 12am', () => {
    expect(formatTime({ hour: 0, minute: 0 })).toBe('12am')
  })

  it('formats noon as 12pm', () => {
    expect(formatTime({ hour: 12, minute: 0 })).toBe('12pm')
  })

  it('formats 11pm correctly', () => {
    expect(formatTime({ hour: 23, minute: 0 })).toBe('11pm')
  })

  it('pads single digit minutes with zero', () => {
    expect(formatTime({ hour: 10, minute: 5 })).toBe('10:05am')
  })
})

// ============================================
// formatTimes
// ============================================

describe('formatTimes', () => {
  it('formats single time', () => {
    expect(formatTimes([{ hour: 9, minute: 0 }])).toBe('9am')
  })

  it('formats multiple times with comma separator', () => {
    const times: ScheduleTime[] = [
      { hour: 8, minute: 0 },
      { hour: 11, minute: 0 },
      { hour: 15, minute: 0 },
    ]
    expect(formatTimes(times)).toBe('8am, 11am, 3pm')
  })

  it('formats empty array', () => {
    expect(formatTimes([])).toBe('')
  })
})

// ============================================
// getNextRunTime
// ============================================

describe('getNextRunTime', () => {
  // Helper to create a minimal schedule config
  function createSchedule(overrides: Partial<ScheduledPromptConfig>): ScheduledPromptConfig {
    return {
      id: 'test',
      name: 'Test',
      prompt: 'Test prompt',
      times: [{ hour: 9, minute: 0 }],
      enabled: true,
      createdAt: Date.now(),
      ...overrides,
    }
  }

  it('returns null for disabled schedules', () => {
    const schedule = createSchedule({ enabled: false })
    expect(getNextRunTime(schedule)).toBeNull()
  })

  it('returns null for schedules with no times', () => {
    const schedule = createSchedule({ times: [] })
    expect(getNextRunTime(schedule)).toBeNull()
  })

  it('returns next time today if time is in the future', () => {
    // Set "now" to 8am
    const now = new Date('2024-01-15T08:00:00')
    const schedule = createSchedule({ times: [{ hour: 9, minute: 0 }] })

    const result = getNextRunTime(schedule, now)

    expect(result).not.toBeNull()
    expect(result!.getHours()).toBe(9)
    expect(result!.getMinutes()).toBe(0)
    expect(result!.toDateString()).toBe(now.toDateString())
  })

  it('returns next day if all times have passed today', () => {
    // Set "now" to 5pm
    const now = new Date('2024-01-15T17:00:00')
    const schedule = createSchedule({ times: [{ hour: 9, minute: 0 }] })

    const result = getNextRunTime(schedule, now)

    expect(result).not.toBeNull()
    expect(result!.getHours()).toBe(9)
    // Should be tomorrow
    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)
    expect(result!.toDateString()).toBe(tomorrow.toDateString())
  })

  it('returns earliest matching time regardless of list order', () => {
    // Set "now" to 7am
    const now = new Date('2024-01-15T07:00:00')
    const schedule = createSchedule({
      times: [
        { hour: 15, minute: 0 },
        { hour: 8, minute: 0 },
        { hour: 11, minute: 0 },
      ],
    })

    const result = getNextRunTime(schedule, now)

    expect(result).not.toBeNull()
    // Returns earliest time in the future (8:00), not first in list order
    expect(result!.getHours()).toBe(8)
  })

  it('respects day restrictions - skips days not in schedule', () => {
    // Set "now" to Monday 5pm (after the scheduled time)
    const monday = new Date('2024-01-15T17:00:00') // Monday
    const schedule = createSchedule({
      times: [{ hour: 9, minute: 0 }],
      days: ['wed', 'fri'], // Only Wednesday and Friday
    })

    const result = getNextRunTime(schedule, monday)

    expect(result).not.toBeNull()
    // Should skip Tuesday, land on Wednesday
    expect(result!.getDay()).toBe(3) // Wednesday
  })

  it('returns today if day is in schedule and time is in future', () => {
    // Set "now" to Monday 8am
    const monday = new Date('2024-01-15T08:00:00') // Monday
    const schedule = createSchedule({
      times: [{ hour: 9, minute: 0 }],
      days: ['mon', 'wed', 'fri'],
    })

    const result = getNextRunTime(schedule, monday)

    expect(result).not.toBeNull()
    expect(result!.toDateString()).toBe(monday.toDateString())
    expect(result!.getDay()).toBe(1) // Monday
  })

  it('handles weekday-only schedules', () => {
    // Set "now" to Friday 5pm
    const friday = new Date('2024-01-19T17:00:00') // Friday
    const schedule = createSchedule({
      times: [{ hour: 9, minute: 0 }],
      days: ['mon', 'tue', 'wed', 'thu', 'fri'],
    })

    const result = getNextRunTime(schedule, friday)

    expect(result).not.toBeNull()
    // Should skip Saturday and Sunday, land on Monday
    expect(result!.getDay()).toBe(1) // Monday
  })
})

// ============================================
// formatRelativeTime
// ============================================

describe('formatRelativeTime', () => {
  it('formats time within the same hour as minutes', () => {
    const now = new Date('2024-01-15T10:00:00')
    const future = new Date('2024-01-15T10:30:00')

    expect(formatRelativeTime(future, now)).toBe('in 30 mins')
  })

  it('formats singular minute', () => {
    const now = new Date('2024-01-15T10:00:00')
    const future = new Date('2024-01-15T10:01:00')

    expect(formatRelativeTime(future, now)).toBe('in 1 min')
  })

  it('formats time more than an hour as hours', () => {
    const now = new Date('2024-01-15T10:00:00')
    const future = new Date('2024-01-15T12:30:00')

    expect(formatRelativeTime(future, now)).toBe('in 3 hours')
  })

  it('formats singular hour', () => {
    const now = new Date('2024-01-15T10:00:00')
    const future = new Date('2024-01-15T11:00:00')

    expect(formatRelativeTime(future, now)).toBe('in 1 hour')
  })

  it('formats tomorrow with time', () => {
    const now = new Date('2024-01-15T10:00:00')
    const tomorrow = new Date('2024-01-16T09:00:00')

    expect(formatRelativeTime(tomorrow, now)).toBe('tomorrow 9am')
  })

  it('formats later in the week with day name', () => {
    const monday = new Date('2024-01-15T10:00:00') // Monday
    const wednesday = new Date('2024-01-17T09:00:00') // Wednesday

    expect(formatRelativeTime(wednesday, monday)).toBe('Wed 9am')
  })
})

// ============================================
// formatLastRunTime
// ============================================

describe('formatLastRunTime', () => {
  it('returns null for undefined timestamp', () => {
    expect(formatLastRunTime(undefined)).toBeNull()
  })

  it('formats recent time as just now', () => {
    const now = new Date('2024-01-15T10:00:30')
    const recent = now.getTime() - 20000 // 20 seconds ago

    expect(formatLastRunTime(recent, now)).toBe('just now')
  })

  it('formats minutes ago', () => {
    const now = new Date('2024-01-15T10:30:00')
    const past = now.getTime() - 15 * 60 * 1000 // 15 minutes ago

    expect(formatLastRunTime(past, now)).toBe('15m ago')
  })

  it('formats hours ago', () => {
    const now = new Date('2024-01-15T15:00:00')
    const past = now.getTime() - 3 * 60 * 60 * 1000 // 3 hours ago

    expect(formatLastRunTime(past, now)).toBe('3h ago')
  })

  it('formats yesterday', () => {
    const now = new Date('2024-01-16T10:00:00')
    const yesterday = new Date('2024-01-15T10:00:00').getTime()

    expect(formatLastRunTime(yesterday, now)).toBe('yesterday')
  })

  it('formats multiple days ago', () => {
    const now = new Date('2024-01-20T10:00:00')
    const past = now.getTime() - 5 * 24 * 60 * 60 * 1000 // 5 days ago

    expect(formatLastRunTime(past, now)).toBe('5d ago')
  })
})

// ============================================
// formatScheduleDescription
// ============================================

describe('formatScheduleDescription', () => {
  // Helper to create a schedule with specific times and days
  const createSchedule = (
    times: ScheduleTime[],
    days?: ('sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat')[]
  ): ScheduledPromptConfig => ({
    id: 'test',
    name: 'Test',
    prompt: 'Test prompt',
    times,
    days,
    enabled: true,
    createdAt: Date.now(),
  })

  // --- No times ---
  it('returns "No times set" when times array is empty', () => {
    const schedule = createSchedule([])
    expect(formatScheduleDescription(schedule)).toBe('No times set')
  })

  // --- Every day (no day restriction) ---
  it('formats every day at single time', () => {
    const schedule = createSchedule([{ hour: 9, minute: 0 }])
    expect(formatScheduleDescription(schedule)).toBe('Every day at 9am')
  })

  it('formats every day at single time with minutes', () => {
    const schedule = createSchedule([{ hour: 9, minute: 30 }])
    expect(formatScheduleDescription(schedule)).toBe('Every day at 9:30am')
  })

  it('formats every day at afternoon time', () => {
    const schedule = createSchedule([{ hour: 15, minute: 0 }])
    expect(formatScheduleDescription(schedule)).toBe('Every day at 3pm')
  })

  it('formats every day at multiple times', () => {
    const schedule = createSchedule([
      { hour: 9, minute: 0 },
      { hour: 15, minute: 0 },
    ])
    expect(formatScheduleDescription(schedule)).toBe('Every day at 9am, 3pm')
  })

  it('formats every day at three times', () => {
    const schedule = createSchedule([
      { hour: 8, minute: 0 },
      { hour: 12, minute: 0 },
      { hour: 18, minute: 0 },
    ])
    expect(formatScheduleDescription(schedule)).toBe('Every day at 8am, 12pm, 6pm')
  })

  // --- All 7 days explicitly set (same as no restriction) ---
  it('formats all 7 days as "Every day"', () => {
    const schedule = createSchedule(
      [{ hour: 9, minute: 0 }],
      ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
    )
    expect(formatScheduleDescription(schedule)).toBe('Every day at 9am')
  })

  // --- Single day ---
  it('formats single day - Monday', () => {
    const schedule = createSchedule([{ hour: 9, minute: 0 }], ['mon'])
    expect(formatScheduleDescription(schedule)).toBe('Every Monday at 9am')
  })

  it('formats single day - Wednesday', () => {
    const schedule = createSchedule([{ hour: 9, minute: 0 }], ['wed'])
    expect(formatScheduleDescription(schedule)).toBe('Every Wednesday at 9am')
  })

  it('formats single day - Sunday', () => {
    const schedule = createSchedule([{ hour: 10, minute: 30 }], ['sun'])
    expect(formatScheduleDescription(schedule)).toBe('Every Sunday at 10:30am')
  })

  it('formats single day - Saturday with multiple times', () => {
    const schedule = createSchedule(
      [{ hour: 9, minute: 0 }, { hour: 14, minute: 0 }],
      ['sat']
    )
    expect(formatScheduleDescription(schedule)).toBe('Every Saturday at 9am, 2pm')
  })

  // --- Weekdays ---
  it('formats weekdays', () => {
    const schedule = createSchedule(
      [{ hour: 9, minute: 0 }],
      ['mon', 'tue', 'wed', 'thu', 'fri']
    )
    expect(formatScheduleDescription(schedule)).toBe('Weekdays at 9am')
  })

  it('formats weekdays with multiple times', () => {
    const schedule = createSchedule(
      [{ hour: 9, minute: 0 }, { hour: 17, minute: 0 }],
      ['mon', 'tue', 'wed', 'thu', 'fri']
    )
    expect(formatScheduleDescription(schedule)).toBe('Weekdays at 9am, 5pm')
  })

  // --- Weekends ---
  it('formats weekends', () => {
    const schedule = createSchedule(
      [{ hour: 10, minute: 0 }],
      ['sat', 'sun']
    )
    expect(formatScheduleDescription(schedule)).toBe('Weekends at 10am')
  })

  it('formats weekends with afternoon time', () => {
    const schedule = createSchedule(
      [{ hour: 14, minute: 30 }],
      ['sat', 'sun']
    )
    expect(formatScheduleDescription(schedule)).toBe('Weekends at 2:30pm')
  })

  // --- Multiple specific days (not weekdays/weekends) ---
  it('formats two specific days', () => {
    const schedule = createSchedule(
      [{ hour: 9, minute: 0 }],
      ['mon', 'wed']
    )
    expect(formatScheduleDescription(schedule)).toBe('Mon, Wed at 9am')
  })

  it('formats three specific days', () => {
    const schedule = createSchedule(
      [{ hour: 9, minute: 0 }],
      ['mon', 'wed', 'fri']
    )
    expect(formatScheduleDescription(schedule)).toBe('Mon, Wed, Fri at 9am')
  })

  it('formats four specific days', () => {
    const schedule = createSchedule(
      [{ hour: 8, minute: 0 }],
      ['tue', 'wed', 'thu', 'fri']
    )
    expect(formatScheduleDescription(schedule)).toBe('Tue, Wed, Thu, Fri at 8am')
  })

  it('formats specific days with multiple times', () => {
    const schedule = createSchedule(
      [{ hour: 9, minute: 0 }, { hour: 15, minute: 0 }],
      ['mon', 'thu']
    )
    expect(formatScheduleDescription(schedule)).toBe('Mon, Thu at 9am, 3pm')
  })

  // --- Days are sorted in week order regardless of input order ---
  it('sorts days in week order', () => {
    const schedule = createSchedule(
      [{ hour: 9, minute: 0 }],
      ['fri', 'mon', 'wed'] // Out of order
    )
    expect(formatScheduleDescription(schedule)).toBe('Mon, Wed, Fri at 9am')
  })

  it('sorts days including weekend', () => {
    const schedule = createSchedule(
      [{ hour: 10, minute: 0 }],
      ['sun', 'tue', 'sat'] // Out of order with weekends
    )
    expect(formatScheduleDescription(schedule)).toBe('Tue, Sat, Sun at 10am')
  })

  // --- Edge cases ---
  it('formats midnight', () => {
    const schedule = createSchedule([{ hour: 0, minute: 0 }])
    expect(formatScheduleDescription(schedule)).toBe('Every day at 12am')
  })

  it('formats noon', () => {
    const schedule = createSchedule([{ hour: 12, minute: 0 }])
    expect(formatScheduleDescription(schedule)).toBe('Every day at 12pm')
  })

  it('formats 11pm with minutes', () => {
    const schedule = createSchedule([{ hour: 23, minute: 45 }])
    expect(formatScheduleDescription(schedule)).toBe('Every day at 11:45pm')
  })
})
