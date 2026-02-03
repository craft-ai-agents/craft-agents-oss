/**
 * Scheduled Prompts Storage
 *
 * Filesystem-based storage for workspace scheduled prompt configurations.
 * Schedules are stored at {workspaceRootPath}/schedules/config.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { WorkspaceSchedulesConfig, ScheduledPromptConfig } from './types.ts'

const SCHEDULES_CONFIG_DIR = 'schedules'
const SCHEDULES_CONFIG_FILE = 'schedules/config.json'

/**
 * Get default (empty) schedules configuration
 */
export function getDefaultSchedulesConfig(): WorkspaceSchedulesConfig {
  return {
    version: 1,
    schedules: [],
  }
}

/**
 * Ensure the schedules config file exists, creating it with defaults if needed.
 * Returns the path to the config file.
 */
export function ensureSchedulesConfig(workspaceRootPath: string): string {
  const schedulesDir = join(workspaceRootPath, SCHEDULES_CONFIG_DIR)
  const configPath = join(workspaceRootPath, SCHEDULES_CONFIG_FILE)

  if (!existsSync(configPath)) {
    // Create schedules directory if missing
    if (!existsSync(schedulesDir)) {
      mkdirSync(schedulesDir, { recursive: true })
    }
    // Create default config file
    writeFileSync(configPath, JSON.stringify(getDefaultSchedulesConfig(), null, 2), 'utf-8')
  }

  return configPath
}

/**
 * Load workspace schedules configuration
 * Creates default config file if none exists.
 */
export function loadSchedulesConfig(workspaceRootPath: string): WorkspaceSchedulesConfig {
  const configPath = ensureSchedulesConfig(workspaceRootPath)

  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as WorkspaceSchedulesConfig
    return config
  } catch (error) {
    console.error('[loadSchedulesConfig] Failed to parse config:', error)
    return getDefaultSchedulesConfig()
  }
}

/**
 * Save workspace schedules configuration to disk
 */
export function saveSchedulesConfig(
  workspaceRootPath: string,
  config: WorkspaceSchedulesConfig
): void {
  const schedulesDir = join(workspaceRootPath, SCHEDULES_CONFIG_DIR)
  const configPath = join(workspaceRootPath, SCHEDULES_CONFIG_FILE)

  // Create schedules directory if missing
  if (!existsSync(schedulesDir)) {
    mkdirSync(schedulesDir, { recursive: true })
  }

  // Write config to disk
  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
  } catch (error) {
    console.error('[saveSchedulesConfig] Failed to save config:', error)
    throw error
  }
}

/**
 * Get a single schedule by ID
 * Returns null if not found
 */
export function getSchedule(
  workspaceRootPath: string,
  scheduleId: string
): ScheduledPromptConfig | null {
  const config = loadSchedulesConfig(workspaceRootPath)
  return config.schedules.find(s => s.id === scheduleId) || null
}

/**
 * Get all schedules
 */
export function listSchedules(workspaceRootPath: string): ScheduledPromptConfig[] {
  const config = loadSchedulesConfig(workspaceRootPath)
  return config.schedules
}

/**
 * Update the lastRunAt timestamp for a schedule
 * Used by the scheduler to prevent duplicate runs
 */
export function updateLastRunAt(
  workspaceRootPath: string,
  scheduleId: string,
  timestamp: number
): void {
  const config = loadSchedulesConfig(workspaceRootPath)
  const schedule = config.schedules.find(s => s.id === scheduleId)

  if (schedule) {
    schedule.lastRunAt = timestamp
    saveSchedulesConfig(workspaceRootPath, config)
  }
}

/**
 * Update a schedule by ID
 * Returns the updated schedule, or null if not found
 */
export function updateSchedule(
  workspaceRootPath: string,
  scheduleId: string,
  updates: Partial<Omit<ScheduledPromptConfig, 'id' | 'createdAt'>>
): ScheduledPromptConfig | null {
  const config = loadSchedulesConfig(workspaceRootPath)
  const index = config.schedules.findIndex(s => s.id === scheduleId)

  if (index === -1) return null

  const existing = config.schedules[index]!
  const updated: ScheduledPromptConfig = {
    id: existing.id,
    createdAt: existing.createdAt,
    name: updates.name ?? existing.name,
    prompt: updates.prompt ?? existing.prompt,
    times: updates.times ?? existing.times,
    days: updates.days !== undefined ? updates.days : existing.days,
    enabled: updates.enabled ?? existing.enabled,
    lastRunAt: updates.lastRunAt !== undefined ? updates.lastRunAt : existing.lastRunAt,
  }
  config.schedules[index] = updated
  saveSchedulesConfig(workspaceRootPath, config)
  return updated
}

/**
 * Delete a schedule by ID
 * Returns true if deleted, false if not found
 */
export function deleteSchedule(
  workspaceRootPath: string,
  scheduleId: string
): boolean {
  const config = loadSchedulesConfig(workspaceRootPath)
  const index = config.schedules.findIndex(s => s.id === scheduleId)

  if (index === -1) return false

  config.schedules.splice(index, 1)
  saveSchedulesConfig(workspaceRootPath, config)
  return true
}

/**
 * Get the path to the schedules config file
 */
export function getSchedulesConfigPath(workspaceRootPath: string): string {
  return join(workspaceRootPath, SCHEDULES_CONFIG_FILE)
}
