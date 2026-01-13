/**
 * Auto-update module for Electron app
 *
 * Handles checking for updates, downloading, and triggering installation.
 * Uses the custom manifest system at https://agents.craft.do/electron/
 *
 * Currently only supports macOS. Windows and Linux support planned for future.
 */

import { app } from 'electron'
import { createWriteStream, existsSync, mkdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { spawn } from 'child_process'
import { createHash } from 'crypto'
import { mainLog } from './logger'
import {
  getElectronLatestVersion,
  getElectronManifest,
  isNewerVersion,
  getPlatformKey,
  getAppVersion,
} from '@craft-agent/shared/version'
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

  // Only support macOS for now
  if (process.platform !== 'darwin') {
    mainLog.info('[auto-update] Auto-update only supported on macOS')
    return updateInfo
  }

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

  try {
    // Create temp directory for download
    const tempDir = join(app.getPath('temp'), 'craft-agent-updates')
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true })
    }

    // Download file
    const installerPath = join(tempDir, `Craft-Agent-${latestVersion}.dmg`)

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
  } catch (error) {
    mainLog.error('[auto-update] Download failed:', error)
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
 * Currently only supports macOS
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

  // Only support macOS for now
  if (process.platform !== 'darwin') {
    throw new Error('Auto-update installation only supported on macOS. Please download and install manually.')
  }

  isInstalling = true
  mainLog.info('[auto-update] Starting macOS installation...')

  updateInfo = { ...updateInfo, downloadState: 'installing' }
  broadcastUpdateInfo()

  try {
    await installMacOS()
    // Note: if installMacOS succeeds, app.quit() is called and we never reach here
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
  mainLog.info('[auto-update] Quitting app for macOS update...')
  app.quit()
}

/**
 * Schedule update check after app startup
 * Delays check by a few seconds to not slow down startup
 */
export function scheduleUpdateCheck(delayMs = 5000): void {
  // Only schedule on macOS
  if (process.platform !== 'darwin') {
    mainLog.info('[auto-update] Skipping update check - not on macOS')
    return
  }

  mainLog.info(`[auto-update] Scheduling update check in ${delayMs}ms`)

  setTimeout(() => {
    checkForUpdates().catch(err => {
      mainLog.error('[auto-update] Scheduled check failed:', err)
    })
  }, delayMs)
}
