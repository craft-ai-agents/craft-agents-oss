/**
 * Shared automation utilities.
 *
 * Cron helpers used by CronBuilder (visual editor) and AutomationInfoPage (info display).
 * Time formatting shared by AutomationsListPanel and AutomationEventTimeline.
 */

import { Cron } from 'croner'

/** 默认的翻译函数，当没有提供翻译函数时使用 */
const defaultT = (key: string, defaultValue: string, params?: Record<string, string | number>): string => {
  let text = defaultValue
  if (params) {
    Object.keys(params).forEach(paramKey => {
      text = text.replace(new RegExp(`{${paramKey}}`, 'g'), String(params[paramKey]))
    })
  }
  return text
}

/**
 * Format a timestamp as a compact relative time string (e.g. "3m", "2h", "5d").
 * Used by both AutomationsListPanel (trailing timestamp) and AutomationEventTimeline.
 */
export function formatShortRelativeTime(timestamp: number, t: any = defaultT): string {
  const diff = Date.now() - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (seconds < 60) return t('common.justNow', 'Just now')
  if (minutes < 60) return `${minutes}${t('common.minutesAgo', 'm ago')}`
  if (hours < 24) return `${hours}${t('common.hoursAgo', 'h ago')}`
  return `${days}${t('common.daysAgo', 'd ago')}`
}

/**
 * Describe a cron expression in human-readable form.
 */
export function describeCron(cron: string, t: any = defaultT): string {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return t('common.invalidSchedule', 'Invalid schedule')

  const [minute, hour, dom, month, dow] = parts

  if (cron.trim() === '* * * * *') return t('common.everyMinute', 'Every minute')
  if (minute.startsWith('*/')) return t('common.everyXMinutes', 'Every {x} minutes', { x: minute.slice(2) })
  if (hour === '*' && minute !== '*') return t('common.everyHourAt', 'Every hour at :{time}', { time: minute.padStart(2, '0') })
  if (dom === '*' && month === '*') {
    const time = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
    if (dow === '*') return t('common.dailyAt', 'Daily at {time}', { time })
    if (dow === '1-5') return t('common.weekdaysAt', 'Weekdays at {time}', { time })
    if (dow === '0,6') return t('common.weekendsAt', 'Weekends at {time}', { time })
    return t('common.atTimeWeekday', 'At {time} (weekday: {weekday})', { time, weekday: dow })
  }
  if (month === '*' && dow === '*') {
    const time = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
    return t('common.monthlyOnDayAt', 'Monthly on day {day} at {time}', { day: dom, time })
  }
  return cron
}

/**
 * Compute the next N run times for a cron expression using croner.
 */
export function computeNextRuns(cron: string, count: number = 3): Date[] {
  try {
    const job = new Cron(cron)
    return job.nextRuns(count)
  } catch {
    return []
  }
}
