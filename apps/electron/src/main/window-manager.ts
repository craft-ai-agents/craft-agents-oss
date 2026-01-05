import { BrowserWindow, shell, nativeTheme, Menu, app } from 'electron'
import { windowLog } from './logger'
import { join } from 'path'
import { existsSync } from 'fs'
import { IPC_CHANNELS } from '../shared/types'

// Vite dev server URL for hot reload
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

interface ManagedWindow {
  window: BrowserWindow
  workspaceId: string
  mode?: string
}

export class WindowManager {
  private windows: Map<number, ManagedWindow> = new Map()  // webContents.id → ManagedWindow

  /**
   * Create a new window for a workspace
   * @param workspaceId - The workspace to open (empty string for onboarding)
   * @param mode - Optional mode for the window
   */
  createWindow(workspaceId: string, mode?: string): BrowserWindow {
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
      windowLog.warn('App icon not found at:', iconPath)
    }

    const window = new BrowserWindow({
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
        // SECURITY NOTE: Sandbox is disabled to allow preload script access to process.versions
        // for the getVersions() API (returns node/chrome/electron versions).
        // This is a minimal exposure since contextIsolation is enabled and nodeIntegration
        // is disabled - the preload only exposes safe, read-only version data via IPC.
        // If sandbox is re-enabled, process.versions becomes undefined.
        sandbox: false,
        webviewTag: true // Enable webview for browser panel
      }
    })

    // Open external links in default browser
    window.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url)
      return { action: 'deny' }
    })

    // Handle navigation in webviews to external URLs
    window.webContents.on('will-navigate', (event, url) => {
      // Allow navigation within the app (file:// in prod, localhost dev server)
      const isInternalUrl = url.startsWith('file://') ||
        (VITE_DEV_SERVER_URL && url.startsWith(VITE_DEV_SERVER_URL))

      if (!isInternalUrl) {
        event.preventDefault()
        shell.openExternal(url)
      }
    })

    // Enable right-click context menu in development
    if (!app.isPackaged) {
      window.webContents.on('context-menu', (_event, params) => {
        Menu.buildFromTemplate([
          { label: 'Inspect Element', click: () => window.webContents.inspectElement(params.x, params.y) },
          { type: 'separator' },
          { label: 'Cut', role: 'cut', enabled: params.editFlags.canCut },
          { label: 'Copy', role: 'copy', enabled: params.editFlags.canCopy },
          { label: 'Paste', role: 'paste', enabled: params.editFlags.canPaste },
        ]).popup()
      })
    }

    // Load the renderer with workspace ID and mode as query params
    const query: Record<string, string> = { workspaceId }
    if (mode) {
      query.mode = mode
    }

    if (VITE_DEV_SERVER_URL) {
      const params = new URLSearchParams(query).toString()
      window.loadURL(`${VITE_DEV_SERVER_URL}?${params}`)
    } else {
      window.loadFile(join(__dirname, 'renderer/index.html'), { query })
    }

    // Store the window mapping
    const webContentsId = window.webContents.id
    this.windows.set(webContentsId, { window, workspaceId, mode })

    // Listen for system theme changes and notify this window's renderer
    const themeHandler = () => {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.SYSTEM_THEME_CHANGED, nativeTheme.shouldUseDarkColors)
      }
    }
    nativeTheme.on('updated', themeHandler)

    // Handle window close - clean up theme listener first, then internal state
    window.on('closed', () => {
      nativeTheme.removeListener('updated', themeHandler)
      this.windows.delete(webContentsId)
      windowLog.info(`Window closed for workspace ${workspaceId}`)
    })

    windowLog.info(`Created window for workspace ${workspaceId}`)
    return window
  }

  /**
   * Get window by workspace ID
   */
  getWindowByWorkspace(workspaceId: string): BrowserWindow | null {
    for (const managed of this.windows.values()) {
      if (managed.workspaceId === workspaceId && !managed.window.isDestroyed()) {
        return managed.window
      }
    }
    return null
  }

  /**
   * Get workspace ID for a window (by webContents.id)
   */
  getWorkspaceForWindow(webContentsId: number): string | null {
    const managed = this.windows.get(webContentsId)
    return managed?.workspaceId ?? null
  }

  /**
   * Get mode for a window (by webContents.id)
   */
  getModeForWindow(webContentsId: number): string | null {
    const managed = this.windows.get(webContentsId)
    return managed?.mode ?? null
  }

  /**
   * Close window by webContents.id
   */
  closeWindow(webContentsId: number): void {
    const managed = this.windows.get(webContentsId)
    if (managed && !managed.window.isDestroyed()) {
      managed.window.close()
    }
  }

  /**
   * Close window for a specific workspace
   */
  closeWindowForWorkspace(workspaceId: string): void {
    const window = this.getWindowByWorkspace(workspaceId)
    if (window && !window.isDestroyed()) {
      window.close()
    }
  }

  /**
   * Update the workspace ID for an existing window (for in-window switching)
   * @param webContentsId - The webContents.id of the window
   * @param workspaceId - The new workspace ID
   */
  updateWindowWorkspace(webContentsId: number, workspaceId: string): void {
    const managed = this.windows.get(webContentsId)
    if (managed) {
      const oldWorkspaceId = managed.workspaceId
      managed.workspaceId = workspaceId
      windowLog.info(`Updated window ${webContentsId} from workspace ${oldWorkspaceId} to ${workspaceId}`)
    }
  }

  /**
   * Get all managed windows
   */
  getAllWindows(): ManagedWindow[] {
    return Array.from(this.windows.values()).filter(m => !m.window.isDestroyed())
  }

  /**
   * Focus existing window for workspace or create new one
   */
  focusOrCreateWindow(workspaceId: string): BrowserWindow {
    const existing = this.getWindowByWorkspace(workspaceId)
    if (existing) {
      if (existing.isMinimized()) {
        existing.restore()
      }
      existing.focus()
      return existing
    }
    return this.createWindow(workspaceId)
  }

  /**
   * Get list of workspace IDs that have open windows (for persistence)
   */
  getOpenWorkspaceIds(): string[] {
    return this.getAllWindows().map(m => m.workspaceId)
  }

  /**
   * Check if any windows are open
   */
  hasWindows(): boolean {
    return this.getAllWindows().length > 0
  }

  /**
   * Get the currently focused window
   */
  getFocusedWindow(): BrowserWindow | null {
    const focused = BrowserWindow.getFocusedWindow()
    if (focused && !focused.isDestroyed()) {
      return focused
    }
    return null
  }

  /**
   * Get the last active window (most recently used)
   * Falls back to any available window if none focused
   */
  getLastActiveWindow(): BrowserWindow | null {
    // First try focused window
    const focused = this.getFocusedWindow()
    if (focused) {
      return focused
    }

    // Fall back to any available window
    const allWindows = this.getAllWindows()
    if (allWindows.length > 0) {
      return allWindows[0].window
    }

    return null
  }

  /**
   * Send IPC message to all windows
   */
  broadcastToAll(channel: string, ...args: unknown[]): void {
    for (const managed of this.getAllWindows()) {
      if (!managed.window.isDestroyed()) {
        managed.window.webContents.send(channel, ...args)
      }
    }
  }
}
