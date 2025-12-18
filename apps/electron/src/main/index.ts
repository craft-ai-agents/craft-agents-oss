import { app, BrowserWindow, shell, nativeTheme } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { SessionManager } from './sessions'
import { registerIpcHandlers } from './ipc'
import { createApplicationMenu } from './menu'
import { IPC_CHANNELS } from '../shared/types'

// Check if running in development mode
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

// Vite dev server URL for hot reload
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

// Custom URL scheme for deeplinks (e.g., craftagents://auth-complete)
const DEEPLINK_SCHEME = 'craftagents'

let mainWindow: BrowserWindow | null = null
let sessionManager: SessionManager | null = null

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
  console.log('[Main] Received deeplink:', url)

  // Bring the app to focus
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
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
    if (url) {
      console.log('[Main] Received deeplink from second instance:', url)
    }

    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

function createWindow(): void {
  // Load platform-specific app icon
  const getIconPath = () => {
    const resourcesDir = join(__dirname, '../resources')
    if (process.platform === 'darwin') {
      return join(resourcesDir, 'icon.icns')
    } else if (process.platform === 'win32') {
      return join(resourcesDir, 'icon.ico')
    } else {
      return join(resourcesDir, 'icon.png')
    }
  }

  const iconPath = getIconPath()
  const iconExists = existsSync(iconPath)

  if (!iconExists) {
    console.warn('[Main] App icon not found at:', iconPath)
  }

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: '',
    icon: iconExists ? iconPath : undefined,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    vibrancy: 'under-window',
    visualEffectState: 'active',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true // Enable webview for browser panel
    }
  })

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Handle navigation in webviews to external URLs
  mainWindow.webContents.on('will-navigate', (event, url) => {
    // Allow navigation within the app, but open external URLs in browser
    if (!url.startsWith('file://')) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  // Load the renderer - from Vite dev server in dev mode, or file in production
  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, 'renderer/index.html'))
  }

  // Open DevTools only in development mode
  if (isDev) {
    mainWindow.webContents.openDevTools()
  }

  // Handle window close
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Update session manager with new window reference
  if (sessionManager) {
    sessionManager.setMainWindow(mainWindow)
  }

  // Listen for system theme changes and notify renderer
  nativeTheme.on('updated', () => {
    mainWindow?.webContents.send(IPC_CHANNELS.SYSTEM_THEME_CHANGED, nativeTheme.shouldUseDarkColors)
  })
}

app.whenReady().then(async () => {
  app.setName('Craft Agents')

  // Create the application menu
  createApplicationMenu()

  // Set dock icon on macOS (required for dev mode, bundled apps use Info.plist)
  if (process.platform === 'darwin' && app.dock) {
    const dockIconPath = join(__dirname, '../resources/icon.png')
    if (existsSync(dockIconPath)) {
      app.dock.setIcon(dockIconPath)
    }
  }

  try {
    // Initialize session manager first
    sessionManager = new SessionManager()

    // Register IPC handlers (must happen before window creation)
    registerIpcHandlers(sessionManager)

    // Create the main window
    createWindow()

    // Initialize auth (must happen after window creation for error reporting)
    await sessionManager.initialize()

    console.log('[Main] App initialized successfully')
  } catch (error) {
    console.error('[Main] Failed to initialize app:', error)
    // Continue anyway - the app will show errors in the UI
  }

  // macOS: Re-create window when dock icon is clicked
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  // On macOS, apps typically stay active until explicitly quit
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Handle uncaught exceptions to prevent crashes
process.on('uncaughtException', (error) => {
  console.error('[Main] Uncaught exception:', error)
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Main] Unhandled rejection at:', promise, 'reason:', reason)
})
