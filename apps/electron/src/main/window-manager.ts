import { BrowserWindow, shell, nativeTheme, Menu, app } from 'electron'
import { windowLog } from './logger'
import { join } from 'path'
import { existsSync } from 'fs'
import { IPC_CHANNELS } from '../shared/types'
import type { SavedWindow } from './window-state'

// Vite dev server URL for hot reload
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

interface ManagedWindow {
  window: BrowserWindow
  workspaceId: string
  mode?: 'main' | 'tab-content'
  query?: string  // Full query string for restoration (tab-content windows)
}

export class WindowManager {
  private windows: Map<number, ManagedWindow> = new Map()  // webContents.id → ManagedWindow

  /**
   * Create a new window for a workspace
   * @param workspaceId - The workspace to open (empty string for onboarding)
   * @param mode - Optional mode for the window ('main' or 'tab-content')
   */
  createWindow(workspaceId: string, mode?: 'main' | 'tab-content'): BrowserWindow {
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
      show: false, // Don't show until ready-to-show event (faster perceived startup)
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

    // Show window when first paint is ready (faster perceived startup)
    window.once('ready-to-show', () => {
      window.show()
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

    // Handle focus/blur to broadcast window focus state
    window.on('focus', () => {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.WINDOW_FOCUS_STATE, true)
      }
    })
    window.on('blur', () => {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.WINDOW_FOCUS_STATE, false)
      }
    })

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
   * Get window by workspace ID (returns first match - for backwards compatibility)
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
   * Get ALL windows for a workspace (main window + tab content windows)
   * Used for broadcasting events to all windows showing the same workspace
   */
  getAllWindowsForWorkspace(workspaceId: string): BrowserWindow[] {
    const windows: BrowserWindow[] = []
    for (const managed of this.windows.values()) {
      if (managed.workspaceId === workspaceId && !managed.window.isDestroyed()) {
        windows.push(managed.window)
      }
    }
    return windows
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
  getModeForWindow(webContentsId: number): 'main' | 'tab-content' | null {
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
   * Create a tab content window (lightweight window showing only tab content)
   * Used for "Open in New Window" functionality
   * @param workspaceId - The workspace this window belongs to
   * @param tabType - The type of tab to display (chat, settings, etc.)
   * @param tabParams - Tab-specific parameters (sessionId, agentId, path, etc.)
   */
  createTabContentWindow(workspaceId: string, tabType: string, tabParams?: Record<string, string>): BrowserWindow {
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

    const window = new BrowserWindow({
      width: 800,
      height: 600,
      minWidth: 400,
      minHeight: 300,
      show: false,
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
        sandbox: false,
        webviewTag: true
      }
    })

    // Show window when ready
    window.once('ready-to-show', () => {
      window.show()
    })

    // Open external links in default browser
    window.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url)
      return { action: 'deny' }
    })

    // Build query params for tab content window
    const query: Record<string, string> = {
      workspaceId,
      mode: 'tab-content',
      tabType,
    }
    // Add tab params to query string
    if (tabParams) {
      for (const [key, value] of Object.entries(tabParams)) {
        query[key] = value
      }
    }

    // Build query string for loading and storage
    const queryString = new URLSearchParams(query).toString()

    if (VITE_DEV_SERVER_URL) {
      window.loadURL(`${VITE_DEV_SERVER_URL}?${queryString}`)
    } else {
      window.loadFile(join(__dirname, 'renderer/index.html'), { query })
    }

    // Store the window mapping with query for restoration
    const webContentsId = window.webContents.id
    this.windows.set(webContentsId, { window, workspaceId, mode: 'tab-content', query: queryString })

    // Listen for system theme changes
    const themeHandler = () => {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.SYSTEM_THEME_CHANGED, nativeTheme.shouldUseDarkColors)
      }
    }
    nativeTheme.on('updated', themeHandler)

    // Handle focus/blur
    window.on('focus', () => {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.WINDOW_FOCUS_STATE, true)
      }
    })
    window.on('blur', () => {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.WINDOW_FOCUS_STATE, false)
      }
    })

    // Cleanup on close
    window.on('closed', () => {
      nativeTheme.removeListener('updated', themeHandler)
      this.windows.delete(webContentsId)
      windowLog.info(`Tab content window closed for workspace ${workspaceId}, tab ${tabType}`)
    })

    windowLog.info(`Created tab content window for workspace ${workspaceId}, tab ${tabType}`)
    return window
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
   * @deprecated Use getWindowStates() instead for full window state persistence
   */
  getOpenWorkspaceIds(): string[] {
    return this.getAllWindows().map(m => m.workspaceId)
  }

  /**
   * Get window states for persistence (includes bounds, type, and query)
   * Used by window-state.ts to save/restore windows
   */
  getWindowStates(): SavedWindow[] {
    return this.getAllWindows().map(managed => ({
      type: (managed.mode === 'tab-content' ? 'tab-content' : 'main') as 'main' | 'tab-content',
      workspaceId: managed.workspaceId,
      bounds: managed.window.getBounds(),
      query: managed.query
    }))
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
