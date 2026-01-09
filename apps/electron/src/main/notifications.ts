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
    windowManager.createWindow(workspaceId)
    window = windowManager.getWindowByWorkspace(workspaceId)
  }

  if (window && !window.isDestroyed()) {
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
 * Update the app dock badge count (macOS only)
 *
 * Uses a canvas-based approach to draw the badge directly onto the dock icon.
 * This works in both dev and production builds, unlike app.dock.setBadge().
 *
 * @param count - Number to show on badge (0 to clear)
 */
export function updateBadgeCount(count: number): void {
  if (process.platform !== 'darwin') {
    // Badge is only supported on macOS
    return
  }

  // Skip if count hasn't changed
  if (count === currentBadgeCount) {
    return
  }

  try {
    currentBadgeCount = count

    if (count > 0) {
      // Draw badge onto icon using the renderer process
      // We'll send this to the renderer which has Canvas API
      const windows = BrowserWindow.getAllWindows()
      if (windows.length > 0 && baseIconDataUrl) {
        windows[0].webContents.send('badge:draw', { count, iconDataUrl: baseIconDataUrl })
      }
    } else {
      // Reset to original icon (no badge)
      if (baseIconPath) {
        const originalIcon = nativeImage.createFromPath(baseIconPath)
        app.dock.setIcon(originalIcon)
      }
    }
    mainLog.info('Badge count updated:', count)
  } catch (error) {
    mainLog.error('Failed to update badge count:', error)
  }
}

/**
 * Set the dock icon with a pre-rendered badge image
 * Called from IPC when renderer has drawn the badge
 */
export function setDockIconWithBadge(dataUrl: string): void {
  if (process.platform !== 'darwin') {
    return
  }

  try {
    const icon = nativeImage.createFromDataURL(dataUrl)
    app.dock.setIcon(icon)
    mainLog.info('Dock icon updated with badge')
  } catch (error) {
    mainLog.error('Failed to set dock icon with badge:', error)
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
