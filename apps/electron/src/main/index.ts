// Load user's shell environment first (before other imports that may use env)
// This ensures tools like Homebrew, nvm, etc. are available to the agent
import { loadShellEnv } from './shell-env'
loadShellEnv()

import { app, BrowserWindow, powerMonitor } from 'electron'
import { createHash } from 'crypto'
import { hostname, homedir } from 'os'
import * as Sentry from '@sentry/electron/main'

// Initialize Sentry error tracking as early as possible after app import.
// Only enabled in production (packaged) builds to avoid noise during development.
// DSN is baked in at build time via esbuild --define (same pattern as OAuth secrets).
//
// NOTE: Source map upload is intentionally disabled. Stack traces in Sentry will show
// bundled/minified code. To enable source map upload in the future:
//   1. Add SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT to CI secrets
//   2. Re-enable the @sentry/vite-plugin in vite.config.ts (handles renderer maps)
//   3. Add @sentry/esbuild-plugin to scripts/electron-build-main.ts (handles main process maps)
Sentry.init({
  dsn: process.env.SENTRY_ELECTRON_INGEST_URL,
  environment: app.isPackaged ? 'production' : 'development',
  release: app.getVersion(),
  // Enabled whenever the ingest URL is available — works in both production (baked via CI)
  // and development (injected via .env / 1Password). Filter by environment in Sentry dashboard.
  enabled: !!process.env.SENTRY_ELECTRON_INGEST_URL,

  // Scrub sensitive data before sending to Sentry.
  // Removes authorization headers, API keys/tokens, and credential-like values.
  beforeSend(event) {
    // Scrub request headers (authorization, cookies)
    if (event.request?.headers) {
      const sensitiveHeaders = ['authorization', 'cookie', 'x-api-key']
      for (const header of sensitiveHeaders) {
        if (event.request.headers[header]) {
          event.request.headers[header] = '[REDACTED]'
        }
      }
    }

    // Scrub breadcrumb data that may contain sensitive values
    if (event.breadcrumbs) {
      for (const breadcrumb of event.breadcrumbs) {
        if (breadcrumb.data) {
          for (const key of Object.keys(breadcrumb.data)) {
            const lowerKey = key.toLowerCase()
            if (lowerKey.includes('token') || lowerKey.includes('key') ||
              lowerKey.includes('secret') || lowerKey.includes('password') ||
              lowerKey.includes('credential') || lowerKey.includes('auth')) {
              breadcrumb.data[key] = '[REDACTED]'
            }
          }
        }
      }
    }

    return event
  },
})

// Set anonymous machine ID for Sentry user tracking (no PII — just a hash).
// Uses hostname + homedir to produce a stable per-machine identifier.
const machineId = createHash('sha256').update(hostname() + homedir()).digest('hex').slice(0, 16)
Sentry.setUser({ id: machineId })

import { join } from 'path'
import { existsSync } from 'fs'
import { SessionManager } from './sessions'
import { registerIpcHandlers } from './ipc'
import { createApplicationMenu } from './menu'
import { WindowManager } from './window-manager'
import { loadWindowState, saveWindowState } from './window-state'
import { getWorkspaces, loadStoredConfig } from '@craft-agent/shared/config'
import { initializeDocs } from '@craft-agent/shared/docs'
import { ensureDefaultPermissions } from '@craft-agent/shared/agent/permissions-config'
import { ensureToolIcons } from '@craft-agent/shared/config'
import { setBundledAssetsRoot } from '@craft-agent/shared/utils'
import { handleDeepLink } from './deep-link'
import { registerThumbnailScheme, registerThumbnailHandler } from './thumbnail-protocol'
import log, { isDebugMode, mainLog, getLogFilePath } from './logger'
import { setPerfEnabled, enableDebug } from '@craft-agent/shared/utils'
import { initNotificationService, clearBadgeCount, initBadgeIcon, initInstanceBadge } from './notifications'
import { isUpdating } from './auto-update'
import { initializeGlobalShortcut, cleanupGlobalShortcut } from './global-shortcut'

// Initialize electron-log for renderer process support
log.initialize()

// Enable debug/perf in dev mode (running from source)
if (isDebugMode) {
  process.env.CRAFT_DEBUG = '1'
  enableDebug()
  setPerfEnabled(true)
}

// Custom URL scheme for deeplinks (e.g., bunnyagents://auth-complete)
// Supports multi-instance dev: CRAFT_DEEPLINK_SCHEME env var (bunnyagents1, bunnyagents2, etc.)
const DEEPLINK_SCHEME = process.env.CRAFT_DEEPLINK_SCHEME || 'bunnyagents'

let windowManager: WindowManager | null = null
let sessionManager: SessionManager | null = null

// Track system interruptions (lock screen, sleep) to distinguish from normal app switching
// When true, the next window focus should NOT trigger auto-new-chat
let isSystemInterrupted = false

/**
 * Consume the system interrupted flag (returns current value and resets to false)
 * Called by renderer when handling window focus to check if focus was from unlock/resume
 */
export function consumeSystemInterrupted(): boolean {
  const wasInterrupted = isSystemInterrupted
  isSystemInterrupted = false
  return wasInterrupted
}

// Store pending deep link if app not ready yet (cold start)
let pendingDeepLink: string | null = null

// Store pending folder path if app not ready yet (cold start via 'open -a Bunny /path')
let pendingFolderPath: string | null = null

// Set app name early (before app.whenReady) to ensure correct macOS menu bar title
// Supports multi-instance dev: CRAFT_APP_NAME env var (e.g., "Craft Agents [1]")
app.setName(process.env.CRAFT_APP_NAME || 'Bunny')

// Register as default protocol client for bunnyagents:// URLs
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

// Register thumbnail:// custom protocol for file preview thumbnails in the sidebar.
// Must happen before app.whenReady() — Electron requires early scheme registration.
registerThumbnailScheme()

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

// Handle folder drop on dock icon or 'open -a Bunny /path' command (macOS)
app.on('open-file', (event, path) => {
  event.preventDefault()
  mainLog.info('Received open-file:', path)

  // Check if path is a directory
  try {
    const stat = require('fs').statSync(path)
    if (!stat.isDirectory()) {
      mainLog.info('open-file: not a directory, ignoring:', path)
      return
    }
  } catch (err) {
    mainLog.error('open-file: failed to stat path:', path, err)
    return
  }

  if (windowManager) {
    // App is ready - open new chat with workdir
    const encodedPath = encodeURIComponent(path)
    const deepLink = `bunnyagents://action/new-chat?workdir=${encodedPath}`
    handleDeepLink(deepLink, windowManager).catch(err => {
      mainLog.error('Failed to handle open-file deep link:', err)
    })
  } else {
    // App not ready - store for later
    pendingFolderPath = path
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
  // Register bundled assets root so all seeding functions can find their files
  // (docs, permissions, themes, tool-icons resolve via getBundledAssetsDir)
  setBundledAssetsRoot(__dirname)

  // Initialize bundled docs
  initializeDocs()

  // Ensure default permissions file exists (copies bundled default.json on first run)
  ensureDefaultPermissions()

  // Seed tool icons to ~/.craft-agent/tool-icons/ (copies bundled SVGs on first run)
  ensureToolIcons()

  // Register thumbnail:// protocol handler (scheme was registered earlier, before app.whenReady)
  registerThumbnailHandler()

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

    // Set Sentry context tags for error grouping (no PII — just config classification).
    // Runs after init so config and auth state are available.
    try {
      const config = loadStoredConfig()
      const workspaces = getWorkspaces()
      Sentry.setTag('authType', config?.authType ?? 'unknown')
      Sentry.setTag('hasCustomEndpoint', String(!!config?.anthropicBaseUrl))
      Sentry.setTag('model', config?.model ?? 'default')
      Sentry.setTag('customModel', config?.customModel ?? 'none')
      Sentry.setTag('workspaceCount', String(workspaces.length))
    } catch (err) {
      mainLog.warn('Failed to set Sentry context tags:', err)
    }

    // Auto-update disabled - using custom fork, not the original open source version
    // setAutoUpdateWindowManager(windowManager)
    // if (app.isPackaged) {
    //   checkForUpdatesOnLaunch().catch(err => {
    //     mainLog.error('[auto-update] Launch check failed:', err)
    //   })
    // } else {
    //   mainLog.info('[auto-update] Skipping auto-update in dev mode')
    // }

    // Process pending deep link from cold start
    if (pendingDeepLink) {
      mainLog.info('Processing pending deep link:', pendingDeepLink)
      await handleDeepLink(pendingDeepLink, windowManager)
      pendingDeepLink = null
    }

    // Process pending folder path from cold start (via 'open -a Bunny /path')
    if (pendingFolderPath) {
      mainLog.info('Processing pending folder path:', pendingFolderPath)
      const encodedPath = encodeURIComponent(pendingFolderPath)
      const deepLink = `bunnyagents://action/new-chat?workdir=${encodedPath}`
      await handleDeepLink(deepLink, windowManager)
      pendingFolderPath = null
    }

    // Listen for system interruptions (lock screen, sleep)
    // These should NOT trigger auto-new-chat when window regains focus
    powerMonitor.on('lock-screen', () => {
      mainLog.info('[powerMonitor] Screen locked')
      isSystemInterrupted = true
    })
    powerMonitor.on('suspend', () => {
      mainLog.info('[powerMonitor] System suspended')
      isSystemInterrupted = true
    })

    // Initialize global shortcut (if previously enabled)
    initializeGlobalShortcut()

    mainLog.info('App initialized successfully')
    if (isDebugMode) {
      mainLog.info('Debug mode enabled - logs at:', getLogFilePath())
    }
  } catch (error) {
    mainLog.error('Failed to initialize app:', error)
    // Continue anyway - the app will show errors in the UI
  }

  // macOS: Reveal hidden windows or re-create when dock icon is clicked
  app.on('activate', () => {
    if (!windowManager) return

    const managedWindows = windowManager.getAllWindows()
    if (managedWindows.length === 0) {
      // Open first workspace or last focused
      const workspaces = getWorkspaces()
      if (workspaces.length > 0) {
        const savedState = loadWindowState()
        const wsId = savedState?.lastFocusedWorkspaceId || workspaces[0].id
        // Verify workspace still exists
        if (workspaces.some(ws => ws.id === wsId)) {
          windowManager.createWindow({ workspaceId: wsId })
        } else {
          windowManager.createWindow({ workspaceId: workspaces[0].id })
        }
      }
      return
    }

    const hasVisibleWindow = managedWindows.some(({ window }) => window.isVisible() && !window.isMinimized())
    if (!hasVisibleWindow) {
      for (const { window } of managedWindows) {
        if (window.isMinimized()) {
          window.restore()
        }
        if (!window.isVisible()) {
          window.show()
        }
      }
      const focusTarget = windowManager.getLastActiveWindow() ?? managedWindows[0].window
      focusTarget.focus()
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

    // Clean up global shortcuts
    cleanupGlobalShortcut()

    // If update is in progress, let electron-updater handle the quit flow
    // Force exit breaks the NSIS installer on Windows
    if (isUpdating()) {
      mainLog.info('Update in progress, letting electron-updater handle quit')
      app.quit()
      return
    }

    // Now actually quit
    app.exit(0)
  }
})

// Handle uncaught exceptions — forward to Sentry explicitly since registering
// a custom handler can interfere with @sentry/electron's automatic capture.
process.on('uncaughtException', (error) => {
  mainLog.error('Uncaught exception:', error)
  Sentry.captureException(error)
})

process.on('unhandledRejection', (reason, promise) => {
  mainLog.error('Unhandled rejection at:', promise, 'reason:', reason)
  Sentry.captureException(reason instanceof Error ? reason : new Error(String(reason)))
})
