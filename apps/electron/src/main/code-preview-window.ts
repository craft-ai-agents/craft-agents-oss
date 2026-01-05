import { BrowserWindow, shell, nativeTheme } from 'electron'
import { windowLog } from './logger'
import { join } from 'path'
import { IPC_CHANNELS, type CodePreviewData } from '../shared/types'

// Vite dev server URL for hot reload
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

interface CodePreviewWindowData {
  window: BrowserWindow
  sessionId: string
  previewId: string
  data: CodePreviewData
}

/**
 * CodePreviewWindowManager - Manages pop-out windows for viewing file content
 *
 * Used for Read and Write tool results - displays syntax-highlighted code.
 */
export class CodePreviewWindowManager {
  private windows: Map<string, CodePreviewWindowData> = new Map()

  /**
   * Generate key for a code preview window
   */
  private getKey(sessionId: string, previewId: string): string {
    return `${sessionId}:${previewId}`
  }

  /**
   * Open or focus an existing code preview window
   */
  openCodePreview(sessionId: string, previewId: string, data: CodePreviewData): BrowserWindow {
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

    // Create new code preview window
    const backgroundColor = nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ffffff'
    const modeLabel = data.mode === 'read' ? 'Read' : 'Write'

    const window = new BrowserWindow({
      width: 900,
      height: 700,
      minWidth: 600,
      minHeight: 400,
      title: `${modeLabel}: ${data.filePath}`,
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

    // Load the code preview renderer
    const query = { sessionId, previewId }

    if (VITE_DEV_SERVER_URL) {
      const params = new URLSearchParams(query).toString()
      window.loadURL(`${VITE_DEV_SERVER_URL}/code-preview.html?${params}`)
    } else {
      window.loadFile(join(__dirname, 'renderer/code-preview.html'), { query })
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
      windowLog.info(`[CodePreviewWindowManager] Code preview window closed for ${key}`)
    })

    windowLog.info(`[CodePreviewWindowManager] Created code preview window for ${key}`)
    return window
  }

  /**
   * Get data for a code preview window (called from renderer on mount)
   */
  getData(sessionId: string, previewId: string): CodePreviewData | null {
    const key = this.getKey(sessionId, previewId)
    const windowData = this.windows.get(key)
    return windowData?.data ?? null
  }

  /**
   * Close all code preview windows for a session
   */
  closeWindowsForSession(sessionId: string): void {
    for (const [key, data] of this.windows) {
      if (data.sessionId === sessionId && !data.window.isDestroyed()) {
        data.window.close()
      }
    }
  }

  /**
   * Get all code preview windows
   */
  getAllWindows(): CodePreviewWindowData[] {
    return Array.from(this.windows.values()).filter((d) => !d.window.isDestroyed())
  }
}
