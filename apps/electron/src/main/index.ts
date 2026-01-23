// Load user's shell environment first (before other imports that may use env)
// This ensures tools like Homebrew, nvm, etc. are available to the agent
import { loadShellEnv } from './shell-env'
loadShellEnv()

import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { SessionManager } from './sessions'
import { registerIpcHandlers } from './ipc'
import { createApplicationMenu } from './menu'
import { WindowManager } from './window-manager'
import { loadWindowState, saveWindowState } from './window-state'
import { getWorkspaces } from '@craft-agent/shared/config'
import { initializeDocs } from '@craft-agent/shared/docs'
import { ensureDefaultPermissions } from '@craft-agent/shared/agent/permissions-config'
import { handleDeepLink } from './deep-link'
import log, { isDebugMode, mainLog, getLogFilePath } from './logger'
import { setPerfEnabled, enableDebug } from '@craft-agent/shared/utils'
import { initNotificationService, clearBadgeCount, initBadgeIcon, initInstanceBadge } from './notifications'
import { checkForUpdatesOnLaunch, setWindowManager as setAutoUpdateWindowManager } from './auto-update'

// Initialize electron-log for renderer process support
log.initialize()

// Enable debug/perf in dev mode (running from source)
if (isDebugMode) {
  process.env.CRAFT_DEBUG = '1'
  enableDebug()
  setPerfEnabled(true)
}

// Custom URL scheme for deeplinks (e.g., craftagents://auth-complete)
// Supports multi-instance dev: CRAFT_DEEPLINK_SCHEME env var (craftagents1, craftagents2, etc.)
const DEEPLINK_SCHEME = process.env.CRAFT_DEEPLINK_SCHEME || 'craftagents'

let windowManager: WindowManager | null = null
let sessionManager: SessionManager | null = null

// Store pending deep link if app not ready yet (cold start)
let pendingDeepLink: string | null = null

// Set app name early (before app.whenReady) to ensure correct macOS menu bar title
// Supports multi-instance dev: CRAFT_APP_NAME env var (e.g., "Craft Agents [1]")
app.setName(process.env.CRAFT_APP_NAME || 'Craft Agents')

// Register as default protocol client for craftagents:// URLs
// This must be done before app.whenReady() on some platforms
if (process.defaultApp) {
  // Development mode: need to pass the app path
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(DEEPLINK_SCHEME, process.execPath, [process.argv[1]])
  }
} else {
  // Production mode
  app.setAsDefaultProtocolClient(DEEPLINK_SCHEME)
}

// Handle deeplink on macOS (when app is already running)
app.on('open-url', (event, url) => {
  event.preventDefault()
  mainLog.info('Received deeplink:', url)

  if (windowManager) {
    handleDeepLink(url, windowManager).catch(err => {
      mainLog.error('Failed to handle deep link:', err)
    })
  } else {
    // App not ready - store for later
    pendingDeepLink = url
  }
})

// Handle deeplink on Windows/Linux (single instance check)
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, commandLine, _workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window.
    // On Windows/Linux, the deeplink is in commandLine
    const url = commandLine.find(arg => arg.startsWith(`${DEEPLINK_SCHEME}://`))
    if (url && windowManager) {
      mainLog.info('Received deeplink from second instance:', url)
      handleDeepLink(url, windowManager).catch(err => {
        mainLog.error('Failed to handle deep link:', err)
      })
    } else if (windowManager) {
      // No deep link - just focus the first window
      const windows = windowManager.getAllWindows()
      if (windows.length > 0) {
        const win = windows[0].window
        if (win.isMinimized()) win.restore()
        win.focus()
      }
    }
  })
}

// Helper to create initial windows on startup
async function createInitialWindows(): Promise<void> {
  if (!windowManager) return

  // Load saved window state
  const savedState = loadWindowState()
  const workspaces = getWorkspaces()
  const validWorkspaceIds = workspaces.map(ws => ws.id)

  if (workspaces.length === 0) {
    // No workspaces configured - create window without workspace (will show onboarding)
    windowManager.createWindow({ workspaceId: '' })
    return
  }

  if (savedState?.windows.length) {
    // Restore windows from saved state
    let restoredCount = 0

    for (const saved of savedState.windows) {
      // Skip invalid workspaces
      if (!validWorkspaceIds.includes(saved.workspaceId)) continue

      // Restore main window with focused mode if it was saved
      mainLog.info(`Restoring window: workspaceId=${saved.workspaceId}, focused=${saved.focused ?? false}, url=${saved.url ?? 'none'}`)
      const win = windowManager.createWindow({
        workspaceId: saved.workspaceId,
        focused: saved.focused,
        restoreUrl: saved.url,
      })
      win.setBounds(saved.bounds)

      restoredCount++
    }

    if (restoredCount > 0) {
      mainLog.info(`Restored ${restoredCount} window(s) from saved state`)
      return
    }
  }

  // Default: open window for first workspace
  windowManager.createWindow({ workspaceId: workspaces[0].id })
  mainLog.info(`Created window for first workspace: ${workspaces[0].name}`)
}

app.whenReady().then(async () => {
  // Initialize bundled docs
  initializeDocs()

  // Ensure default permissions file exists (copies bundled default.json on first run)
  const bundledPermissionsDir = join(__dirname, 'resources/permissions')
  ensureDefaultPermissions(bundledPermissionsDir)

  // Note: electron-updater handles pending updates internally via autoInstallOnAppQuit

  // Application menu is created after windowManager initialization (see below)

  // Set dock icon on macOS (required for dev mode, bundled apps use Info.plist)
  if (process.platform === 'darwin' && app.dock) {
    const dockIconPath = join(__dirname, '../resources/icon.png')
    if (existsSync(dockIconPath)) {
      app.dock.setIcon(dockIconPath)
      // Initialize badge icon for canvas-based badge overlay
      initBadgeIcon(dockIconPath)
    }

    // Multi-instance dev: show instance number badge on dock icon
    // CRAFT_INSTANCE_NUMBER is set by detect-instance.sh for numbered folders
    const instanceNum = process.env.CRAFT_INSTANCE_NUMBER
    if (instanceNum) {
      const num = parseInt(instanceNum, 10)
      if (!isNaN(num) && num > 0) {
        initInstanceBadge(num)
      }
    }
  }

  try {
    // Initialize window manager
    windowManager = new WindowManager()

    // Create the application menu (needs windowManager for New Window action)
    createApplicationMenu(windowManager)

    // Initialize session manager
    sessionManager = new SessionManager()
    sessionManager.setWindowManager(windowManager)

    // Initialize notification service
    initNotificationService(windowManager)

    // Register IPC handlers (must happen before window creation)
    registerIpcHandlers(sessionManager, windowManager)

    // Create initial windows (restores from saved state or opens first workspace)
    await createInitialWindows()

    // Initialize auth (must happen after window creation for error reporting)
    await sessionManager.initialize()

    // Initialize auto-update (check immediately on launch)
    // Skip in dev mode to avoid replacing /Applications app and launching it instead
    setAutoUpdateWindowManager(windowManager)
    if (app.isPackaged) {
      checkForUpdatesOnLaunch().catch(err => {
        mainLog.error('[auto-update] Launch check failed:', err)
      })
    } else {
      mainLog.info('[auto-update] Skipping auto-update in dev mode')
    }

    // Process pending deep link from cold start
    if (pendingDeepLink) {
      mainLog.info('Processing pending deep link:', pendingDeepLink)
      await handleDeepLink(pendingDeepLink, windowManager)
      pendingDeepLink = null
    }

    mainLog.info('App initialized successfully')
    if (isDebugMode) {
      mainLog.info('Debug mode enabled - logs at:', getLogFilePath())
    }
  } catch (error) {
    mainLog.error('Failed to initialize app:', error)
    // Continue anyway - the app will show errors in the UI
  }

  // macOS: Re-create window when dock icon is clicked
  app.on('activate', () => {
    if (!windowManager?.hasWindows()) {
      // Open first workspace or last focused
      const workspaces = getWorkspaces()
      if (workspaces.length > 0 && windowManager) {
        const savedState = loadWindowState()
        const wsId = savedState?.lastFocusedWorkspaceId || workspaces[0].id
        // Verify workspace still exists
        if (workspaces.some(ws => ws.id === wsId)) {
          windowManager.createWindow({ workspaceId: wsId })
        } else {
          windowManager.createWindow({ workspaceId: workspaces[0].id })
        }
      }
    }
  })
})

app.on('window-all-closed', () => {
  // On macOS, apps typically stay active until explicitly quit
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Track if we're in the process of quitting (to avoid re-entry)
let isQuitting = false

// Save window state and clean up resources before quitting
app.on('before-quit', async (event) => {
  // Avoid re-entry when we call app.exit()
  if (isQuitting) return
  isQuitting = true

  if (windowManager) {
    // Get full window states (includes bounds, type, and query)
    const windows = windowManager.getWindowStates()
    // Get the focused window's workspace as last focused
    const focusedWindow = BrowserWindow.getFocusedWindow()
    let lastFocusedWorkspaceId: string | undefined
    if (focusedWindow) {
      lastFocusedWorkspaceId = windowManager.getWorkspaceForWindow(focusedWindow.webContents.id) ?? undefined
    }

    saveWindowState({
      windows,
      lastFocusedWorkspaceId,
    })
    mainLog.info('Saved window state:', windows.length, 'windows')
  }

  // Flush all pending session writes before quitting
  if (sessionManager) {
    // Prevent quit until sessions are flushed
    event.preventDefault()
    try {
      await sessionManager.flushAllSessions()
      mainLog.info('Flushed all pending session writes')
    } catch (error) {
      mainLog.error('Failed to flush sessions:', error)
    }
    // Clean up SessionManager resources (file watchers, timers, etc.)
    sessionManager.cleanup()
    // Now actually quit
    app.exit(0)
  }
})

// Handle uncaught exceptions to prevent crashes
process.on('uncaughtException', (error) => {
  mainLog.error('Uncaught exception:', error)
})

process.on('unhandledRejection', (reason, promise) => {
  mainLog.error('Unhandled rejection at:', promise, 'reason:', reason)
})
