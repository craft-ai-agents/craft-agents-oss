import { BrowserWindow, shell, nativeTheme } from 'electron'
import { windowLog } from './logger'
import { join } from 'path'
import { IPC_CHANNELS, type DiffPreviewData } from '../shared/types'

// Vite dev server URL for hot reload
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

interface DiffPreviewWindowData {
  window: BrowserWindow
  sessionId: string
  diffId: string
  data: DiffPreviewData
}

/**
 * DiffPreviewWindowManager - Manages pop-out windows for viewing diffs
 *
 * Each window is keyed by sessionId:diffId to support multiple diff windows.
 */
export class DiffPreviewWindowManager {
  private windows: Map<string, DiffPreviewWindowData> = new Map()

  /**
   * Generate key for a diff preview window
   */
  private getKey(sessionId: string, diffId: string): string {
    return `${sessionId}:${diffId}`
  }

  /**
   * Open or focus an existing diff preview window
   */
  openDiffPreview(sessionId: string, diffId: string, data: DiffPreviewData): BrowserWindow {
    const key = this.getKey(sessionId, diffId)

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

    // Create new diff preview window
    const backgroundColor = nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ffffff'

    const window = new BrowserWindow({
      width: 1100,
      height: 800,
      minWidth: 800,
      minHeight: 500,
      title: `Diff: ${data.filePath}`,
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
      diffId,
      data,
    })

    // Load the diff preview renderer
    const query = { sessionId, diffId }

    if (VITE_DEV_SERVER_URL) {
      const params = new URLSearchParams(query).toString()
      window.loadURL(`${VITE_DEV_SERVER_URL}/diff-preview.html?${params}`)
    } else {
      window.loadFile(join(__dirname, 'renderer/diff-preview.html'), { query })
    }

    // Listen for system theme changes
    const themeHandler = () => {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.SYSTEM_THEME_CHANGED, nativeTheme.shouldUseDarkColors)
      }
    }
    nativeTheme.on('updated', themeHandler)

    // Clean up when window is closed - theme listener first, then internal state
    window.on('closed', () => {
      nativeTheme.removeListener('updated', themeHandler)
      this.windows.delete(key)
      windowLog.info(`[DiffPreviewWindowManager] Diff preview window closed for ${key}`)
    })

    windowLog.info(`[DiffPreviewWindowManager] Created diff preview window for ${key}`)
    return window
  }

  /**
   * Get data for a diff preview window (called from renderer on mount)
   */
  getData(sessionId: string, diffId: string): DiffPreviewData | null {
    const key = this.getKey(sessionId, diffId)
    const windowData = this.windows.get(key)
    return windowData?.data ?? null
  }

  /**
   * Close all diff preview windows for a session
   */
  closeWindowsForSession(sessionId: string): void {
    for (const [key, data] of this.windows) {
      if (data.sessionId === sessionId && !data.window.isDestroyed()) {
        data.window.close()
      }
    }
  }

  /**
   * Get all diff preview windows
   */
  getAllWindows(): DiffPreviewWindowData[] {
    return Array.from(this.windows.values()).filter((d) => !d.window.isDestroyed())
  }
}
