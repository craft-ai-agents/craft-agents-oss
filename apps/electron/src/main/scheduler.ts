/**
 * Scheduler Service
 *
 * Checks for scheduled prompts every minute and triggers them when due.
 * Creates a new chat session and sends the configured prompt automatically.
 */

import { getWorkspaces } from '@craft-agent/shared/config'
import { listSchedules, updateLastRunAt } from '@craft-agent/shared/schedules/storage'
import type { ScheduledPromptConfig, ScheduleDay } from '@craft-agent/shared/schedules'
import type { SessionManager } from './sessions'
import type { WindowManager } from './window-manager'
import { mainLog } from './logger'

const SCHEDULER_INTERVAL_MS = 60_000 // Check every minute

export class SchedulerService {
  private intervalId: NodeJS.Timeout | null = null
  private sessionManager: SessionManager
  private windowManager: WindowManager

  constructor(sessionManager: SessionManager, windowManager: WindowManager) {
    this.sessionManager = sessionManager
    this.windowManager = windowManager
  }

  /**
   * Start the scheduler - checks every minute for due schedules
   */
  start(): void {
    mainLog.info('[Scheduler] Starting scheduler service')

    // Check immediately on start
    this.checkSchedules()

    // Then check every minute
    this.intervalId = setInterval(() => {
      this.checkSchedules()
    }, SCHEDULER_INTERVAL_MS)
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
      mainLog.info('[Scheduler] Stopped scheduler service')
    }
  }

  /**
   * Check all workspaces for due schedules
   */
  private async checkSchedules(): Promise<void> {
    const workspaces = getWorkspaces()
    const now = new Date()

    for (const workspace of workspaces) {
      try {
        const schedules = listSchedules(workspace.rootPath)

        for (const schedule of schedules) {
          if (this.shouldTrigger(schedule, now)) {
            await this.triggerSchedule(workspace.id, workspace.rootPath, schedule)
          }
        }
      } catch (error) {
        mainLog.error(`[Scheduler] Error checking schedules for workspace ${workspace.id}:`, error)
      }
    }
  }

  /**
   * Determine if a schedule should trigger at the current time
   */
  private shouldTrigger(schedule: ScheduledPromptConfig, now: Date): boolean {
    // Skip disabled schedules
    if (!schedule.enabled) return false

    // Check day of week (if specified)
    if (schedule.days && schedule.days.length > 0) {
      const dayMap: ScheduleDay[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
      const today = dayMap[now.getDay()]
      if (!schedule.days.includes(today)) return false
    }

    // Check if any time matches current hour:minute
    const currentHour = now.getHours()
    const currentMinute = now.getMinutes()

    const matchesTime = schedule.times.some(
      t => t.hour === currentHour && t.minute === currentMinute
    )
    if (!matchesTime) return false

    // Check if already ran this minute (prevent duplicate runs)
    if (schedule.lastRunAt) {
      const lastRun = new Date(schedule.lastRunAt)
      if (
        lastRun.getFullYear() === now.getFullYear() &&
        lastRun.getMonth() === now.getMonth() &&
        lastRun.getDate() === now.getDate() &&
        lastRun.getHours() === currentHour &&
        lastRun.getMinutes() === currentMinute
      ) {
        return false
      }
    }

    return true
  }

  /**
   * Trigger a schedule - create session and send prompt
   */
  private async triggerSchedule(
    workspaceId: string,
    workspaceRootPath: string,
    schedule: ScheduledPromptConfig
  ): Promise<void> {
    try {
      mainLog.info(`[Scheduler] Triggering schedule "${schedule.name}" (${schedule.id})`)

      // Update lastRunAt first to prevent race conditions/duplicate runs
      updateLastRunAt(workspaceRootPath, schedule.id, Date.now())

      // Create new session with trigger info and allow-all permissions for autonomous execution
      const session = await this.sessionManager.createSession(workspaceId, {
        permissionMode: 'allow-all',
        triggeredBy: {
          type: 'schedule',
          scheduleId: schedule.id,
          scheduleName: schedule.name,
        },
      })

      mainLog.info(`[Scheduler] Created session ${session.id} for schedule "${schedule.name}"`)

      // Send the scheduled prompt
      await this.sessionManager.sendMessage(session.id, schedule.prompt)

      // Notify all windows to refresh (so they see the new session)
      this.windowManager.broadcastToAll('schedules:triggered', {
        workspaceId,
        sessionId: session.id,
        scheduleName: schedule.name,
        scheduleId: schedule.id,
      })

      mainLog.info(`[Scheduler] Successfully triggered schedule "${schedule.name}"`)
    } catch (error) {
      mainLog.error(`[Scheduler] Failed to trigger schedule "${schedule.id}":`, error)
    }
  }
}
