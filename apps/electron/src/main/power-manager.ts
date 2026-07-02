/**
 * Power Manager - Prevents screen sleep while sessions are running
 *
 * Uses Electron's powerSaveBlocker API to prevent the display from sleeping
 * when the "Keep screen awake" setting is enabled and at least one session
 * is actively processing.
 */

import { powerSaveBlocker } from 'electron'
import { mainLog } from './logger'

// Track current power blocker IDs (null when not blocking)
let displayPowerBlockerId: number | null = null
let runnerPowerBlockerId: number | null = null

// Track the number of active (processing) sessions
let activeSessionCount = 0

// Track whether this process is currently the team automation runner
let teamRunnerActive = false

// Cache the setting value to avoid repeated config reads
let settingEnabled = false

/**
 * Initialize the power manager by loading the current setting.
 * Call this on app startup.
 */
export async function initPowerManager(): Promise<void> {
  const { getKeepAwakeWhileRunning } = await import('@craft-agent/shared/config/storage')
  settingEnabled = getKeepAwakeWhileRunning()
  mainLog.info('[power] Power manager initialized', { settingEnabled })
}

/**
 * Update the power state based on active sessions and setting.
 * Called when:
 * - A session starts or stops processing
 * - The setting is toggled
 */
function updatePowerState(): void {
  const shouldBlockDisplay = settingEnabled && activeSessionCount > 0
  const shouldBlockRunner = teamRunnerActive

  if (shouldBlockDisplay && displayPowerBlockerId === null) {
    // Start blocking display sleep
    displayPowerBlockerId = powerSaveBlocker.start('prevent-display-sleep')
    mainLog.info('[power] Started display power save blocker', { blockerId: displayPowerBlockerId, activeSessionCount })
  } else if (!shouldBlockDisplay && displayPowerBlockerId !== null) {
    // Stop blocking
    powerSaveBlocker.stop(displayPowerBlockerId)
    mainLog.info('[power] Stopped display power save blocker', { blockerId: displayPowerBlockerId })
    displayPowerBlockerId = null
  }

  if (shouldBlockRunner && runnerPowerBlockerId === null) {
    runnerPowerBlockerId = powerSaveBlocker.start('prevent-app-suspension')
    mainLog.info('[power] Started team runner power save blocker', { blockerId: runnerPowerBlockerId })
  } else if (!shouldBlockRunner && runnerPowerBlockerId !== null) {
    powerSaveBlocker.stop(runnerPowerBlockerId)
    mainLog.info('[power] Stopped team runner power save blocker', { blockerId: runnerPowerBlockerId })
    runnerPowerBlockerId = null
  }
}

/**
 * Called when a session starts processing.
 */
export function onSessionStarted(): void {
  activeSessionCount++
  mainLog.debug('[power] Session started processing', { activeSessionCount })
  updatePowerState()
}

/**
 * Called when a session stops processing (complete, error, or cancelled).
 */
export function onSessionStopped(): void {
  if (activeSessionCount > 0) {
    activeSessionCount--
  }
  mainLog.debug('[power] Session stopped processing', { activeSessionCount })
  updatePowerState()
}

/**
 * Update the keep awake setting.
 * Called from IPC handler when user toggles the setting.
 */
export function setKeepAwakeSetting(enabled: boolean): void {
  settingEnabled = enabled
  mainLog.info('[power] Keep awake setting changed', { enabled, activeSessionCount })
  updatePowerState()
}

/**
 * Keep the machine awake while it owns team background automation duties.
 */
export function setTeamRunnerActive(active: boolean): void {
  if (teamRunnerActive === active) return
  teamRunnerActive = active
  mainLog.info('[power] Team runner state changed', { active, activeSessionCount })
  updatePowerState()
}

/**
 * Get the current keep awake setting value.
 */
export function getKeepAwakeSetting(): boolean {
  return settingEnabled
}

/**
 * Check if power blocker is currently active.
 * Useful for debugging.
 */
export function isPowerBlockerActive(): boolean {
  return Boolean(
    (displayPowerBlockerId !== null && powerSaveBlocker.isStarted(displayPowerBlockerId)) ||
    (runnerPowerBlockerId !== null && powerSaveBlocker.isStarted(runnerPowerBlockerId))
  )
}

/**
 * Clean up power blocker on app quit.
 * Note: Electron automatically releases blockers on quit, but this is explicit.
 */
export function cleanup(): void {
  const hadPowerBlocker = displayPowerBlockerId !== null || runnerPowerBlockerId !== null
  if (displayPowerBlockerId !== null) {
    powerSaveBlocker.stop(displayPowerBlockerId)
    displayPowerBlockerId = null
  }
  if (runnerPowerBlockerId !== null) {
    powerSaveBlocker.stop(runnerPowerBlockerId)
    runnerPowerBlockerId = null
  }
  if (hadPowerBlocker) {
    mainLog.info('[power] Cleaned up power save blockers on shutdown')
  }
  activeSessionCount = 0
  teamRunnerActive = false
}
