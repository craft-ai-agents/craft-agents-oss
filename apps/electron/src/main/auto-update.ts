/**
 * Auto-update module for Electron app
 *
 * Handles checking for updates, downloading, and triggering installation.
 * Uses the custom manifest system at https://agents.craft.do/electron/
 *
 * Supports macOS, Windows, and Linux (AppImage only).
 */

import { app } from 'electron'
import { createWriteStream, createReadStream, existsSync, mkdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { spawn } from 'child_process'
import { createHash } from 'crypto'
import { pipeline } from 'stream/promises'
import { mainLog } from './logger'
import {
  getElectronLatestVersion,
  getElectronManifest,
  isNewerVersion,
  getPlatformKey,
  getAppVersion,
} from '@craft-agent/shared/version'
import {
  getDismissedUpdateVersion,
  clearDismissedUpdateVersion,
  getPendingUpdate,
  setPendingUpdate,
  clearPendingUpdate,
} from '@craft-agent/shared/config'
import type { VersionManifest, BinaryInfo } from '@craft-agent/shared/version/manifest'
import type { UpdateInfo } from '../shared/types'
import type { WindowManager } from './window-manager'

// Module state
let updateInfo: UpdateInfo = {
  available: false,
  currentVersion: getAppVersion(),
  latestVersion: null,
  downloadUrl: null,
  downloadState: 'idle',
  downloadProgress: 0,
}

let windowManager: WindowManager | null = null
let downloadedInstallerPath: string | null = null

// Cache the manifest to avoid refetching during download
let cachedManifest: VersionManifest | null = null
let cachedBinaryInfo: BinaryInfo | null = null

// Mutex locks to prevent concurrent operations
// Using promises for deduplication - concurrent callers get the same result
let checkPromise: Promise<UpdateInfo> | null = null
let downloadPromise: Promise<void> | null = null
let isInstalling = false

/**
 * Set the window manager for broadcasting updates
 */
export function setWindowManager(wm: WindowManager): void {
  windowManager = wm
}

/**
 * Get current update info
 */
export function getUpdateInfo(): UpdateInfo {
  return { ...updateInfo }
}

/**
 * Broadcast update info to all renderer windows
 * Takes a snapshot of the current state to avoid race conditions
 */
function broadcastUpdateInfo(): void {
  if (!windowManager) return

  // Create snapshot to avoid race conditions if state changes during broadcast
  const snapshot = { ...updateInfo }

  const windows = windowManager.getAllWindows()
  for (const { window } of windows) {
    if (!window.isDestroyed()) {
      window.webContents.send('update:available', snapshot)
    }
  }
}

/**
 * Broadcast download progress to all renderer windows
 */
function broadcastDownloadProgress(progress: number): void {
  if (!windowManager) return

  const windows = windowManager.getAllWindows()
  for (const { window } of windows) {
    if (!window.isDestroyed()) {
      window.webContents.send('update:downloadProgress', progress)
    }
  }
}

/**
 * Options for checkForUpdates
 */
interface CheckOptions {
  /** If true, automatically start download when update is found (default: true for scheduled checks) */
  autoDownload?: boolean
}

/**
 * Check for available updates
 * Returns UpdateInfo with available=true if a newer version exists
 *
 * Uses promise deduplication - concurrent callers get the same result
 *
 * @param options.autoDownload - If true, auto-start download (default: true)
 */
export async function checkForUpdates(options: CheckOptions = {}): Promise<UpdateInfo> {
  // Return existing promise if check already in progress (deduplication)
  if (checkPromise) {
    mainLog.info('[auto-update] Check already in progress, returning existing promise')
    return checkPromise
  }

  const { autoDownload = true } = options
  checkPromise = doCheckForUpdates(autoDownload)
  try {
    return await checkPromise
  } finally {
    checkPromise = null
  }
}

/**
 * Internal implementation of update check
 */
async function doCheckForUpdates(autoDownload: boolean): Promise<UpdateInfo> {
  mainLog.info('[auto-update] Checking for updates...')

  const currentVersion = getAppVersion()
  updateInfo = { ...updateInfo, currentVersion }

  try {
    // Fetch latest version from server
    const latestVersion = await getElectronLatestVersion()

    if (!latestVersion) {
      mainLog.info('[auto-update] Could not fetch latest version')
      return updateInfo
    }

    updateInfo = { ...updateInfo, latestVersion }

    // Check if newer version is available
    if (!isNewerVersion(currentVersion, latestVersion)) {
      mainLog.info(`[auto-update] Already up to date (${currentVersion})`)
      updateInfo = { ...updateInfo, available: false }
      return updateInfo
    }

    mainLog.info(`[auto-update] Update available: ${currentVersion} → ${latestVersion}`)

    // Fetch manifest for download URL and cache it
    const manifest = await getElectronManifest(latestVersion)
    if (!manifest) {
      mainLog.error('[auto-update] Could not fetch manifest')
      return updateInfo
    }

    // Cache the manifest for later use during download
    cachedManifest = manifest

    // Get download URL for current platform
    const platformKey = getPlatformKey()
    const binary = manifest.binaries[platformKey]

    if (!binary) {
      mainLog.error(`[auto-update] No binary found for platform: ${platformKey}`)
      return updateInfo
    }

    // Cache binary info for checksum verification during download
    cachedBinaryInfo = binary

    // Update state atomically
    updateInfo = {
      ...updateInfo,
      available: true,
      downloadUrl: binary.url,
      downloadState: 'idle',
      downloadProgress: 0,
    }

    // Broadcast to all windows
    broadcastUpdateInfo()

    // Start auto-download in background only if requested
    // Manual "Check Now" from settings uses autoDownload=false so users on metered
    // connections aren't surprised by a large download
    if (autoDownload) {
      downloadUpdate().catch(err => {
        mainLog.error('[auto-update] Auto-download failed:', err)
      })
    }

    return updateInfo
  } catch (error) {
    mainLog.error('[auto-update] Check failed:', error)
    return updateInfo
  }
}

/**
 * Download the update DMG
 *
 * Uses promise deduplication - concurrent callers get the same result
 *
 * @throws Error if called before checkForUpdates() or if no update is available
 */
export async function downloadUpdate(): Promise<void> {
  // Return existing promise if download already in progress (deduplication)
  if (downloadPromise) {
    mainLog.info('[auto-update] Download already in progress, returning existing promise')
    return downloadPromise
  }

  // Already downloaded
  if (updateInfo.downloadState === 'ready') {
    mainLog.info('[auto-update] Download already complete')
    return
  }

  if (!updateInfo.available || !updateInfo.downloadUrl || !updateInfo.latestVersion) {
    const error = new Error('No update available to download. Call checkForUpdates() first.')
    mainLog.warn('[auto-update] No update to download')
    throw error
  }

  // Use cached binary info from checkForUpdates()
  // This prevents TOCTOU race where manifest could change between check and download
  if (!cachedBinaryInfo) {
    const error = new Error('No cached binary info - must call checkForUpdates() first')
    mainLog.error('[auto-update]', error.message)
    // Update state to reflect error
    updateInfo = { ...updateInfo, downloadState: 'error', error: error.message }
    broadcastUpdateInfo()
    throw error
  }

  downloadPromise = doDownloadUpdate()
  try {
    return await downloadPromise
  } finally {
    downloadPromise = null
  }
}

/**
 * Internal implementation of download
 */
async function doDownloadUpdate(): Promise<void> {
  // These were validated in downloadUpdate() but TypeScript doesn't track across functions
  const downloadUrl = updateInfo.downloadUrl
  const latestVersion = updateInfo.latestVersion
  const binaryInfo = cachedBinaryInfo

  if (!downloadUrl || !latestVersion || !binaryInfo) {
    throw new Error('Missing required update info - call checkForUpdates first')
  }

  mainLog.info(`[auto-update] Downloading update from: ${downloadUrl}`)

  updateInfo = { ...updateInfo, downloadState: 'downloading', downloadProgress: 0 }
  broadcastUpdateInfo()

  // Declare installerPath outside try block so it's accessible in catch for cleanup
  let installerPath: string | undefined

  try {
    // Create temp directory for download
    const tempDir = join(app.getPath('temp'), 'craft-agent-updates')
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true })
    }

    // Download file - use correct extension per platform
    const extension = process.platform === 'darwin' ? 'dmg' :
                      process.platform === 'win32' ? 'exe' :
                      'AppImage'
    installerPath = join(tempDir, `Craft-Agent-${latestVersion}.${extension}`)

    // Remove existing file if present
    if (existsSync(installerPath)) {
      unlinkSync(installerPath)
    }

    const response = await fetch(downloadUrl)
    if (!response.ok || !response.body) {
      throw new Error(`Download failed: ${response.status}`)
    }

    const contentLength = parseInt(response.headers.get('content-length') || '0', 10)
    let downloadedBytes = 0

    // Track progress for deduplication
    let lastBroadcastProgress = 0

    // Create transform stream to track progress
    const progressStream = new TransformStream({
      transform(chunk, controller) {
        downloadedBytes += chunk.byteLength
        if (contentLength > 0) {
          const progress = Math.round((downloadedBytes / contentLength) * 100)
          if (progress !== lastBroadcastProgress) {
            lastBroadcastProgress = progress
            updateInfo = { ...updateInfo, downloadProgress: progress }
            broadcastDownloadProgress(progress)
          }
        }
        controller.enqueue(chunk)
      },
    })

    // Pipe response through progress tracker to file
    const writeStream = createWriteStream(installerPath)
    const reader = response.body.pipeThrough(progressStream).getReader()

    const hash = createHash('sha256')

    // Manual read loop for Node.js compatibility
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      hash.update(Buffer.from(value))
      writeStream.write(Buffer.from(value))
    }

    writeStream.end()

    // Wait for write stream to finish
    await new Promise<void>((resolve, reject) => {
      writeStream.on('finish', resolve)
      writeStream.on('error', reject)
    })

    // Verify checksum using cached binary info
    const downloadedChecksum = hash.digest('hex')
    if (downloadedChecksum !== binaryInfo.sha256) {
      unlinkSync(installerPath)
      throw new Error(`Checksum mismatch: expected ${binaryInfo.sha256}, got ${downloadedChecksum}`)
    }

    mainLog.info('[auto-update] Download complete and verified')

    downloadedInstallerPath = installerPath
    updateInfo = { ...updateInfo, downloadState: 'ready', downloadProgress: 100 }
    broadcastUpdateInfo()

    // Save pending update for auto-install on next launch
    setPendingUpdate({
      version: latestVersion,
      installerPath,
      sha256: binaryInfo.sha256,
    })

    // Update menu to show "Install Update..."
    const { rebuildMenu } = await import('./menu')
    rebuildMenu()
  } catch (error) {
    mainLog.error('[auto-update] Download failed:', error)

    // Clean up partial download on failure
    if (installerPath && existsSync(installerPath)) {
      try {
        unlinkSync(installerPath)
        mainLog.info('[auto-update] Cleaned up partial download')
      } catch (cleanupError) {
        mainLog.warn('[auto-update] Failed to clean up partial download:', cleanupError)
      }
    }

    updateInfo = {
      ...updateInfo,
      downloadState: 'error',
      error: error instanceof Error ? error.message : 'Download failed',
    }
    broadcastUpdateInfo()
    throw error
  }
}

/**
 * Install the downloaded update and restart the app
 * Supports macOS, Windows, and Linux (AppImage only)
 *
 * Uses a flag to prevent concurrent installations
 */
export async function installUpdate(): Promise<void> {
  // Prevent concurrent installations
  if (isInstalling) {
    mainLog.info('[auto-update] Installation already in progress')
    return
  }

  if (updateInfo.downloadState !== 'ready' || !downloadedInstallerPath) {
    throw new Error('No update ready to install')
  }

  // Check platform support
  if (process.platform === 'linux' && !process.env.APPIMAGE) {
    throw new Error('Auto-update only supported for AppImage on Linux. Please download and install the new version manually.')
  }

  isInstalling = true
  mainLog.info(`[auto-update] Starting ${process.platform} installation...`)

  updateInfo = { ...updateInfo, downloadState: 'installing' }
  broadcastUpdateInfo()

  // Clear dismissed version on successful update start
  clearDismissedUpdateVersion()

  try {
    if (process.platform === 'darwin') {
      await installMacOS()
    } else if (process.platform === 'win32') {
      await installWindows()
    } else if (process.platform === 'linux') {
      await installLinux()
    } else {
      throw new Error(`Unsupported platform: ${process.platform}`)
    }
    // Note: if install succeeds, app.quit() is called and we never reach here
  } catch (error) {
    // Reset flag so user can retry
    isInstalling = false
    mainLog.error('[auto-update] Installation failed:', error)
    updateInfo = {
      ...updateInfo,
      downloadState: 'error',
      error: error instanceof Error ? error.message : 'Installation failed',
    }
    broadcastUpdateInfo()
    throw error
  }
}

/**
 * macOS: Use self-update.sh script to mount DMG and copy to /Applications
 * The script handles:
 * - Atomic swap (backup old app, install new app atomically)
 * - Rollback on failure
 * - Code signature verification
 * - Clean environment for launch
 */
async function installMacOS(): Promise<void> {
  if (!downloadedInstallerPath) throw new Error('No installer path')

  const scriptPath = app.isPackaged
    ? join(process.resourcesPath, 'self-update.sh')
    : join(__dirname, '../scripts/self-update.sh')

  if (!existsSync(scriptPath)) {
    mainLog.warn('[auto-update] Self-update script not found, opening DMG manually')
    const { shell } = await import('electron')
    await shell.openPath(downloadedInstallerPath)
    return
  }

  const child = spawn('bash', [scriptPath, downloadedInstallerPath, app.getPath('exe')], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      CRAFT_UPDATE_DMG: downloadedInstallerPath,
      CRAFT_APP_PATH: app.getPath('exe'),
    },
  })

  child.unref()

  // Small delay to ensure the detached script process has fully started before we exit.
  // This prevents a race condition where the app exits before the script is ready.
  await new Promise(resolve => setTimeout(resolve, 500))

  // Clear pending update only after delay - if something goes wrong before this point,
  // the pending update will be preserved for retry on next launch.
  clearPendingUpdate()

  mainLog.info('[auto-update] Exiting app for macOS update...')
  // Use app.exit() instead of app.quit() to avoid window close handlers potentially
  // intercepting or delaying the quit, which could cause race conditions with the update script.
  app.exit(0)
}

/**
 * Windows: Use PowerShell script to run NSIS installer silently
 * The script handles:
 * - Waiting for app to quit
 * - Running NSIS installer with /S (silent) flag
 * - Relaunching the app
 */
async function installWindows(): Promise<void> {
  if (!downloadedInstallerPath) throw new Error('No installer path')

  const scriptPath = app.isPackaged
    ? join(process.resourcesPath, 'self-update.ps1')
    : join(__dirname, '../scripts/self-update.ps1')

  if (!existsSync(scriptPath)) {
    mainLog.warn('[auto-update] Self-update script not found, opening installer manually')
    const { shell } = await import('electron')
    await shell.openPath(downloadedInstallerPath)
    return
  }

  const child = spawn('powershell.exe', [
    '-WindowStyle', 'Hidden', // Prevent console window from briefly appearing
    '-ExecutionPolicy', 'Bypass',
    '-File', scriptPath,
    '-InstallerPath', downloadedInstallerPath,
    '-AppPath', app.getPath('exe'),
  ], {
    detached: true,
    stdio: 'ignore',
  })

  child.unref()

  // Small delay to ensure the detached script process has fully started before we exit.
  await new Promise(resolve => setTimeout(resolve, 500))

  // Clear pending update only after delay
  clearPendingUpdate()

  mainLog.info('[auto-update] Exiting app for Windows update...')
  // Use app.exit() to avoid window close handlers potentially intercepting the quit
  app.exit(0)
}

/**
 * Linux: Replace AppImage with new version
 * The script handles:
 * - Waiting for app to quit
 * - Making new AppImage executable
 * - Atomic replacement with backup/rollback
 * - Relaunching the app
 */
async function installLinux(): Promise<void> {
  if (!downloadedInstallerPath) throw new Error('No installer path')

  const currentAppImage = process.env.APPIMAGE
  if (!currentAppImage) {
    throw new Error('Not running as AppImage - cannot auto-update')
  }

  const scriptPath = app.isPackaged
    ? join(process.resourcesPath, 'self-update-linux.sh')
    : join(__dirname, '../scripts/self-update-linux.sh')

  if (!existsSync(scriptPath)) {
    mainLog.warn('[auto-update] Self-update script not found, opening file location')
    const { shell } = await import('electron')
    await shell.showItemInFolder(downloadedInstallerPath)
    return
  }

  const child = spawn('bash', [
    scriptPath,
    downloadedInstallerPath,
    currentAppImage,
  ], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      CRAFT_UPDATE_APPIMAGE: downloadedInstallerPath,
      CRAFT_CURRENT_APPIMAGE: currentAppImage,
    },
  })

  child.unref()

  // Small delay to ensure the detached script process has fully started before we exit.
  await new Promise(resolve => setTimeout(resolve, 500))

  // Clear pending update only after delay
  clearPendingUpdate()

  mainLog.info('[auto-update] Exiting app for Linux update...')
  // Use app.exit() to avoid window close handlers potentially intercepting the quit
  app.exit(0)
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
 * Compute SHA256 hash of a file using streams (memory-efficient for large files)
 */
async function computeFileHashStreaming(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  const stream = createReadStream(filePath)

  await pipeline(stream, hash)
  return hash.digest('hex')
}

/**
 * Check for a pending update from previous session and auto-install if valid.
 * Call this early in app startup, before creating windows.
 *
 * @returns true if auto-installing (app will quit), false otherwise
 */
export async function checkPendingUpdateAndInstall(): Promise<boolean> {
  const pending = getPendingUpdate()

  if (!pending) {
    return false
  }

  mainLog.info(`[auto-update] Found pending update: v${pending.version} at ${pending.installerPath}`)

  // Check if installer file still exists
  if (!existsSync(pending.installerPath)) {
    mainLog.warn('[auto-update] Pending installer file not found, clearing')
    clearPendingUpdate()
    return false
  }

  // Verify checksum using streaming to avoid loading large files into memory
  try {
    const hash = await computeFileHashStreaming(pending.installerPath)

    if (hash !== pending.sha256) {
      mainLog.error('[auto-update] Pending installer checksum mismatch, clearing')
      clearPendingUpdate()
      unlinkSync(pending.installerPath)
      return false
    }
  } catch (error) {
    mainLog.error('[auto-update] Failed to verify pending installer:', error)
    clearPendingUpdate()
    return false
  }

  mainLog.info('[auto-update] Pending update verified, auto-installing...')

  // Set up state for installation
  downloadedInstallerPath = pending.installerPath
  updateInfo = {
    ...updateInfo,
    available: true,
    latestVersion: pending.version,
    downloadState: 'ready',
  }

  // NOTE: Pending update is cleared inside the platform-specific install functions
  // right before app.quit(). This ensures we only clear after successful script spawn.
  // If install throws before spawning the script, we preserve the pending state
  // to allow retry on next launch.

  // Trigger installation
  try {
    await installUpdate()
    // Note: If we reach here, app.quit() was called and this line won't execute.
    // The clearPendingUpdate() is done inside installMacOS/Windows/Linux before quit.
    return true
  } catch (error) {
    mainLog.error('[auto-update] Auto-install failed:', error)
    // DON'T clear pending update - allow retry on next launch
    mainLog.info('[auto-update] Pending update preserved for retry on next launch')
    return false
  }
}

/**
 * Check for updates on app launch
 * - Runs immediately (no delay)
 * - If update already downloaded, returns 'ready' for immediate prompt
 * - If update available but not downloaded, starts silent download
 * - Respects dismissed version (skips notification but still allows manual check)
 */
export async function checkForUpdatesOnLaunch(): Promise<UpdateOnLaunchResult> {
  mainLog.info('[auto-update] Checking for updates on launch...')

  // Check for update
  const info = await checkForUpdates({ autoDownload: true })

  if (!info.available) {
    return { action: 'none' }
  }

  // Check if this version was dismissed
  const dismissedVersion = getDismissedUpdateVersion()
  if (dismissedVersion === info.latestVersion) {
    mainLog.info(`[auto-update] Update ${info.latestVersion} was dismissed, skipping notification`)
    return { action: 'skipped', reason: 'dismissed', version: info.latestVersion }
  }

  if (info.downloadState === 'ready') {
    return { action: 'ready', version: info.latestVersion }
  }

  // Download in progress or starting - will notify when ready
  return { action: 'downloading', version: info.latestVersion }
}

/**
 * Schedule update check after app startup
 * @deprecated Use checkForUpdatesOnLaunch() instead for immediate check
 *
 * Skipped in debug mode (dev builds) to allow manual testing via Debug menu.
 */
export function scheduleUpdateCheck(delayMs = 5000): void {
  // Skip auto-update in debug mode - use Debug menu to test manually
  if (!app.isPackaged) {
    mainLog.info('[auto-update] Skipping auto-update check in debug mode (use Debug menu to test)')
    return
  }

  mainLog.info(`[auto-update] Scheduling update check in ${delayMs}ms`)

  setTimeout(() => {
    checkForUpdates().catch(err => {
      mainLog.error('[auto-update] Scheduled check failed:', err)
    })
  }, delayMs)
}
