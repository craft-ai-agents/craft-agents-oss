/**
 * ScheduleManager
 *
 * Manages scheduled jobs in the Electron main process.
 * Uses setTimeout (not setInterval) to correctly handle sleep/wake and timezone changes.
 * Jobs only run while the app is open.
 */

import type { SessionManager } from './sessions'
import type { WindowManager } from './window-manager'
import { mainLog } from './logger'
import { showNotification } from './notifications'
import { getWorkspaces, getWorkspaceByNameOrId } from '@g4os/shared/config'
import {
  loadScheduledJobs,
  updateJobRunStatus,
  getNextRun,
  shouldRunNow,
  type ScheduledJob,
  type JobExecution,
} from '@g4os/shared/scheduler'

export class ScheduleManager {
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private executions = new Map<string, JobExecution>()
  private sessionManager: SessionManager | null = null
  private windowManager: WindowManager | null = null

  setSessionManager(sessionManager: SessionManager): void {
    this.sessionManager = sessionManager
  }

  setWindowManager(windowManager: WindowManager): void {
    this.windowManager = windowManager
  }

  /**
   * Load all jobs for all workspaces and start timers.
   */
  async initialize(): Promise<void> {
    const workspaces = getWorkspaces()
    for (const ws of workspaces) {
      const jobs = loadScheduledJobs(ws.rootPath)
      for (const job of jobs) {
        if (job.enabled) {
          this.scheduleJob(job, ws.rootPath)
        }
      }
    }
    mainLog.info(`[scheduler] Initialized with ${this.timers.size} active job timer(s)`)
  }

  /**
   * Check for missed jobs that should run on launch.
   */
  async checkMissedJobs(): Promise<void> {
    const workspaces = getWorkspaces()
    for (const ws of workspaces) {
      const jobs = loadScheduledJobs(ws.rootPath)
      for (const job of jobs) {
        if (!job.enabled || !job.runOnLaunchIfMissed) continue

        const graceMs = (job.graceWindowMinutes ?? 120) * 60 * 1000
        if (shouldRunNow(job.schedule, job.lastRunAt, graceMs)) {
          mainLog.info(`[scheduler] Running missed job: ${job.name} (${job.id})`)
          this.executeJob(job, ws.rootPath).catch(err => {
            mainLog.error(`[scheduler] Failed to execute missed job ${job.id}:`, err)
          })
        }
      }
    }
  }

  /**
   * Schedule a single job (calculate next run, set timeout).
   */
  private scheduleJob(job: ScheduledJob, workspaceRootPath: string): void {
    // Clear existing timer if any
    this.clearTimer(job.id)

    try {
      const nextRun = getNextRun(job.schedule)
      const delay = nextRun.getTime() - Date.now()

      if (delay <= 0) {
        // Should run now
        this.executeJob(job, workspaceRootPath).catch(err => {
          mainLog.error(`[scheduler] Failed to execute job ${job.id}:`, err)
        })
        return
      }

      // Cap setTimeout to ~24 days (max safe delay for setTimeout)
      // For longer delays, we re-schedule after the cap
      const MAX_TIMEOUT = 2_147_483_647 // ~24.8 days
      const actualDelay = Math.min(delay, MAX_TIMEOUT)

      const timer = setTimeout(() => {
        if (actualDelay < delay) {
          // Re-schedule — we haven't reached the target time yet
          this.scheduleJob(job, workspaceRootPath)
        } else {
          this.executeJob(job, workspaceRootPath).catch(err => {
            mainLog.error(`[scheduler] Failed to execute job ${job.id}:`, err)
          })
        }
      }, actualDelay)

      this.timers.set(job.id, timer)
      mainLog.info(`[scheduler] Scheduled "${job.name}" next run at ${nextRun.toISOString()}`)
    } catch (err) {
      mainLog.error(`[scheduler] Failed to schedule job ${job.id}:`, err)
    }
  }

  /**
   * Execute a job.
   */
  private async executeJob(job: ScheduledJob, workspaceRootPath: string): Promise<void> {
    if (!this.sessionManager) {
      mainLog.error('[scheduler] SessionManager not available')
      return
    }

    mainLog.info(`[scheduler] Executing job: ${job.name} (${job.id})`)

    try {
      if (job.action.type === 'new-session') {
        await this.executeNewSession(job, workspaceRootPath)
      } else {
        await this.executeBatch(job, workspaceRootPath)
      }

      updateJobRunStatus(workspaceRootPath, job.id, 'success')

      if (job.notifyOnComplete !== false) {
        showNotification(
          'Scheduled Job Complete',
          `"${job.name}" finished successfully.`,
          job.workspaceId,
          '' // No specific session to navigate to
        )
      }
    } catch (err) {
      mainLog.error(`[scheduler] Job ${job.id} failed:`, err)
      updateJobRunStatus(workspaceRootPath, job.id, 'error')

      if (job.notifyOnComplete !== false) {
        showNotification(
          'Scheduled Job Failed',
          `"${job.name}" encountered an error.`,
          job.workspaceId,
          ''
        )
      }
    }

    // Reschedule for next run
    this.rescheduleJob(job, workspaceRootPath)
  }

  /**
   * Execute a new-session job.
   */
  private async executeNewSession(job: ScheduledJob, workspaceRootPath: string): Promise<void> {
    if (!this.sessionManager) throw new Error('SessionManager not available')

    const session = await this.sessionManager.createSession(job.workspaceId, {
      permissionMode: job.permissionMode ?? 'allow-all',
      labels: ['scheduled'],
      model: job.model,
      name: job.name,
      workingDirectory: job.workingDirectory,
      enabledSourceSlugs: job.enabledSourceSlugs,
    })

    const execution: JobExecution = {
      jobId: job.id,
      sessionId: session.id,
      startedAt: Date.now(),
      status: 'running',
    }
    this.executions.set(job.id, execution)

    // Build the message: skill invocation or custom prompt
    let message: string
    if (job.action.type === 'new-session' && job.action.skillSlug) {
      message = `/${job.action.skillSlug}`
      if (job.action.prompt) {
        message += ` ${job.action.prompt}`
      }
    } else if (job.action.type === 'new-session' && job.action.prompt) {
      message = job.action.prompt
    } else {
      message = 'Start session.'
    }

    const skillSlugs = job.enabledSkillSlugs?.length ? job.enabledSkillSlugs : undefined
    await this.sessionManager.sendMessage(session.id, message, undefined, undefined, {
      skillSlugs,
    })

    execution.status = 'success'
    execution.completedAt = Date.now()
  }

  /**
   * Execute a batch job (run skill on filtered sessions).
   */
  private async executeBatch(job: ScheduledJob, workspaceRootPath: string): Promise<void> {
    if (!this.sessionManager) throw new Error('SessionManager not available')
    if (job.action.type !== 'batch') return

    const allSessions = this.sessionManager.getSessions()
    const sessions = allSessions.filter(s => s.workspaceId === job.workspaceId)
    const filter = job.action.filter
    const now = new Date()
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()

    const matchingSessions = sessions.filter(s => {
      // Skip archived
      if (s.isArchived) return false

      switch (filter.scope) {
        case 'today':
          return (s.lastMessageAt ?? 0) >= startOfDay
        case 'active':
          return true
        case 'labeled':
          if (!filter.labels?.length) return false
          return filter.labels.some(label => s.labels?.includes(label))
        default:
          return false
      }
    })

    mainLog.info(`[scheduler] Batch job "${job.name}" matched ${matchingSessions.length} session(s)`)

    const message = `/${job.action.skillSlug}`
    for (const session of matchingSessions) {
      try {
        await this.sessionManager.sendMessage(session.id, message)
      } catch (err) {
        mainLog.error(`[scheduler] Batch: failed to send to session ${session.id}:`, err)
      }
    }
  }

  /**
   * Reschedule after execution (calculate next run).
   */
  private rescheduleJob(job: ScheduledJob, workspaceRootPath: string): void {
    if (!job.enabled) return

    // Re-load the job to get fresh data
    const jobs = loadScheduledJobs(workspaceRootPath)
    const freshJob = jobs.find(j => j.id === job.id)
    if (freshJob && freshJob.enabled) {
      this.scheduleJob(freshJob, workspaceRootPath)
    }
  }

  /**
   * Refresh timers when config changes (job created/updated/deleted).
   */
  async refresh(workspaceId: string): Promise<void> {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) return

    // Clear all timers for this workspace's jobs
    const jobs = loadScheduledJobs(workspace.rootPath)
    const jobIds = new Set(jobs.map(j => j.id))

    // Clear timers for jobs that no longer exist or are disabled
    for (const [id, timer] of this.timers) {
      // We can't know which workspace a timer belongs to from the id alone,
      // but we can re-schedule all jobs for the workspace
      if (jobIds.has(id)) {
        clearTimeout(timer)
        this.timers.delete(id)
      }
    }

    // Re-schedule all enabled jobs
    for (const job of jobs) {
      if (job.enabled) {
        this.scheduleJob(job, workspace.rootPath)
      } else {
        this.clearTimer(job.id)
      }
    }
  }

  /**
   * Manually trigger a job immediately.
   */
  async runJobNow(jobId: string, workspaceId: string): Promise<void> {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const jobs = loadScheduledJobs(workspace.rootPath)
    const job = jobs.find(j => j.id === jobId)
    if (!job) throw new Error('Job not found')

    await this.executeJob(job, workspace.rootPath)
  }

  /**
   * Get recent execution history.
   */
  getExecutions(): JobExecution[] {
    return [...this.executions.values()]
  }

  /**
   * Stop all timers.
   */
  destroy(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer)
    }
    this.timers.clear()
    this.executions.clear()
    mainLog.info('[scheduler] Destroyed all timers')
  }

  private clearTimer(jobId: string): void {
    const timer = this.timers.get(jobId)
    if (timer) {
      clearTimeout(timer)
      this.timers.delete(jobId)
    }
  }
}
