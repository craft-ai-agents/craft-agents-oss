import { app, ipcMain, nativeTheme, nativeImage, dialog, shell, BrowserWindow } from 'electron'
import { appendFile, readFile, readdir, stat, realpath, mkdir, writeFile, unlink, rm } from 'fs/promises'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { normalize, isAbsolute, join, basename, dirname, resolve, relative, sep } from 'path'
import { homedir, tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { execSync } from 'child_process'
import { SessionManager } from './sessions'
import { ipcLog, windowLog, searchLog } from './logger'
import { WindowManager } from './window-manager'
import { registerOnboardingHandlers } from './onboarding'
import { IPC_CHANNELS, type FileAttachment, type StoredAttachment, type SendMessageOptions, type LlmConnectionSetup, type SkillFile } from '../shared/types'
import { readFileAttachment, perf, validateImageForClaudeAPI, IMAGE_LIMITS } from '@craft-agent/shared/utils'
import { safeJsonParse } from '@craft-agent/shared/utils/files'
import { getPreferencesPath, getSessionDraft, setSessionDraft, deleteSessionDraft, getAllSessionDrafts, getWorkspaceByNameOrId, addWorkspace, setActiveWorkspace, loadStoredConfig, saveConfig, type Workspace, getLlmConnections, getLlmConnection, addLlmConnection, updateLlmConnection, deleteLlmConnection, getDefaultLlmConnection, setDefaultLlmConnection, touchLlmConnection, isCompatProvider, isAnthropicProvider, getDefaultModelsForConnection, getDefaultModelForConnection, type LlmConnection, type LlmConnectionWithStatus, getGitBashPath, setGitBashPath, clearGitBashPath } from '@craft-agent/shared/config'
import { getSessionAttachmentsPath, validateSessionId } from '@craft-agent/shared/sessions'
import { loadWorkspaceSources, getSourcesBySlugs, type LoadedSource } from '@craft-agent/shared/sources'
import { isValidThinkingLevel } from '@craft-agent/shared/agent/thinking-levels'
import {
  resolveSetupTestConnectionHint,
  testBackendConnection,
  validateStoredBackendConnection,
} from '@craft-agent/shared/agent/backend'
import { getCredentialManager } from '@craft-agent/shared/credentials'
import { MarkItDown } from 'markitdown-js'
import { isUsableGitBashPath, validateGitBashPath } from './git-bash'
import { getModelRefreshService } from './model-fetchers'
import { parseTestConnectionError, createBuiltInConnection, validateModelList, piAuthProviderDisplayName } from './connection-setup-logic'

/**
 * Sanitizes a filename to prevent path traversal and filesystem issues.
 * Removes dangerous characters and limits length.
 */
function sanitizeFilename(name: string): string {
  return name
    // Remove path separators and traversal patterns
    .replace(/[/\\]/g, '_')
    // Remove Windows-forbidden characters: < > : " | ? *
    .replace(/[<>:"|?*]/g, '_')
    // Remove control characters (ASCII 0-31)
    .replace(/[\x00-\x1f]/g, '')
    // Collapse multiple dots (prevent hidden files and extension tricks)
    .replace(/\.{2,}/g, '.')
    // Remove leading/trailing dots and spaces (Windows issues)
    .replace(/^[.\s]+|[.\s]+$/g, '')
    // Limit length (200 chars is safe for all filesystems)
    .slice(0, 200)
    // Fallback if name is empty after sanitization
    || 'unnamed'
}

/**
 * Get workspace by ID or name, throwing if not found.
 * Use this when a workspace must exist for the operation to proceed.
 */
function getWorkspaceOrThrow(workspaceId: string): Workspace {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`)
  }
  return workspace
}

function buildBackendHostRuntimeContext() {
  return {
    appRootPath: app.isPackaged ? app.getAppPath() : process.cwd(),
    resourcesPath: process.resourcesPath,
    isPackaged: app.isPackaged,
  }
}

/**
 * Validates that a file path is within allowed directories to prevent path traversal attacks.
 * Allowed directories: user's home directory and /tmp
 */
async function validateFilePath(filePath: string): Promise<string> {
  // Normalize the path to resolve . and .. components
  let normalizedPath = normalize(filePath)

  // Expand ~ to home directory
  if (normalizedPath.startsWith('~')) {
    normalizedPath = normalizedPath.replace(/^~/, homedir())
  }

  // Must be an absolute path
  if (!isAbsolute(normalizedPath)) {
    throw new Error('Only absolute file paths are allowed')
  }

  // Resolve symlinks to get the real path
  let realPath: string
  try {
    realPath = await realpath(normalizedPath)
  } catch {
    // File doesn't exist or can't be resolved - use normalized path
    realPath = normalizedPath
  }

  // Define allowed base directories
  const allowedDirs = [
    homedir(),      // User's home directory
    tmpdir(),       // Platform-appropriate temp directory
  ]

  // Check if the real path is within an allowed directory (cross-platform)
  const isAllowed = allowedDirs.some(dir => {
    const normalizedDir = normalize(dir)
    const normalizedReal = normalize(realPath)
    return normalizedReal.startsWith(normalizedDir + sep) || normalizedReal === normalizedDir
  })

  if (!isAllowed) {
    throw new Error('Access denied: file path is outside allowed directories')
  }

  // Block sensitive files even within home directory
  const sensitivePatterns = [
    /\.ssh\//,
    /\.gnupg\//,
    /\.aws\/credentials/,
    /\.env$/,
    /\.env\./,
    /credentials\.json$/,
    /secrets?\./i,
    /\.pem$/,
    /\.key$/,
  ]

  if (sensitivePatterns.some(pattern => pattern.test(realPath))) {
    throw new Error('Access denied: cannot read sensitive files')
  }

  return realPath
}

export function registerIpcHandlers(sessionManager: SessionManager, windowManager: WindowManager): void {
  // Get all sessions for the calling window's workspace
  // Waits for initialization to complete so sessions are never returned empty during startup
  ipcMain.handle(IPC_CHANNELS.GET_SESSIONS, async (event) => {
    try {
      await sessionManager.waitForInit()
    } catch (error) {
      ipcLog.error('GET_SESSIONS continuing after initialization failure:', error)
    }
    const end = perf.start('ipc.getSessions')
    const workspaceId = windowManager.getWorkspaceForWindow(event.sender.id)
    const sessions = sessionManager.getSessions(workspaceId ?? undefined)
    end()
    return sessions
  })

  // Get a single session with messages (for lazy loading)
  ipcMain.handle(IPC_CHANNELS.GET_SESSION_MESSAGES, async (_event, sessionId: string) => {
    const end = perf.start('ipc.getSessionMessages')
    const session = await sessionManager.getSession(sessionId)
    end()
    return session
  })

  // Get workspaces
  ipcMain.handle(IPC_CHANNELS.GET_WORKSPACES, async () => {
    return sessionManager.getWorkspaces()
  })

  // Create a new workspace at a folder path (Obsidian-style: folder IS the workspace)
  ipcMain.handle(IPC_CHANNELS.CREATE_WORKSPACE, async (_event, folderPath: string, name: string) => {
    const rootPath = folderPath
    const workspace = addWorkspace({ name, rootPath })
    // Make it active
    setActiveWorkspace(workspace.id)
    ipcLog.info(`Created workspace "${name}" at ${rootPath}`)
    return workspace
  })

  // Check if a workspace slug already exists (for validation before creation)
  ipcMain.handle(IPC_CHANNELS.CHECK_WORKSPACE_SLUG, async (_event, slug: string) => {
    const defaultWorkspacesDir = join(homedir(), '.craft-agent', 'workspaces')
    const workspacePath = join(defaultWorkspacesDir, slug)
    const exists = existsSync(workspacePath)
    return { exists, path: workspacePath }
  })

  // ============================================================
  // Window Management
  // ============================================================

  // Get workspace ID for the calling window
  ipcMain.handle(IPC_CHANNELS.GET_WINDOW_WORKSPACE, (event) => {
    const workspaceId = windowManager.getWorkspaceForWindow(event.sender.id)
    // Set up ConfigWatcher for live updates (labels, statuses, sources, themes)
    if (workspaceId) {
      const workspace = getWorkspaceByNameOrId(workspaceId)
      if (workspace) {
        sessionManager.setupConfigWatcher(workspace.rootPath, workspaceId)
      }
    }
    return workspaceId
  })

  // Open workspace in new window (or focus existing)
  ipcMain.handle(IPC_CHANNELS.OPEN_WORKSPACE, async (_event, workspaceId: string) => {
    windowManager.focusOrCreateWindow(workspaceId)
  })

  // Open a session in a new window
  ipcMain.handle(IPC_CHANNELS.OPEN_SESSION_IN_NEW_WINDOW, async (_event, workspaceId: string, sessionId: string) => {
    // Build deep link for session navigation
    const deepLink = `craftagents://allSessions/session/${sessionId}`
    windowManager.createWindow({
      workspaceId,
      focused: true,
      initialDeepLink: deepLink,
    })
  })

  // Get mode for the calling window (always 'main' now)
  ipcMain.handle(IPC_CHANNELS.GET_WINDOW_MODE, () => {
    return 'main'
  })

  // Close the calling window (triggers close event which may be intercepted)
  ipcMain.handle(IPC_CHANNELS.CLOSE_WINDOW, (event) => {
    windowManager.closeWindow(event.sender.id)
  })

  // Confirm close - force close the window (bypasses interception).
  // Called by renderer when it has no modals to close and wants to proceed.
  ipcMain.handle(IPC_CHANNELS.WINDOW_CONFIRM_CLOSE, (event) => {
    windowManager.forceCloseWindow(event.sender.id)
  })

  // Show/hide macOS traffic light buttons (for fullscreen overlays)
  ipcMain.handle(IPC_CHANNELS.WINDOW_SET_TRAFFIC_LIGHTS, (event, visible: boolean) => {
    windowManager.setTrafficLightsVisible(event.sender.id, visible)
  })

  // Switch workspace in current window (in-window switching)
  ipcMain.handle(IPC_CHANNELS.SWITCH_WORKSPACE, async (event, workspaceId: string) => {
    const end = perf.start('ipc.switchWorkspace', { workspaceId })

    // Get the old workspace ID before updating
    const oldWorkspaceId = windowManager.getWorkspaceForWindow(event.sender.id)

    // Update the window's workspace mapping
    const updated = windowManager.updateWindowWorkspace(event.sender.id, workspaceId)

    // If update failed, the window may have been re-created (e.g., after refresh)
    // Try to register it
    if (!updated) {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win) {
        windowManager.registerWindow(win, workspaceId)
        windowLog.info(`Re-registered window ${event.sender.id} for workspace ${workspaceId}`)
      }
    }

    // Clear activeViewingSession for old workspace if no other windows are viewing it
    // This ensures read/unread state is correct after workspace switch
    if (oldWorkspaceId && oldWorkspaceId !== workspaceId) {
      const otherWindows = windowManager.getAllWindowsForWorkspace(oldWorkspaceId)
      if (otherWindows.length === 0) {
        sessionManager.clearActiveViewingSession(oldWorkspaceId)
      }
    }

    // Set up ConfigWatcher for the new workspace
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (workspace) {
      sessionManager.setupConfigWatcher(workspace.rootPath, workspaceId)
    }
    end()
  })

  // Create a new session
  ipcMain.handle(IPC_CHANNELS.CREATE_SESSION, async (_event, workspaceId: string, options?: import('../shared/types').CreateSessionOptions) => {
    const end = perf.start('ipc.createSession', { workspaceId })
    const session = sessionManager.createSession(workspaceId, options)
    end()
    return session
  })

  // Create a sub-session under a parent session
  ipcMain.handle(IPC_CHANNELS.CREATE_SUB_SESSION, async (_event, workspaceId: string, parentSessionId: string, options?: import('../shared/types').CreateSessionOptions) => {
    const end = perf.start('ipc.createSubSession', { workspaceId, parentSessionId })
    const session = await sessionManager.createSubSession(workspaceId, parentSessionId, options)
    end()
    return session
  })

  // Delete a session
  ipcMain.handle(IPC_CHANNELS.DELETE_SESSION, async (_event, sessionId: string) => {
    return sessionManager.deleteSession(sessionId)
  })

  // Send a message to a session (with optional file attachments)
  // Note: We intentionally don't await here - the response is streamed via events.
  // The IPC handler returns immediately, and results come through SESSION_EVENT channel.
  // attachments: FileAttachment[] for Claude (has content), storedAttachments: StoredAttachment[] for persistence (has thumbnailBase64)
  ipcMain.handle(IPC_CHANNELS.SEND_MESSAGE, async (event, sessionId: string, message: string, attachments?: FileAttachment[], storedAttachments?: StoredAttachment[], options?: SendMessageOptions) => {
    // Capture the workspace from the calling window for error routing
    const callingWorkspaceId = windowManager.getWorkspaceForWindow(event.sender.id)

    // Start processing in background, errors are sent via event stream
    sessionManager.sendMessage(sessionId, message, attachments, storedAttachments, options).catch(err => {
      ipcLog.error('Error in sendMessage:', err)
      // Send error to renderer so user sees it (route to correct window)
      const window = callingWorkspaceId
        ? windowManager.getWindowByWorkspace(callingWorkspaceId)
        : BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
      // Check mainFrame - it becomes null when render frame is disposed
      if (window && !window.isDestroyed() && !window.webContents.isDestroyed() && window.webContents.mainFrame) {
        window.webContents.send(IPC_CHANNELS.SESSION_EVENT, {
          type: 'error',
          sessionId,
          error: err instanceof Error ? err.message : 'Unknown error'
        })
        // Also send complete event to clear processing state
        window.webContents.send(IPC_CHANNELS.SESSION_EVENT, {
          type: 'complete',
          sessionId
        })
      }
    })
    // Return immediately - streaming results come via SESSION_EVENT
    return { started: true }
  })

  // Cancel processing
  ipcMain.handle(IPC_CHANNELS.CANCEL_PROCESSING, async (_event, sessionId: string, silent?: boolean) => {
    return sessionManager.cancelProcessing(sessionId, silent)
  })

  // Kill background shell
  ipcMain.handle(IPC_CHANNELS.KILL_SHELL, async (_event, sessionId: string, shellId: string) => {
    return sessionManager.killShell(sessionId, shellId)
  })

  // Get background task output
  ipcMain.handle(IPC_CHANNELS.GET_TASK_OUTPUT, async (_event, taskId: string) => {
    try {
      const output = await sessionManager.getTaskOutput(taskId)
      return output
    } catch (err) {
      ipcLog.error('Failed to get task output:', err)
      throw err
    }
  })

  // Respond to a permission request (bash command approval)
  // Returns true if the response was delivered, false if agent/session is gone
  ipcMain.handle(IPC_CHANNELS.RESPOND_TO_PERMISSION, async (_event, sessionId: string, requestId: string, allowed: boolean, alwaysAllow: boolean) => {
    return sessionManager.respondToPermission(sessionId, requestId, allowed, alwaysAllow)
  })

  // Respond to a credential request (secure auth input)
  // Returns true if the response was delivered, false if agent/session is gone
  ipcMain.handle(IPC_CHANNELS.RESPOND_TO_CREDENTIAL, async (_event, sessionId: string, requestId: string, response: import('../shared/types').CredentialResponse) => {
    return sessionManager.respondToCredential(sessionId, requestId, response)
  })

  // ==========================================================================
  // Consolidated Command Handlers
  // ==========================================================================

  // Session commands - consolidated handler for session operations
  ipcMain.handle(IPC_CHANNELS.SESSION_COMMAND, async (
    _event,
    sessionId: string,
    command: import('../shared/types').SessionCommand
  ) => {
    switch (command.type) {
      case 'flag':
        return sessionManager.flagSession(sessionId)
      case 'unflag':
        return sessionManager.unflagSession(sessionId)
      case 'archive':
        return sessionManager.archiveSession(sessionId)
      case 'unarchive':
        return sessionManager.unarchiveSession(sessionId)
      case 'rename':
        return sessionManager.renameSession(sessionId, command.name)
      case 'setSessionStatus':
        return sessionManager.setSessionStatus(sessionId, command.state)
      case 'markRead':
        return sessionManager.markSessionRead(sessionId)
      case 'markUnread':
        return sessionManager.markSessionUnread(sessionId)
      case 'setActiveViewing':
        // Track which session user is actively viewing (for unread state machine)
        return sessionManager.setActiveViewingSession(sessionId, command.workspaceId)
      case 'setPermissionMode':
        return sessionManager.setSessionPermissionMode(sessionId, command.mode)
      case 'setThinkingLevel':
        // Validate thinking level before passing to session manager
        if (!isValidThinkingLevel(command.level)) {
          throw new Error(`Invalid thinking level: ${command.level}. Valid values: 'off', 'think', 'max'`)
        }
        return sessionManager.setSessionThinkingLevel(sessionId, command.level)
      case 'updateWorkingDirectory':
        return sessionManager.updateWorkingDirectory(sessionId, command.dir)
      case 'setSources':
        return sessionManager.setSessionSources(sessionId, command.sourceSlugs)
      case 'setLabels':
        return sessionManager.setSessionLabels(sessionId, command.labels)
      case 'showInFinder': {
        const sessionPath = sessionManager.getSessionPath(sessionId)
        if (sessionPath) {
          shell.showItemInFolder(sessionPath)
        }
        return
      }
      case 'copyPath': {
        // Return the session folder path for copying to clipboard
        const sessionPath = sessionManager.getSessionPath(sessionId)
        return sessionPath ? { success: true, path: sessionPath } : { success: false }
      }
      case 'shareToViewer':
        return sessionManager.shareToViewer(sessionId)
      case 'updateShare':
        return sessionManager.updateShare(sessionId)
      case 'revokeShare':
        return sessionManager.revokeShare(sessionId)
      case 'startOAuth':
        return sessionManager.startSessionOAuth(sessionId, command.requestId)
      case 'refreshTitle':
        ipcLog.info(`IPC: refreshTitle received for session ${sessionId}`)
        return sessionManager.refreshTitle(sessionId)
      // Connection selection (locked after first message)
      case 'setConnection':
        ipcLog.info(`IPC: setConnection received for session ${sessionId}, connection: ${command.connectionSlug}`)
        return sessionManager.setSessionConnection(sessionId, command.connectionSlug)
      // Pending plan execution (Accept & Compact flow)
      case 'setPendingPlanExecution':
        return sessionManager.setPendingPlanExecution(sessionId, command.planPath)
      case 'markCompactionComplete':
        return sessionManager.markCompactionComplete(sessionId)
      case 'clearPendingPlanExecution':
        return sessionManager.clearPendingPlanExecution(sessionId)
      // Sub-session hierarchy
      case 'getSessionFamily':
        return sessionManager.getSessionFamily(sessionId)
      case 'updateSiblingOrder':
        return sessionManager.updateSiblingOrder(command.orderedSessionIds)
      case 'archiveCascade':
        return sessionManager.archiveSessionCascade(sessionId)
      case 'deleteCascade':
        return sessionManager.deleteSessionCascade(sessionId)
      default: {
        const _exhaustive: never = command
        throw new Error(`Unknown session command: ${JSON.stringify(command)}`)
      }
    }
  })

  // Get pending plan execution state (for reload recovery)
  ipcMain.handle(IPC_CHANNELS.GET_PENDING_PLAN_EXECUTION, async (
    _event,
    sessionId: string
  ) => {
    return sessionManager.getPendingPlanExecution(sessionId)
  })

  // Read a file (with path validation to prevent traversal attacks)
  ipcMain.handle(IPC_CHANNELS.READ_FILE, async (_event, path: string) => {
    try {
      // Validate and normalize the path
      const safePath = await validateFilePath(path)
      const content = await readFile(safePath, 'utf-8')
      return content
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      // ENOENT is expected for optional config files (e.g. automations.json)
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        ipcLog.debug('readFile: file not found:', path)
      } else {
        ipcLog.error('readFile error:', message)
      }
      throw new Error(`Failed to read file: ${message}`)
    }
  })

  // Read a file as a data URL for in-app binary preview (images).
  // Returns data:{mime};base64,{content} — used by ImagePreviewOverlay.
  // Note: PDFs use file:// URLs directly (Chromium's PDF viewer doesn't support data: URLs).
  ipcMain.handle(IPC_CHANNELS.READ_FILE_DATA_URL, async (_event, path: string) => {
    try {
      const safePath = await validateFilePath(path)
      const buffer = await readFile(safePath)
      const ext = safePath.split('.').pop()?.toLowerCase() ?? ''

      // Map extensions to MIME types (only formats Chromium can render in-app).
      // HEIC/HEIF and TIFF are excluded — no Chromium codec, opened externally instead.
      const mimeMap: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        svg: 'image/svg+xml',
        bmp: 'image/bmp',
        ico: 'image/x-icon',
        avif: 'image/avif',
        pdf: 'application/pdf',
      }
      const mime = mimeMap[ext] || 'application/octet-stream'
      const base64 = buffer.toString('base64')
      return `data:${mime};base64,${base64}`
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      ipcLog.error('readFileDataUrl error:', message)
      throw new Error(`Failed to read file as data URL: ${message}`)
    }
  })

  // Read a file as raw binary (Uint8Array) for react-pdf.
  // Returns Uint8Array which IPC automatically converts to ArrayBuffer for the renderer.
  ipcMain.handle(IPC_CHANNELS.READ_FILE_BINARY, async (_event, path: string) => {
    try {
      const safePath = await validateFilePath(path)
      const buffer = await readFile(safePath)
      // Return as Uint8Array (serializes to ArrayBuffer over IPC)
      return new Uint8Array(buffer)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      ipcLog.error('readFileBinary error:', message)
      throw new Error(`Failed to read file as binary: ${message}`)
    }
  })

  // Open native file dialog for selecting files to attach
  ipcMain.handle(IPC_CHANNELS.OPEN_FILE_DIALOG, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        // Allow all files by default - the agent can figure out how to handle them
        { name: 'All Files', extensions: ['*'] },
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'ico', 'icns', 'heic', 'heif', 'svg'] },
        { name: 'Documents', extensions: ['pdf', 'docx', 'xlsx', 'pptx', 'doc', 'xls', 'ppt', 'txt', 'md', 'rtf'] },
        { name: 'Code', extensions: ['js', 'ts', 'tsx', 'jsx', 'py', 'json', 'css', 'html', 'xml', 'yaml', 'yml', 'sh', 'sql', 'go', 'rs', 'rb', 'php', 'java', 'c', 'cpp', 'h', 'swift', 'kt'] },
      ]
    })
    return result.canceled ? [] : result.filePaths
  })

  // Read file and return as FileAttachment with Quick Look thumbnail
  ipcMain.handle(IPC_CHANNELS.READ_FILE_ATTACHMENT, async (_event, path: string) => {
    try {
      // Validate path first to prevent path traversal
      const safePath = await validateFilePath(path)
      // Use shared utility that handles file type detection, encoding, etc.
      const attachment = await readFileAttachment(safePath)
      if (!attachment) return null

      // Generate Quick Look thumbnail for preview (works for images, PDFs, Office docs on macOS)
      try {
        const thumbnail = await nativeImage.createThumbnailFromPath(safePath, { width: 200, height: 200 })
        if (!thumbnail.isEmpty()) {
          ;(attachment as { thumbnailBase64?: string }).thumbnailBase64 = thumbnail.toPNG().toString('base64')
        }
      } catch (thumbError) {
        // Thumbnail generation failed - this is ok, we'll show an icon fallback
        ipcLog.info('Quick Look thumbnail failed (using fallback):', thumbError instanceof Error ? thumbError.message : thumbError)
      }

      return attachment
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      ipcLog.error('readFileAttachment error:', message)
      return null
    }
  })

  // Generate thumbnail from base64 data (for drag-drop files where we don't have a path)
  ipcMain.handle(IPC_CHANNELS.GENERATE_THUMBNAIL, async (_event, base64: string, mimeType: string): Promise<string | null> => {
    // Save to temp file, generate thumbnail, clean up
    const tempDir = tmpdir()
    const ext = mimeType.split('/')[1] || 'bin'
    const tempPath = join(tempDir, `craft-thumb-${randomUUID()}.${ext}`)

    try {
      // Write base64 to temp file
      const buffer = Buffer.from(base64, 'base64')
      await writeFile(tempPath, buffer)

      // Generate thumbnail using Quick Look
      const thumbnail = await nativeImage.createThumbnailFromPath(tempPath, { width: 200, height: 200 })

      // Clean up temp file
      await unlink(tempPath).catch(() => {})

      if (!thumbnail.isEmpty()) {
        return thumbnail.toPNG().toString('base64')
      }
      return null
    } catch (error) {
      // Clean up temp file on error
      await unlink(tempPath).catch(() => {})
      ipcLog.info('generateThumbnail failed:', error instanceof Error ? error.message : error)
      return null
    }
  })

  // Store an attachment to disk and generate thumbnail/markdown conversion
  // This is the core of the persistent file attachment system
  ipcMain.handle(IPC_CHANNELS.STORE_ATTACHMENT, async (event, sessionId: string, attachment: FileAttachment): Promise<StoredAttachment> => {
    // Track files we've written for cleanup on error
    const filesToCleanup: string[] = []

    try {
      // Reject empty files early
      if (attachment.size === 0) {
        throw new Error('Cannot attach empty file')
      }

      // Get workspace slug from the calling window
      const workspaceId = windowManager.getWorkspaceForWindow(event.sender.id)
      if (!workspaceId) {
        throw new Error('Cannot determine workspace for attachment storage')
      }
      const workspace = getWorkspaceByNameOrId(workspaceId)
      if (!workspace) {
        throw new Error(`Workspace not found: ${workspaceId}`)
      }
      const workspaceRootPath = workspace.rootPath

      // SECURITY: Validate sessionId to prevent path traversal attacks
      // This must happen before using sessionId in any file path operations
      validateSessionId(sessionId)

      // Create attachments directory if it doesn't exist
      const attachmentsDir = getSessionAttachmentsPath(workspaceRootPath, sessionId)
      await mkdir(attachmentsDir, { recursive: true })

      // Generate unique ID for this attachment
      const id = randomUUID()
      const safeName = sanitizeFilename(attachment.name)
      const storedFileName = `${id}_${safeName}`
      const storedPath = join(attachmentsDir, storedFileName)

      // Track if image was resized (for return value)
      let wasResized = false
      let finalSize = attachment.size
      let resizedBase64: string | undefined

      // 1. Save the file (with image validation and resizing)
      if (attachment.base64) {
        // Images, PDFs, Office files - decode from base64
        // Type as Buffer (generic) to allow reassignment from nativeImage.toJPEG/toPNG
        let decoded: Buffer = Buffer.from(attachment.base64, 'base64')
        // Validate decoded size matches expected (allow small variance for encoding overhead)
        if (Math.abs(decoded.length - attachment.size) > 100) {
          throw new Error(`Attachment corrupted: size mismatch (expected ${attachment.size}, got ${decoded.length})`)
        }

        // For images: validate and resize if needed for Claude API compatibility
        if (attachment.type === 'image') {
          // Get image dimensions using nativeImage
          const image = nativeImage.createFromBuffer(decoded)
          const imageSize = image.getSize()

          // Validate image for Claude API
          const validation = validateImageForClaudeAPI(decoded.length, imageSize.width, imageSize.height)

          // Determine if we should resize
          let shouldResize = validation.needsResize
          let targetSize = validation.suggestedSize

          if (!validation.valid && validation.errorCode === 'dimension_exceeded') {
            // Image exceeds 8000px limit - calculate resize to fit within limits
            const maxDim = IMAGE_LIMITS.MAX_DIMENSION
            const scale = Math.min(maxDim / imageSize.width, maxDim / imageSize.height)
            targetSize = {
              width: Math.floor(imageSize.width * scale),
              height: Math.floor(imageSize.height * scale),
            }
            shouldResize = true
            ipcLog.info(`Image exceeds ${maxDim}px limit (${imageSize.width}×${imageSize.height}), will resize to ${targetSize.width}×${targetSize.height}`)
          } else if (!validation.valid) {
            // Other validation errors (e.g., file size > 5MB) - reject
            throw new Error(validation.error)
          }

          // If resize is needed (either recommended or required), do it now
          if (shouldResize && targetSize) {
            ipcLog.info(`Resizing image from ${imageSize.width}×${imageSize.height} to ${targetSize.width}×${targetSize.height}`)

            try {
              const resized = image.resize({
                width: targetSize.width,
                height: targetSize.height,
                quality: 'best',
              })

              // Get as PNG for best quality (or JPEG for photos to save space)
              const isPhoto = attachment.mimeType === 'image/jpeg'
              decoded = isPhoto ? resized.toJPEG(IMAGE_LIMITS.JPEG_QUALITY_HIGH) : resized.toPNG()
              wasResized = true
              finalSize = decoded.length

              // Re-validate final size after resize (should be much smaller)
              if (decoded.length > IMAGE_LIMITS.MAX_SIZE) {
                // Even after resize it's too big - try more aggressive compression
                decoded = resized.toJPEG(IMAGE_LIMITS.JPEG_QUALITY_FALLBACK)
                finalSize = decoded.length
                if (decoded.length > IMAGE_LIMITS.MAX_SIZE) {
                  throw new Error(`Image still too large after resize (${(decoded.length / 1024 / 1024).toFixed(1)}MB). Please use a smaller image.`)
                }
              }

              ipcLog.info(`Image resized: ${attachment.size} → ${finalSize} bytes (${Math.round((1 - finalSize / attachment.size) * 100)}% reduction)`)

              // Store resized base64 to return to renderer
              // This is used when sending to Claude API instead of original large base64
              resizedBase64 = decoded.toString('base64')
            } catch (resizeError) {
              ipcLog.error('Image resize failed:', resizeError)
              const reason = resizeError instanceof Error ? resizeError.message : String(resizeError)
              throw new Error(`Image too large (${imageSize.width}×${imageSize.height}) and automatic resize failed: ${reason}. Please manually resize it before attaching.`)
            }
          }
        }

        await writeFile(storedPath, decoded)
        filesToCleanup.push(storedPath)
      } else if (attachment.text) {
        // Text files - save as UTF-8
        await writeFile(storedPath, attachment.text, 'utf-8')
        filesToCleanup.push(storedPath)
      } else {
        throw new Error('Attachment has no content (neither base64 nor text)')
      }

      // 2. Generate thumbnail using native OS APIs (Quick Look on macOS, Shell handlers on Windows)
      let thumbnailPath: string | undefined
      let thumbnailBase64: string | undefined
      const thumbFileName = `${id}_thumb.png`
      const thumbPath = join(attachmentsDir, thumbFileName)
      try {
        const thumbnail = await nativeImage.createThumbnailFromPath(storedPath, { width: 200, height: 200 })
        if (!thumbnail.isEmpty()) {
          const pngBuffer = thumbnail.toPNG()
          await writeFile(thumbPath, pngBuffer)
          thumbnailPath = thumbPath
          thumbnailBase64 = pngBuffer.toString('base64')
          filesToCleanup.push(thumbPath)
        }
      } catch (thumbError) {
        // Thumbnail generation failed - this is ok, we'll show an icon fallback
        ipcLog.info('Thumbnail generation failed (using fallback):', thumbError instanceof Error ? thumbError.message : thumbError)
      }

      // 3. Convert Office files to markdown (for sending to Claude)
      // This is required for Office files - Claude can't read raw Office binary
      let markdownPath: string | undefined
      if (attachment.type === 'office') {
        const mdFileName = `${id}_${safeName}.md`
        const mdPath = join(attachmentsDir, mdFileName)
        try {
          const markitdown = new MarkItDown()
          const result = await markitdown.convert(storedPath)
          if (!result || !result.textContent) {
            throw new Error('Conversion returned empty result')
          }
          await writeFile(mdPath, result.textContent, 'utf-8')
          markdownPath = mdPath
          filesToCleanup.push(mdPath)
          ipcLog.info(`Converted Office file to markdown: ${mdPath}`)
        } catch (convertError) {
          // Conversion failed - throw so user knows the file can't be processed
          // Claude can't read raw Office binary, so a failed conversion = unusable file
          const errorMsg = convertError instanceof Error ? convertError.message : String(convertError)
          ipcLog.error('Office to markdown conversion failed:', errorMsg)
          throw new Error(`Failed to convert "${attachment.name}" to readable format: ${errorMsg}`)
        }
      }

      // Return StoredAttachment metadata
      // Include wasResized flag so UI can show notification
      // Include resizedBase64 so renderer uses resized image for Claude API
      return {
        id,
        type: attachment.type,
        name: attachment.name,
        mimeType: attachment.mimeType,
        size: finalSize, // Use final size (may differ if resized)
        originalSize: wasResized ? attachment.size : undefined, // Track original if resized
        storedPath,
        thumbnailPath,
        thumbnailBase64,
        markdownPath,
        wasResized,
        resizedBase64, // Only set when wasResized=true, used for Claude API
      }
    } catch (error) {
      // Clean up any files we've written before the error
      if (filesToCleanup.length > 0) {
        ipcLog.info(`Cleaning up ${filesToCleanup.length} orphaned file(s) after storage error`)
        await Promise.all(filesToCleanup.map(f => unlink(f).catch(() => {})))
      }

      const message = error instanceof Error ? error.message : 'Unknown error'
      ipcLog.error('storeAttachment error:', message)
      throw new Error(`Failed to store attachment: ${message}`)
    }
  })

  // Get system theme preference (dark = true, light = false)
  ipcMain.handle(IPC_CHANNELS.GET_SYSTEM_THEME, () => {
    return nativeTheme.shouldUseDarkColors
  })

  // Get user's home directory
  ipcMain.handle(IPC_CHANNELS.GET_HOME_DIR, () => {
    return homedir()
  })

  // Check if running in debug mode (from source)
  ipcMain.handle(IPC_CHANNELS.IS_DEBUG_MODE, () => {
    return !app.isPackaged
  })

  // Release notes
  ipcMain.handle(IPC_CHANNELS.GET_RELEASE_NOTES, () => {
    const { getCombinedReleaseNotes } = require('@craft-agent/shared/release-notes') as typeof import('@craft-agent/shared/release-notes')
    return getCombinedReleaseNotes()
  })

  ipcMain.handle(IPC_CHANNELS.GET_LATEST_RELEASE_VERSION, () => {
    const { getLatestReleaseVersion } = require('@craft-agent/shared/release-notes') as typeof import('@craft-agent/shared/release-notes')
    return getLatestReleaseVersion()
  })

  // Get git branch for a directory (returns null if not a git repo or git unavailable)
  ipcMain.handle(IPC_CHANNELS.GET_GIT_BRANCH, (_event, dirPath: string) => {
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
  ipcMain.handle(IPC_CHANNELS.GITBASH_CHECK, async () => {
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

  ipcMain.handle(IPC_CHANNELS.GITBASH_BROWSE, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
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

  ipcMain.handle(IPC_CHANNELS.GITBASH_SET_PATH, async (_event, bashPath: string) => {
    const validation = await validateGitBashPath(bashPath)
    if (!validation.valid) {
      return { success: false, error: validation.error }
    }

    // Persist to config and set env var so SDK subprocess can find Git Bash
    setGitBashPath(validation.path)
    process.env.CLAUDE_CODE_GIT_BASH_PATH = validation.path
    return { success: true }
  })

  // Debug logging from renderer → main log file (fire-and-forget, no response)
  ipcMain.on(IPC_CHANNELS.DEBUG_LOG, (_event, ...args: unknown[]) => {
    ipcLog.info('[renderer]', ...args)
  })

  // Filesystem search for @ mention file selection.
  // Parallel BFS walk that skips ignored directories BEFORE entering them,
  // avoiding reading node_modules/etc. contents entirely. Uses withFileTypes
  // to get entry types without separate stat calls.
  ipcMain.handle(IPC_CHANNELS.FS_SEARCH, async (_event, basePath: string, query: string) => {
    ipcLog.info('[FS_SEARCH] called:', basePath, query)
    const MAX_RESULTS = 50

    // Directories to never recurse into
    const SKIP_DIRS = new Set([
      'node_modules', '.git', '.svn', '.hg', 'dist', 'build',
      '.next', '.nuxt', '.cache', '__pycache__', 'vendor',
      '.idea', '.vscode', 'coverage', '.nyc_output', '.turbo', 'out',
    ])

    const lowerQuery = query.toLowerCase()
    const results: Array<{ name: string; path: string; type: 'file' | 'directory'; relativePath: string }> = []

    try {
      // BFS queue: each entry is a relative path prefix ('' for root)
      let queue = ['']

      while (queue.length > 0 && results.length < MAX_RESULTS) {
        // Process current level: read all directories in parallel
        const nextQueue: string[] = []

        const dirResults = await Promise.all(
          queue.map(async (relDir) => {
            const absDir = relDir ? join(basePath, relDir) : basePath
            try {
              return { relDir, entries: await readdir(absDir, { withFileTypes: true }) }
            } catch {
              // Skip dirs we can't read (permissions, broken symlinks, etc.)
              return { relDir, entries: [] as import('fs').Dirent[] }
            }
          })
        )

        for (const { relDir, entries } of dirResults) {
          if (results.length >= MAX_RESULTS) break

          for (const entry of entries) {
            if (results.length >= MAX_RESULTS) break

            const name = entry.name
            // Skip hidden files/dirs and ignored directories
            if (name.startsWith('.') || SKIP_DIRS.has(name)) continue

            const relativePath = relDir ? `${relDir}/${name}` : name
            const isDir = entry.isDirectory()

            // Queue subdirectories for next BFS level
            if (isDir) {
              nextQueue.push(relativePath)
            }

            // Check if name or path matches the query
            const lowerName = name.toLowerCase()
            const lowerRelative = relativePath.toLowerCase()
            if (lowerName.includes(lowerQuery) || lowerRelative.includes(lowerQuery)) {
              results.push({
                name,
                path: join(basePath, relativePath),
                type: isDir ? 'directory' : 'file',
                relativePath,
              })
            }
          }
        }

        queue = nextQueue
      }

      // Sort: directories first, then by name length (shorter = better match)
      results.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
        return a.name.length - b.name.length
      })

      ipcLog.info('[FS_SEARCH] returning', results.length, 'results')
      return results
    } catch (err) {
      ipcLog.error('[FS_SEARCH] error:', err)
      return []
    }
  })

  // Auto-update handlers
  // Manual check from UI - don't auto-download (user might be on metered connection)
  ipcMain.handle(IPC_CHANNELS.UPDATE_CHECK, async () => {
    const { checkForUpdates } = await import('./auto-update')
    return checkForUpdates({ autoDownload: false })
  })

  ipcMain.handle(IPC_CHANNELS.UPDATE_GET_INFO, async () => {
    const { getUpdateInfo } = await import('./auto-update')
    return getUpdateInfo()
  })

  ipcMain.handle(IPC_CHANNELS.UPDATE_INSTALL, async () => {
    const { installUpdate } = await import('./auto-update')
    return installUpdate()
  })

  // Dismiss update for this version (persists across restarts)
  ipcMain.handle(IPC_CHANNELS.UPDATE_DISMISS, async (_event, version: string) => {
    const { setDismissedUpdateVersion } = await import('@craft-agent/shared/config')
    setDismissedUpdateVersion(version)
  })

  // Get dismissed version
  ipcMain.handle(IPC_CHANNELS.UPDATE_GET_DISMISSED, async () => {
    const { getDismissedUpdateVersion } = await import('@craft-agent/shared/config')
    return getDismissedUpdateVersion()
  })

  // Shell operations - open URL in external browser (or handle craftagents:// internally)
  ipcMain.handle(IPC_CHANNELS.OPEN_URL, async (_event, url: string) => {
    ipcLog.info('[OPEN_URL] Received request:', url)
    try {
      // Validate URL format
      const parsed = new URL(url)

      // Handle craftagents:// URLs internally via deep link handler
      // This ensures ?window= params work correctly for "Open in New Window"
      if (parsed.protocol === 'craftagents:') {
        ipcLog.info('[OPEN_URL] Handling as deep link')
        const { handleDeepLink } = await import('./deep-link')
        const result = await handleDeepLink(url, windowManager)
        ipcLog.info('[OPEN_URL] Deep link result:', result)
        return
      }

      // External URLs - open in default browser
      if (!['http:', 'https:', 'mailto:', 'craftdocs:'].includes(parsed.protocol)) {
        throw new Error('Only http, https, mailto, craftdocs URLs are allowed')
      }
      await shell.openExternal(url)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      ipcLog.error('openUrl error:', message)
      throw new Error(`Failed to open URL: ${message}`)
    }
  })

  // Shell operations - open file in default application
  ipcMain.handle(IPC_CHANNELS.OPEN_FILE, async (_event, path: string) => {
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
      ipcLog.error('openFile error:', message)
      throw new Error(`Failed to open file: ${message}`)
    }
  })

  // Shell operations - show file in folder (opens Finder/Explorer with file selected)
  ipcMain.handle(IPC_CHANNELS.SHOW_IN_FOLDER, async (_event, path: string) => {
    try {
      // Resolve relative paths to absolute before validation
      const absolutePath = resolve(path)
      // Validate path is within allowed directories
      const safePath = await validateFilePath(absolutePath)
      shell.showItemInFolder(safePath)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      ipcLog.error('showInFolder error:', message)
      throw new Error(`Failed to show in folder: ${message}`)
    }
  })

  // Menu actions from renderer (for unified Craft menu)
  ipcMain.handle(IPC_CHANNELS.MENU_QUIT, () => {
    app.quit()
  })

  // New Window: create a new window for the current workspace
  ipcMain.handle(IPC_CHANNELS.MENU_NEW_WINDOW, (event) => {
    const workspaceId = windowManager.getWorkspaceForWindow(event.sender.id)
    if (workspaceId) {
      windowManager.createWindow({ workspaceId })
    }
  })

  ipcMain.handle(IPC_CHANNELS.MENU_MINIMIZE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.minimize()
  })

  ipcMain.handle(IPC_CHANNELS.MENU_MAXIMIZE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize()
      } else {
        win.maximize()
      }
    }
  })

  ipcMain.handle(IPC_CHANNELS.MENU_ZOOM_IN, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      const currentZoom = win.webContents.getZoomFactor()
      win.webContents.setZoomFactor(Math.min(currentZoom + 0.1, 3.0))
    }
  })

  ipcMain.handle(IPC_CHANNELS.MENU_ZOOM_OUT, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      const currentZoom = win.webContents.getZoomFactor()
      win.webContents.setZoomFactor(Math.max(currentZoom - 0.1, 0.5))
    }
  })

  ipcMain.handle(IPC_CHANNELS.MENU_ZOOM_RESET, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.webContents.setZoomFactor(1.0)
  })

  ipcMain.handle(IPC_CHANNELS.MENU_TOGGLE_DEVTOOLS, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.webContents.toggleDevTools()
  })

  ipcMain.handle(IPC_CHANNELS.MENU_UNDO, (event) => {
    event.sender.undo()
  })

  ipcMain.handle(IPC_CHANNELS.MENU_REDO, (event) => {
    event.sender.redo()
  })

  ipcMain.handle(IPC_CHANNELS.MENU_CUT, (event) => {
    event.sender.cut()
  })

  ipcMain.handle(IPC_CHANNELS.MENU_COPY, (event) => {
    event.sender.copy()
  })

  ipcMain.handle(IPC_CHANNELS.MENU_PASTE, (event) => {
    event.sender.paste()
  })

  ipcMain.handle(IPC_CHANNELS.MENU_SELECT_ALL, (event) => {
    event.sender.selectAll()
  })

  // Show logout confirmation dialog
  ipcMain.handle(IPC_CHANNELS.SHOW_LOGOUT_CONFIRMATION, async () => {
    const window = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    const result = await dialog.showMessageBox(window, {
      type: 'warning',
      buttons: ['Cancel', 'Log Out'],
      defaultId: 0,
      cancelId: 0,
      title: 'Log Out',
      message: 'Are you sure you want to log out?',
      detail: 'All conversations will be deleted. This action cannot be undone.',
    } as Electron.MessageBoxOptions)
    // result.response is the index of the clicked button
    // 0 = Cancel, 1 = Log Out
    return result.response === 1
  })

  // Show delete session confirmation dialog
  ipcMain.handle(IPC_CHANNELS.SHOW_DELETE_SESSION_CONFIRMATION, async (_event, name: string) => {
    const window = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    const result = await dialog.showMessageBox(window, {
      type: 'warning',
      buttons: ['Cancel', 'Delete'],
      defaultId: 0,
      cancelId: 0,
      title: 'Delete Conversation',
      message: `Are you sure you want to delete: "${name}"?`,
      detail: 'This action cannot be undone.',
    } as Electron.MessageBoxOptions)
    // result.response is the index of the clicked button
    // 0 = Cancel, 1 = Delete
    return result.response === 1
  })

  // Logout - clear all credentials and config
  ipcMain.handle(IPC_CHANNELS.LOGOUT, async () => {
    try {
      const manager = getCredentialManager()

      // List and delete all stored credentials
      const allCredentials = await manager.list()
      for (const credId of allCredentials) {
        await manager.delete(credId)
      }

      // Delete the config file
      const configPath = join(homedir(), '.craft-agent', 'config.json')
      await unlink(configPath).catch(() => {
        // Ignore if file doesn't exist
      })

      ipcLog.info('Logout complete - cleared all credentials and config')
    } catch (error) {
      ipcLog.error('Logout error:', error)
      throw error
    }
  })

  // Credential health check - validates credential store is readable and usable
  // Called on app startup to detect corruption, machine migration, or missing credentials
  ipcMain.handle(IPC_CHANNELS.CREDENTIAL_HEALTH_CHECK, async () => {
    const manager = getCredentialManager()
    return manager.checkHealth()
  })

  // Unified handler for LLM connection setup
  ipcMain.handle(IPC_CHANNELS.SETUP_LLM_CONNECTION, async (_event, setup: LlmConnectionSetup): Promise<{ success: boolean; error?: string }> => {
    try {
      const manager = getCredentialManager()

      // Ensure connection exists in config
      let connection = getLlmConnection(setup.slug)
      let isNewConnection = false
      if (!connection) {
        // Create connection with appropriate defaults based on slug
        connection = createBuiltInConnection(setup.slug, setup.baseUrl)
        isNewConnection = true
      }

      const updates: Partial<LlmConnection> = {}
      const hasCustomEndpoint = !!setup.baseUrl
      if (setup.baseUrl !== undefined) {
        updates.baseUrl = setup.baseUrl ?? undefined

        // Only mutate providerType for API key connections (not OAuth connections)
        if (isAnthropicProvider(connection.providerType) && connection.authType !== 'oauth') {
          const pt = hasCustomEndpoint ? 'anthropic_compat' as const : 'anthropic' as const
          updates.providerType = pt
          updates.authType = hasCustomEndpoint ? 'api_key_with_endpoint' : 'api_key'
          if (!hasCustomEndpoint) {
            updates.models = getDefaultModelsForConnection(pt)
            updates.defaultModel = getDefaultModelForConnection(pt)
          }
        }

        // Pi API key flow: store baseUrl on the connection (Pi SDK doesn't use it yet,
        // but it's persisted for future backend support)

      }

      if (setup.defaultModel !== undefined) {
        updates.defaultModel = setup.defaultModel ?? undefined
      }
      if (setup.models !== undefined) {
        updates.models = setup.models ?? undefined
      }
      // Pi API key flow: set piAuthProvider from setup data (e.g. 'anthropic', 'google', 'openai')
      if (setup.piAuthProvider) {
        updates.piAuthProvider = setup.piAuthProvider
        // Update connection name to show the actual provider (e.g. "Craft Agents Backend (Google AI Studio)")
        const providerName = piAuthProviderDisplayName(setup.piAuthProvider)
        if (providerName) {
          updates.name = `Craft Agents Backend (${providerName})`
        }
        // Only set default models when using standard Pi provider AND user didn't pick explicit models
        if (!hasCustomEndpoint && !setup.models?.length) {
          updates.models = getDefaultModelsForConnection('pi', setup.piAuthProvider)
          updates.defaultModel = getDefaultModelForConnection('pi', setup.piAuthProvider)
        }
      }

      const pendingConnection: LlmConnection = {
        ...connection,
        ...updates,
      }

      if (updates.models && updates.models.length > 0) {
        const validation = validateModelList(updates.models, pendingConnection.defaultModel)
        if (!validation.valid) {
          return { success: false, error: validation.error }
        }
        if (validation.resolvedDefaultModel) {
          pendingConnection.defaultModel = validation.resolvedDefaultModel
          updates.defaultModel = validation.resolvedDefaultModel
        }
      }

      if (isCompatProvider(pendingConnection.providerType) && !pendingConnection.defaultModel) {
        return { success: false, error: 'Default model is required for compatible endpoints.' }
      }

      if (isNewConnection) {
        addLlmConnection(pendingConnection)
        ipcLog.info(`Created LLM connection: ${setup.slug}`)
      } else if (Object.keys(updates).length > 0) {
        updateLlmConnection(setup.slug, updates)
        ipcLog.info(`Updated LLM connection settings: ${setup.slug}`)
      }

      // Store credential if provided
      if (setup.credential) {
        const authType = pendingConnection.authType
        if (authType === 'oauth') {
          await manager.setLlmOAuth(setup.slug, { accessToken: setup.credential })
          ipcLog.info('Saved OAuth access token to LLM connection')
        } else {
          await manager.setLlmApiKey(setup.slug, setup.credential)
          ipcLog.info('Saved API key to LLM connection')
        }
      }

      // Set as default only if no default exists yet (first connection)
      if (!getDefaultLlmConnection()) {
        setDefaultLlmConnection(setup.slug)
        ipcLog.info(`Set default LLM connection: ${setup.slug}`)
      }

      // Fetch available models (non-blocking — validation will also trigger refresh)
      // Skip when user explicitly provided models (tier selection) to avoid overwriting their choices
      if (!setup.models?.length) {
        getModelRefreshService().refreshNow(setup.slug).catch(err => {
          ipcLog.warn(`Model refresh after setup failed for ${setup.slug}: ${err instanceof Error ? err.message : err}`)
        })
      }

      // Reinitialize auth with the newly-created connection's slug
      // (not the default, which may be a different connection)
      const authSlug = getDefaultLlmConnection() || setup.slug
      await sessionManager.reinitializeAuth(authSlug)
      ipcLog.info('Reinitialized auth after LLM connection setup')

      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      ipcLog.error('Failed to setup LLM connection:', message)
      return { success: false, error: message }
    }
  })

  // Unified connection test — uses the agent factory to spawn a real agent subprocess
  // and validate credentials via runMiniCompletion(). Same code path as actual chat.
  //
  // TODO: Complex auth providers (Amazon Bedrock, Azure OpenAI, Google Vertex)
  // These need multi-field credential forms (AWS IAM keys, Azure resource name, etc.)
  // and provider-specific BackendConfig setup. See PI_EXCLUDED_PROVIDERS in models.ts.
  //
  // TODO: OAuth providers (Copilot, ChatGPT, Claude Max)
  // These validate implicitly during the OAuth flow — no separate test needed.
  ipcMain.handle(IPC_CHANNELS.SETTINGS_TEST_LLM_CONNECTION_SETUP, async (_event, params: import('../shared/types').TestLlmConnectionParams): Promise<import('../shared/types').TestLlmConnectionResult> => {
    const { provider, apiKey, baseUrl, model, piAuthProvider } = params
    const trimmedKey = apiKey?.trim()

    if (!trimmedKey) {
      return { success: false, error: 'API key is required' }
    }

    ipcLog.info(`[testLlmConnectionSetup] Testing: provider=${provider}${piAuthProvider ? ` piAuth=${piAuthProvider}` : ''}${baseUrl ? ` baseUrl=${baseUrl}` : ''}`)

    try {
      const testModel = model || getDefaultModelForConnection(provider, piAuthProvider)
      const result = await testBackendConnection({
        provider,
        apiKey: trimmedKey,
        model: testModel,
        baseUrl,
        timeoutMs: 20000,
        hostRuntime: buildBackendHostRuntimeContext(),
        connection: resolveSetupTestConnectionHint({ provider, baseUrl, piAuthProvider }),
      })

      if (!result.success) {
        return { success: false, error: parseTestConnectionError(result.error || 'Unknown error') }
      }
      return { success: true }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      ipcLog.info(`[testLlmConnectionSetup] Error: ${msg.slice(0, 500)}`)
      return { success: false, error: parseTestConnectionError(msg) }
    }
  })

  // ============================================================
  // Pi Provider Discovery (main process only — Pi SDK can't run in renderer)
  // ============================================================

  ipcMain.handle(IPC_CHANNELS.PI_GET_API_KEY_PROVIDERS, async () => {
    const { getPiApiKeyProviders } = await import('@craft-agent/shared/config')
    return getPiApiKeyProviders()
  })

  ipcMain.handle(IPC_CHANNELS.PI_GET_PROVIDER_BASE_URL, async (_event, provider: string) => {
    const { getPiProviderBaseUrl } = await import('@craft-agent/shared/config')
    return getPiProviderBaseUrl(provider)
  })

  ipcMain.handle(IPC_CHANNELS.PI_GET_PROVIDER_MODELS, async (_event, provider: string) => {
    const { getModels } = await import('@mariozechner/pi-ai')
    try {
      const models = getModels(provider as Parameters<typeof getModels>[0])
      const sorted = [...models].sort((a, b) => b.cost.output - a.cost.output || b.cost.input - a.cost.input)
      return {
        models: sorted.map(m => ({
          id: m.id,
          name: m.name,
          costInput: m.cost.input,
          costOutput: m.cost.output,
          contextWindow: m.contextWindow,
          reasoning: m.reasoning,
        })),
        totalCount: models.length,
      }
    } catch {
      return { models: [], totalCount: 0 }
    }
  })

  // ============================================================
  // Settings - Model (Session-Specific)
  // ============================================================

  // Get session-specific model
  ipcMain.handle(IPC_CHANNELS.SESSION_GET_MODEL, async (_event, sessionId: string, _workspaceId: string): Promise<string | null> => {
    const session = await sessionManager.getSession(sessionId)
    return session?.model ?? null
  })

  // Set session-specific model (and optionally connection)
  ipcMain.handle(IPC_CHANNELS.SESSION_SET_MODEL, async (_event, sessionId: string, workspaceId: string, model: string | null, connection?: string) => {
    await sessionManager.updateSessionModel(sessionId, workspaceId, model, connection)
    ipcLog.info(`Session ${sessionId} model updated to: ${model}${connection ? ` (connection: ${connection})` : ''}`)
  })

  // Open native folder dialog for selecting working directory
  ipcMain.handle(IPC_CHANNELS.OPEN_FOLDER_DIALOG, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Working Directory',
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // ============================================================
  // Workspace Settings (per-workspace configuration)
  // ============================================================

  // Get workspace settings (model, permission mode, working directory, credential strategy)
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_SETTINGS_GET, async (_event, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      ipcLog.error(`Workspace not found: ${workspaceId}`)
      return null
    }

    // Load workspace config
    const { loadWorkspaceConfig } = await import('@craft-agent/shared/workspaces')
    const config = loadWorkspaceConfig(workspace.rootPath)

    return {
      name: config?.name,
      model: config?.defaults?.model,
      permissionMode: config?.defaults?.permissionMode,
      cyclablePermissionModes: config?.defaults?.cyclablePermissionModes,
      thinkingLevel: config?.defaults?.thinkingLevel,
      workingDirectory: config?.defaults?.workingDirectory,
      localMcpEnabled: config?.localMcpServers?.enabled ?? true,
      defaultLlmConnection: config?.defaults?.defaultLlmConnection,
      enabledSourceSlugs: config?.defaults?.enabledSourceSlugs ?? [],
    }
  })

  // Update a workspace setting
  // Valid keys: 'name', 'model', 'enabledSourceSlugs', 'permissionMode', 'cyclablePermissionModes', 'thinkingLevel', 'workingDirectory', 'localMcpEnabled', 'defaultLlmConnection'
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_SETTINGS_UPDATE, async (_event, workspaceId: string, key: string, value: unknown) => {
    const workspace = getWorkspaceOrThrow(workspaceId)

    // Validate key is a known workspace setting
    const validKeys = ['name', 'model', 'enabledSourceSlugs', 'permissionMode', 'cyclablePermissionModes', 'thinkingLevel', 'workingDirectory', 'localMcpEnabled', 'defaultLlmConnection']
    if (!validKeys.includes(key)) {
      throw new Error(`Invalid workspace setting key: ${key}. Valid keys: ${validKeys.join(', ')}`)
    }

    // Validate defaultLlmConnection exists before saving
    if (key === 'defaultLlmConnection' && value !== undefined && value !== null) {
      const { getLlmConnection } = await import('@craft-agent/shared/config/storage')
      if (!getLlmConnection(value as string)) {
        throw new Error(`LLM connection "${value}" not found`)
      }
    }

    const { loadWorkspaceConfig, saveWorkspaceConfig } = await import('@craft-agent/shared/workspaces')
    const config = loadWorkspaceConfig(workspace.rootPath)
    if (!config) {
      throw new Error(`Failed to load workspace config: ${workspaceId}`)
    }

    // Handle 'name' specially - it's a top-level config property, not in defaults
    if (key === 'name') {
      config.name = String(value).trim()
    } else if (key === 'localMcpEnabled') {
      // Store in localMcpServers.enabled (top-level, not in defaults)
      config.localMcpServers = config.localMcpServers || { enabled: true }
      config.localMcpServers.enabled = Boolean(value)
    } else {
      // Update the setting in defaults
      config.defaults = config.defaults || {}
      ;(config.defaults as Record<string, unknown>)[key] = value
    }

    // Save the config
    saveWorkspaceConfig(workspace.rootPath, config)
    ipcLog.info(`Workspace setting updated: ${key} = ${JSON.stringify(value)}`)
  })

  // ============================================================
  // User Preferences
  // ============================================================

  // Read user preferences file
  ipcMain.handle(IPC_CHANNELS.PREFERENCES_READ, async () => {
    const path = getPreferencesPath()
    if (!existsSync(path)) {
      return { content: '{}', exists: false, path }
    }
    return { content: readFileSync(path, 'utf-8'), exists: true, path }
  })

  // Write user preferences file (validates JSON before saving)
  ipcMain.handle(IPC_CHANNELS.PREFERENCES_WRITE, async (_, content: string) => {
    try {
      JSON.parse(content) // Validate JSON
      const path = getPreferencesPath()
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, content, 'utf-8')
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  // ============================================================
  // Session Drafts (persisted input text)
  // ============================================================

  // Get draft text for a session
  ipcMain.handle(IPC_CHANNELS.DRAFTS_GET, async (_event, sessionId: string) => {
    return getSessionDraft(sessionId)
  })

  // Set draft text for a session (pass empty string to clear)
  ipcMain.handle(IPC_CHANNELS.DRAFTS_SET, async (_event, sessionId: string, text: string) => {
    setSessionDraft(sessionId, text)
  })

  // Delete draft for a session
  ipcMain.handle(IPC_CHANNELS.DRAFTS_DELETE, async (_event, sessionId: string) => {
    deleteSessionDraft(sessionId)
  })

  // Get all drafts (for loading on app start)
  ipcMain.handle(IPC_CHANNELS.DRAFTS_GET_ALL, async () => {
    return getAllSessionDrafts()
  })

  // ============================================================
  // LLM Connections (provider configurations)
  // ============================================================

  // List all LLM connections (includes built-in and custom)
  ipcMain.handle(IPC_CHANNELS.LLM_CONNECTION_LIST, async (): Promise<LlmConnection[]> => {
    return getLlmConnections()
  })

  // List all LLM connections with authentication status
  ipcMain.handle(IPC_CHANNELS.LLM_CONNECTION_LIST_WITH_STATUS, async (): Promise<LlmConnectionWithStatus[]> => {
    const connections = getLlmConnections()
    const credentialManager = getCredentialManager()
    const defaultSlug = getDefaultLlmConnection()

    return Promise.all(connections.map(async (conn): Promise<LlmConnectionWithStatus> => {
      // Check if credentials exist for this connection
      const hasCredentials = await credentialManager.hasLlmCredentials(conn.slug, conn.authType)
      return {
        ...conn,
        isAuthenticated: conn.authType === 'none' || hasCredentials,
        isDefault: conn.slug === defaultSlug,
      }
    }))
  })

  // Get a specific LLM connection by slug
  ipcMain.handle(IPC_CHANNELS.LLM_CONNECTION_GET, async (_event, slug: string): Promise<LlmConnection | null> => {
    return getLlmConnection(slug)
  })

  // Get stored API key for an LLM connection (for edit pre-fill)
  ipcMain.handle(IPC_CHANNELS.LLM_CONNECTION_GET_API_KEY, async (_event, slug: string): Promise<string | null> => {
    const manager = getCredentialManager()
    return manager.getLlmApiKey(slug)
  })

  // Save (create or update) an LLM connection
  // If connection.slug exists and is found, updates it; otherwise creates new
  ipcMain.handle(IPC_CHANNELS.LLM_CONNECTION_SAVE, async (_event, connection: LlmConnection): Promise<{ success: boolean; error?: string }> => {
    try {
      // Check if this is an update or create
      const existing = getLlmConnection(connection.slug)
      if (existing) {
        // Update existing connection (can't change slug)
        const { slug: _slug, ...updates } = connection
        const success = updateLlmConnection(connection.slug, updates)
        if (!success) {
          return { success: false, error: 'Failed to update connection' }
        }
      } else {
        // Create new connection
        const success = addLlmConnection(connection)
        if (!success) {
          return { success: false, error: 'Connection with this slug already exists' }
        }
      }
      ipcLog.info(`LLM connection saved: ${connection.slug}`)
      // Reinitialize auth if the saved connection is the current default
      // (updates env vars and summarization model override)
      const defaultSlug = getDefaultLlmConnection()
      if (defaultSlug === connection.slug) {
        await sessionManager.reinitializeAuth()
      }
      return { success: true }
    } catch (error) {
      ipcLog.error('Failed to save LLM connection:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  // Delete an LLM connection (at least one connection must remain)
  ipcMain.handle(IPC_CHANNELS.LLM_CONNECTION_DELETE, async (_event, slug: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const connection = getLlmConnection(slug)
      if (!connection) {
        return { success: false, error: 'Connection not found' }
      }
      // deleteLlmConnection handles the "at least one must remain" check
      const success = deleteLlmConnection(slug)
      if (success) {
        // Stop any periodic model refresh timer for this connection
        getModelRefreshService().stopConnection(slug)
        // Also delete associated credentials
        const credentialManager = getCredentialManager()
        await credentialManager.deleteLlmCredentials(slug)
        ipcLog.info(`LLM connection deleted: ${slug}`)
      }
      return { success }
    } catch (error) {
      ipcLog.error('Failed to delete LLM connection:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  // Test an LLM connection (validate credentials and connectivity with actual API call)
  ipcMain.handle(IPC_CHANNELS.LLM_CONNECTION_TEST, async (_event, slug: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const result = await validateStoredBackendConnection({
        slug,
        hostRuntime: buildBackendHostRuntimeContext(),
      })

      if (!result.success) {
        return { success: false, error: result.error }
      }

      touchLlmConnection(slug)

      if (result.shouldRefreshModels) {
        getModelRefreshService().refreshNow(slug).catch(err => {
          ipcLog.warn(`Model refresh failed during validation: ${err instanceof Error ? err.message : err}`)
        })
      }

      ipcLog.info(`LLM connection validated: ${slug}`)
      return { success: true }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      ipcLog.info(`[LLM_CONNECTION_TEST] Error for ${slug}: ${msg.slice(0, 500)}`)
      const { parseValidationError } = await import('@craft-agent/shared/config')
      return { success: false, error: parseValidationError(msg) }
    }
  })

  // Set global default LLM connection
  ipcMain.handle(IPC_CHANNELS.LLM_CONNECTION_SET_DEFAULT, async (_event, slug: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const success = setDefaultLlmConnection(slug)
      if (success) {
        ipcLog.info(`Global default LLM connection set to: ${slug}`)
        // Reinitialize auth so env vars and summarization model override match the new default
        await sessionManager.reinitializeAuth()
      }
      return { success, error: success ? undefined : 'Connection not found' }
    } catch (error) {
      ipcLog.error('Failed to set default LLM connection:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  // Set workspace default LLM connection
  ipcMain.handle(IPC_CHANNELS.LLM_CONNECTION_SET_WORKSPACE_DEFAULT, async (_event, workspaceId: string, slug: string | null): Promise<{ success: boolean; error?: string }> => {
    try {
      const workspace = getWorkspaceOrThrow(workspaceId)

      // Validate connection exists if setting (not clearing)
      if (slug) {
        const connection = getLlmConnection(slug)
        if (!connection) {
          return { success: false, error: 'Connection not found' }
        }
      }

      const { loadWorkspaceConfig, saveWorkspaceConfig } = await import('@craft-agent/shared/workspaces')
      const config = loadWorkspaceConfig(workspace.rootPath)
      if (!config) {
        return { success: false, error: 'Failed to load workspace config' }
      }

      // Update workspace defaults
      config.defaults = config.defaults || {}
      if (slug) {
        config.defaults.defaultLlmConnection = slug
      } else {
        delete config.defaults.defaultLlmConnection
      }

      saveWorkspaceConfig(workspace.rootPath, config)
      ipcLog.info(`Workspace ${workspaceId} default LLM connection set to: ${slug}`)
      return { success: true }
    } catch (error) {
      ipcLog.error('Failed to set workspace default LLM connection:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  // Refresh available models for a connection (dynamic model discovery)
  ipcMain.handle(IPC_CHANNELS.LLM_CONNECTION_REFRESH_MODELS, async (_event, slug: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const connection = getLlmConnection(slug)
      if (!connection) {
        return { success: false, error: 'Connection not found' }
      }

      await getModelRefreshService().refreshNow(slug)
      return { success: true }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error'
      ipcLog.error(`Failed to refresh models for ${slug}: ${msg}`)
      return { success: false, error: msg }
    }
  })

  // ============================================================
  // ChatGPT OAuth (for Codex chatgptAuthTokens mode)
  // ============================================================

  // Start ChatGPT OAuth flow
  // Opens browser for authentication, waits for callback, exchanges code for tokens
  ipcMain.handle(IPC_CHANNELS.CHATGPT_START_OAUTH, async (_event, connectionSlug: string): Promise<{
    success: boolean
    error?: string
  }> => {
    try {
      const { startChatGptOAuth, exchangeChatGptCode } = await import('@craft-agent/shared/auth')
      const credentialManager = getCredentialManager()

      ipcLog.info(`Starting ChatGPT OAuth flow for connection: ${connectionSlug}`)

      // Start OAuth and wait for authorization code
      const code = await startChatGptOAuth((status) => {
        ipcLog.info(`[ChatGPT OAuth] ${status}`)
      })

      // Exchange code for tokens
      const tokens = await exchangeChatGptCode(code, (status) => {
        ipcLog.info(`[ChatGPT OAuth] ${status}`)
      })

      // Store both tokens properly in credential manager
      // OpenAI OIDC returns both: idToken (JWT for identity) and accessToken (for API access)
      await credentialManager.setLlmOAuth(connectionSlug, {
        accessToken: tokens.accessToken,  // Store actual accessToken
        idToken: tokens.idToken,           // Store idToken separately
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
      })

      ipcLog.info('ChatGPT OAuth completed successfully')
      return { success: true }
    } catch (error) {
      ipcLog.error('ChatGPT OAuth failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'OAuth authentication failed',
      }
    }
  })

  // Cancel ongoing ChatGPT OAuth flow
  ipcMain.handle(IPC_CHANNELS.CHATGPT_CANCEL_OAUTH, async (): Promise<{ success: boolean }> => {
    try {
      const { cancelChatGptOAuth } = await import('@craft-agent/shared/auth')
      cancelChatGptOAuth()
      ipcLog.info('ChatGPT OAuth cancelled')
      return { success: true }
    } catch (error) {
      ipcLog.error('Failed to cancel ChatGPT OAuth:', error)
      return { success: false }
    }
  })

  // Get ChatGPT authentication status
  ipcMain.handle(IPC_CHANNELS.CHATGPT_GET_AUTH_STATUS, async (_event, connectionSlug: string): Promise<{
    authenticated: boolean
    expiresAt?: number
    hasRefreshToken?: boolean
  }> => {
    try {
      const credentialManager = getCredentialManager()
      const creds = await credentialManager.getLlmOAuth(connectionSlug)

      if (!creds) {
        return { authenticated: false }
      }

      // Check if expired (with 5-minute buffer)
      const isExpired = creds.expiresAt && Date.now() > creds.expiresAt - 5 * 60 * 1000

      return {
        authenticated: !isExpired || !!creds.refreshToken, // Can refresh if has refresh token
        expiresAt: creds.expiresAt,
        hasRefreshToken: !!creds.refreshToken,
      }
    } catch (error) {
      ipcLog.error('Failed to get ChatGPT auth status:', error)
      return { authenticated: false }
    }
  })

  // Logout from ChatGPT (clear stored tokens)
  ipcMain.handle(IPC_CHANNELS.CHATGPT_LOGOUT, async (_event, connectionSlug: string): Promise<{ success: boolean }> => {
    try {
      const credentialManager = getCredentialManager()
      await credentialManager.deleteLlmCredentials(connectionSlug)
      ipcLog.info('ChatGPT credentials cleared')
      return { success: true }
    } catch (error) {
      ipcLog.error('Failed to clear ChatGPT credentials:', error)
      return { success: false }
    }
  })

  // ============================================================
  // GitHub Copilot OAuth
  // ============================================================

  let copilotOAuthAbort: AbortController | null = null

  // Start GitHub Copilot OAuth flow (device flow via Pi SDK)
  ipcMain.handle(IPC_CHANNELS.COPILOT_START_OAUTH, async (event, connectionSlug: string): Promise<{
    success: boolean
    error?: string
  }> => {
    try {
      const { loginGitHubCopilot } = await import('@mariozechner/pi-ai')
      const credentialManager = getCredentialManager()

      // Cancel any previous in-flight flow
      copilotOAuthAbort?.abort()
      copilotOAuthAbort = new AbortController()

      ipcLog.info(`Starting GitHub Copilot OAuth device flow for connection: ${connectionSlug}`)

      // Use Pi SDK's login flow — this handles the device code flow AND
      // the critical Copilot token exchange that determines the correct
      // API endpoint for the user's subscription tier (individual/business/enterprise).
      const credentials = await loginGitHubCopilot({
        onAuth: (url, instructions) => {
          // Extract user code from instructions (format: "Enter code: XXXX-YYYY")
          const codeMatch = instructions?.match(/:\s*(\S+)/)
          const userCode = codeMatch?.[1] ?? ''
          ipcLog.info(`[GitHub OAuth] Device code: ${userCode}`)
          event.sender.send(IPC_CHANNELS.COPILOT_DEVICE_CODE, {
            userCode,
            verificationUri: url,
          })
          // Open GitHub device code page in default browser
          shell.openExternal(url).catch(err => {
            ipcLog.warn(`Failed to open browser for GitHub OAuth: ${err}`)
          })
        },
        onPrompt: async () => {
          // Pi SDK asks for GitHub Enterprise domain — return empty for github.com
          return ''
        },
        onProgress: (message) => {
          ipcLog.info(`[GitHub OAuth] ${message}`)
        },
        signal: copilotOAuthAbort.signal,
      })

      copilotOAuthAbort = null

      // Store the full OAuth credential:
      // - accessToken = Copilot API token (contains proxy-ep for correct endpoint)
      // - refreshToken = GitHub access token (used to refresh the Copilot token)
      // - expiresAt = Copilot token expiry (short-lived, ~1 hour)
      await credentialManager.setLlmOAuth(connectionSlug, {
        accessToken: credentials.access,
        refreshToken: credentials.refresh,
        expiresAt: credentials.expires,
      })

      ipcLog.info('GitHub Copilot OAuth completed successfully')
      return { success: true }
    } catch (error) {
      copilotOAuthAbort = null
      ipcLog.error('GitHub Copilot OAuth failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'OAuth authentication failed',
      }
    }
  })

  // Cancel ongoing GitHub OAuth flow
  ipcMain.handle(IPC_CHANNELS.COPILOT_CANCEL_OAUTH, async (): Promise<{ success: boolean }> => {
    if (copilotOAuthAbort) {
      copilotOAuthAbort.abort()
      copilotOAuthAbort = null
      ipcLog.info('GitHub Copilot OAuth cancelled')
    }
    return { success: true }
  })

  // Get GitHub Copilot authentication status
  ipcMain.handle(IPC_CHANNELS.COPILOT_GET_AUTH_STATUS, async (_event, connectionSlug: string): Promise<{
    authenticated: boolean
  }> => {
    try {
      const credentialManager = getCredentialManager()
      const creds = await credentialManager.getLlmOAuth(connectionSlug)

      return {
        authenticated: !!creds?.accessToken,
      }
    } catch (error) {
      ipcLog.error('Failed to get GitHub auth status:', error)
      return { authenticated: false }
    }
  })

  // Logout from Copilot (clear stored tokens)
  ipcMain.handle(IPC_CHANNELS.COPILOT_LOGOUT, async (_event, connectionSlug: string): Promise<{ success: boolean }> => {
    try {
      const credentialManager = getCredentialManager()
      await credentialManager.deleteLlmCredentials(connectionSlug)
      ipcLog.info('Copilot credentials cleared')
      return { success: true }
    } catch (error) {
      ipcLog.error('Failed to clear Copilot credentials:', error)
      return { success: false }
    }
  })

  // ============================================================
  // Session Info Panel (files, notes, file watching)
  // ============================================================

  // Recursive directory scanner for session files
  // Filters out internal files (session.jsonl) and hidden files (. prefix)
  // Returns only non-empty directories
  async function scanSessionDirectory(dirPath: string): Promise<import('../shared/types').SessionFile[]> {
    const { readdir, stat } = await import('fs/promises')
    const entries = await readdir(dirPath, { withFileTypes: true })
    const files: import('../shared/types').SessionFile[] = []

    for (const entry of entries) {
      // Skip internal and hidden files
      if (entry.name === 'session.jsonl' || entry.name.startsWith('.')) continue

      const fullPath = join(dirPath, entry.name)

      if (entry.isDirectory()) {
        // Recursively scan subdirectory
        const children = await scanSessionDirectory(fullPath)
        // Only include non-empty directories
        if (children.length > 0) {
          files.push({
            name: entry.name,
            path: fullPath,
            type: 'directory',
            children,
          })
        }
      } else {
        const stats = await stat(fullPath)
        files.push({
          name: entry.name,
          path: fullPath,
          type: 'file',
          size: stats.size,
        })
      }
    }

    // Sort: directories first, then alphabetically
    return files.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }

  // Get files in session directory (recursive tree structure)
  ipcMain.handle(IPC_CHANNELS.GET_SESSION_FILES, async (_event, sessionId: string) => {
    const sessionPath = sessionManager.getSessionPath(sessionId)
    if (!sessionPath) return []

    try {
      return await scanSessionDirectory(sessionPath)
    } catch (error) {
      ipcLog.error('Failed to get session files:', error)
      return []
    }
  })

  // Session file watcher state - only one session watched at a time
  let sessionFileWatcher: import('fs').FSWatcher | null = null
  let watchedSessionId: string | null = null
  let fileChangeDebounceTimer: ReturnType<typeof setTimeout> | null = null

  // Start watching a session directory for file changes
  ipcMain.handle(IPC_CHANNELS.WATCH_SESSION_FILES, async (_event, sessionId: string) => {
    const sessionPath = sessionManager.getSessionPath(sessionId)
    if (!sessionPath) return

    // Close existing watcher if watching a different session
    if (sessionFileWatcher) {
      sessionFileWatcher.close()
      sessionFileWatcher = null
    }
    if (fileChangeDebounceTimer) {
      clearTimeout(fileChangeDebounceTimer)
      fileChangeDebounceTimer = null
    }

    watchedSessionId = sessionId

    try {
      const { watch } = await import('fs')
      sessionFileWatcher = watch(sessionPath, { recursive: true }, (eventType, filename) => {
        // Ignore internal files and hidden files
        if (filename && (filename.includes('session.jsonl') || filename.startsWith('.'))) {
          return
        }

        // Debounce: wait 100ms before notifying to batch rapid changes
        if (fileChangeDebounceTimer) {
          clearTimeout(fileChangeDebounceTimer)
        }
        fileChangeDebounceTimer = setTimeout(() => {
          // Notify all windows that session files changed
          const { BrowserWindow } = require('electron')
          for (const win of BrowserWindow.getAllWindows()) {
            win.webContents.send(IPC_CHANNELS.SESSION_FILES_CHANGED, watchedSessionId)
          }
        }, 100)
      })
    } catch (error) {
      ipcLog.error('Failed to start session file watcher:', error)
    }
  })

  // Stop watching session files
  ipcMain.handle(IPC_CHANNELS.UNWATCH_SESSION_FILES, async () => {
    if (sessionFileWatcher) {
      sessionFileWatcher.close()
      sessionFileWatcher = null
    }
    if (fileChangeDebounceTimer) {
      clearTimeout(fileChangeDebounceTimer)
      fileChangeDebounceTimer = null
    }
    if (watchedSessionId) {
      watchedSessionId = null
    }
  })

  // Get session notes (reads notes.md from session directory)
  ipcMain.handle(IPC_CHANNELS.GET_SESSION_NOTES, async (_event, sessionId: string) => {
    const sessionPath = sessionManager.getSessionPath(sessionId)
    if (!sessionPath) return ''

    try {
      const notesPath = join(sessionPath, 'notes.md')
      const content = await readFile(notesPath, 'utf-8')
      return content
    } catch {
      // File doesn't exist yet - return empty string
      return ''
    }
  })

  // Set session notes (writes to notes.md in session directory)
  ipcMain.handle(IPC_CHANNELS.SET_SESSION_NOTES, async (_event, sessionId: string, content: string) => {
    const sessionPath = sessionManager.getSessionPath(sessionId)
    if (!sessionPath) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    try {
      const notesPath = join(sessionPath, 'notes.md')
      await writeFile(notesPath, content, 'utf-8')
    } catch (error) {
      ipcLog.error('Failed to save session notes:', error)
      throw error
    }
  })

  // Preview windows removed - now using in-app overlays (see ChatDisplay.tsx)

  // ============================================================
  // Sources
  // ============================================================

  // Get all sources for a workspace
  ipcMain.handle(IPC_CHANNELS.SOURCES_GET, async (_event, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      ipcLog.error(`SOURCES_GET: Workspace not found: ${workspaceId}`)
      return []
    }
    return loadWorkspaceSources(workspace.rootPath)
  })

  // Create a new source
  ipcMain.handle(IPC_CHANNELS.SOURCES_CREATE, async (_event, workspaceId: string, config: Partial<import('@craft-agent/shared/sources').CreateSourceInput>) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    const { createSource } = await import('@craft-agent/shared/sources')
    return createSource(workspace.rootPath, {
      name: config.name || 'New Source',
      provider: config.provider || 'custom',
      type: config.type || 'mcp',
      enabled: config.enabled ?? true,
      mcp: config.mcp,
      api: config.api,
      local: config.local,
    })
  })

  // Delete a source
  ipcMain.handle(IPC_CHANNELS.SOURCES_DELETE, async (_event, workspaceId: string, sourceSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    const { deleteSource } = await import('@craft-agent/shared/sources')
    deleteSource(workspace.rootPath, sourceSlug)

    // Clean up stale slug from workspace default sources
    const { loadWorkspaceConfig, saveWorkspaceConfig } = await import('@craft-agent/shared/workspaces')
    const config = loadWorkspaceConfig(workspace.rootPath)
    if (config?.defaults?.enabledSourceSlugs?.includes(sourceSlug)) {
      config.defaults.enabledSourceSlugs = config.defaults.enabledSourceSlugs.filter(s => s !== sourceSlug)
      saveWorkspaceConfig(workspace.rootPath, config)
    }
  })

  // Start OAuth flow for a source
  ipcMain.handle(IPC_CHANNELS.SOURCES_START_OAUTH, async (_event, workspaceId: string, sourceSlug: string) => {
    try {
      const workspace = getWorkspaceByNameOrId(workspaceId)
      if (!workspace) {
        return { success: false, error: `Workspace not found: ${workspaceId}` }
      }
      const { loadSource, getSourceCredentialManager } = await import('@craft-agent/shared/sources')

      const source = loadSource(workspace.rootPath, sourceSlug)
      if (!source || source.config.type !== 'mcp' || !source.config.mcp?.url) {
        return { success: false, error: 'Source not found or not an MCP source' }
      }

      const credManager = getSourceCredentialManager()
      const result = await credManager.authenticate(source, {
        onStatus: (message) => ipcLog.info(`[OAuth] ${source.config.name}: ${message}`),
        onError: (error) => ipcLog.error(`[OAuth] ${source.config.name} error: ${error}`),
      })

      if (!result.success) {
        return { success: false, error: result.error }
      }

      // Get token to return to caller
      const token = await credManager.getToken(source)

      ipcLog.info(`Source OAuth complete: ${sourceSlug}`)
      return { success: true, accessToken: token }
    } catch (error) {
      ipcLog.error(`Source OAuth failed:`, error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'OAuth authentication failed',
      }
    }
  })

  // Save credentials for a source (bearer token or API key)
  ipcMain.handle(IPC_CHANNELS.SOURCES_SAVE_CREDENTIALS, async (_event, workspaceId: string, sourceSlug: string, credential: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    const { loadSource, getSourceCredentialManager } = await import('@craft-agent/shared/sources')

    const source = loadSource(workspace.rootPath, sourceSlug)
    if (!source) {
      throw new Error(`Source not found: ${sourceSlug}`)
    }

    // SourceCredentialManager handles credential type resolution
    const credManager = getSourceCredentialManager()
    await credManager.save(source, { value: credential })

    ipcLog.info(`Saved credentials for source: ${sourceSlug}`)
  })

  // Get permissions config for a source (raw format for UI display)
  ipcMain.handle(IPC_CHANNELS.SOURCES_GET_PERMISSIONS, async (_event, workspaceId: string, sourceSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) return null

    // Load raw JSON file (not normalized) for UI display
    const { existsSync, readFileSync } = await import('fs')
    const { getSourcePermissionsPath } = await import('@craft-agent/shared/agent')
    const path = getSourcePermissionsPath(workspace.rootPath, sourceSlug)

    if (!existsSync(path)) return null

    try {
      const content = readFileSync(path, 'utf-8')
      return safeJsonParse(content)
    } catch (error) {
      ipcLog.error('Error reading permissions config:', error)
      return null
    }
  })

  // Get permissions config for a workspace (raw format for UI display)
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_GET_PERMISSIONS, async (_event, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) return null

    // Load raw JSON file (not normalized) for UI display
    const { existsSync, readFileSync } = await import('fs')
    const { getWorkspacePermissionsPath } = await import('@craft-agent/shared/agent')
    const path = getWorkspacePermissionsPath(workspace.rootPath)

    if (!existsSync(path)) return null

    try {
      const content = readFileSync(path, 'utf-8')
      return safeJsonParse(content)
    } catch (error) {
      ipcLog.error('Error reading workspace permissions config:', error)
      return null
    }
  })

  // Get default permissions from ~/.craft-agent/permissions/default.json
  // Returns raw JSON for UI display (patterns with comments), plus the file path
  ipcMain.handle(IPC_CHANNELS.DEFAULT_PERMISSIONS_GET, async () => {
    const { existsSync, readFileSync } = await import('fs')
    const { getAppPermissionsDir } = await import('@craft-agent/shared/agent')
    const { join } = await import('path')

    const defaultPath = join(getAppPermissionsDir(), 'default.json')
    if (!existsSync(defaultPath)) return { config: null, path: defaultPath }

    try {
      const content = readFileSync(defaultPath, 'utf-8')
      return { config: safeJsonParse(content), path: defaultPath }
    } catch (error) {
      ipcLog.error('Error reading default permissions config:', error)
      return { config: null, path: defaultPath }
    }
  })

  // Get MCP tools for a source with permission status
  ipcMain.handle(IPC_CHANNELS.SOURCES_GET_MCP_TOOLS, async (_event, workspaceId: string, sourceSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) return { success: false, error: 'Workspace not found' }

    try {
      // Load source config
      const sources = await loadWorkspaceSources(workspace.rootPath)
      const source = sources.find(s => s.config.slug === sourceSlug)
      if (!source) return { success: false, error: 'Source not found' }
      if (source.config.type !== 'mcp') return { success: false, error: 'Source is not an MCP server' }
      if (!source.config.mcp) return { success: false, error: 'MCP config not found' }

      // Check connection status
      if (source.config.connectionStatus === 'needs_auth') {
        return { success: false, error: 'Source requires authentication' }
      }
      if (source.config.connectionStatus === 'failed') {
        return { success: false, error: source.config.connectionError || 'Connection failed' }
      }
      if (source.config.connectionStatus === 'untested') {
        return { success: false, error: 'Source has not been tested yet' }
      }

      // Create unified MCP client for both stdio and HTTP transports
      const { CraftMcpClient } = await import('@craft-agent/shared/mcp')
      let client: InstanceType<typeof CraftMcpClient>

      if (source.config.mcp.transport === 'stdio') {
        // Stdio transport - spawn local MCP server process
        if (!source.config.mcp.command) {
          return { success: false, error: 'Stdio MCP source is missing required "command" field' }
        }
        ipcLog.info(`Fetching MCP tools via stdio: ${source.config.mcp.command}`)
        client = new CraftMcpClient({
          transport: 'stdio',
          command: source.config.mcp.command,
          args: source.config.mcp.args,
          env: source.config.mcp.env,
        })
      } else {
        // HTTP/SSE transport - connect to remote MCP server
        if (!source.config.mcp.url) {
          return { success: false, error: 'MCP source URL is required for HTTP/SSE transport' }
        }

        let accessToken: string | undefined
        if (source.config.mcp.authType === 'oauth' || source.config.mcp.authType === 'bearer') {
          const credentialManager = getCredentialManager()
          const credentialId = source.config.mcp.authType === 'oauth'
            ? { type: 'source_oauth' as const, workspaceId: source.workspaceId, sourceId: sourceSlug }
            : { type: 'source_bearer' as const, workspaceId: source.workspaceId, sourceId: sourceSlug }
          const credential = await credentialManager.get(credentialId)
          accessToken = credential?.value
        }

        ipcLog.info(`Fetching MCP tools from ${source.config.mcp.url}`)
        client = new CraftMcpClient({
          transport: 'http',
          url: source.config.mcp.url,
          headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
        })
      }

      // Both transports now return full Tool[] with descriptions
      const tools = await client.listTools()
      await client.close()

      // Load permissions patterns
      const { loadSourcePermissionsConfig, permissionsConfigCache } = await import('@craft-agent/shared/agent')
      const permissionsConfig = loadSourcePermissionsConfig(workspace.rootPath, sourceSlug)

      // Get merged permissions config
      const mergedConfig = permissionsConfigCache.getMergedConfig({
        workspaceRootPath: workspace.rootPath,
        activeSourceSlugs: [sourceSlug],
      })

      // Check each tool against permissions patterns
      const toolsWithPermission = tools.map(tool => {
        // Check if tool matches any allowed pattern
        const allowed = mergedConfig.readOnlyMcpPatterns.some((pattern: RegExp) => pattern.test(tool.name))
        return {
          name: tool.name,
          description: tool.description,
          allowed,
        }
      })

      return { success: true, tools: toolsWithPermission }
    } catch (error) {
      ipcLog.error('Failed to get MCP tools:', error)
      const errorMessage = error instanceof Error ? error.message : 'Failed to fetch tools'
      // Provide more helpful error messages
      if (errorMessage.includes('404')) {
        return { success: false, error: 'MCP server endpoint not found. The server may be offline or the URL may be incorrect.' }
      }
      if (errorMessage.includes('401') || errorMessage.includes('403')) {
        return { success: false, error: 'Authentication failed. Please re-authenticate with this source.' }
      }
      return { success: false, error: errorMessage }
    }
  })

  // ============================================================
  // Session Content Search
  // ============================================================

  // Search session content using ripgrep
  ipcMain.handle(IPC_CHANNELS.SEARCH_SESSIONS, async (_event, workspaceId: string, query: string, searchId?: string) => {
    const id = searchId || Date.now().toString(36)
    searchLog.info('ipc:request', { searchId: id, query })

    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      ipcLog.warn('SEARCH_SESSIONS: Workspace not found:', workspaceId)
      return []
    }

    const { searchSessions } = await import('./search')
    const { getWorkspaceSessionsPath } = await import('@craft-agent/shared/workspaces')

    const sessionsDir = getWorkspaceSessionsPath(workspace.rootPath)
    ipcLog.debug(`SEARCH_SESSIONS: Searching "${query}" in ${sessionsDir}`)

    const results = await searchSessions(query, sessionsDir, {
      timeout: 5000,
      maxMatchesPerSession: 3,
      maxSessions: 50,
      searchId: id,
    })

    // Filter out hidden sessions (e.g., mini edit sessions)
    const allSessions = await sessionManager.getSessions()
    const hiddenSessionIds = new Set(
      allSessions.filter(s => s.hidden).map(s => s.id)
    )
    const filteredResults = results.filter(r => !hiddenSessionIds.has(r.sessionId))

    searchLog.info('ipc:response', { searchId: id, resultCount: filteredResults.length, totalFound: results.length })
    return filteredResults
  })

  // ============================================================
  // Skills (Workspace-scoped)
  // ============================================================

  // Get all skills for a workspace (and optionally project-level skills from workingDirectory)
  ipcMain.handle(IPC_CHANNELS.SKILLS_GET, async (_event, workspaceId: string, workingDirectory?: string) => {
    ipcLog.info(`SKILLS_GET: Loading skills for workspace: ${workspaceId}${workingDirectory ? `, workingDirectory: ${workingDirectory}` : ''}`)
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      ipcLog.error(`SKILLS_GET: Workspace not found: ${workspaceId}`)
      return []
    }
    const { loadAllSkills } = await import('@craft-agent/shared/skills')
    const skills = loadAllSkills(workspace.rootPath, workingDirectory)
    ipcLog.info(`SKILLS_GET: Loaded ${skills.length} skills from ${workspace.rootPath}`)
    return skills
  })

  // Get files in a skill directory
  ipcMain.handle(IPC_CHANNELS.SKILLS_GET_FILES, async (_event, workspaceId: string, skillSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      ipcLog.error(`SKILLS_GET_FILES: Workspace not found: ${workspaceId}`)
      return []
    }

    const { join } = await import('path')
    const { readdirSync, statSync } = await import('fs')
    const { getWorkspaceSkillsPath } = await import('@craft-agent/shared/workspaces')

    const skillsDir = getWorkspaceSkillsPath(workspace.rootPath)
    const skillDir = join(skillsDir, skillSlug)

    function scanDirectory(dirPath: string): SkillFile[] {
      try {
        const entries = readdirSync(dirPath, { withFileTypes: true })
        return entries
          .filter(entry => !entry.name.startsWith('.')) // Skip hidden files
          .map(entry => {
            const fullPath = join(dirPath, entry.name)
            if (entry.isDirectory()) {
              return {
                name: entry.name,
                type: 'directory' as const,
                children: scanDirectory(fullPath),
              }
            } else {
              const stats = statSync(fullPath)
              return {
                name: entry.name,
                type: 'file' as const,
                size: stats.size,
              }
            }
          })
          .sort((a, b) => {
            // Directories first, then files
            if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
            return a.name.localeCompare(b.name)
          })
      } catch (err) {
        ipcLog.error(`SKILLS_GET_FILES: Error scanning ${dirPath}:`, err)
        return []
      }
    }

    return scanDirectory(skillDir)
  })

  // Delete a skill from a workspace
  ipcMain.handle(IPC_CHANNELS.SKILLS_DELETE, async (_event, workspaceId: string, skillSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { deleteSkill } = await import('@craft-agent/shared/skills')
    deleteSkill(workspace.rootPath, skillSlug)
    ipcLog.info(`Deleted skill: ${skillSlug}`)
  })

  // Open skill SKILL.md in editor
  ipcMain.handle(IPC_CHANNELS.SKILLS_OPEN_EDITOR, async (_event, workspaceId: string, skillSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { join } = await import('path')
    const { shell } = await import('electron')
    const { getWorkspaceSkillsPath } = await import('@craft-agent/shared/workspaces')

    const skillsDir = getWorkspaceSkillsPath(workspace.rootPath)
    const skillFile = join(skillsDir, skillSlug, 'SKILL.md')
    await shell.openPath(skillFile)
  })

  // Open skill folder in Finder/Explorer
  ipcMain.handle(IPC_CHANNELS.SKILLS_OPEN_FINDER, async (_event, workspaceId: string, skillSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { join } = await import('path')
    const { shell } = await import('electron')
    const { getWorkspaceSkillsPath } = await import('@craft-agent/shared/workspaces')

    const skillsDir = getWorkspaceSkillsPath(workspace.rootPath)
    const skillDir = join(skillsDir, skillSlug)
    await shell.showItemInFolder(skillDir)
  })

  // ============================================================
  // Status Management (Workspace-scoped)
  // ============================================================

  // List all statuses for a workspace
  ipcMain.handle(IPC_CHANNELS.STATUSES_LIST, async (_event, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { listStatuses } = await import('@craft-agent/shared/statuses')
    return listStatuses(workspace.rootPath)
  })

  // Reorder statuses (drag-and-drop). Receives new ordered array of status IDs.
  // Config watcher will detect the file change and broadcast STATUSES_CHANGED.
  ipcMain.handle(IPC_CHANNELS.STATUSES_REORDER, async (_event, workspaceId: string, orderedIds: string[]) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { reorderStatuses } = await import('@craft-agent/shared/statuses')
    reorderStatuses(workspace.rootPath, orderedIds)
  })

  // ============================================================
  // Label Management (Workspace-scoped)
  // ============================================================

  // List all labels for a workspace
  ipcMain.handle(IPC_CHANNELS.LABELS_LIST, async (_event, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { listLabels } = await import('@craft-agent/shared/labels/storage')
    return listLabels(workspace.rootPath)
  })

  // Create a new label in a workspace
  ipcMain.handle(IPC_CHANNELS.LABELS_CREATE, async (_event, workspaceId: string, input: import('@craft-agent/shared/labels').CreateLabelInput) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { createLabel } = await import('@craft-agent/shared/labels/crud')
    const label = createLabel(workspace.rootPath, input)
    windowManager.broadcastToAll(IPC_CHANNELS.LABELS_CHANGED, workspaceId)
    return label
  })

  // Delete a label (and descendants) from a workspace
  ipcMain.handle(IPC_CHANNELS.LABELS_DELETE, async (_event, workspaceId: string, labelId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { deleteLabel } = await import('@craft-agent/shared/labels/crud')
    const result = deleteLabel(workspace.rootPath, labelId)
    windowManager.broadcastToAll(IPC_CHANNELS.LABELS_CHANGED, workspaceId)
    return result
  })

  // List views for a workspace (dynamic expression-based filters stored in views.json)
  ipcMain.handle(IPC_CHANNELS.VIEWS_LIST, async (_event, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { listViews } = await import('@craft-agent/shared/views/storage')
    return listViews(workspace.rootPath)
  })

  // Save views (replaces full array)
  ipcMain.handle(IPC_CHANNELS.VIEWS_SAVE, async (_event, workspaceId: string, views: import('@craft-agent/shared/views').ViewConfig[]) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { saveViews } = await import('@craft-agent/shared/views/storage')
    saveViews(workspace.rootPath, views)
    // Broadcast labels changed since views are used alongside labels in sidebar
    windowManager.broadcastToAll(IPC_CHANNELS.LABELS_CHANGED, workspaceId)
  })

  // ============================================================
  // Automation Testing (manual trigger from UI)
  // ============================================================

  ipcMain.handle(IPC_CHANNELS.TEST_AUTOMATION, async (_event, payload: import('../shared/types').TestAutomationPayload) => {
    const workspace = getWorkspaceByNameOrId(payload.workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const results: import('../shared/types').TestAutomationActionResult[] = []
    const { parsePromptReferences } = await import('@craft-agent/shared/automations')

    for (const action of payload.actions) {
      const start = Date.now()

      // Parse @mentions from the prompt to resolve source/skill references
      const references = parsePromptReferences(action.prompt)

      try {
        // Delegate to executePromptAutomation which handles:
        // - @mention resolution (sources + skills)
        // - enabledSourceSlugs, llmConnection, model, permissionMode on createSession
        // - skillSlugs passed to sendMessage
        const { sessionId } = await sessionManager.executePromptAutomation(
          payload.workspaceId,
          workspace.rootPath,
          action.prompt,
          payload.labels,
          payload.permissionMode,
          references.mentions,
          action.llmConnection,
          action.model,
        )
        results.push({
          type: 'prompt',
          success: true,
          sessionId,
          duration: Date.now() - start,
        })

        // Write history entry for test runs
        if (payload.automationId) {
          const entry = { id: payload.automationId, ts: Date.now(), ok: true, sessionId, prompt: action.prompt.slice(0, 200) }
          appendFile(join(workspace.rootPath, HISTORY_FILE), JSON.stringify(entry) + '\n', 'utf-8').catch(e => ipcLog.warn('[Automations] Failed to write history:', e))
        }
      } catch (err: unknown) {
        results.push({
          type: 'prompt',
          success: false,
          stderr: (err as Error).message,
          duration: Date.now() - start,
        })

        // Write failed history entry
        if (payload.automationId) {
          const entry = { id: payload.automationId, ts: Date.now(), ok: false, error: ((err as Error).message ?? '').slice(0, 200), prompt: action.prompt.slice(0, 200) }
          appendFile(join(workspace.rootPath, HISTORY_FILE), JSON.stringify(entry) + '\n', 'utf-8').catch(e => ipcLog.warn('[Automations] Failed to write history:', e))
        }
      }
    }

    return { actions: results } satisfies import('../shared/types').TestAutomationResult
  })

  // History file name — matches AUTOMATIONS_HISTORY_FILE from @craft-agent/shared/automations/constants
  const HISTORY_FILE = 'automations-history.jsonl'
  interface HistoryEntry { id: string; ts: number; ok: boolean; sessionId?: string; prompt?: string; error?: string }

  // Per-workspace config mutex: serializes read-modify-write cycles on automations.json
  // to prevent concurrent IPC calls from clobbering each other's changes.
  const configMutexes = new Map<string, Promise<void>>()
  function withConfigMutex<T>(workspaceRoot: string, fn: () => Promise<T>): Promise<T> {
    const prev = configMutexes.get(workspaceRoot) ?? Promise.resolve()
    const next = prev.then(fn, fn) // run fn regardless of previous result
    configMutexes.set(workspaceRoot, next.then(() => {}, () => {}))
    return next
  }

  // Shared helper: resolve workspace, read automations.json, validate matcher, mutate, write back
  interface AutomationsConfigJson { automations?: Record<string, Record<string, unknown>[]>; [key: string]: unknown }
  async function withAutomationMatcher(workspaceId: string, eventName: string, matcherIndex: number, mutate: (matchers: Record<string, unknown>[], index: number, config: AutomationsConfigJson, genId: () => string) => void) {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    await withConfigMutex(workspace.rootPath, async () => {
      const { resolveAutomationsConfigPath, generateShortId } = await import('@craft-agent/shared/automations/resolve-config-path')
      const configPath = resolveAutomationsConfigPath(workspace.rootPath)

      const raw = await readFile(configPath, 'utf-8')
      const config = JSON.parse(raw)

      const eventMap = config.automations ?? {}
      const matchers = eventMap[eventName]
      if (!Array.isArray(matchers) || matcherIndex < 0 || matcherIndex >= matchers.length) {
        throw new Error(`Invalid automation reference: ${eventName}[${matcherIndex}]`)
      }

      mutate(matchers, matcherIndex, config, generateShortId)

      // Backfill missing IDs on all matchers before writing
      for (const eventMatchers of Object.values(eventMap)) {
        if (!Array.isArray(eventMatchers)) continue
        for (const m of eventMatchers as Record<string, unknown>[]) {
          if (!m.id) m.id = generateShortId()
        }
      }

      await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
    })
  }

  // Automation enabled state management (toggle enabled/disabled in automations.json)
  ipcMain.handle(IPC_CHANNELS.AUTOMATIONS_SET_ENABLED, async (_event, workspaceId: string, eventName: string, matcherIndex: number, enabled: boolean) => {
    await withAutomationMatcher(workspaceId, eventName, matcherIndex, (matchers, idx) => {
      if (enabled) {
        // Remove the enabled field entirely (defaults to true) to keep JSON clean
        delete matchers[idx].enabled
      } else {
        matchers[idx].enabled = false
      }
    })
  })

  // Duplicate an automation matcher (deep-clone, new ID, append " Copy" to name, insert after original)
  ipcMain.handle(IPC_CHANNELS.AUTOMATIONS_DUPLICATE, async (_event, workspaceId: string, eventName: string, matcherIndex: number) => {
    await withAutomationMatcher(workspaceId, eventName, matcherIndex, (matchers, idx, _config, genId) => {
      const clone = JSON.parse(JSON.stringify(matchers[idx]))
      clone.id = genId()
      clone.name = clone.name ? `${clone.name} Copy` : 'Untitled Copy'
      matchers.splice(idx + 1, 0, clone)
    })
  })

  // Delete an automation matcher (remove from array, clean up empty event key)
  ipcMain.handle(IPC_CHANNELS.AUTOMATIONS_DELETE, async (_event, workspaceId: string, eventName: string, matcherIndex: number) => {
    await withAutomationMatcher(workspaceId, eventName, matcherIndex, (matchers, idx, config) => {
      matchers.splice(idx, 1)
      if (matchers.length === 0) {
        const eventMap = config.automations
        if (eventMap) delete eventMap[eventName]
      }
    })
  })

  // Read execution history for a specific automation
  ipcMain.handle(IPC_CHANNELS.AUTOMATIONS_GET_HISTORY, async (_event, workspaceId: string, automationId: string, limit = 20) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const historyPath = join(workspace.rootPath, HISTORY_FILE)
    try {
      const content = await readFile(historyPath, 'utf-8')
      const lines = content.trim().split('\n').filter(Boolean)

      return lines
        .map(line => { try { return JSON.parse(line) } catch { return null } })
        .filter((e): e is HistoryEntry => e?.id === automationId)
        .slice(-limit)
        .reverse()
    } catch {
      return [] // File doesn't exist yet
    }
  })

  // Return last execution timestamp for all automations (for lastExecutedAt in list)
  ipcMain.handle(IPC_CHANNELS.AUTOMATIONS_GET_LAST_EXECUTED, async (_event, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const historyPath = join(workspace.rootPath, HISTORY_FILE)
    try {
      const content = await readFile(historyPath, 'utf-8')
      const result: Record<string, number> = {}
      for (const line of content.trim().split('\n')) {
        try {
          const entry = JSON.parse(line)
          if (entry.id && entry.ts) result[entry.id] = entry.ts
        } catch { /* skip malformed lines */ }
      }
      return result
    } catch {
      return {}
    }
  })

  // Generic workspace image loading (for source icons, status icons, etc.)
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_READ_IMAGE, async (_event, workspaceId: string, relativePath: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { readFileSync, existsSync } = await import('fs')
    const { join, normalize } = await import('path')

    // Security: validate path
    // - Must not contain .. (path traversal)
    // - Must be a valid image extension
    const ALLOWED_EXTENSIONS = ['.svg', '.png', '.jpg', '.jpeg', '.webp', '.ico', '.gif']

    if (relativePath.includes('..')) {
      throw new Error('Invalid path: directory traversal not allowed')
    }

    const ext = relativePath.toLowerCase().slice(relativePath.lastIndexOf('.'))
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      throw new Error(`Invalid file type: ${ext}. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`)
    }

    // Resolve path relative to workspace root
    const absolutePath = normalize(join(workspace.rootPath, relativePath))

    // Double-check the resolved path is still within workspace
    if (!absolutePath.startsWith(workspace.rootPath)) {
      throw new Error('Invalid path: outside workspace directory')
    }

    if (!existsSync(absolutePath)) {
      return null  // Missing optional files - silent fallback to default icons
    }

    // Read file as buffer
    const buffer = readFileSync(absolutePath)

    // If SVG, return as UTF-8 string (caller will use as innerHTML)
    if (ext === '.svg') {
      return buffer.toString('utf-8')
    }

    // For binary images, return as data URL
    const mimeTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.ico': 'image/x-icon',
      '.gif': 'image/gif',
    }
    const mimeType = mimeTypes[ext] || 'image/png'
    return `data:${mimeType};base64,${buffer.toString('base64')}`
  })

  // Generic workspace image writing (for workspace icon, etc.)
  // Resizes images to max 256x256 to keep file sizes small
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_WRITE_IMAGE, async (_event, workspaceId: string, relativePath: string, base64: string, mimeType: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { writeFileSync, existsSync, unlinkSync, readdirSync } = await import('fs')
    const { join, normalize, basename } = await import('path')

    // Security: validate path
    const ALLOWED_EXTENSIONS = ['.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif']

    if (relativePath.includes('..')) {
      throw new Error('Invalid path: directory traversal not allowed')
    }

    const ext = relativePath.toLowerCase().slice(relativePath.lastIndexOf('.'))
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      throw new Error(`Invalid file type: ${ext}. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`)
    }

    // Resolve path relative to workspace root
    const absolutePath = normalize(join(workspace.rootPath, relativePath))

    // Double-check the resolved path is still within workspace
    if (!absolutePath.startsWith(workspace.rootPath)) {
      throw new Error('Invalid path: outside workspace directory')
    }

    // If this is an icon file (icon.*), delete any existing icon files with different extensions
    const fileName = basename(relativePath)
    if (fileName.startsWith('icon.')) {
      const files = readdirSync(workspace.rootPath)
      for (const file of files) {
        if (file.startsWith('icon.') && file !== fileName) {
          const oldPath = join(workspace.rootPath, file)
          try {
            unlinkSync(oldPath)
          } catch {
            // Ignore errors deleting old icon
          }
        }
      }
    }

    // Decode base64 to buffer
    const buffer = Buffer.from(base64, 'base64')

    // For SVGs, just write directly (no resizing needed)
    if (mimeType === 'image/svg+xml' || ext === '.svg') {
      writeFileSync(absolutePath, buffer)
      return
    }

    // For raster images, resize to max 256x256 using nativeImage
    const image = nativeImage.createFromBuffer(buffer)
    const size = image.getSize()

    // Only resize if larger than 256px
    if (size.width > 256 || size.height > 256) {
      const ratio = Math.min(256 / size.width, 256 / size.height)
      const newWidth = Math.round(size.width * ratio)
      const newHeight = Math.round(size.height * ratio)
      const resized = image.resize({ width: newWidth, height: newHeight, quality: 'best' })

      // Write as PNG for consistency
      writeFileSync(absolutePath, resized.toPNG())
    } else {
      // Small enough, write as-is
      writeFileSync(absolutePath, buffer)
    }
  })

  // Register onboarding handlers
  registerOnboardingHandlers(sessionManager)

  // ============================================================
  // Backend Capabilities (for capabilities-driven UI)
  // ============================================================

  // ============================================================
  // Theme (app-level only)
  // ============================================================

  ipcMain.handle(IPC_CHANNELS.THEME_GET_APP, async () => {
    const { loadAppTheme } = await import('@craft-agent/shared/config/storage')
    return loadAppTheme()
  })

  // Preset themes (app-level)
  ipcMain.handle(IPC_CHANNELS.THEME_GET_PRESETS, async () => {
    const { loadPresetThemes } = await import('@craft-agent/shared/config/storage')
    return loadPresetThemes()
  })

  ipcMain.handle(IPC_CHANNELS.THEME_LOAD_PRESET, async (_event, themeId: string) => {
    const { loadPresetTheme } = await import('@craft-agent/shared/config/storage')
    return loadPresetTheme(themeId)
  })

  ipcMain.handle(IPC_CHANNELS.THEME_GET_COLOR_THEME, async () => {
    const { getColorTheme } = await import('@craft-agent/shared/config/storage')
    return getColorTheme()
  })

  ipcMain.handle(IPC_CHANNELS.THEME_SET_COLOR_THEME, async (_event, themeId: string) => {
    const { setColorTheme } = await import('@craft-agent/shared/config/storage')
    setColorTheme(themeId)
  })

  // Broadcast theme preferences to all other windows (for cross-window sync)
  ipcMain.handle(IPC_CHANNELS.THEME_BROADCAST_PREFERENCES, async (event, preferences: { mode: string; colorTheme: string; font: string }) => {
    const senderId = event.sender.id
    // Broadcast to all windows except the sender
    for (const managed of windowManager.getAllWindows()) {
      if (!managed.window.isDestroyed() &&
          !managed.window.webContents.isDestroyed() &&
          managed.window.webContents.mainFrame &&
          managed.window.webContents.id !== senderId) {
        managed.window.webContents.send(IPC_CHANNELS.THEME_PREFERENCES_CHANGED, preferences)
      }
    }
  })

  // Workspace-level theme overrides
  ipcMain.handle(IPC_CHANNELS.THEME_GET_WORKSPACE_COLOR_THEME, async (_event, workspaceId: string) => {
    const { getWorkspaces } = await import('@craft-agent/shared/config/storage')
    const { getWorkspaceColorTheme } = await import('@craft-agent/shared/workspaces/storage')
    const workspaces = getWorkspaces()
    const workspace = workspaces.find(w => w.id === workspaceId)
    if (!workspace) return null
    return getWorkspaceColorTheme(workspace.rootPath) ?? null
  })

  ipcMain.handle(IPC_CHANNELS.THEME_SET_WORKSPACE_COLOR_THEME, async (_event, workspaceId: string, themeId: string | null) => {
    const { getWorkspaces } = await import('@craft-agent/shared/config/storage')
    const { setWorkspaceColorTheme } = await import('@craft-agent/shared/workspaces/storage')
    const workspaces = getWorkspaces()
    const workspace = workspaces.find(w => w.id === workspaceId)
    if (!workspace) return
    setWorkspaceColorTheme(workspace.rootPath, themeId ?? undefined)
  })

  ipcMain.handle(IPC_CHANNELS.THEME_GET_ALL_WORKSPACE_THEMES, async () => {
    const { getWorkspaces } = await import('@craft-agent/shared/config/storage')
    const { getWorkspaceColorTheme } = await import('@craft-agent/shared/workspaces/storage')
    const workspaces = getWorkspaces()
    const themes: Record<string, string | undefined> = {}
    for (const ws of workspaces) {
      themes[ws.id] = getWorkspaceColorTheme(ws.rootPath)
    }
    return themes
  })

  // Broadcast workspace theme change to all other windows (for cross-window sync)
  ipcMain.handle(IPC_CHANNELS.THEME_BROADCAST_WORKSPACE_THEME, async (event, workspaceId: string, themeId: string | null) => {
    const senderId = event.sender.id
    // Broadcast to all windows except the sender
    for (const managed of windowManager.getAllWindows()) {
      if (!managed.window.isDestroyed() &&
          !managed.window.webContents.isDestroyed() &&
          managed.window.webContents.mainFrame &&
          managed.window.webContents.id !== senderId) {
        managed.window.webContents.send(IPC_CHANNELS.THEME_WORKSPACE_THEME_CHANGED, { workspaceId, themeId })
      }
    }
  })

  // Tool icon mappings — loads tool-icons.json and resolves each entry's icon to a data URL
  // for display in the Appearance settings page
  ipcMain.handle(IPC_CHANNELS.TOOL_ICONS_GET_MAPPINGS, async () => {
    const { getToolIconsDir } = await import('@craft-agent/shared/config/storage')
    const { loadToolIconConfig } = await import('@craft-agent/shared/utils/cli-icon-resolver')
    const { encodeIconToDataUrl } = await import('@craft-agent/shared/utils/icon-encoder')
    const { join } = await import('path')

    const toolIconsDir = getToolIconsDir()
    const config = loadToolIconConfig(toolIconsDir)
    if (!config) return []

    return config.tools
      .map(tool => {
        const iconPath = join(toolIconsDir, tool.icon)
        const iconDataUrl = encodeIconToDataUrl(iconPath)
        if (!iconDataUrl) return null
        return {
          id: tool.id,
          displayName: tool.displayName,
          iconDataUrl,
          commands: tool.commands,
        }
      })
      .filter(Boolean)
  })

  // Logo URL resolution (uses Node.js filesystem cache for provider domains)
  ipcMain.handle(IPC_CHANNELS.LOGO_GET_URL, async (_event, serviceUrl: string, provider?: string) => {
    const { getLogoUrl } = await import('@craft-agent/shared/utils/logo')
    const result = getLogoUrl(serviceUrl, provider)
    return result
  })

  // ============================================================
  // Notifications and Badge
  // ============================================================

  // Show a notification
  ipcMain.handle(IPC_CHANNELS.NOTIFICATION_SHOW, async (_event, title: string, body: string, workspaceId: string, sessionId: string) => {
    const { showNotification } = await import('./notifications')
    showNotification(title, body, workspaceId, sessionId)
  })

  // Get notifications enabled setting
  ipcMain.handle(IPC_CHANNELS.NOTIFICATION_GET_ENABLED, async () => {
    const { getNotificationsEnabled } = await import('@craft-agent/shared/config/storage')
    return getNotificationsEnabled()
  })

  // Set notifications enabled setting (also triggers permission request if enabling)
  ipcMain.handle(IPC_CHANNELS.NOTIFICATION_SET_ENABLED, async (_event, enabled: boolean) => {
    const { setNotificationsEnabled } = await import('@craft-agent/shared/config/storage')
    setNotificationsEnabled(enabled)

    // If enabling, trigger a notification to request macOS permission
    if (enabled) {
      const { showNotification } = await import('./notifications')
      showNotification('Notifications enabled', 'You will be notified when tasks complete.', '', '')
    }
  })

  // Get auto-capitalisation setting
  ipcMain.handle(IPC_CHANNELS.INPUT_GET_AUTO_CAPITALISATION, async () => {
    const { getAutoCapitalisation } = await import('@craft-agent/shared/config/storage')
    return getAutoCapitalisation()
  })

  // Set auto-capitalisation setting
  ipcMain.handle(IPC_CHANNELS.INPUT_SET_AUTO_CAPITALISATION, async (_event, enabled: boolean) => {
    const { setAutoCapitalisation } = await import('@craft-agent/shared/config/storage')
    setAutoCapitalisation(enabled)
  })

  // Get send message key setting
  ipcMain.handle(IPC_CHANNELS.INPUT_GET_SEND_MESSAGE_KEY, async () => {
    const { getSendMessageKey } = await import('@craft-agent/shared/config/storage')
    return getSendMessageKey()
  })

  // Set send message key setting
  ipcMain.handle(IPC_CHANNELS.INPUT_SET_SEND_MESSAGE_KEY, async (_event, key: 'enter' | 'cmd-enter') => {
    const { setSendMessageKey } = await import('@craft-agent/shared/config/storage')
    setSendMessageKey(key)
  })

  // Get spell check setting
  ipcMain.handle(IPC_CHANNELS.INPUT_GET_SPELL_CHECK, async () => {
    const { getSpellCheck } = await import('@craft-agent/shared/config/storage')
    return getSpellCheck()
  })

  // Set spell check setting
  ipcMain.handle(IPC_CHANNELS.INPUT_SET_SPELL_CHECK, async (_event, enabled: boolean) => {
    const { setSpellCheck } = await import('@craft-agent/shared/config/storage')
    setSpellCheck(enabled)
  })

  // Get keep awake while running setting
  ipcMain.handle(IPC_CHANNELS.POWER_GET_KEEP_AWAKE, async () => {
    const { getKeepAwakeWhileRunning } = await import('@craft-agent/shared/config/storage')
    return getKeepAwakeWhileRunning()
  })

  // Set keep awake while running setting
  ipcMain.handle(IPC_CHANNELS.POWER_SET_KEEP_AWAKE, async (_event, enabled: boolean) => {
    const { setKeepAwakeWhileRunning } = await import('@craft-agent/shared/config/storage')
    const { setKeepAwakeSetting } = await import('./power-manager')
    // Save to config
    setKeepAwakeWhileRunning(enabled)
    // Update the power manager's cached value and power state
    setKeepAwakeSetting(enabled)
  })

  // Get rich tool descriptions setting
  ipcMain.handle(IPC_CHANNELS.APPEARANCE_GET_RICH_TOOL_DESCRIPTIONS, async () => {
    const { getRichToolDescriptions } = await import('@craft-agent/shared/config/storage')
    return getRichToolDescriptions()
  })

  // Set rich tool descriptions setting
  ipcMain.handle(IPC_CHANNELS.APPEARANCE_SET_RICH_TOOL_DESCRIPTIONS, async (_event, enabled: boolean) => {
    const { setRichToolDescriptions } = await import('@craft-agent/shared/config/storage')
    setRichToolDescriptions(enabled)
  })

  // Update app badge count
  ipcMain.handle(IPC_CHANNELS.BADGE_UPDATE, async (_event, count: number) => {
    const { updateBadgeCount } = await import('./notifications')
    updateBadgeCount(count)
  })

  // Clear app badge
  ipcMain.handle(IPC_CHANNELS.BADGE_CLEAR, async () => {
    const { clearBadgeCount } = await import('./notifications')
    clearBadgeCount()
  })

  // Set dock icon with badge (canvas-rendered badge image from renderer)
  ipcMain.handle(IPC_CHANNELS.BADGE_SET_ICON, async (_event, dataUrl: string) => {
    const { setDockIconWithBadge } = await import('./notifications')
    setDockIconWithBadge(dataUrl)
  })

  // Get window focus state
  ipcMain.handle(IPC_CHANNELS.WINDOW_GET_FOCUS_STATE, () => {
    const { isAnyWindowFocused } = require('./notifications')
    return isAnyWindowFocused()
  })

  // Note: Permission mode cycling settings (cyclablePermissionModes) are now workspace-level
  // and managed via WORKSPACE_SETTINGS_GET/UPDATE channels

}
