import { BrowserWindow, shell, nativeTheme } from 'electron'
import { windowLog } from './logger'
import { join } from 'path'
import { IPC_CHANNELS, type MultiFileDiffData } from '../shared/types'

// Vite dev server URL for hot reload
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

interface MultiFileDiffWindowData {
  window: BrowserWindow
  sessionId: string
  turnId: string
  data: MultiFileDiffData
}

/**
 * MultiFileDiffWindowManager - Manages pop-out windows for viewing all edits/writes in a turn
 *
 * Each window is keyed by sessionId:turnId to support multiple diff windows.
 * Shows a VS Code-style file tree on the left with Monaco diff editor on the right.
 */
export class MultiFileDiffWindowManager {
  private windows: Map<string, MultiFileDiffWindowData> = new Map()

  /**
   * Generate key for a multi-file diff window
   */
  private getKey(sessionId: string, turnId: string): string {
    return `${sessionId}:${turnId}`
  }

  /**
   * Open or focus an existing multi-file diff window
   */
  openMultiFileDiff(sessionId: string, turnId: string, data: MultiFileDiffData): BrowserWindow {
    const key = this.getKey(sessionId, turnId)

    // If window exists and is not destroyed, focus it
    const existing = this.windows.get(key)
    if (existing && !existing.window.isDestroyed()) {
      if (existing.window.isMinimized()) {
        existing.window.restore()
      }
      existing.window.focus()
      // Update data if changed
      existing.data = data
      return existing.window
    }

    // Create new multi-file diff window
    const backgroundColor = nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ffffff'

    const window = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 900,
      minHeight: 600,
      title: `Changes (${data.changes.length} files)`,
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 18, y: 18 },
      backgroundColor,
      webPreferences: {
        preload: join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    // Open external links in default browser
    window.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url)
      return { action: 'deny' }
    })

    // Store window data BEFORE loading URL
    this.windows.set(key, {
      window,
      sessionId,
      turnId,
      data,
    })

    // Load the multi-file diff renderer
    const query = { sessionId, turnId }

    if (VITE_DEV_SERVER_URL) {
      const params = new URLSearchParams(query).toString()
      window.loadURL(`${VITE_DEV_SERVER_URL}/multi-file-diff.html?${params}`)
    } else {
      window.loadFile(join(__dirname, 'renderer/multi-file-diff.html'), { query })
    }

    // Listen for system theme changes
    const themeHandler = () => {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.SYSTEM_THEME_CHANGED, nativeTheme.shouldUseDarkColors)
      }
    }
    nativeTheme.on('updated', themeHandler)

    // Clean up when window is closed
    window.on('closed', () => {
      nativeTheme.removeListener('updated', themeHandler)
      this.windows.delete(key)
      windowLog.info(`[MultiFileDiffWindowManager] Multi-file diff window closed for ${key}`)
    })

    windowLog.info(`[MultiFileDiffWindowManager] Created multi-file diff window for ${key} with ${data.changes.length} changes`)
    return window
  }

  /**
   * Get data for a multi-file diff window (called from renderer on mount)
   */
  getData(sessionId: string, turnId: string): MultiFileDiffData | null {
    const key = this.getKey(sessionId, turnId)
    const windowData = this.windows.get(key)
    return windowData?.data ?? null
  }

  /**
   * Close all multi-file diff windows for a session
   */
  closeWindowsForSession(sessionId: string): void {
    for (const [key, data] of this.windows) {
      if (data.sessionId === sessionId && !data.window.isDestroyed()) {
        data.window.close()
      }
    }
  }

  /**
   * Get all multi-file diff windows
   */
  getAllWindows(): MultiFileDiffWindowData[] {
    return Array.from(this.windows.values()).filter((d) => !d.window.isDestroyed())
  }
}
