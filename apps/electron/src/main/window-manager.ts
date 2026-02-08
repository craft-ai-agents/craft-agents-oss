import { BrowserWindow, shell, nativeTheme, Menu, app, webContents } from 'electron'
import { windowLog } from './logger'
import { join } from 'path'
import { existsSync } from 'fs'
import { release } from 'os'
import { IPC_CHANNELS } from '../shared/types'
import type { SavedWindow } from './window-state'

// Vite dev server URL for hot reload
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

/**
 * Get the appropriate background material for Windows transparency effects
 * - Windows 11 (build 22000+): Mica effect
 * - Windows 10 1809+ (build 17763+): Acrylic effect
 * - Older versions: No transparency
 */
function getWindowsBackgroundMaterial(): 'mica' | 'acrylic' | undefined {
  if (process.platform !== 'win32') return undefined

  // os.release() returns "10.0.xxxxx" where xxxxx is the build number
  const buildNumber = parseInt(release().split('.')[2] || '0', 10)

  if (buildNumber >= 22000) {
    windowLog.info('Windows 11 detected (build ' + buildNumber + '), using Mica')
    return 'mica'
  } else if (buildNumber >= 17763) {
    windowLog.info('Windows 10 1809+ detected (build ' + buildNumber + '), using Acrylic')
    return 'acrylic'
  }

  windowLog.info('Older Windows detected (build ' + buildNumber + '), no transparency')
  return undefined
}


interface ManagedWindow {
  window: BrowserWindow
  workspaceId: string
}

export interface CreateWindowOptions {
  /** The workspace to open (empty string for onboarding) */
  workspaceId: string
  /** Whether to open in focused mode (smaller window, no sidebars) */
  focused?: boolean
  /** Deep link URL to navigate to after window loads (without ?window= param) */
  initialDeepLink?: string
  /** Full URL to restore from saved state (preserves route/query params) */
  restoreUrl?: string
}

type CloseIntent = 'shortcut' | 'unknown'

const CLOSE_SHORTCUT_WINDOW_MS = 1000

export class WindowManager {
  private windows: Map<number, ManagedWindow> = new Map()  // webContents.id → ManagedWindow
  private focusedModeWindows: Set<number> = new Set()  // webContents.id of windows in focused mode
  private closeShortcutTimestamps: Map<number, number> = new Map()  // webContents.id → last Cmd+W timestamp
  private pendingCloseIntents: Map<number, CloseIntent> = new Map()  // webContents.id → close intent for current request
  private pendingCloseTimeouts: Map<number, NodeJS.Timeout> = new Map()  // Fallback timeouts for window close

  private async readAlwaysOnTop(window: BrowserWindow, expected: boolean): Promise<boolean> {
    const immediate = window.isAlwaysOnTop()
    if (immediate === expected) return immediate

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 80)
    })
    return window.isAlwaysOnTop()
  }

  private resolveWindow(webContentsId: number): BrowserWindow | null {
    const managed = this.windows.get(webContentsId)
    if (managed && !managed.window.isDestroyed()) {
      return managed.window
    }

    const contents = webContents.fromId(webContentsId)
    if (!contents) return null

    const window = BrowserWindow.fromWebContents(contents)
    if (window && !window.isDestroyed()) {
      return window
    }

    return null
  }

  private recordCloseShortcut(webContentsId: number): void {
    this.closeShortcutTimestamps.set(webContentsId, Date.now())
  }

  private resolveCloseIntent(webContentsId: number): CloseIntent {
    const lastShortcutAt = this.closeShortcutTimestamps.get(webContentsId)
    this.closeShortcutTimestamps.delete(webContentsId)
    if (!lastShortcutAt) return 'unknown'
    const delta = Date.now() - lastShortcutAt
    return delta <= CLOSE_SHORTCUT_WINDOW_MS ? 'shortcut' : 'unknown'
  }

  consumeCloseIntent(webContentsId: number): CloseIntent {
    const intent = this.pendingCloseIntents.get(webContentsId) ?? 'unknown'
    this.pendingCloseIntents.delete(webContentsId)
    return intent
  }

  isFocusedModeWindow(webContentsId: number): boolean {
    return this.focusedModeWindows.has(webContentsId)
  }

  getMainWindowCount(): number {
    let count = 0
    for (const managed of this.getAllWindows()) {
      if (!this.focusedModeWindows.has(managed.window.webContents.id)) {
        count += 1
      }
    }
    return count
  }

  /**
   * Create a new window for a workspace
   * @param options - Window creation options
   */
  createWindow(options: CreateWindowOptions): BrowserWindow {
    const { workspaceId, focused = false, initialDeepLink, restoreUrl } = options

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

    // Use smaller window size for focused mode (single session view)
    const windowWidth = focused ? 900 : 1400
    const windowHeight = focused ? 700 : 900

    // Platform-specific window options
    const isMac = process.platform === 'darwin'
    const isWindows = process.platform === 'win32'
    const windowsBackgroundMaterial = getWindowsBackgroundMaterial()

    const window = new BrowserWindow({
      width: windowWidth,
      height: windowHeight,
      minWidth: 600,
      minHeight: 600,
      show: false, // Don't show until ready-to-show event (faster perceived startup)
      title: '',
      icon: iconExists ? iconPath : undefined,
      // macOS-specific: hidden title bar with inset traffic lights
      ...(isMac && {
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: { x: 18, y: 18 },
        vibrancy: 'under-window',
        visualEffectState: 'active',
      }),
      // Windows: use native frame with Mica/Acrylic transparency (Windows 10/11)
      ...(isWindows && {
        frame: true, // Keep native frame for better UX
        autoHideMenuBar: true, // Menu is null on Windows, this is just for safety
        // Note: Don't use transparent:true with backgroundMaterial - it hides the window frame
        ...(windowsBackgroundMaterial && {
          backgroundMaterial: windowsBackgroundMaterial,
        }),
      }),
      // Linux: use native frame
      ...(!isMac && !isWindows && {
        frame: true,
        autoHideMenuBar: true,
      }),
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

    // Load the renderer - use restoreUrl if provided, otherwise build from options
    if (restoreUrl) {
      // Restore from saved URL - need to adapt for dev vs prod
      if (VITE_DEV_SERVER_URL) {
        // In dev mode, replace the base URL but keep the path and query
        try {
          const savedUrl = new URL(restoreUrl)
          const devUrl = new URL(VITE_DEV_SERVER_URL)
          // Preserve pathname and search from saved URL, use dev server host
          devUrl.pathname = savedUrl.pathname
          devUrl.search = savedUrl.search
          window.loadURL(devUrl.toString())
        } catch {
          // Fallback if URL parsing fails
          windowLog.warn('Failed to parse restoreUrl, using default:', restoreUrl)
          const params = new URLSearchParams({ workspaceId, ...(focused && { focused: 'true' }) }).toString()
          window.loadURL(`${VITE_DEV_SERVER_URL}?${params}`)
        }
      } else {
        // In prod, always extract query params and load from current __dirname.
        // Never load file:// URLs directly — the path may be stale (e.g. Linux AppImage
        // mounts to a different /tmp dir on each launch). See #13.
        try {
          const savedUrl = new URL(restoreUrl)
          const query: Record<string, string> = {}
          savedUrl.searchParams.forEach((value, key) => { query[key] = value })
          window.loadFile(join(__dirname, 'renderer/index.html'), { query })
        } catch {
          window.loadFile(join(__dirname, 'renderer/index.html'), { query: { workspaceId } })
        }
      }
    } else {
      // Build URL from options
      const query: Record<string, string> = { workspaceId }
      if (focused) {
        query.focused = 'true' // Open in focused mode (no sidebars)
      }

      if (VITE_DEV_SERVER_URL) {
        const params = new URLSearchParams(query).toString()
        window.loadURL(`${VITE_DEV_SERVER_URL}?${params}`)
      } else {
        window.loadFile(join(__dirname, 'renderer/index.html'), { query })
      }
    }

    // Fallback: if the renderer fails to load (e.g. stale path, disk error),
    // recover gracefully by loading the default state instead of showing a white screen. See #13.
    window.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
      windowLog.warn('Failed to load renderer, falling back to default state:', errorCode, errorDescription)
      window.loadFile(join(__dirname, 'renderer/index.html'), { query: { workspaceId } })
    })

    // If an initial deep link was provided, navigate to it after the window is ready
    if (initialDeepLink) {
      window.once('ready-to-show', () => {
        // Import parseDeepLink dynamically to avoid circular dependency
        import('./deep-link').then(({ parseDeepLink }) => {
          const target = parseDeepLink(initialDeepLink)
          if (target && (target.view || target.action)) {
            // Wait a bit for React to mount and register IPC listeners
            setTimeout(() => {
              if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
                window.webContents.send(IPC_CHANNELS.DEEP_LINK_NAVIGATE, {
                  view: target.view,
                  action: target.action,
                  actionParams: target.actionParams,
                })
              }
            }, 100)
          }
        })
      })
    }

    // Store the window mapping
    const webContentsId = window.webContents.id
    this.windows.set(webContentsId, { window, workspaceId })

    // Track focused mode state for persistence
    if (focused) {
      this.focusedModeWindows.add(webContentsId)
    }

    // Track Cmd+W to distinguish shortcut-initiated closes on macOS
    if (process.platform === 'darwin') {
      window.webContents.on('before-input-event', (_event, input) => {
        if (input.type !== 'keyDown') return
        const key = typeof input.key === 'string' ? input.key.toLowerCase() : ''
        if (input.meta && !input.control && !input.alt && !input.shift && (key === 'w' || input.code === 'KeyW')) {
          this.recordCloseShortcut(webContentsId)
        }
      })
    }

    // Listen for system theme changes and notify this window's renderer
    const themeHandler = () => {
      // Check mainFrame - it becomes null when render frame is disposed
      if (!window.isDestroyed() && !window.webContents.isDestroyed() && window.webContents.mainFrame) {
        window.webContents.send(IPC_CHANNELS.SYSTEM_THEME_CHANGED, nativeTheme.shouldUseDarkColors)
      }
    }
    nativeTheme.on('updated', themeHandler)

    // Handle focus/blur to broadcast window focus state
    window.on('focus', () => {
      if (!window.isDestroyed() && !window.webContents.isDestroyed() && window.webContents.mainFrame) {
        window.webContents.send(IPC_CHANNELS.WINDOW_FOCUS_STATE, true)
      }
    })
    window.on('blur', () => {
      if (!window.isDestroyed() && !window.webContents.isDestroyed() && window.webContents.mainFrame) {
        window.webContents.send(IPC_CHANNELS.WINDOW_FOCUS_STATE, false)
      }
    })

    // Handle window close request (X button, Cmd+W) - intercept to allow modal closing first
    // The renderer can respond via WINDOW_CONFIRM_CLOSE to actually close the window
    window.on('close', (event) => {
      // Check if renderer is ready (mainFrame exists) - if not, allow close directly
      if (!window.webContents.isDestroyed() && window.webContents.mainFrame) {
        event.preventDefault()
        this.pendingCloseIntents.set(webContentsId, this.resolveCloseIntent(webContentsId))
        // Send close request to renderer - it will either close a modal or confirm close
        window.webContents.send(IPC_CHANNELS.WINDOW_CLOSE_REQUESTED)

        // Fallback timeout: if IPC fails (e.g., on Hyprland/Wayland), force close after 3s.
        // Reset timeout on each attempt so active users closing modals aren't interrupted.
        const wcId = window.webContents.id
        const existingTimeout = this.pendingCloseTimeouts.get(wcId)
        if (existingTimeout) clearTimeout(existingTimeout)

        this.pendingCloseTimeouts.set(wcId, setTimeout(() => {
          this.pendingCloseTimeouts.delete(wcId)
          if (!window.isDestroyed()) window.destroy()
        }, 3000))
      }
      // If renderer not ready, allow default close behavior
    })

    // Handle window closed - clean up theme listener and internal state
    window.on('closed', () => {
      // Clean up any pending close timeout to prevent memory leaks
      const timeout = this.pendingCloseTimeouts.get(webContentsId)
      if (timeout) {
        clearTimeout(timeout)
        this.pendingCloseTimeouts.delete(webContentsId)
      }

      nativeTheme.removeListener('updated', themeHandler)
      this.windows.delete(webContentsId)
      this.focusedModeWindows.delete(webContentsId)
      this.closeShortcutTimestamps.delete(webContentsId)
      this.pendingCloseIntents.delete(webContentsId)
      windowLog.info(`Window closed for workspace ${workspaceId}`)
    })

    windowLog.info(`Created window for workspace ${workspaceId} (focused: ${focused})`)
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
    // Debug: log registered workspaces when lookup fails
    if (windows.length === 0 && this.windows.size > 0) {
      const registered = Array.from(this.windows.values()).map(m => m.workspaceId)
      windowLog.warn(`No windows for workspace '${workspaceId}', have: [${registered.join(', ')}]`)
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
   * Close window by webContents.id (triggers close event which may be intercepted)
   */
  closeWindow(webContentsId: number): void {
    const managed = this.windows.get(webContentsId)
    if (managed && !managed.window.isDestroyed()) {
      managed.window.close()
    }
  }

  /**
   * Force close window by webContents.id (bypasses close event interception).
   * Used when renderer confirms the close action (no modals to close).
   */
  forceCloseWindow(webContentsId: number): void {
    // Clear any pending close timeout since renderer confirmed
    const timeout = this.pendingCloseTimeouts.get(webContentsId)
    if (timeout) {
      clearTimeout(timeout)
      this.pendingCloseTimeouts.delete(webContentsId)
    }

    const managed = this.windows.get(webContentsId)
    if (managed && !managed.window.isDestroyed()) {
      // Remove close listener temporarily to avoid infinite loop,
      // then destroy the window directly
      managed.window.destroy()
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
   * @returns true if window was found and updated, false otherwise
   */
  updateWindowWorkspace(webContentsId: number, workspaceId: string): boolean {
    const managed = this.windows.get(webContentsId)
    if (managed) {
      const oldWorkspaceId = managed.workspaceId
      managed.workspaceId = workspaceId
      windowLog.info(`Updated window ${webContentsId} from workspace ${oldWorkspaceId} to ${workspaceId}`)
      return true
    }
    // Window not found - log for debugging
    windowLog.warn(`Cannot update workspace for unknown window ${webContentsId}, registered: [${Array.from(this.windows.keys()).join(', ')}]`)
    return false
  }

  /**
   * Register an existing window with a workspace ID
   * Used for re-registration when window mapping is lost (e.g., after refresh)
   * @param window - The BrowserWindow to register
   * @param workspaceId - The workspace ID to associate with
   */
  registerWindow(window: BrowserWindow, workspaceId: string): void {
    const webContentsId = window.webContents.id
    this.windows.set(webContentsId, { window, workspaceId })
    windowLog.info(`Registered window ${webContentsId} for workspace ${workspaceId}`)
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
      if (!existing.isVisible()) {
        existing.show()
      }
      existing.focus()
      return existing
    }
    return this.createWindow({ workspaceId })
  }

  /**
   * Get window states for persistence (includes bounds and focused mode)
   * Used by window-state.ts to save/restore windows
   */
  getWindowStates(): SavedWindow[] {
    return this.getAllWindows().map(managed => {
      const webContentsId = managed.window.webContents.id
      const isFocused = this.focusedModeWindows.has(webContentsId)
      const url = managed.window.webContents.getURL()
      return {
        type: 'main' as const,
        workspaceId: managed.workspaceId,
        bounds: managed.window.getBounds(),
        ...(isFocused && { focused: true }),
        ...(url && { url }),
      }
    })
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
      // Check mainFrame - it becomes null when render frame is disposed
      if (!managed.window.isDestroyed() &&
          !managed.window.webContents.isDestroyed() &&
          managed.window.webContents.mainFrame) {
        managed.window.webContents.send(channel, ...args)
      }
    }
  }

  /**
   * Show or hide macOS traffic light buttons (close/minimize/maximize).
   * Used to hide them when fullscreen overlays are open to prevent accidental clicks.
   * No-op on non-macOS platforms.
   */
  setTrafficLightsVisible(webContentsId: number, visible: boolean): void {
    if (process.platform !== 'darwin') return

    const managed = this.windows.get(webContentsId)
    if (managed && !managed.window.isDestroyed()) {
      managed.window.setWindowButtonVisibility(visible)
      // Re-apply custom traffic light position after showing buttons
      // setWindowButtonVisibility can reset position to default, so we need
      // to restore the custom position using the modern setWindowButtonPosition API
      if (visible) {
        managed.window.setWindowButtonPosition({ x: 18, y: 18 })
      }
    }
  }

  /**
   * Set window always on top (pin mode).
   * When enabled, the window stays above all other windows.
   */
  async setAlwaysOnTop(webContentsId: number, enabled: boolean): Promise<boolean> {
    const window = this.resolveWindow(webContentsId)
    if (!window) {
      windowLog.warn(`Cannot set always on top for unknown window ${webContentsId}`)
      return false
    }

    if (process.platform === 'darwin') {
      if (enabled) {
        window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      } else {
        window.setVisibleOnAllWorkspaces(false)
      }
      window.setAlwaysOnTop(enabled, 'floating')
      if (enabled) {
        window.moveTop()
      }
    } else {
      window.setAlwaysOnTop(enabled)
    }

    const actual = await this.readAlwaysOnTop(window, enabled)
    windowLog.info(`Window ${webContentsId} always on top: ${actual}`)
    return actual
  }

  /**
   * Get the current always on top state of a window.
   */
  getAlwaysOnTop(webContentsId: number): boolean {
    const window = this.resolveWindow(webContentsId)
    return window ? window.isAlwaysOnTop() : false
  }
}
