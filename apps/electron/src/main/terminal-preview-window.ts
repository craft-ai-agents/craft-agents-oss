import { BrowserWindow, shell, nativeTheme } from 'electron'
import { windowLog } from './logger'
import { join } from 'path'
import { IPC_CHANNELS, type TerminalPreviewData } from '../shared/types'

// Vite dev server URL for hot reload
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

interface TerminalPreviewWindowData {
  window: BrowserWindow
  sessionId: string
  previewId: string
  data: TerminalPreviewData
}

/**
 * TerminalPreviewWindowManager - Manages pop-out windows for viewing terminal output
 *
 * Used for Bash tool results - displays command and output in terminal style.
 */
export class TerminalPreviewWindowManager {
  private windows: Map<string, TerminalPreviewWindowData> = new Map()

  /**
   * Generate key for a terminal preview window
   */
  private getKey(sessionId: string, previewId: string): string {
    return `${sessionId}:${previewId}`
  }

  /**
   * Open or focus an existing terminal preview window
   */
  openTerminalPreview(sessionId: string, previewId: string, data: TerminalPreviewData): BrowserWindow {
    const key = this.getKey(sessionId, previewId)

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

    // Terminal windows use dark background
    const backgroundColor = '#1a1a1a'

    // Truncate command for title
    const cmdPreview = data.command.length > 50
      ? data.command.substring(0, 47) + '...'
      : data.command

    const window = new BrowserWindow({
      width: 900,
      height: 600,
      minWidth: 500,
      minHeight: 300,
      title: `Terminal: ${cmdPreview}`,
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
      previewId,
      data,
    })

    // Load the terminal preview renderer
    const query = { sessionId, previewId }

    if (VITE_DEV_SERVER_URL) {
      const params = new URLSearchParams(query).toString()
      window.loadURL(`${VITE_DEV_SERVER_URL}/terminal-preview.html?${params}`)
    } else {
      window.loadFile(join(__dirname, 'renderer/terminal-preview.html'), { query })
    }

    // Listen for system theme changes (terminal stays dark but may need updates)
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
      windowLog.info(`[TerminalPreviewWindowManager] Terminal preview window closed for ${key}`)
    })

    windowLog.info(`[TerminalPreviewWindowManager] Created terminal preview window for ${key}`)
    return window
  }

  /**
   * Get data for a terminal preview window (called from renderer on mount)
   */
  getData(sessionId: string, previewId: string): TerminalPreviewData | null {
    const key = this.getKey(sessionId, previewId)
    const windowData = this.windows.get(key)
    return windowData?.data ?? null
  }

  /**
   * Close all terminal preview windows for a session
   */
  closeWindowsForSession(sessionId: string): void {
    for (const [key, data] of this.windows) {
      if (data.sessionId === sessionId && !data.window.isDestroyed()) {
        data.window.close()
      }
    }
  }

  /**
   * Get all terminal preview windows
   */
  getAllWindows(): TerminalPreviewWindowData[] {
    return Array.from(this.windows.values()).filter((d) => !d.window.isDestroyed())
  }
}
