/**
 * Schedule Utilities
 *
 * Helper functions for working with scheduled prompts.
 */

import type { ScheduledPromptConfig, ScheduleTime, ScheduleDay } from './types.ts'

/**
 * Format a ScheduleTime to a readable string (e.g., "8am", "3:30pm")
 */
export function formatTime(time: ScheduleTime): string {
  const hour = time.hour % 12 || 12
  const ampm = time.hour < 12 ? 'am' : 'pm'
  return time.minute === 0 ? `${hour}${ampm}` : `${hour}:${time.minute.toString().padStart(2, '0')}${ampm}`
}

/**
 * Format an array of ScheduleTimes to a readable string (e.g., "8am, 11am, 3pm")
 */
export function formatTimes(times: ScheduleTime[]): string {
  return times.map(formatTime).join(', ')
}

/**
 * Calculate the next run time for a schedule.
 * Returns null if the schedule is disabled or has no times.
 */
export function getNextRunTime(schedule: ScheduledPromptConfig, now: Date = new Date()): Date | null {
  if (!schedule.enabled || schedule.times.length === 0) return null

  const dayMap: ScheduleDay[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

  // Sort times chronologically for correct next-run calculation
  const sortedTimes = [...schedule.times].sort((a, b) => {
    if (a.hour !== b.hour) return a.hour - b.hour
    return a.minute - b.minute
  })

  // Check the next 8 days (today + 7 more) to find the next run
  for (let dayOffset = 0; dayOffset < 8; dayOffset++) {
    const checkDate = new Date(now)
    checkDate.setDate(checkDate.getDate() + dayOffset)
    checkDate.setSeconds(0, 0)

    const dayOfWeek = dayMap[checkDate.getDay()]!

    // Skip if day restriction exists and today isn't included
    if (schedule.days && schedule.days.length > 0 && !schedule.days.includes(dayOfWeek)) {
      continue
    }

    // Check each time on this day (sorted, so first match is earliest)
    for (const time of sortedTimes) {
      const candidate = new Date(checkDate)
      candidate.setHours(time.hour, time.minute, 0, 0)

      // If it's today, only consider times that are in the future
      if (dayOffset === 0 && candidate <= now) {
        continue
      }

      return candidate
    }
  }

  return null
}

/**
 * Format a relative time string (e.g., "in 2 hours", "tomorrow at 9am")
 */
export function formatRelativeTime(date: Date, now: Date = new Date()): string {
  const diffMs = date.getTime() - now.getTime()
  const diffMins = Math.round(diffMs / 60000)
  const diffHours = Math.round(diffMs / 3600000)

  // Today
  if (date.toDateString() === now.toDateString()) {
    if (diffMins < 60) {
      return diffMins === 1 ? 'in 1 min' : `in ${diffMins} mins`
    }
    if (diffHours === 1) {
      return 'in 1 hour'
    }
    return `in ${diffHours} hours`
  }

  // Tomorrow
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  if (date.toDateString() === tomorrow.toDateString()) {
    return `tomorrow ${formatTime({ hour: date.getHours(), minute: date.getMinutes() })}`
  }

  // This week
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return `${dayNames[date.getDay()]} ${formatTime({ hour: date.getHours(), minute: date.getMinutes() })}`
}

/**
 * Format a schedule as a human-readable description.
 * Examples:
 *   - "Every day at 9am"
 *   - "Weekdays at 9am"
 *   - "Weekends at 10am"
 *   - "Every Monday at 9am"
 *   - "Mon, Wed, Fri at 9am"
 *   - "Every day at 9am, 3pm"
 */
export function formatScheduleDescription(schedule: ScheduledPromptConfig): string {
  const times = schedule.times
  if (times.length === 0) return 'No times set'

  // Format the time(s) part
  const timeStr = formatTimes(times)

  // Format the days part
  const days = schedule.days
  let dayStr: string

  if (!days || days.length === 0 || days.length === 7) {
    // All days or no restriction
    dayStr = 'Every day'
  } else if (days.length === 1) {
    // Single day - use full name
    const dayNames: Record<ScheduleDay, string> = {
      sun: 'Sunday',
      mon: 'Monday',
      tue: 'Tuesday',
      wed: 'Wednesday',
      thu: 'Thursday',
      fri: 'Friday',
      sat: 'Saturday',
    }
    dayStr = `Every ${dayNames[days[0]!]}`
  } else {
    // Check for common patterns
    const weekdays: ScheduleDay[] = ['mon', 'tue', 'wed', 'thu', 'fri']
    const weekends: ScheduleDay[] = ['sat', 'sun']

    const isWeekdays = weekdays.every(d => days.includes(d)) && days.length === 5
    const isWeekends = weekends.every(d => days.includes(d)) && days.length === 2

    if (isWeekdays) {
      dayStr = 'Weekdays'
    } else if (isWeekends) {
      dayStr = 'Weekends'
    } else {
      // List specific days (abbreviated)
      const dayOrder: ScheduleDay[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
      const abbrevNames: Record<ScheduleDay, string> = {
        sun: 'Sun',
        mon: 'Mon',
        tue: 'Tue',
        wed: 'Wed',
        thu: 'Thu',
        fri: 'Fri',
        sat: 'Sat',
      }
      const sortedDays = dayOrder.filter(d => days.includes(d))
      dayStr = sortedDays.map(d => abbrevNames[d]).join(', ')
    }
  }

  return `${dayStr} at ${timeStr}`
}

/**
 * Format the last run time as a relative string (e.g., "2 hours ago", "yesterday")
 */
export function formatLastRunTime(timestamp: number | undefined, now: Date = new Date()): string | null {
  if (!timestamp) return null

  const date = new Date(timestamp)
  const diffMs = now.getTime() - timestamp
  const diffMins = Math.round(diffMs / 60000)
  const diffHours = Math.round(diffMs / 3600000)

  // Just now / minutes ago
  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`

  // Yesterday
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) {
    return 'yesterday'
  }

  // More than a day
  const diffDays = Math.round(diffMs / 86400000)
  return `${diffDays}d ago`
}
