/**
 * Global Shortcut Manager
 *
 * Manages global keyboard shortcuts for activating the app from anywhere.
 * The shortcut brings all windows to foreground when pressed.
 */

import { globalShortcut, app, BrowserWindow } from 'electron'
import { mainLog } from './logger'
import { loadPreferences, savePreferences, type GlobalShortcutSettings } from '@craft-agent/shared/config'

// Default shortcut: Cmd+Shift+Space on macOS, Ctrl+Shift+Space on Windows/Linux
const DEFAULT_SHORTCUT = 'CommandOrControl+Shift+Space'

let currentShortcut: string | null = null

/**
 * Get the current global shortcut settings
 */
export function getGlobalShortcutSettings(): { enabled: boolean; shortcut: string } {
  const prefs = loadPreferences()
  return {
    enabled: prefs.globalShortcut?.enabled ?? false,
    shortcut: prefs.globalShortcut?.shortcut ?? DEFAULT_SHORTCUT,
  }
}

/**
 * Toggle the app - if in foreground, hide it; if in background, bring to foreground
 */
function activateApp(): void {
  const windows = BrowserWindow.getAllWindows()
  if (windows.length === 0) {
    mainLog.info('[GlobalShortcut] No windows to toggle')
    return
  }

  const mainWindow = windows[0]
  const isAppInForeground = mainWindow.isFocused() && mainWindow.isVisible()

  if (isAppInForeground) {
    mainLog.info('[GlobalShortcut] Hiding app')
    if (process.platform === 'darwin') {
      app.hide()
    } else {
      for (const win of windows) {
        win.minimize()
      }
    }
  } else {
    mainLog.info('[GlobalShortcut] Activating app')

    if (process.platform === 'darwin' && app.dock) {
      app.dock.show()
    }

    for (const win of windows) {
      if (win.isMinimized()) {
        win.restore()
      }
      if (!win.isVisible()) {
        win.show()
      }
    }

    mainWindow.focus()

    if (process.platform === 'darwin') {
      app.focus({ steal: true })
    }
  }
}

/**
 * Register a global shortcut
 * Returns true if registration was successful
 */
function registerShortcut(accelerator: string): boolean {
  try {
    // Unregister any existing shortcut first
    if (currentShortcut) {
      globalShortcut.unregister(currentShortcut)
      currentShortcut = null
    }

    // Register the new shortcut
    const success = globalShortcut.register(accelerator, activateApp)
    if (success) {
      currentShortcut = accelerator
      mainLog.info(`[GlobalShortcut] Registered shortcut: ${accelerator}`)
    } else {
      mainLog.warn(`[GlobalShortcut] Failed to register shortcut: ${accelerator}`)
    }
    return success
  } catch (error) {
    mainLog.error(`[GlobalShortcut] Error registering shortcut: ${accelerator}`, error)
    return false
  }
}

/**
 * Unregister the current global shortcut
 */
function unregisterShortcut(): void {
  if (currentShortcut) {
    globalShortcut.unregister(currentShortcut)
    mainLog.info(`[GlobalShortcut] Unregistered shortcut: ${currentShortcut}`)
    currentShortcut = null
  }
}

/**
 * Set the global shortcut settings
 * Returns success status and optional error message
 */
export function setGlobalShortcutSettings(
  enabled: boolean,
  shortcut: string
): { success: boolean; error?: string } {
  const accelerator = shortcut || DEFAULT_SHORTCUT

  if (enabled) {
    // Validate the shortcut format
    if (!isValidAccelerator(accelerator)) {
      return { success: false, error: 'Invalid shortcut format' }
    }

    // Try to register the shortcut
    const success = registerShortcut(accelerator)
    if (!success) {
      return { success: false, error: 'Shortcut may be in use by another application' }
    }
  } else {
    // Disable - just unregister
    unregisterShortcut()
  }

  // Save to preferences
  const prefs = loadPreferences()
  const updatedPrefs = {
    ...prefs,
    globalShortcut: {
      enabled,
      shortcut: accelerator,
    } as GlobalShortcutSettings,
    updatedAt: Date.now(),
  }
  savePreferences(updatedPrefs)

  return { success: true }
}

/**
 * Initialize global shortcuts on app startup
 * Registers the shortcut if it was previously enabled
 */
export function initializeGlobalShortcut(): void {
  const settings = getGlobalShortcutSettings()
  if (settings.enabled && settings.shortcut) {
    const success = registerShortcut(settings.shortcut)
    if (!success) {
      mainLog.warn('[GlobalShortcut] Failed to restore previous shortcut on startup')
    }
  }
}

/**
 * Cleanup global shortcuts on app quit
 */
export function cleanupGlobalShortcut(): void {
  globalShortcut.unregisterAll()
  currentShortcut = null
  mainLog.info('[GlobalShortcut] Cleaned up all shortcuts')
}

/**
 * Check if an accelerator string is valid
 * This is a basic validation - Electron will do the actual validation on register
 */
function isValidAccelerator(accelerator: string): boolean {
  if (!accelerator || typeof accelerator !== 'string') {
    return false
  }

  // Must contain at least one modifier and one key
  const parts = accelerator.split('+').map(p => p.trim())
  if (parts.length < 2) {
    return false
  }

  // Check for valid modifiers
  const validModifiers = [
    'Command', 'Cmd', 'Control', 'Ctrl', 'CommandOrControl', 'CmdOrCtrl',
    'Alt', 'Option', 'AltGr', 'Shift', 'Super', 'Meta'
  ]
  const hasModifier = parts.some(p =>
    validModifiers.some(m => m.toLowerCase() === p.toLowerCase())
  )

  return hasModifier
}
