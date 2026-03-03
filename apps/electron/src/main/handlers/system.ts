import { app, nativeTheme, shell, dialog } from 'electron'
import { resolve } from 'path'
import { join } from 'path'
import { homedir } from 'os'
import { execSync } from 'child_process'
import { IPC_CHANNELS } from '../../shared/types'
import { getGitBashPath, setGitBashPath, clearGitBashPath } from '@craft-agent/shared/config'
import { isUsableGitBashPath, validateGitBashPath } from '../git-bash'
import { validateFilePath } from './files'
import type { RpcServer } from '../../transport/types'
import type { HandlerDeps } from './handler-deps'
import { requestClientOpenExternal } from '../../transport/capabilities'

export const HANDLED_CHANNELS = [
  IPC_CHANNELS.theme.GET_SYSTEM_PREFERENCE,
  IPC_CHANNELS.system.VERSIONS,
  IPC_CHANNELS.system.HOME_DIR,
  IPC_CHANNELS.system.IS_DEBUG_MODE,
  IPC_CHANNELS.debug.LOG,
  IPC_CHANNELS.update.CHECK,
  IPC_CHANNELS.update.GET_INFO,
  IPC_CHANNELS.update.INSTALL,
  IPC_CHANNELS.update.DISMISS,
  IPC_CHANNELS.update.GET_DISMISSED,
  IPC_CHANNELS.shell.OPEN_URL,
  IPC_CHANNELS.shell.OPEN_FILE,
  IPC_CHANNELS.shell.SHOW_IN_FOLDER,
  IPC_CHANNELS.releaseNotes.GET,
  IPC_CHANNELS.releaseNotes.GET_LATEST_VERSION,
  IPC_CHANNELS.git.GET_BRANCH,
  IPC_CHANNELS.gitbash.CHECK,
  IPC_CHANNELS.gitbash.BROWSE,
  IPC_CHANNELS.gitbash.SET_PATH,
  IPC_CHANNELS.badge.REFRESH,
  IPC_CHANNELS.badge.SET_ICON,
  IPC_CHANNELS.window.GET_FOCUS_STATE,
  IPC_CHANNELS.notification.SHOW,
  IPC_CHANNELS.notification.GET_ENABLED,
  IPC_CHANNELS.notification.SET_ENABLED,
  IPC_CHANNELS.menu.QUIT,
  IPC_CHANNELS.menu.NEW_WINDOW,
  IPC_CHANNELS.menu.MINIMIZE,
  IPC_CHANNELS.menu.MAXIMIZE,
  IPC_CHANNELS.menu.ZOOM_IN,
  IPC_CHANNELS.menu.ZOOM_OUT,
  IPC_CHANNELS.menu.ZOOM_RESET,
  IPC_CHANNELS.menu.TOGGLE_DEV_TOOLS,
  IPC_CHANNELS.menu.UNDO,
  IPC_CHANNELS.menu.REDO,
  IPC_CHANNELS.menu.CUT,
  IPC_CHANNELS.menu.COPY,
  IPC_CHANNELS.menu.PASTE,
  IPC_CHANNELS.menu.SELECT_ALL,
] as const

export function registerSystemHandlers(server: RpcServer, deps: HandlerDeps): void {
  const { sessionManager } = deps
  // Shell handler — windowManager is always present in Electron context
  const windowManager = deps.windowManager!

  // Get system theme preference (dark = true, light = false)
  server.handle(IPC_CHANNELS.theme.GET_SYSTEM_PREFERENCE, async () => {
    return nativeTheme.shouldUseDarkColors
  })

  // Get runtime versions (previously handled locally in preload via process.versions)
  server.handle(IPC_CHANNELS.system.VERSIONS, async () => {
    return {
      node: process.versions.node,
      chrome: process.versions.chrome,
      electron: process.versions.electron,
    }
  })

  // Get user's home directory
  server.handle(IPC_CHANNELS.system.HOME_DIR, async () => {
    return homedir()
  })

  // Check if running in debug mode (from source)
  server.handle(IPC_CHANNELS.system.IS_DEBUG_MODE, async () => {
    return !app.isPackaged
  })

  // Release notes
  server.handle(IPC_CHANNELS.releaseNotes.GET, async () => {
    const { getCombinedReleaseNotes } = require('@craft-agent/shared/release-notes') as typeof import('@craft-agent/shared/release-notes')
    return getCombinedReleaseNotes()
  })

  server.handle(IPC_CHANNELS.releaseNotes.GET_LATEST_VERSION, async () => {
    const { getLatestReleaseVersion } = require('@craft-agent/shared/release-notes') as typeof import('@craft-agent/shared/release-notes')
    return getLatestReleaseVersion()
  })

  // Get git branch for a directory (returns null if not a git repo or git unavailable)
  server.handle(IPC_CHANNELS.git.GET_BRANCH, async (_ctx, dirPath: string) => {
    try {
      const branch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: dirPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],  // Suppress stderr output
        timeout: 5000,  // 5 second timeout
      }).trim()
      return branch || null
    } catch {
      // Not a git repo, git not installed, or other error
      return null
    }
  })

  // Git Bash detection and configuration (Windows only)
  server.handle(IPC_CHANNELS.gitbash.CHECK, async () => {
    const platform = process.platform as 'win32' | 'darwin' | 'linux'

    // Non-Windows platforms don't need Git Bash
    if (platform !== 'win32') {
      return { found: true, path: null, platform }
    }

    // Check common Git Bash installation paths
    const commonPaths = [
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
      join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'bin', 'bash.exe'),
      join(process.env.PROGRAMFILES || '', 'Git', 'bin', 'bash.exe'),
    ]

    // Check if we have a persisted path from a previous session
    const persistedPath = getGitBashPath()
    if (persistedPath) {
      if (await isUsableGitBashPath(persistedPath)) {
        process.env.CLAUDE_CODE_GIT_BASH_PATH = persistedPath.trim()
        return { found: true, path: persistedPath, platform }
      } else {
        // Persisted path no longer valid, clear stale config and fall through to detection
        clearGitBashPath()
      }
    }

    for (const bashPath of commonPaths) {
      if (await isUsableGitBashPath(bashPath)) {
        process.env.CLAUDE_CODE_GIT_BASH_PATH = bashPath
        setGitBashPath(bashPath)
        return { found: true, path: bashPath, platform }
      }
    }

    // Try to find via 'where' command
    try {
      const result = execSync('where bash', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 5000,
      }).trim()
      const firstPath = result.split('\n')[0]?.trim()
      if (firstPath && firstPath.toLowerCase().includes('git') && await isUsableGitBashPath(firstPath)) {
        process.env.CLAUDE_CODE_GIT_BASH_PATH = firstPath
        setGitBashPath(firstPath)
        return { found: true, path: firstPath, platform }
      }
    } catch {
      // where command failed
    }

    delete process.env.CLAUDE_CODE_GIT_BASH_PATH
    return { found: false, path: null, platform }
  })

  server.handle(IPC_CHANNELS.gitbash.BROWSE, async (ctx) => {
    const win = windowManager.getWindowByWebContentsId(ctx.webContentsId!)
    if (!win) return null

    const result = await dialog.showOpenDialog(win, {
      title: 'Select bash.exe',
      filters: [{ name: 'Executable', extensions: ['exe'] }],
      properties: ['openFile'],
      defaultPath: 'C:\\Program Files\\Git\\bin',
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  })

  server.handle(IPC_CHANNELS.gitbash.SET_PATH, async (_ctx, bashPath: string) => {
    const validation = await validateGitBashPath(bashPath)
    if (!validation.valid) {
      return { success: false, error: validation.error }
    }

    // Persist to config and set env var so SDK subprocess can find Git Bash
    setGitBashPath(validation.path)
    process.env.CLAUDE_CODE_GIT_BASH_PATH = validation.path
    return { success: true }
  })

  // Debug logging from renderer -> main log file (fire-and-forget, no response)
  server.handle(IPC_CHANNELS.debug.LOG, async (_ctx, ...args: unknown[]) => {
    deps.platform.logger.info('[renderer]', ...args)
  })

  // Auto-update handlers
  // Manual check from UI - don't auto-download (user might be on metered connection)
  server.handle(IPC_CHANNELS.update.CHECK, async () => {
    const { checkForUpdates } = await import('../auto-update')
    return checkForUpdates({ autoDownload: false })
  })

  server.handle(IPC_CHANNELS.update.GET_INFO, async () => {
    const { getUpdateInfo } = await import('../auto-update')
    return getUpdateInfo()
  })

  server.handle(IPC_CHANNELS.update.INSTALL, async () => {
    const { installUpdate } = await import('../auto-update')
    return installUpdate()
  })

  // Dismiss update for this version (persists across restarts)
  server.handle(IPC_CHANNELS.update.DISMISS, async (_ctx, version: string) => {
    const { setDismissedUpdateVersion } = await import('@craft-agent/shared/config')
    setDismissedUpdateVersion(version)
  })

  // Get dismissed version
  server.handle(IPC_CHANNELS.update.GET_DISMISSED, async () => {
    const { getDismissedUpdateVersion } = await import('@craft-agent/shared/config')
    return getDismissedUpdateVersion()
  })

  // Shell operations - open URL in external browser (or handle craftagents:// internally)
  server.handle(IPC_CHANNELS.shell.OPEN_URL, async (ctx, url: string) => {
    deps.platform.logger.info('[OPEN_URL] Received request:', url)
    try {
      // Validate URL format
      const parsed = new URL(url)

      // Handle craftagents:// URLs internally via deep link handler
      // This ensures ?window= params work correctly for "Open in New Window"
      if (parsed.protocol === 'craftagents:') {
        deps.platform.logger.info('[OPEN_URL] Handling as deep link')
        const { handleDeepLink } = await import('../deep-link')
        const result = await handleDeepLink(url, windowManager, server.push.bind(server))
        deps.platform.logger.info('[OPEN_URL] Deep link result:', result)
        return
      }

      // External URLs - open in default browser
      if (!['http:', 'https:', 'mailto:', 'craftdocs:'].includes(parsed.protocol)) {
        throw new Error('Only http, https, mailto, craftdocs URLs are allowed')
      }

      // Route through client capability so browser opens on the user's machine (not the server)
      const result = await requestClientOpenExternal(server, ctx.clientId, url)
      if (!result.opened) {
        deps.platform.logger.error(`[OPEN_URL] Client capability failed: ${result.error}`)
        throw new Error(`Cannot open URL on client: ${result.error}`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      deps.platform.logger.error('openUrl error:', message)
      throw new Error(`Failed to open URL: ${message}`)
    }
  })

  // Shell operations - open file in default application
  server.handle(IPC_CHANNELS.shell.OPEN_FILE, async (_ctx, path: string) => {
    try {
      // Resolve relative paths to absolute before validation
      const absolutePath = resolve(path)
      // Validate path is within allowed directories
      const safePath = await validateFilePath(absolutePath)
      // openPath opens file with default application (e.g., VS Code for .ts files)
      const result = await shell.openPath(safePath)
      if (result) {
        // openPath returns empty string on success, error message on failure
        throw new Error(result)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      deps.platform.logger.error('openFile error:', message)
      throw new Error(`Failed to open file: ${message}`)
    }
  })

  // Shell operations - show file in folder (opens Finder/Explorer with file selected)
  server.handle(IPC_CHANNELS.shell.SHOW_IN_FOLDER, async (_ctx, path: string) => {
    try {
      // Resolve relative paths to absolute before validation
      const absolutePath = resolve(path)
      // Validate path is within allowed directories
      const safePath = await validateFilePath(absolutePath)
      shell.showItemInFolder(safePath)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      deps.platform.logger.error('showInFolder error:', message)
      throw new Error(`Failed to show in folder: ${message}`)
    }
  })

  // Menu actions from renderer (for unified Craft menu)
  server.handle(IPC_CHANNELS.menu.QUIT, async () => {
    app.quit()
  })

  // New Window: create a new window for the current workspace
  server.handle(IPC_CHANNELS.menu.NEW_WINDOW, async (ctx) => {
    const workspaceId = ctx.workspaceId ?? windowManager.getWorkspaceForWindow(ctx.webContentsId!)
    if (workspaceId) {
      windowManager.createWindow({ workspaceId })
    }
  })

  server.handle(IPC_CHANNELS.menu.MINIMIZE, async (ctx) => {
    const win = windowManager.getWindowByWebContentsId(ctx.webContentsId!)
    win?.minimize()
  })

  server.handle(IPC_CHANNELS.menu.MAXIMIZE, async (ctx) => {
    const win = windowManager.getWindowByWebContentsId(ctx.webContentsId!)
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize()
      } else {
        win.maximize()
      }
    }
  })

  server.handle(IPC_CHANNELS.menu.ZOOM_IN, async (ctx) => {
    const win = windowManager.getWindowByWebContentsId(ctx.webContentsId!)
    if (win) {
      const currentZoom = win.webContents.getZoomFactor()
      win.webContents.setZoomFactor(Math.min(currentZoom + 0.1, 3.0))
    }
  })

  server.handle(IPC_CHANNELS.menu.ZOOM_OUT, async (ctx) => {
    const win = windowManager.getWindowByWebContentsId(ctx.webContentsId!)
    if (win) {
      const currentZoom = win.webContents.getZoomFactor()
      win.webContents.setZoomFactor(Math.max(currentZoom - 0.1, 0.5))
    }
  })

  server.handle(IPC_CHANNELS.menu.ZOOM_RESET, async (ctx) => {
    const win = windowManager.getWindowByWebContentsId(ctx.webContentsId!)
    win?.webContents.setZoomFactor(1.0)
  })

  server.handle(IPC_CHANNELS.menu.TOGGLE_DEV_TOOLS, async (ctx) => {
    const win = windowManager.getWindowByWebContentsId(ctx.webContentsId!)
    win?.webContents.toggleDevTools()
  })

  server.handle(IPC_CHANNELS.menu.UNDO, async (ctx) => {
    const win = windowManager.getWindowByWebContentsId(ctx.webContentsId!)
    win?.webContents.undo()
  })

  server.handle(IPC_CHANNELS.menu.REDO, async (ctx) => {
    const win = windowManager.getWindowByWebContentsId(ctx.webContentsId!)
    win?.webContents.redo()
  })

  server.handle(IPC_CHANNELS.menu.CUT, async (ctx) => {
    const win = windowManager.getWindowByWebContentsId(ctx.webContentsId!)
    win?.webContents.cut()
  })

  server.handle(IPC_CHANNELS.menu.COPY, async (ctx) => {
    const win = windowManager.getWindowByWebContentsId(ctx.webContentsId!)
    win?.webContents.copy()
  })

  server.handle(IPC_CHANNELS.menu.PASTE, async (ctx) => {
    const win = windowManager.getWindowByWebContentsId(ctx.webContentsId!)
    win?.webContents.paste()
  })

  server.handle(IPC_CHANNELS.menu.SELECT_ALL, async (ctx) => {
    const win = windowManager.getWindowByWebContentsId(ctx.webContentsId!)
    win?.webContents.selectAll()
  })

  // Notifications
  server.handle(IPC_CHANNELS.notification.SHOW, async (_ctx, title: string, body: string, workspaceId: string, sessionId: string) => {
    const { showNotification } = await import('../notifications')
    showNotification(title, body, workspaceId, sessionId)
  })

  server.handle(IPC_CHANNELS.notification.GET_ENABLED, async () => {
    const { getNotificationsEnabled } = await import('@craft-agent/shared/config/storage')
    return getNotificationsEnabled()
  })

  server.handle(IPC_CHANNELS.notification.SET_ENABLED, async (_ctx, enabled: boolean) => {
    const { setNotificationsEnabled } = await import('@craft-agent/shared/config/storage')
    setNotificationsEnabled(enabled)

    // If enabling, trigger a notification to request macOS permission
    if (enabled) {
      const { showNotification } = await import('../notifications')
      showNotification('Notifications enabled', 'You will be notified when tasks complete.', '', '')
    }
  })

  // Badge and window focus
  server.handle(IPC_CHANNELS.badge.REFRESH, async () => {
    try {
      await sessionManager.waitForInit()
    } catch { /* continue */ }
    sessionManager.refreshBadge()
  })

  server.handle(IPC_CHANNELS.badge.SET_ICON, async (_ctx, dataUrl: string) => {
    const { setDockIconWithBadge } = await import('../notifications')
    setDockIconWithBadge(dataUrl)
  })

  server.handle(IPC_CHANNELS.window.GET_FOCUS_STATE, async () => {
    const { isAnyWindowFocused } = require('../notifications')
    return isAnyWindowFocused()
  })
}
