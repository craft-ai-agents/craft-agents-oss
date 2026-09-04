import { startOfDay, subDays } from 'date-fns'

export const OLDER_SESSION_GROUP_KEY = 'date-older'
export type RecencyDays = 7 | 30 | null

export function getSessionDateGroupKey(
  timestamp: number,
  olderThanDays: RecencyDays,
  now = Date.now(),
): string {
  const day = startOfDay(new Date(timestamp || 0))
  if (olderThanDays !== null) {
    const firstVisibleDay = subDays(startOfDay(new Date(now)), olderThanDays - 1)
    if (day.getTime() < firstVisibleDay.getTime()) return OLDER_SESSION_GROUP_KEY
  }
  return day.toISOString()
}

export function isWithinRecency(timestamp: number | undefined, days: RecencyDays, now = Date.now()): boolean {
  if (days === null) return true
  const firstVisibleDay = subDays(startOfDay(new Date(now)), days - 1)
  return (timestamp ?? 0) >= firstVisibleDay.getTime()
}
