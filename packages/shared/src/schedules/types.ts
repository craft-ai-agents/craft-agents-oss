/**
 * Scheduled Prompts Types
 *
 * Type definitions for workspace scheduled prompt configurations.
 * Schedules automatically create new chat sessions with pre-filled prompts
 * at specified times when the app is open.
 */

/**
 * Time specification for when a scheduled prompt should run.
 * Uses 24-hour format for simplicity.
 */
export interface ScheduleTime {
  /** Hour in 24-hour format (0-23) */
  hour: number
  /** Minute (0-59) */
  minute: number
}

/**
 * Days of the week when the schedule is active.
 */
export type ScheduleDay = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

/**
 * A scheduled prompt configuration
 */
export interface ScheduledPromptConfig {
  /** Unique ID (slug-style: 'morning-standup', 'daily-review') */
  id: string

  /** Display name for the schedule */
  name: string

  /** The prompt text to send when triggered */
  prompt: string

  /** Times of day to run (e.g., [{hour: 8, minute: 0}, {hour: 15, minute: 0}]) */
  times: ScheduleTime[]

  /** Days of week to run (empty/undefined = every day) */
  days?: ScheduleDay[]

  /** Whether this schedule is currently enabled */
  enabled: boolean

  /** Timestamp of last execution (to prevent duplicate runs) */
  lastRunAt?: number

  /** Created timestamp */
  createdAt: number
}

/**
 * Complete schedules configuration for a workspace
 */
export interface WorkspaceSchedulesConfig {
  /** Schema version (start at 1) */
  version: number

  /** Array of scheduled prompt configurations */
  schedules: ScheduledPromptConfig[]
}
