/**
 * Scheduler Service
 *
 * Manages scheduled prompts that run automatically at specified times.
 * - Uses Croner for cron scheduling
 * - Persists schedules to JSON file per workspace
 * - Executes prompts using the session system
 * - Shows native notifications on completion
 */

import { Cron } from 'croner'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { randomUUID } from 'crypto'
import { Notification, BrowserWindow } from 'electron'
import { mainLog } from './logger'
import type { WindowManager } from './window-manager'
import type { SessionManager } from './sessions'
import type { Schedule, ScheduleFormData, ScheduleEvent } from '../shared/types'
import { IPC_CHANNELS } from '../shared/types'

/**
 * SchedulerService manages scheduled task execution for a workspace.
 */
export class SchedulerService {
  private jobs: Map<string, Cron> = new Map()
  private schedules: Schedule[] = []
  private filePath: string
  private workspaceId: string
  private workspacePath: string
  private isExecuting = false
  private queue: Schedule[] = []
  private windowManager: WindowManager | null = null
  private sessionManager: SessionManager | null = null

  constructor(workspaceId: string, workspacePath: string) {
    this.workspaceId = workspaceId
    this.workspacePath = workspacePath
    this.filePath = join(workspacePath, 'schedules.json')
  }

  /**
   * Set window manager for notifications and navigation
   */
  setWindowManager(wm: WindowManager): void {
    this.windowManager = wm
  }

  /**
   * Set session manager for executing prompts
   */
  setSessionManager(sm: SessionManager): void {
    this.sessionManager = sm
  }

  /**
   * Start the scheduler - load schedules and create cron jobs
   */
  async start(): Promise<void> {
    await this.load()
    for (const schedule of this.schedules) {
      if (schedule.enabled) {
        this.startJob(schedule)
      }
    }
    mainLog.info(`Scheduler started for workspace ${this.workspaceId} with ${this.schedules.length} schedules`)
  }

  /**
   * Stop all scheduled jobs
   */
  async stop(): Promise<void> {
    for (const job of this.jobs.values()) {
      job.stop()
    }
    this.jobs.clear()
    mainLog.info(`Scheduler stopped for workspace ${this.workspaceId}`)
  }

  /**
   * Load schedules from JSON file
   */
  private async load(): Promise<void> {
    try {
      if (existsSync(this.filePath)) {
        const data = await readFile(this.filePath, 'utf-8')
        const parsed = JSON.parse(data)
        this.schedules = parsed.schedules || []
      } else {
        this.schedules = []
      }
    } catch (error) {
      mainLog.error('Failed to load schedules:', error)
      this.schedules = []
    }
  }

  /**
   * Save schedules to JSON file
   */
  private async save(): Promise<void> {
    try {
      // Ensure directory exists
      const dir = dirname(this.filePath)
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true })
      }
      await writeFile(
        this.filePath,
        JSON.stringify({ schedules: this.schedules }, null, 2)
      )
    } catch (error) {
      mainLog.error('Failed to save schedules:', error)
    }
  }

  /**
   * Start a cron job for a schedule
   */
  private startJob(schedule: Schedule): void {
    if (this.jobs.has(schedule.id)) return

    try {
      if (schedule.cron) {
        // Recurring schedule
        const job = new Cron(
          schedule.cron,
          { timezone: schedule.timezone },
          () => this.enqueue(schedule)
        )
        this.jobs.set(schedule.id, job)
        mainLog.info(`Started recurring job for schedule ${schedule.id}: ${schedule.cron}`)
      } else if (schedule.scheduledFor) {
        // One-time schedule
        const runAt = new Date(schedule.scheduledFor * 1000)
        if (runAt > new Date()) {
          const job = new Cron(runAt, () => {
            this.enqueue(schedule)
            this.jobs.delete(schedule.id)
          })
          this.jobs.set(schedule.id, job)
          mainLog.info(`Started one-time job for schedule ${schedule.id}: ${runAt.toISOString()}`)
        }
      }
    } catch (error) {
      mainLog.error(`Failed to start job for schedule ${schedule.id}:`, error)
    }
  }

  /**
   * Stop a cron job
   */
  private stopJob(scheduleId: string): void {
    const job = this.jobs.get(scheduleId)
    if (job) {
      job.stop()
      this.jobs.delete(scheduleId)
      mainLog.info(`Stopped job for schedule ${scheduleId}`)
    }
  }

  /**
   * Add schedule to execution queue
   */
  private enqueue(schedule: Schedule): void {
    // Refresh schedule data in case it was updated
    const current = this.schedules.find(s => s.id === schedule.id)
    if (!current || !current.enabled) return

    this.queue.push(current)
    this.processQueue()
  }

  /**
   * Process execution queue sequentially
   */
  private async processQueue(): Promise<void> {
    if (this.isExecuting || this.queue.length === 0) return

    this.isExecuting = true
    while (this.queue.length > 0) {
      const schedule = this.queue.shift()!
      await this.execute(schedule)
    }
    this.isExecuting = false
  }

  /**
   * Execute a scheduled task
   */
  private async execute(schedule: Schedule): Promise<void> {
    const startTime = Date.now()
    mainLog.info(`Executing schedule ${schedule.id}: ${schedule.name}`)

    // Broadcast start event
    this.broadcastEvent({
      type: 'started',
      scheduleId: schedule.id,
      scheduleName: schedule.name,
    })

    try {
      if (!this.sessionManager) {
        throw new Error('SessionManager not initialized')
      }

      // Create a new session for this scheduled task
      const session = await this.sessionManager.createSession(this.workspaceId)

      // Rename the session
      await this.sessionManager.renameSession(session.id, `Schedule: ${schedule.name}`)

      // Send the prompt as the initial message
      await this.sessionManager.sendMessage(session.id, schedule.prompt)

      // Update schedule status
      const idx = this.schedules.findIndex(s => s.id === schedule.id)
      if (idx !== -1) {
        this.schedules[idx].lastRunAt = Math.floor(startTime / 1000)
        this.schedules[idx].lastRunStatus = 'success'
        this.schedules[idx].lastRunError = null
        await this.save()
      }

      // Show success notification
      this.showNotification(
        schedule.name,
        'Completed successfully',
        session.id
      )

      // Broadcast completion event
      this.broadcastEvent({
        type: 'completed',
        scheduleId: schedule.id,
        scheduleName: schedule.name,
        sessionId: session.id,
      })

      mainLog.info(`Schedule ${schedule.id} completed successfully, session: ${session.id}`)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      mainLog.error(`Schedule ${schedule.id} failed:`, error)

      // Update schedule status
      const idx = this.schedules.findIndex(s => s.id === schedule.id)
      if (idx !== -1) {
        this.schedules[idx].lastRunAt = Math.floor(startTime / 1000)
        this.schedules[idx].lastRunStatus = 'failed'
        this.schedules[idx].lastRunError = errorMessage
        await this.save()
      }

      // Show failure notification
      this.showNotification(
        schedule.name,
        `Failed: ${errorMessage}`,
        null
      )

      // Broadcast failure event
      this.broadcastEvent({
        type: 'failed',
        scheduleId: schedule.id,
        scheduleName: schedule.name,
        error: errorMessage,
      })
    }

    // Disable one-time schedules after execution
    if (!schedule.cron) {
      const idx = this.schedules.findIndex(s => s.id === schedule.id)
      if (idx !== -1) {
        this.schedules[idx].enabled = false
        await this.save()
      }
    }
  }

  /**
   * Show native notification
   */
  private showNotification(title: string, body: string, sessionId: string | null): void {
    if (!Notification.isSupported()) return

    const notification = new Notification({
      title: `Schedule: ${title}`,
      body,
      silent: false,
    })

    notification.on('click', () => {
      if (sessionId && this.windowManager) {
        // Focus window and navigate to session
        const window = this.windowManager.getWindowByWorkspace(this.workspaceId)
        if (window && !window.isDestroyed()) {
          if (window.isMinimized()) {
            window.restore()
          }
          window.focus()
          window.webContents.send('notification:navigate', {
            workspaceId: this.workspaceId,
            sessionId,
          })
        }
      }
    })

    notification.show()
  }

  /**
   * Broadcast schedule event to all windows
   */
  private broadcastEvent(event: ScheduleEvent): void {
    const windows = BrowserWindow.getAllWindows()
    for (const window of windows) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.SCHEDULE_EVENT, event)
      }
    }
  }

  // ============================================
  // CRUD Operations
  // ============================================

  /**
   * Create a new schedule
   */
  async create(data: ScheduleFormData): Promise<Schedule> {
    const schedule: Schedule = {
      ...data,
      id: randomUUID(),
      createdAt: Math.floor(Date.now() / 1000),
      lastRunAt: null,
      lastRunStatus: null,
      lastRunError: null,
    }
    this.schedules.push(schedule)
    await this.save()

    if (schedule.enabled) {
      this.startJob(schedule)
    }

    mainLog.info(`Created schedule ${schedule.id}: ${schedule.name}`)
    return schedule
  }

  /**
   * Update an existing schedule
   */
  async update(id: string, updates: Partial<ScheduleFormData>): Promise<Schedule | null> {
    const index = this.schedules.findIndex(s => s.id === id)
    if (index === -1) return null

    const schedule = { ...this.schedules[index], ...updates }
    this.schedules[index] = schedule
    await this.save()

    // Restart job if timing changed
    this.stopJob(id)
    if (schedule.enabled) {
      this.startJob(schedule)
    }

    mainLog.info(`Updated schedule ${id}`)
    return schedule
  }

  /**
   * Delete a schedule
   */
  async delete(id: string): Promise<void> {
    this.stopJob(id)
    this.schedules = this.schedules.filter(s => s.id !== id)
    await this.save()
    mainLog.info(`Deleted schedule ${id}`)
  }

  /**
   * Toggle schedule enabled/disabled
   */
  async toggle(id: string): Promise<Schedule | null> {
    const schedule = this.schedules.find(s => s.id === id)
    if (!schedule) return null

    schedule.enabled = !schedule.enabled
    await this.save()

    if (schedule.enabled) {
      this.startJob(schedule)
    } else {
      this.stopJob(schedule.id)
    }

    mainLog.info(`Toggled schedule ${id}: enabled=${schedule.enabled}`)
    return schedule
  }

  /**
   * Run a schedule immediately
   */
  async runNow(id: string): Promise<void> {
    const schedule = this.schedules.find(s => s.id === id)
    if (!schedule) {
      throw new Error(`Schedule not found: ${id}`)
    }
    this.enqueue(schedule)
  }

  /**
   * Get all schedules
   */
  list(): Schedule[] {
    return [...this.schedules]
  }

  /**
   * Get next run time for a schedule
   */
  getNextRun(schedule: Schedule): Date | null {
    if (!schedule.cron || !schedule.enabled) return null
    try {
      const cron = new Cron(schedule.cron, { timezone: schedule.timezone })
      return cron.nextRun()
    } catch {
      return null
    }
  }
}

// ============================================
// Scheduler Manager (per-workspace instances)
// ============================================

const schedulers: Map<string, SchedulerService> = new Map()

/**
 * Get or create scheduler for a workspace
 */
export function getScheduler(workspaceId: string, workspacePath: string): SchedulerService {
  let scheduler = schedulers.get(workspaceId)
  if (!scheduler) {
    scheduler = new SchedulerService(workspaceId, workspacePath)
    schedulers.set(workspaceId, scheduler)
  }
  return scheduler
}

/**
 * Start all workspace schedulers
 */
export async function startAllSchedulers(
  workspaces: Array<{ id: string; rootPath: string }>,
  windowManager: WindowManager,
  sessionManager: SessionManager
): Promise<void> {
  for (const workspace of workspaces) {
    const scheduler = getScheduler(workspace.id, workspace.rootPath)
    scheduler.setWindowManager(windowManager)
    scheduler.setSessionManager(sessionManager)
    await scheduler.start()
  }
}

/**
 * Stop all workspace schedulers
 */
export async function stopAllSchedulers(): Promise<void> {
  for (const scheduler of schedulers.values()) {
    await scheduler.stop()
  }
  schedulers.clear()
}
