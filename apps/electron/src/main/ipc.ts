import { ipcMain, nativeTheme, nativeImage, dialog, shell, BrowserWindow } from 'electron'
import { readFile, realpath, mkdir, writeFile, unlink, rm } from 'fs/promises'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { normalize, isAbsolute, join, basename, dirname, resolve } from 'path'
import { homedir, tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { SessionManager } from './sessions'
import { ipcLog } from './logger'
import { WindowManager } from './window-manager'
import { PreviewWindowManager } from './preview-window'
import { DiffPreviewWindowManager } from './diff-preview-window'
import { CodePreviewWindowManager } from './code-preview-window'
import { TerminalPreviewWindowManager } from './terminal-preview-window'
import { MultiFileDiffWindowManager } from './multi-file-diff-window'
import { agentService } from './agent-service'
import { registerOnboardingHandlers } from './onboarding'
import { IPC_CHANNELS, type FileAttachment, type StoredAttachment, type AgentActivateOptions, type AuthType, type BillingMethodInfo, type SendMessageOptions, type DiffPreviewData, type CodePreviewData, type TerminalPreviewData, type MultiFileDiffData } from '../shared/types'
import { readFileAttachment } from '@craft-agent/shared/utils'
import { getAiCreditTopUpUrl } from '@craft-agent/shared/auth'
import { getAuthType, setAuthType, getPreferencesPath, getModel, setModel, getSessionDraft, setSessionDraft, deleteSessionDraft, getAllSessionDrafts, getDefaultPermissionMode, setDefaultPermissionMode, getWorkspaceByNameOrId, addWorkspace, setActiveWorkspace, type Workspace } from '@craft-agent/shared/config'
import { getSessionAttachmentsPath } from '@craft-agent/shared/sessions'
import { loadWorkspaceSources, getSourcesBySlugs, type LoadedSource } from '@craft-agent/shared/sources'
import { getCredentialManager } from '@craft-agent/shared/credentials'
import { MarkItDown } from 'markitdown-js'

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
    '/tmp',         // Temporary files
    '/var/folders', // macOS temp folders
  ]

  // Check if the real path is within an allowed directory
  const isAllowed = allowedDirs.some(dir => realPath.startsWith(dir + '/') || realPath === dir)

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

export function registerIpcHandlers(sessionManager: SessionManager, windowManager: WindowManager, previewWindowManager: PreviewWindowManager, diffPreviewWindowManager: DiffPreviewWindowManager, codePreviewWindowManager: CodePreviewWindowManager, terminalPreviewWindowManager: TerminalPreviewWindowManager, multiFileDiffWindowManager: MultiFileDiffWindowManager): void {
  // Get all sessions
  ipcMain.handle(IPC_CHANNELS.GET_SESSIONS, async () => {
    return sessionManager.getSessions()
  })

  // Get workspaces
  ipcMain.handle(IPC_CHANNELS.GET_WORKSPACES, async () => {
    return sessionManager.getWorkspaces()
  })

  // Create a new workspace at a folder path
  ipcMain.handle(IPC_CHANNELS.CREATE_WORKSPACE, async (_event, folderPath: string, name: string) => {
    // Create workspace at {folderPath}/.craft-agent/
    const rootPath = join(folderPath, '.craft-agent')
    const workspace = addWorkspace({ name, rootPath })
    // Make it active
    setActiveWorkspace(workspace.id)
    ipcLog.info(`Created workspace "${name}" at ${rootPath}`)
    return workspace
  })

  // ============================================================
  // Window Management
  // ============================================================

  // Get workspace ID for the calling window
  ipcMain.handle(IPC_CHANNELS.GET_WINDOW_WORKSPACE, (event) => {
    const workspaceId = windowManager.getWorkspaceForWindow(event.sender.id)
    // Set up ConfigWatcher for live theme/source updates
    if (workspaceId) {
      const workspace = getWorkspaceByNameOrId(workspaceId)
      if (workspace) {
        sessionManager.setupConfigWatcher(workspace.rootPath)
      }
    }
    return workspaceId
  })

  // Open workspace in new window (or focus existing)
  ipcMain.handle(IPC_CHANNELS.OPEN_WORKSPACE, async (_event, workspaceId: string) => {
    windowManager.focusOrCreateWindow(workspaceId)
  })

  // Get mode for the calling window
  ipcMain.handle(IPC_CHANNELS.GET_WINDOW_MODE, (event) => {
    return windowManager.getModeForWindow(event.sender.id)
  })

  // Close the calling window
  ipcMain.handle(IPC_CHANNELS.CLOSE_WINDOW, (event) => {
    windowManager.closeWindow(event.sender.id)
  })

  // Switch workspace in current window (in-window switching)
  ipcMain.handle(IPC_CHANNELS.SWITCH_WORKSPACE, async (event, workspaceId: string) => {
    // Update the window's workspace mapping
    windowManager.updateWindowWorkspace(event.sender.id, workspaceId)

    // Set up ConfigWatcher for the new workspace
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (workspace) {
      sessionManager.setupConfigWatcher(workspace.rootPath)
    }
  })

  // Create a new session (with optional agent assignment)
  ipcMain.handle(IPC_CHANNELS.CREATE_SESSION, async (_event, workspaceId: string, agentId?: string, agentName?: string) => {
    return sessionManager.createSession(workspaceId, agentId, agentName)
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
      if (window && !window.isDestroyed()) {
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
      case 'rename':
        return sessionManager.renameSession(sessionId, command.name)
      case 'setTodoState':
        return sessionManager.setTodoState(sessionId, command.state)
      case 'markRead':
        return sessionManager.markSessionRead(sessionId)
      case 'markUnread':
        return sessionManager.markSessionUnread(sessionId)
      case 'setPermissionMode':
        return sessionManager.setSessionPermissionMode(sessionId, command.mode)
      case 'updateWorkingDirectory':
        return sessionManager.updateWorkingDirectory(sessionId, command.dir)
      case 'setSources':
        return sessionManager.setSessionSources(sessionId, command.sourceSlugs)
      case 'showInFinder': {
        const sessionPath = sessionManager.getSessionPath(sessionId)
        if (sessionPath) {
          shell.showItemInFolder(sessionPath)
        }
        return
      }
      default: {
        const _exhaustive: never = command
        throw new Error(`Unknown session command: ${JSON.stringify(command)}`)
      }
    }
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
      ipcLog.error('readFile error:', message)
      throw new Error(`Failed to read file: ${message}`)
    }
  })

  // Open native file dialog for selecting files to attach
  ipcMain.handle(IPC_CHANNELS.OPEN_FILE_DIALOG, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'All Supported', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'docx', 'xlsx', 'pptx', 'doc', 'xls', 'ppt', 'txt', 'md', 'json', 'js', 'ts', 'tsx', 'jsx', 'py', 'css', 'html', 'xml', 'yaml', 'yml'] },
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
        { name: 'Documents', extensions: ['pdf', 'docx', 'xlsx', 'pptx', 'doc', 'xls', 'ppt', 'txt', 'md'] },
        { name: 'Code', extensions: ['js', 'ts', 'tsx', 'jsx', 'py', 'json', 'css', 'html', 'xml', 'yaml', 'yml'] },
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

      // Create attachments directory if it doesn't exist
      const attachmentsDir = getSessionAttachmentsPath(workspaceRootPath, sessionId)
      await mkdir(attachmentsDir, { recursive: true })

      // Generate unique ID for this attachment
      const id = randomUUID()
      const safeName = sanitizeFilename(attachment.name)
      const storedFileName = `${id}_${safeName}`
      const storedPath = join(attachmentsDir, storedFileName)

      // 1. Save the file
      if (attachment.base64) {
        // Images, PDFs, Office files - decode from base64
        const decoded = Buffer.from(attachment.base64, 'base64')
        // Validate decoded size matches expected (allow small variance for encoding overhead)
        if (Math.abs(decoded.length - attachment.size) > 100) {
          throw new Error(`Attachment corrupted: size mismatch (expected ${attachment.size}, got ${decoded.length})`)
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
      return {
        id,
        type: attachment.type,
        name: attachment.name,
        mimeType: attachment.mimeType,
        size: attachment.size,
        storedPath,
        thumbnailPath,
        thumbnailBase64,
        markdownPath,
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

  // Agent management
  ipcMain.handle(IPC_CHANNELS.GET_AGENTS, async (_event, workspaceId: string) => {
    return agentService.getAgents(workspaceId)
  })

  ipcMain.handle(IPC_CHANNELS.REFRESH_AGENTS, async (_event, workspaceId: string) => {
    return agentService.refreshAgents(workspaceId)
  })

  // Ensure a builtin agent exists in the workspace
  ipcMain.handle(IPC_CHANNELS.ENSURE_BUILTIN_AGENT, async (_event, workspaceId: string, slug: string) => {
    return agentService.ensureBuiltinAgent(workspaceId, slug)
  })

  // Check if an agent needs authentication
  ipcMain.handle(IPC_CHANNELS.CHECK_AGENT_AUTH, async (_event, workspaceId: string, agentId: string) => {
    return agentService.checkAgentAuthStatus(workspaceId, agentId)
  })

  // Get auth status for all MCP servers and APIs (for Info dialog)
  ipcMain.handle(IPC_CHANNELS.GET_AGENT_AUTH_STATUS, async (_event, workspaceId: string, agentId: string) => {
    return agentService.getAgentAuthStatus(workspaceId, agentId)
  })

  // Get full agent definition for Info display
  ipcMain.handle(IPC_CHANNELS.GET_AGENT_DEFINITION, async (_event, workspaceId: string, agentId: string) => {
    return agentService.getAgentDefinition(workspaceId, agentId)
  })

  // Reload agent (clear cache, re-extract from Craft)
  ipcMain.handle(IPC_CHANNELS.RELOAD_AGENT, async (_event, workspaceId: string, agentId: string) => {
    return agentService.reloadAgent(workspaceId, agentId)
  })

  // Reset agent (clear all cached data including credentials)
  // Uses sessionManager.resetAgent() to properly reset AgentStateManager state
  ipcMain.handle(IPC_CHANNELS.RESET_AGENT, async (_event, workspaceId: string, agentId: string) => {
    await sessionManager.resetAgent(workspaceId, agentId)
    // Broadcast complete state after reset
    await sessionManager.broadcastAgentState(workspaceId, agentId)
    return true
  })

  // Agent authentication - get detailed requirements
  ipcMain.handle(IPC_CHANNELS.GET_AGENT_AUTH_REQUIREMENTS, async (_event, workspaceId: string, agentId: string) => {
    return agentService.getAuthRequirements(workspaceId, agentId)
  })

  // Agent authentication - start OAuth flow for MCP server
  ipcMain.handle(IPC_CHANNELS.START_MCP_OAUTH, async (_event, workspaceId: string, agentId: string, serverUrl: string, serverName: string) => {
    const result = await agentService.startMcpOAuth(workspaceId, agentId, serverUrl, serverName)
    // Broadcast complete state on success
    if (result.success) {
      await sessionManager.broadcastAgentState(workspaceId, agentId)
    }
    return result
  })

  // Agent authentication - save bearer token for MCP server
  ipcMain.handle(IPC_CHANNELS.SAVE_MCP_BEARER, async (_event, workspaceId: string, agentId: string, serverName: string, token: string) => {
    await agentService.saveMcpBearer(workspaceId, agentId, serverName, token)
    // Broadcast complete state after saving
    await sessionManager.broadcastAgentState(workspaceId, agentId)
  })

  // Agent authentication - save API credentials
  ipcMain.handle(IPC_CHANNELS.SAVE_API_CREDENTIALS, async (_event, workspaceId: string, agentId: string, apiName: string, credential: string) => {
    await agentService.saveApiCredentials(workspaceId, agentId, apiName, credential)
    // Broadcast complete state after saving
    await sessionManager.broadcastAgentState(workspaceId, agentId)
  })

  // Agent authentication - validate MCP connection
  ipcMain.handle(IPC_CHANNELS.VALIDATE_MCP_CONNECTION, async (_event, serverUrl: string, accessToken?: string) => {
    return agentService.validateMcpConnectionStatus(serverUrl, accessToken)
  })

  // ============================================================
  // Agent State Management (agent-scoped, unified state machine)
  // ============================================================

  // Get current agent status (agent-scoped)
  ipcMain.handle(IPC_CHANNELS.AGENT_GET_STATUS, async (_event, workspaceId: string, agentId: string) => {
    return sessionManager.getAgentStatus(workspaceId, agentId)
  })

  // Start agent activation flow (agent-scoped)
  ipcMain.handle(IPC_CHANNELS.AGENT_ACTIVATE, async (_event, workspaceId: string, agentId: string, options?: AgentActivateOptions) => {
    return sessionManager.activateAgent(workspaceId, agentId, options)
  })

  // Continue after MCP server auth completes (agent-scoped)
  ipcMain.handle(IPC_CHANNELS.AGENT_CONTINUE_MCP_AUTH, async (_event, workspaceId: string, agentId: string) => {
    return sessionManager.continueAfterMcpAuth(workspaceId, agentId)
  })

  // Continue after API auth completes (agent-scoped)
  ipcMain.handle(IPC_CHANNELS.AGENT_CONTINUE_API_AUTH, async (_event, workspaceId: string, agentId: string) => {
    return sessionManager.continueAfterApiAuth(workspaceId, agentId)
  })

  // Deactivate agent (agent-scoped)
  ipcMain.handle(IPC_CHANNELS.AGENT_DEACTIVATE, async (_event, workspaceId: string, agentId: string) => {
    sessionManager.deactivateAgent(workspaceId, agentId)
    // Broadcast complete state after deactivation
    await sessionManager.broadcastAgentState(workspaceId, agentId)
  })

  // Reload agent (clear cache, re-extract) (agent-scoped)
  ipcMain.handle(IPC_CHANNELS.AGENT_RELOAD, async (_event, workspaceId: string, agentId: string) => {
    return sessionManager.reloadAgent(workspaceId, agentId)
  })

  // Reset agent (clear cache AND credentials) (agent-scoped)
  ipcMain.handle(IPC_CHANNELS.AGENT_RESET, async (_event, workspaceId: string, agentId: string) => {
    await sessionManager.resetAgent(workspaceId, agentId)
    // Broadcast complete state after reset
    await sessionManager.broadcastAgentState(workspaceId, agentId)
  })

  // Mark agent as active (agent-scoped)
  ipcMain.handle(IPC_CHANNELS.AGENT_MARK_ACTIVE, async (_event, workspaceId: string, agentId: string) => {
    sessionManager.markAgentActive(workspaceId, agentId)
    // Broadcast complete state after marking active
    await sessionManager.broadcastAgentState(workspaceId, agentId)
  })

  // Shell operations - open URL in external browser
  ipcMain.handle(IPC_CHANNELS.OPEN_URL, async (_event, url: string) => {
    try {
      // Validate URL format
      const parsed = new URL(url)
      if (!['http:', 'https:', 'mailto:', 'craftdocs:'].includes(parsed.protocol)) {
        throw new Error('Only http, https, mailto, and craftdocs URLs are allowed')
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
      // Validate path is within allowed directories
      const safePath = await validateFilePath(path)
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
      // Validate path is within allowed directories
      const safePath = await validateFilePath(path)
      shell.showItemInFolder(safePath)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      ipcLog.error('showInFolder error:', message)
      throw new Error(`Failed to show in folder: ${message}`)
    }
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

  // ============================================================
  // Settings - Billing Method
  // ============================================================

  // Get current billing method and credential status
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_BILLING_METHOD, async (): Promise<BillingMethodInfo> => {
    const authType = getAuthType()
    const manager = getCredentialManager()

    let hasCredential = false
    if (authType === 'api_key') {
      hasCredential = !!(await manager.getApiKey())
    } else if (authType === 'oauth_token') {
      hasCredential = !!(await manager.getClaudeOAuth())
    } else if (authType === 'craft_credits') {
      // Craft credits use Craft OAuth which is always present after setup
      hasCredential = true
    }

    return { authType, hasCredential }
  })

  // Get credits URL (for top-up)
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_CREDITS_URL, async (): Promise<string | null> => {
    try {
      return await getAiCreditTopUpUrl()
    } catch (error) {
      ipcLog.error('Failed to get credits URL:', error)
      return null
    }
  })

  // Update billing method and credential
  ipcMain.handle(IPC_CHANNELS.SETTINGS_UPDATE_BILLING_METHOD, async (_event, authType: AuthType, credential?: string) => {
    const manager = getCredentialManager()

    // Clear old credentials when switching auth types
    const oldAuthType = getAuthType()
    if (oldAuthType !== authType) {
      if (oldAuthType === 'api_key') {
        await manager.delete({ type: 'anthropic_api_key' })
      } else if (oldAuthType === 'oauth_token') {
        await manager.delete({ type: 'claude_oauth' })
      }
    }

    // Set new auth type
    setAuthType(authType)

    // Store new credential if provided
    if (credential) {
      if (authType === 'api_key') {
        await manager.setApiKey(credential)
      } else if (authType === 'oauth_token') {
        await manager.setClaudeOAuth(credential)
      }
    }

    ipcLog.info(`Billing method updated to: ${authType}`)

    // Reinitialize SessionManager auth to pick up new credentials
    try {
      await sessionManager.reinitializeAuth()
      ipcLog.info('Reinitialized auth after billing update')
    } catch (authError) {
      ipcLog.error('Failed to reinitialize auth:', authError)
      // Don't fail the whole operation if auth reinit fails
    }
  })

  // ============================================================
  // Settings - Model
  // ============================================================

  // Get current model (returns stored model or null if not set)
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_MODEL, async (): Promise<string | null> => {
    return getModel()
  })

  // Set model preference
  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET_MODEL, async (_event, model: string) => {
    setModel(model)
    ipcLog.info(`Model updated to: ${model}`)
  })

  // Open native folder dialog for selecting working directory
  ipcMain.handle(IPC_CHANNELS.OPEN_FOLDER_DIALOG, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
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
      workingDirectory: config?.defaults?.workingDirectory,
      credentialStrategy: config?.defaults?.credentialStrategy || 'local',
      localMcpEnabled: config?.localMcpServers?.enabled ?? true,
    }
  })

  // Update a workspace setting
  // Valid keys: 'name', 'model', 'enabledSourceSlugs', 'permissionMode', 'workingDirectory', 'credentialStrategy', 'localMcpEnabled'
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_SETTINGS_UPDATE, async (_event, workspaceId: string, key: string, value: unknown) => {
    const workspace = getWorkspaceOrThrow(workspaceId)

    // Validate key is a known workspace setting
    const validKeys = ['name', 'model', 'enabledSourceSlugs', 'permissionMode', 'workingDirectory', 'credentialStrategy', 'localMcpEnabled']
    if (!validKeys.includes(key)) {
      throw new Error(`Invalid workspace setting key: ${key}. Valid keys: ${validKeys.join(', ')}`)
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

  // Enable portable credentials for a workspace
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_SETTINGS_ENABLE_PORTABLE, async (_event, workspaceId: string, password: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`)
    }

    const { loadWorkspaceConfig, saveWorkspaceConfig } = await import('@craft-agent/shared/workspaces')
    const { getCredentialManager } = await import('@craft-agent/shared/credentials')

    const config = loadWorkspaceConfig(workspace.rootPath)
    if (!config) {
      throw new Error(`Failed to load workspace config: ${workspaceId}`)
    }

    // Migrate existing credentials to portable storage
    const manager = getCredentialManager()
    const migrated = await manager.migrateToPortable(config.id, workspace.rootPath, password)
    ipcLog.info(`Migrated ${migrated} credentials to portable storage`)

    // Update the credential strategy
    config.defaults = config.defaults || {}
    config.defaults.credentialStrategy = 'portable'
    saveWorkspaceConfig(workspace.rootPath, config)

    ipcLog.info(`Enabled portable credentials for workspace: ${workspaceId}`)
  })

  // Disable portable credentials for a workspace (migrate back to local)
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_SETTINGS_DISABLE_PORTABLE, async (_event, workspaceId: string, password: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`)
    }

    const { loadWorkspaceConfig, saveWorkspaceConfig } = await import('@craft-agent/shared/workspaces')
    const { getCredentialManager } = await import('@craft-agent/shared/credentials')

    const config = loadWorkspaceConfig(workspace.rootPath)
    if (!config) {
      throw new Error(`Failed to load workspace config: ${workspaceId}`)
    }

    // Migrate credentials from portable back to local storage
    const manager = getCredentialManager()
    const migrated = await manager.migrateFromPortable(workspace.rootPath, password)
    ipcLog.info(`Migrated ${migrated} credentials from portable to local storage`)

    // Update the credential strategy
    config.defaults = config.defaults || {}
    config.defaults.credentialStrategy = 'local'
    saveWorkspaceConfig(workspace.rootPath, config)

    ipcLog.info(`Disabled portable credentials for workspace: ${workspaceId}`)
  })

  // ============================================================
  // User Preferences
  // ============================================================

  // Read user preferences file
  ipcMain.handle(IPC_CHANNELS.PREFERENCES_READ, async () => {
    const path = getPreferencesPath()
    if (!existsSync(path)) {
      return { content: '{}', exists: false }
    }
    return { content: readFileSync(path, 'utf-8'), exists: true }
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
  // Markdown Preview Window
  // ============================================================

  // Open markdown preview window
  ipcMain.handle(IPC_CHANNELS.MARKDOWN_PREVIEW_OPEN, async (_event, previewId: string, data: import('../shared/types').MarkdownPreviewData) => {
    await previewWindowManager.openPreview(previewId, data)
  })

  // Get data for a markdown preview (called from preview window on mount)
  ipcMain.handle(IPC_CHANNELS.MARKDOWN_PREVIEW_GET_DATA, async (_event, previewId: string) => {
    return previewWindowManager.getData(previewId)
  })

  // Save edited content to file (only for readWrite mode)
  ipcMain.handle(IPC_CHANNELS.MARKDOWN_PREVIEW_SAVE, async (_event, previewId: string, content: string) => {
    await previewWindowManager.save(previewId, content)
  })

  // ============================================================
  // Diff Preview Window
  // ============================================================

  // Open diff preview window
  ipcMain.handle(IPC_CHANNELS.DIFF_PREVIEW_OPEN, async (_event, sessionId: string, diffId: string, data: DiffPreviewData) => {
    diffPreviewWindowManager.openDiffPreview(sessionId, diffId, data)
  })

  // Get data for a diff preview (called from diff preview window on mount)
  ipcMain.handle(IPC_CHANNELS.DIFF_PREVIEW_GET_DATA, async (_event, sessionId: string, diffId: string) => {
    return diffPreviewWindowManager.getData(sessionId, diffId)
  })

  // ============================================================
  // Code Preview Window (Read/Write tools)
  // ============================================================

  // Open code preview window
  ipcMain.handle(IPC_CHANNELS.CODE_PREVIEW_OPEN, async (_event, sessionId: string, previewId: string, data: CodePreviewData) => {
    codePreviewWindowManager.openCodePreview(sessionId, previewId, data)
  })

  // Get data for a code preview (called from code preview window on mount)
  ipcMain.handle(IPC_CHANNELS.CODE_PREVIEW_GET_DATA, async (_event, sessionId: string, previewId: string) => {
    return codePreviewWindowManager.getData(sessionId, previewId)
  })

  // ============================================================
  // Terminal Preview Window (Bash tools)
  // ============================================================

  // Open terminal preview window
  ipcMain.handle(IPC_CHANNELS.TERMINAL_PREVIEW_OPEN, async (_event, sessionId: string, previewId: string, data: TerminalPreviewData) => {
    terminalPreviewWindowManager.openTerminalPreview(sessionId, previewId, data)
  })

  // Get data for a terminal preview (called from terminal preview window on mount)
  ipcMain.handle(IPC_CHANNELS.TERMINAL_PREVIEW_GET_DATA, async (_event, sessionId: string, previewId: string) => {
    return terminalPreviewWindowManager.getData(sessionId, previewId)
  })

  // ============================================================
  // Multi-File Diff Window (all edits/writes in a turn)
  // ============================================================

  // Open multi-file diff window
  ipcMain.handle(IPC_CHANNELS.MULTI_FILE_DIFF_OPEN, async (_event, sessionId: string, turnId: string, data: MultiFileDiffData) => {
    multiFileDiffWindowManager.openMultiFileDiff(sessionId, turnId, data)
  })

  // Get data for a multi-file diff window (called from multi-file diff window on mount)
  ipcMain.handle(IPC_CHANNELS.MULTI_FILE_DIFF_GET_DATA, async (_event, sessionId: string, turnId: string) => {
    return multiFileDiffWindowManager.getData(sessionId, turnId)
  })

  // Read a file for full-context diff view
  ipcMain.handle(IPC_CHANNELS.MULTI_FILE_DIFF_READ_FILE, async (_event, filePath: string) => {
    try {
      // Resolve relative paths to absolute (Edit tool may use relative paths)
      const absolutePath = resolve(filePath)
      const validPath = await validateFilePath(absolutePath)
      const content = await readFile(validPath, 'utf-8')
      return content
    } catch (err) {
      ipcLog.error('Error reading file for diff:', err)
      return null
    }
  })

  // ============================================================
  // Sources
  // ============================================================

  // Get all sources for a workspace
  ipcMain.handle(IPC_CHANNELS.SOURCES_GET, async (_event, workspaceId: string) => {
    // Look up workspace to get rootPath
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      ipcLog.error(`SOURCES_GET: Workspace not found: ${workspaceId}`)
      return []
    }
    // Set up ConfigWatcher for this workspace to broadcast live updates
    sessionManager.setupConfigWatcher(workspace.rootPath)
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

  // Get agent-scoped sources
  ipcMain.handle(IPC_CHANNELS.SOURCES_GET_AGENT, async (_event, workspaceId: string, agentSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) return []
    const { loadAgentSources } = await import('@craft-agent/shared/sources')
    return loadAgentSources(workspace.rootPath, agentSlug)
  })

  // Promote agent source to workspace (copy)
  ipcMain.handle(IPC_CHANNELS.SOURCES_PROMOTE, async (_event, workspaceId: string, agentSlug: string, sourceSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    const { loadAgentSource, createSource, loadSource } = await import('@craft-agent/shared/sources')

    // Load the agent-scoped source
    const agentSource = loadAgentSource(workspace.rootPath, agentSlug, sourceSlug)
    if (!agentSource) {
      throw new Error(`Agent source not found: ${sourceSlug}`)
    }

    // Check if source already exists at workspace level
    const existingWorkspaceSource = loadSource(workspace.rootPath, sourceSlug)
    if (existingWorkspaceSource) {
      throw new Error(`Source already exists at workspace level: ${sourceSlug}`)
    }

    // Copy to workspace sources
    const newConfig = createSource(workspace.rootPath, {
      name: agentSource.config.name,
      provider: agentSource.config.provider,
      type: agentSource.config.type,
      mcp: agentSource.config.mcp,
      api: agentSource.config.api,
      local: agentSource.config.local,
      iconUrl: agentSource.config.iconUrl,
      enabled: agentSource.config.enabled,
    })

    ipcLog.info(`Promoted source ${sourceSlug} from agent ${agentSlug} to workspace`)
    return newConfig
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
      return JSON.parse(content)
    } catch (error) {
      ipcLog.error('Error reading permissions config:', error)
      return null
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

      // Fetch tools based on transport type
      let tools: Array<{ name: string; description?: string }>

      if (source.config.mcp.transport === 'stdio') {
        // Stdio transport - spawn process and list tools
        ipcLog.info(`Fetching MCP tools via stdio: ${source.config.mcp.command}`)
        const { validateStdioMcpConnection } = await import('@craft-agent/shared/mcp')

        const result = await validateStdioMcpConnection({
          command: source.config.mcp.command!,
          args: source.config.mcp.args,
          env: source.config.mcp.env,
          timeout: 30000,
        })

        if (!result.success) {
          return { success: false, error: result.error || 'Failed to connect to stdio MCP server' }
        }

        // validateStdioMcpConnection only returns tool names, not descriptions
        // For now, we'll just use the names
        tools = (result.tools || []).map(name => ({ name }))
      } else {
        // HTTP/SSE transport - use HTTP client
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
        const { CraftMcpClient } = await import('@craft-agent/shared/mcp')
        const client = new CraftMcpClient({
          url: source.config.mcp.url,
          headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
        })

        tools = await client.listTools()
        await client.close()
      }

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
  // Status Management (Workspace-scoped)
  // ============================================================

  // List all statuses for a workspace
  ipcMain.handle(IPC_CHANNELS.STATUSES_LIST, async (_event, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { listStatuses } = await import('@craft-agent/shared/statuses')
    return listStatuses(workspace.rootPath)
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
      throw new Error(`Image file not found: ${relativePath}`)
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
  // Theme (cascading: app → workspace → agent)
  // ============================================================

  ipcMain.handle(IPC_CHANNELS.THEME_GET_APP, async () => {
    const { loadAppTheme } = await import('@craft-agent/shared/config/storage')
    return loadAppTheme()
  })

  ipcMain.handle(IPC_CHANNELS.THEME_GET_WORKSPACE, async (_event, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      return null
    }
    const { loadWorkspaceTheme } = await import('@craft-agent/shared/config/storage')
    return loadWorkspaceTheme(workspace.rootPath)
  })

  ipcMain.handle(IPC_CHANNELS.THEME_GET_AGENT, async (_event, workspaceId: string, agentSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      return null
    }
    const { loadAgentTheme } = await import('@craft-agent/shared/config/storage')
    return loadAgentTheme(workspace.rootPath, agentSlug)
  })
}
