/**
 * Shared cron expression utilities.
 *
 * Used by CronBuilder (visual editor) and HookInfoPage (info display).
 */

/**
 * Describe a cron expression in human-readable form.
 */
export function describeCron(cron: string): string {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return 'Invalid schedule'

  const [minute, hour, dom, month, dow] = parts

  if (cron.trim() === '* * * * *') return 'Every minute'
  if (minute.startsWith('*/')) return `Every ${minute.slice(2)} minutes`
  if (hour === '*' && minute !== '*') return `Every hour at :${minute.padStart(2, '0')}`
  if (dom === '*' && month === '*') {
    const time = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
    if (dow === '*') return `Daily at ${time}`
    if (dow === '1-5') return `Weekdays at ${time}`
    if (dow === '0,6') return `Weekends at ${time}`
    return `At ${time} (weekday: ${dow})`
  }
  if (month === '*' && dow === '*') {
    const time = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
    return `Monthly on day ${dom} at ${time}`
  }
  return cron
}

/**
 * Compute the next N approximate run times for a cron expression.
 * Simplified computation — accurate enough for UI previews.
 */
export function computeNextRuns(cron: string, count: number = 3): Date[] {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return []

  const [minute, hour] = parts
  const h = hour === '*' ? new Date().getHours() : parseInt(hour, 10)
  const m = minute.startsWith('*/') ? 0 : (minute === '*' ? 0 : parseInt(minute, 10))

  const now = new Date()
  const runs: Date[] = []

  for (let i = 0; i < count; i++) {
    const d = new Date(now)
    d.setDate(d.getDate() + i + 1)
    d.setHours(isNaN(h) ? 0 : h, isNaN(m) ? 0 : m, 0, 0)
    runs.push(d)
  }

  return runs
}
