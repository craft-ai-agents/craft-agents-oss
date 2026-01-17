/**
 * Notification Service
 *
 * Handles native OS notifications and app badge count.
 * - Shows notifications when new messages arrive (when app is not focused)
 * - Updates dock badge count with total unread messages
 * - Clicking notification navigates to the relevant session
 */

import { Notification, app, BrowserWindow, nativeImage } from 'electron'
import { join } from 'path'
import { readFileSync } from 'fs'
import { mainLog } from './logger'
import type { WindowManager } from './window-manager'

let windowManager: WindowManager | null = null
let baseIconPath: string | null = null
let baseIconDataUrl: string | null = null
let currentBadgeCount: number = 0
let instanceNumber: number | null = null  // Multi-instance dev: instance number for dock badge

/**
 * Initialize the notification service with window manager reference
 */
export function initNotificationService(wm: WindowManager): void {
  windowManager = wm
}

/**
 * Show a native notification for a new message
 *
 * @param title - Notification title (e.g., session name)
 * @param body - Notification body (e.g., message preview)
 * @param workspaceId - Workspace ID for navigation
 * @param sessionId - Session ID for navigation
 */
export function showNotification(
  title: string,
  body: string,
  workspaceId: string,
  sessionId: string
): void {
  if (!Notification.isSupported()) {
    mainLog.info('Notifications not supported on this platform')
    return
  }

  const notification = new Notification({
    title,
    body,
    // macOS-specific options
    silent: false,
    // Use the app icon
    icon: undefined,  // Will use app icon by default on macOS
  })

  notification.on('click', () => {
    mainLog.info('Notification clicked:', { workspaceId, sessionId })
    handleNotificationClick(workspaceId, sessionId)
  })

  notification.show()
  mainLog.info('Notification shown:', { title, sessionId })
}

/**
 * Handle notification click - focus window and navigate to session
 */
function handleNotificationClick(workspaceId: string, sessionId: string): void {
  if (!windowManager) {
    mainLog.error('WindowManager not initialized for notification click')
    return
  }

  // Find or create window for this workspace
  let window = windowManager.getWindowByWorkspace(workspaceId)

  if (!window) {
    // Create a new window for this workspace
    windowManager.createWindow({ workspaceId })
    window = windowManager.getWindowByWorkspace(workspaceId)
  }

  if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
    // Focus the window
    if (window.isMinimized()) {
      window.restore()
    }
    window.focus()

    // Send navigation event to renderer to open the session
    window.webContents.send('notification:navigate', {
      workspaceId,
      sessionId,
    })
  }
}

/**
 * Initialize the base icon for badge overlay
 * Call this during app startup
 */
export function initBadgeIcon(iconPath: string): void {
  try {
    baseIconPath = iconPath
    // Read and cache the icon as base64 data URL
    const iconBuffer = readFileSync(iconPath)
    baseIconDataUrl = `data:image/png;base64,${iconBuffer.toString('base64')}`
    mainLog.info('Badge icon initialized:', iconPath)
  } catch (error) {
    mainLog.error('Failed to initialize badge icon:', error)
  }
}

/**
 * Update the app badge count (cross-platform)
 *
 * - macOS: Uses a canvas-based approach to draw the badge directly onto the dock icon.
 * - Windows: Uses taskbar overlay icon for badge display.
 * - Linux: Uses app.setBadgeCount() where supported (Unity, KDE).
 *
 * @param count - Number to show on badge (0 to clear)
 */
export function updateBadgeCount(count: number): void {
  // Skip if count hasn't changed
  if (count === currentBadgeCount) {
    return
  }

  currentBadgeCount = count

  if (process.platform === 'darwin') {
    updateBadgeCountMacOS(count)
  } else if (process.platform === 'win32') {
    updateBadgeCountWindows(count)
  } else if (process.platform === 'linux') {
    updateBadgeCountLinux(count)
  }
}

/**
 * Update badge count on macOS using dock icon overlay
 */
function updateBadgeCountMacOS(count: number): void {
  try {
    if (count > 0) {
      // Draw badge onto icon using the renderer process
      // We'll send this to the renderer which has Canvas API
      const windows = BrowserWindow.getAllWindows()
      const window = windows[0]
      if (window && !window.isDestroyed() && !window.webContents.isDestroyed() && baseIconDataUrl) {
        window.webContents.send('badge:draw', { count, iconDataUrl: baseIconDataUrl })
      }
    } else {
      // Reset to original icon (no badge)
      if (baseIconPath) {
        const originalIcon = nativeImage.createFromPath(baseIconPath)
        app.dock?.setIcon(originalIcon)
      }
    }
    mainLog.info('Badge count updated (macOS):', count)
  } catch (error) {
    mainLog.error('Failed to update badge count (macOS):', error)
  }
}

/**
 * Update badge count on Windows using taskbar overlay icon
 */
function updateBadgeCountWindows(count: number): void {
  try {
    const windows = BrowserWindow.getAllWindows()
    const window = windows[0]
    if (!window || window.isDestroyed()) {
      return
    }

    if (count > 0) {
      // Create a simple overlay icon with the count
      // We'll ask the renderer to draw it and send back via IPC
      if (!window.webContents.isDestroyed() && baseIconDataUrl) {
        window.webContents.send('badge:draw-windows', { count })
      }
    } else {
      // Clear the overlay
      window.setOverlayIcon(null, '')
    }
    mainLog.info('Badge count updated (Windows):', count)
  } catch (error) {
    mainLog.error('Failed to update badge count (Windows):', error)
  }
}

/**
 * Update badge count on Linux using app.setBadgeCount (Unity/KDE)
 */
function updateBadgeCountLinux(count: number): void {
  try {
    // Electron's setBadgeCount works on Linux with Unity launcher and KDE
    app.setBadgeCount(count)
    mainLog.info('Badge count updated (Linux):', count)
  } catch (error) {
    mainLog.error('Failed to update badge count (Linux):', error)
  }
}

/**
 * Set the dock/taskbar icon with a pre-rendered badge image (cross-platform)
 * Called from IPC when renderer has drawn the badge
 */
export function setDockIconWithBadge(dataUrl: string): void {
  try {
    const icon = nativeImage.createFromDataURL(dataUrl)

    if (process.platform === 'darwin') {
      app.dock?.setIcon(icon)
      mainLog.info('Dock icon updated with badge (macOS)')
    } else if (process.platform === 'win32') {
      // On Windows, set the taskbar overlay icon
      const windows = BrowserWindow.getAllWindows()
      const window = windows[0]
      if (window && !window.isDestroyed()) {
        window.setOverlayIcon(icon, `${currentBadgeCount} notifications`)
        mainLog.info('Taskbar overlay updated with badge (Windows)')
      }
    }
  } catch (error) {
    mainLog.error('Failed to set dock/taskbar icon with badge:', error)
  }
}

/**
 * Clear the app dock badge
 */
export function clearBadgeCount(): void {
  updateBadgeCount(0)
}

/**
 * Check if any window is currently focused
 */
export function isAnyWindowFocused(): boolean {
  const focusedWindow = BrowserWindow.getFocusedWindow()
  return focusedWindow !== null && !focusedWindow.isDestroyed()
}

/**
 * Initialize instance badge for multi-instance development.
 *
 * When running from a numbered folder (e.g., craft-tui-agent-1), this shows
 * a permanent badge on the dock icon to distinguish between instances.
 * Uses macOS dock.setBadge() for text-based badge display.
 *
 * @param number - Instance number (1, 2, etc.) or null for default instance
 */
export function initInstanceBadge(number: number): void {
  if (process.platform !== 'darwin') {
    // Instance badge only supported on macOS for now
    return
  }

  instanceNumber = number

  try {
    // Use dock.setBadge() for simple text badge
    // This shows the number in a red badge on the dock icon
    app.dock?.setBadge(String(number))
    mainLog.info(`Instance badge set: ${number}`)
  } catch (error) {
    mainLog.error('Failed to set instance badge:', error)
  }
}
