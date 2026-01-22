import { useCallback } from 'react'
import { toast } from 'sonner'
import cronstrue from 'cronstrue'
import type { ScheduleFormData } from '../../shared/types'

// Patterns to detect scheduling intent in user messages
const SCHEDULE_PATTERNS = [
  /schedule\s+this\s+(?:to\s+)?run\s+(.+)/i,
  /run\s+this\s+(.+)/i,
  /schedule\s+(?:this\s+)?(?:task\s+)?(?:to\s+)?(.+)/i,
]

// Common time expressions mapped to cron
const TIME_EXPRESSIONS: Record<string, string> = {
  'every hour': '0 * * * *',
  'hourly': '0 * * * *',
  'every day': '0 9 * * *',
  'daily': '0 9 * * *',
  'daily at 9am': '0 9 * * *',
  'daily at 9 am': '0 9 * * *',
  'every morning': '0 9 * * *',
  'every weekday': '0 9 * * 1-5',
  'weekdays': '0 9 * * 1-5',
  'weekdays at 9am': '0 9 * * 1-5',
  'every weekday at 9am': '0 9 * * 1-5',
  'every weekday at 9 am': '0 9 * * 1-5',
  'every monday': '0 9 * * 1',
  'weekly': '0 9 * * 1',
  'weekly on monday': '0 9 * * 1',
  'every week': '0 9 * * 1',
  'monthly': '0 9 1 * *',
  'every month': '0 9 1 * *',
  'monthly on the 1st': '0 9 1 * *',
  'first of every month': '0 9 1 * *',
}

// Parse time expressions like "at 9am", "at 14:30"
function parseTimeFromExpression(expr: string): { hour: number; minute: number } | null {
  // Match "at Xam/pm" or "at X:XX am/pm"
  const timeMatch = expr.match(/at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i)
  if (timeMatch) {
    let hour = parseInt(timeMatch[1], 10)
    const minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0
    const period = timeMatch[3]?.toLowerCase()

    if (period === 'pm' && hour < 12) hour += 12
    if (period === 'am' && hour === 12) hour = 0

    return { hour, minute }
  }
  return null
}

// Parse day of week from expression
function parseDayOfWeek(expr: string): number | null {
  const days: Record<string, number> = {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
    thursday: 4, friday: 5, saturday: 6,
    sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
  }

  for (const [day, num] of Object.entries(days)) {
    if (expr.toLowerCase().includes(day)) {
      return num
    }
  }
  return null
}

// Convert natural language time expression to cron
export function parseTimeToCron(timeExpression: string): string | null {
  const normalizedExpr = timeExpression.toLowerCase().trim()

  // Check for exact matches first
  for (const [pattern, cron] of Object.entries(TIME_EXPRESSIONS)) {
    if (normalizedExpr.includes(pattern)) {
      return cron
    }
  }

  // Try to parse more complex expressions
  const time = parseTimeFromExpression(normalizedExpr)
  const dayOfWeek = parseDayOfWeek(normalizedExpr)

  if (time) {
    const { hour, minute } = time

    // "every [day] at [time]"
    if (dayOfWeek !== null) {
      return `${minute} ${hour} * * ${dayOfWeek}`
    }

    // "every weekday at [time]"
    if (normalizedExpr.includes('weekday')) {
      return `${minute} ${hour} * * 1-5`
    }

    // "daily at [time]" or "every day at [time]"
    if (normalizedExpr.includes('daily') || normalizedExpr.includes('every day')) {
      return `${minute} ${hour} * * *`
    }

    // Default to daily at the specified time
    return `${minute} ${hour} * * *`
  }

  return null
}

export interface ScheduleIntent {
  timeExpression: string
  cron: string
  description: string
}

// Detect if a message contains scheduling intent and extract the time expression
export function detectScheduleIntent(message: string): ScheduleIntent | null {
  for (const pattern of SCHEDULE_PATTERNS) {
    const match = message.match(pattern)
    if (match) {
      const timeExpression = match[1].trim()
      const cron = parseTimeToCron(timeExpression)

      if (cron) {
        try {
          const description = cronstrue.toString(cron)
          return { timeExpression, cron, description }
        } catch {
          return null
        }
      }
    }
  }
  return null
}

interface UseScheduleFromChatOptions {
  workspaceId: string
  sessionName?: string
  onScheduleCreated?: (scheduleId: string) => void
}

export function useScheduleFromChat({
  workspaceId,
  sessionName,
  onScheduleCreated,
}: UseScheduleFromChatOptions) {
  const createScheduleFromMessage = useCallback(
    async (message: string, prompt: string) => {
      const intent = detectScheduleIntent(message)

      if (!intent) {
        return false
      }

      const scheduleData: ScheduleFormData = {
        name: sessionName || `Chat Schedule`,
        prompt,
        cron: intent.cron,
        scheduledFor: null,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        enabled: true,
      }

      try {
        const schedule = await window.electronAPI.scheduleCreate(workspaceId, scheduleData)
        toast.success(`Scheduled: ${intent.description}`, {
          description: `Created schedule "${schedule.name}"`,
        })
        onScheduleCreated?.(schedule.id)
        return true
      } catch (error) {
        toast.error('Failed to create schedule', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
        return false
      }
    },
    [workspaceId, sessionName, onScheduleCreated]
  )

  return {
    detectScheduleIntent,
    createScheduleFromMessage,
  }
}
