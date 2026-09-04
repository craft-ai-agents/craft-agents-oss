/**
 * Auto-update module using electron-updater
 *
 * Handles checking for updates, downloading, and installing via the standard
 * electron-updater library. Updates use the explicitly configured Jonwork service,
 * using the generic provider (YAML manifests + binaries on R2/S3).
 *
 * Platform behavior:
 * - macOS: Downloads zip, extracts and swaps app bundle atomically
 * - Windows: Downloads NSIS installer, runs silently on quit
 * - Linux: Downloads AppImage, replaces current file
 *
 * All platforms support download-progress events (electron-updater v6.8.0+).
 * quitAndInstall() handles restart natively — no external scripts.
 */

import { autoUpdater } from 'electron-updater'
import { DESKTOP_RELEASE } from '@craft-agent/shared/deployment'
import { BrowserWindow } from 'electron'
import { mainLog, autoUpdateLog } from './logger'
import { getAppVersion } from '@craft-agent/shared/version'
import {
  getDismissedUpdateVersion,
  clearDismissedUpdateVersion,
} from '@craft-agent/shared/config'
import { RPC_CHANNELS, type UpdateInfo } from '../shared/types'
import type { EventSink } from '@craft-agent/server-core/transport'
import { getDesktopUpdateAuthorization } from './desktop-account'

// Module state — keeps track of update info for IPC queries
let updateInfo: UpdateInfo = {
  available: false,
  currentVersion: getAppVersion(),
  latestVersion: null,
  downloadState: 'idle',
  downloadProgress: 0,
}

let eventSink: EventSink | null = null

// Flag to indicate update is in progress — used to prevent force exit during quitAndInstall
let __isUpdating = false

// Hook fired immediately before quitAndInstall, while BrowserWindows still exist.
// electron-updater destroys windows between quitAndInstall and before-quit firing,
// so the regular before-quit save site would see an empty array.
let beforeUpdateQuitHook: (() => void) | null = null

// Hook fired (awaited) immediately before quitAndInstall, AFTER the window
// snapshot. index.ts uses it to flush sessions + release resources BEFORE the
// installer quit, so before-quit no longer needs to preventDefault (which
// cancelled Squirrel.Mac's quit and left the update downloaded-but-not-installed).
let beforeUpdateInstallHook: (() => Promise<void>) | null = null

// Hook fired when quitAndInstall throws AFTER beforeUpdateInstallHook already tore
// the app down (sessions flushed, services disposed, lock released, isQuitting set).
// The process cannot safely keep running at that point — index.ts uses this to
// inform the user and relaunch into a fresh process instead of leaving a zombie
// app whose next quit would skip the flush entirely (#891).
let installQuitFailedHook: (() => void) | null = null

/**
 * Register a callback to run inside installUpdate() before quitAndInstall.
 * Used by index.ts to snapshot multi-window state while windows are still alive.
 */
export function setBeforeUpdateQuitHook(fn: () => void): void {
  beforeUpdateQuitHook = fn
}

/**
 * Register an async callback run (awaited) inside installUpdate() right before
 * quitAndInstall. index.ts uses it to run the full quit cleanup so the installer
 * handoff isn't interrupted by the before-quit handler's preventDefault (#891).
 */
export function setBeforeUpdateInstallHook(fn: () => Promise<void>): void {
  beforeUpdateInstallHook = fn
}

/**
 * Register the recovery callback for a quitAndInstall failure that happens after
 * the install cleanup hook already ran. index.ts relaunches the app from it.
 */
export function setInstallQuitFailedHook(fn: () => void): void {
  installQuitFailedHook = fn
}

/**
 * Check if an update installation is in progress.
 * Used by main process to avoid force-quitting during update.
 */
export function isUpdating(): boolean {
  return __isUpdating
}

/**
 * Set the event sink for broadcasting update events to renderer windows
 */
export function setAutoUpdateEventSink(sink: EventSink): void {
  eventSink = sink
}

/**
 * Get current update info (called by IPC handler)
 */
export function getUpdateInfo(): UpdateInfo {
  return { ...updateInfo }
}

/**
 * Broadcast update info to all renderer windows.
 * Creates a snapshot to avoid race conditions during broadcast.
 */
function broadcastUpdateInfo(): void {
  if (!eventSink) return

  const snapshot = { ...updateInfo }
  eventSink(RPC_CHANNELS.update.AVAILABLE, { to: 'all' }, snapshot)
}

/**
 * Broadcast download progress to all renderer windows.
 */
function broadcastDownloadProgress(progress: number): void {
  if (!eventSink) return

  eventSink(RPC_CHANNELS.update.DOWNLOAD_PROGRESS, { to: 'all' }, progress)
}

// ─── Configure electron-updater ───────────────────────────────────────────────

// Auto-download updates in the background after detection
autoUpdater.autoDownload = DESKTOP_RELEASE.updatesEnabled

// Install on app quit (if update is downloaded but user hasn't clicked "Restart")
autoUpdater.autoInstallOnAppQuit = DESKTOP_RELEASE.updatesEnabled

// The source is compiled with the app, never inherited from upstream metadata.
if (DESKTOP_RELEASE.updatesEnabled) {
  autoUpdater.setFeedURL({ provider: 'generic', url: DESKTOP_RELEASE.updateServerUrl })
}

// Use the logger for electron-updater internal logging
autoUpdater.logger = {
  info: (msg: unknown) => mainLog.info('[electron-updater]', msg),
  warn: (msg: unknown) => mainLog.warn('[electron-updater]', msg),
  error: (msg: unknown) => mainLog.error('[electron-updater]', msg),
  debug: (msg: unknown) => mainLog.info('[electron-updater:debug]', msg),
}

// ─── Event handlers ───────────────────────────────────────────────────────────

autoUpdater.on('checking-for-update', () => {
  mainLog.info('[auto-update] Checking for updates...')
})

autoUpdater.on('update-available', (info) => {
  autoUpdateLog.info('Update available', { currentVersion: updateInfo.currentVersion, latestVersion: info.version })

  // Only update-downloaded may mark an installer ready, after updater validation.
  updateInfo = {
    ...updateInfo,
    available: true,
    latestVersion: info.version,
    downloadState: autoUpdater.autoDownload ? 'downloading' : 'idle',
    downloadProgress: 0,
    error: undefined,
  }
  broadcastUpdateInfo()
})

autoUpdater.on('update-not-available', (info) => {
  mainLog.info(`[auto-update] Already up to date (${info.version})`)

  updateInfo = {
    ...updateInfo,
    available: false,
    latestVersion: info.version,
    downloadState: 'idle',
    error: undefined,
  }
  broadcastUpdateInfo()
})

autoUpdater.on('download-progress', (progress) => {
  const percent = Math.round(progress.percent)
  updateInfo = { ...updateInfo, downloadProgress: percent }
  broadcastDownloadProgress(percent)
})

autoUpdater.on('update-downloaded', async (info) => {
  autoUpdateLog.info('Update downloaded', { currentVersion: updateInfo.currentVersion, latestVersion: info.version })

  updateInfo = {
    ...updateInfo,
    available: true,
    latestVersion: info.version,
    downloadState: 'ready',
    downloadProgress: 100,
    error: undefined,
  }
  broadcastUpdateInfo()

  // Rebuild menu to show "Install Update..." option
  const { rebuildMenu } = await import('./menu')
  rebuildMenu()
})

autoUpdater.on('error', (error) => {
  autoUpdateLog.error('electron-updater error', {
    currentVersion: updateInfo.currentVersion,
    latestVersion: updateInfo.latestVersion,
    channel: DESKTOP_RELEASE.channel,
    error,
  })

  updateInfo = {
    ...updateInfo,
    downloadState: 'error',
    error: error.message,
  }
  broadcastUpdateInfo()
})

// ─── Exported API ─────────────────────────────────────────────────────────────

/**
 * Options for checkForUpdates
 */
interface CheckOptions {
  /** If true, automatically start download when update is found (default: true) */
  autoDownload?: boolean
}

/**
 * Check for available updates.
 * Returns the current UpdateInfo state after check completes.
 *
 * @param options.autoDownload - If false, only checks without downloading (for manual "Check Now")
 */
export async function checkForUpdates(options: CheckOptions = {}): Promise<UpdateInfo> {
  if (!DESKTOP_RELEASE.updatesEnabled) {
    updateInfo = { ...updateInfo, available: false, downloadState: 'idle', downloadProgress: 0,
      error: '此版本未配置自动更新，请联系管理员获取安装包。' }
    return getUpdateInfo()
  }
  const { autoDownload = true } = options

  // The internal feed is not anonymous. The ERP SSO-derived token remains in
  // the main process and is attached to manifest, installer and blockmap requests.
  const authorization = await getDesktopUpdateAuthorization()
  if (!authorization) {
    updateInfo = {
      ...updateInfo,
      available: false,
      downloadState: 'error',
      downloadProgress: 0,
      error: '请先通过 ERPNext 登录，再检查内部更新。',
    }
    autoUpdateLog.warn('Update check skipped: ERP session unavailable', {
      currentVersion: updateInfo.currentVersion,
      channel: DESKTOP_RELEASE.channel,
    })
    broadcastUpdateInfo()
    return getUpdateInfo()
  }
  autoUpdater.requestHeaders = {
    Authorization: authorization,
    'X-Jonwork-Desktop-Version': updateInfo.currentVersion,
    'X-Jonwork-Update-Channel': DESKTOP_RELEASE.channel,
  }

  // Temporarily override autoDownload for this check if needed
  // (e.g., manual check from settings shouldn't auto-download on metered connections)
  const previousAutoDownload = autoUpdater.autoDownload
  autoUpdater.autoDownload = autoDownload

  try {
    // Check for updates - this returns a promise that resolves with the check result
    await autoUpdater.checkForUpdates()
  } catch (error) {
    autoUpdateLog.error('Update check failed', {
      currentVersion: updateInfo.currentVersion,
      latestVersion: updateInfo.latestVersion,
      channel: DESKTOP_RELEASE.channel,
      error,
    })
    updateInfo = {
      ...updateInfo,
      downloadState: 'error',
      error: error instanceof Error ? error.message : 'Check failed',
    }
  } finally {
    // Restore previous autoDownload setting
    autoUpdater.autoDownload = previousAutoDownload
  }

  return getUpdateInfo()
}

/**
 * Install the downloaded update and restart the app.
 * Calls electron-updater's quitAndInstall which handles:
 * - macOS: Extracts zip and swaps app bundle
 * - Windows: Runs NSIS installer silently
 * - Linux: Replaces AppImage file
 * Then relaunches the app automatically.
 */
export async function installUpdate(): Promise<void> {
  if (!DESKTOP_RELEASE.updatesEnabled) throw new Error('Auto-update is disabled for this release')
  if (updateInfo.downloadState !== 'ready') {
    throw new Error('No update ready to install')
  }

  autoUpdateLog.info('Installing update and restarting...')

  updateInfo = { ...updateInfo, downloadState: 'installing' }
  broadcastUpdateInfo()

  // Clear dismissed version since user is explicitly updating
  clearDismissedUpdateVersion()

  // Set flag to prevent force exit from breaking electron-updater's shutdown sequence
  __isUpdating = true

  // Diagnostic correlation with before-quit's [update-flow] log. If these
  // window counts diverge, electron-updater is destroying windows between
  // here and before-quit firing — confirms the multi-window restore bug.
  autoUpdateLog.info('installUpdate pre-quit', {
    electronWindowCount: BrowserWindow.getAllWindows().length,
    downloadState: updateInfo.downloadState,
    latestVersion: updateInfo.latestVersion,
  })

  // Snapshot window state BEFORE quitAndInstall — electron-updater destroys
  // BrowserWindows between this call and before-quit firing, so the regular
  // before-quit save would clobber window-state.json with an empty array.
  try {
    beforeUpdateQuitHook?.()
  } catch (err) {
    autoUpdateLog.error('beforeUpdateQuit hook failed', err)
  }

  // Run the app's quit cleanup (session flush, timers, lock release) BEFORE the
  // installer hands off. This lets the before-quit handler skip its own
  // preventDefault-based cleanup, so Squirrel.Mac's quit runs to a real exit and
  // the update actually installs (#891).
  try {
    await beforeUpdateInstallHook?.()
  } catch (err) {
    autoUpdateLog.error('beforeUpdateInstall cleanup hook failed', err)
  }

  try {
    // isSilent=false shows the installer UI on Windows if needed (fallback)
    // isForceRunAfter=true ensures the app relaunches after install
    autoUpdater.quitAndInstall(false, true)
  } catch (error) {
    __isUpdating = false
    autoUpdateLog.error('quitAndInstall failed', {
      currentVersion: updateInfo.currentVersion,
      latestVersion: updateInfo.latestVersion,
      channel: DESKTOP_RELEASE.channel,
      error,
    })
    updateInfo = {
      ...updateInfo,
      downloadState: 'error',
      error: error instanceof Error ? error.message : 'Update installation failed',
    }
    broadcastUpdateInfo()
    // beforeUpdateInstallHook already tore the app down — recover via the
    // registered relaunch hook instead of leaving a zombie process (#891).
    try {
      installQuitFailedHook?.()
    } catch (hookErr) {
      autoUpdateLog.error('installQuitFailed hook failed', hookErr)
    }
    throw error
  }
}

/**
 * Result of update check on launch
 */
export interface UpdateOnLaunchResult {
  action: 'none' | 'skipped' | 'ready' | 'downloading'
  reason?: string
  version?: string | null
}

/**
 * Check for updates on app launch.
 * - Checks immediately (no delay)
 * - Respects dismissed version (skips notification but allows manual check)
 * - Auto-downloads if update available
 */
export async function checkForUpdatesOnLaunch(): Promise<UpdateOnLaunchResult> {
  autoUpdateLog.info('Checking for updates on launch...')

  const info = await checkForUpdates({ autoDownload: true })

  if (!info.available) {
    return { action: 'none' }
  }

  // Check if this version was dismissed by user
  const dismissedVersion = getDismissedUpdateVersion()
  if (dismissedVersion === info.latestVersion) {
    mainLog.info(`[auto-update] Update ${info.latestVersion} was dismissed, skipping notification`)
    return { action: 'skipped', reason: 'dismissed', version: info.latestVersion }
  }

  if (info.downloadState === 'ready') {
    return { action: 'ready', version: info.latestVersion }
  }

  // Download in progress — will notify when ready via update-downloaded event
  return { action: 'downloading', version: info.latestVersion }
}
