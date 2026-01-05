import { BrowserWindow, shell, nativeTheme } from 'electron'
import { windowLog } from './logger'
import { join, basename } from 'path'
import { readFile, writeFile } from 'fs/promises'
import { IPC_CHANNELS, type MarkdownPreviewData } from '../shared/types'
import type { WindowManager } from './window-manager'

// Vite dev server URL for hot reload
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

interface MarkdownPreviewWindowData {
  window: BrowserWindow
  previewId: string
  data: MarkdownPreviewData
  /** Resolved content (either from memory or file) */
  content: string
  /** Original content for change detection */
  originalContent: string
}

/**
 * MarkdownPreviewWindowManager - Manages pop-out preview windows for markdown content
 *
 * Supports two modes:
 * - readOnly: View markdown content without save functionality
 *   - Can pass content directly (from memory)
 *   - Can pass filePath to read from
 * - readWrite: Edit and save markdown to a file
 *   - Must provide filePath
 */
export class PreviewWindowManager {
  private windows: Map<string, MarkdownPreviewWindowData> = new Map()
  private windowManager: WindowManager | null = null

  /**
   * Set the window manager for broadcasting file save events
   */
  setWindowManager(windowManager: WindowManager): void {
    this.windowManager = windowManager
  }

  /**
   * Open or focus an existing preview window
   */
  async openPreview(previewId: string, data: MarkdownPreviewData): Promise<BrowserWindow> {
    // If window exists and is not destroyed, focus it
    const existing = this.windows.get(previewId)
    if (existing && !existing.window.isDestroyed()) {
      if (existing.window.isMinimized()) {
        existing.window.restore()
      }
      existing.window.focus()
      return existing.window
    }

    // Resolve content based on data type
    let content: string
    if ('content' in data) {
      // Content provided directly
      content = data.content
    } else {
      // Read from file
      try {
        content = await readFile(data.filePath, 'utf-8')
      } catch (err) {
        windowLog.error(`[PreviewWindowManager] Failed to read file: ${data.filePath}`, err)
        content = `Error reading file: ${err instanceof Error ? err.message : String(err)}`
      }
    }

    // Generate window title
    let title = 'Markdown Preview'
    if (data.title) {
      title = data.title
    } else if ('filePath' in data) {
      title = basename(data.filePath)
    }

    // Create new preview window (solid background, no vibrancy)
    const backgroundColor = nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ffffff'

    const window = new BrowserWindow({
      width: 900,
      height: 700,
      minWidth: 600,
      minHeight: 400,
      title,
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

    // Store window data BEFORE loading URL to avoid race condition
    this.windows.set(previewId, {
      window,
      previewId,
      data,
      content,
      originalContent: content,
    })

    // Load the preview renderer with previewId
    const query = { previewId }

    if (VITE_DEV_SERVER_URL) {
      const params = new URLSearchParams(query).toString()
      window.loadURL(`${VITE_DEV_SERVER_URL}/preview.html?${params}`)
    } else {
      window.loadFile(join(__dirname, 'renderer/preview.html'), { query })
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
      this.windows.delete(previewId)
      windowLog.info(`[PreviewWindowManager] Preview window closed for ${previewId}`)
    })

    windowLog.info(`[PreviewWindowManager] Created preview window for ${previewId}`)
    return window
  }

  /**
   * Get data and content for a preview (called from renderer on mount)
   */
  getData(previewId: string): { data: MarkdownPreviewData; content: string } | null {
    const windowData = this.windows.get(previewId)
    if (!windowData) return null
    return {
      data: windowData.data,
      content: windowData.content,
    }
  }

  /**
   * Save content to file (only works for readWrite mode)
   */
  async save(previewId: string, content: string): Promise<void> {
    const windowData = this.windows.get(previewId)
    if (!windowData) {
      throw new Error('Preview window not found')
    }

    if (windowData.data.mode !== 'readWrite') {
      throw new Error('Cannot save in read-only mode')
    }

    const filePath = windowData.data.filePath
    await writeFile(filePath, content, 'utf-8')

    // Update stored content
    windowData.content = content
    windowData.originalContent = content

    windowLog.info(`[PreviewWindowManager] Saved content to ${filePath}`)

    // Broadcast file saved event to all workspace windows
    if (this.windowManager) {
      this.windowManager.broadcastToAll(IPC_CHANNELS.MARKDOWN_PREVIEW_FILE_SAVED, { filePath })
    }
  }

  /**
   * Close all preview windows
   */
  closeAll(): void {
    for (const [, data] of this.windows) {
      if (!data.window.isDestroyed()) {
        data.window.close()
      }
    }
  }

  /**
   * Get all preview windows
   */
  getAllWindows(): MarkdownPreviewWindowData[] {
    return Array.from(this.windows.values()).filter((d) => !d.window.isDestroyed())
  }
}
