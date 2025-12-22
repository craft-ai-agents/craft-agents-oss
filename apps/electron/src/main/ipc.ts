import { ipcMain, nativeTheme, nativeImage, dialog, shell, BrowserWindow } from 'electron'
import { readFile, realpath, mkdir, writeFile, unlink, rm } from 'fs/promises'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { normalize, isAbsolute, join, basename, dirname } from 'path'
import { homedir, tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { SessionManager } from './sessions'
import { WindowManager } from './window-manager'
import { PreviewWindowManager } from './preview-window'
import { DiffPreviewWindowManager } from './diff-preview-window'
import { CodePreviewWindowManager } from './code-preview-window'
import { TerminalPreviewWindowManager } from './terminal-preview-window'
import { agentService } from './agent-service'
import { registerOnboardingHandlers } from './onboarding'
import { IPC_CHANNELS, type FileAttachment, type StoredAttachment, type AgentActivateOptions, type AuthType, type BillingMethodInfo, type SendMessageOptions, type DiffPreviewData, type CodePreviewData, type TerminalPreviewData } from '../shared/types'
import { readFileAttachment } from '@craft-agent/shared/utils'
import { getAiCreditTopUpUrl } from '@craft-agent/shared/auth'
import { getSessionAttachmentsPath, getAuthType, setAuthType, getPreferencesPath, getModel, setModel, getSessionDraft, setSessionDraft, deleteSessionDraft, getAllSessionDrafts, getDefaultPlanMode, setDefaultPlanMode, getDefaultSkipPermissions, setDefaultSkipPermissions } from '@craft-agent/shared/config'
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

export function registerIpcHandlers(sessionManager: SessionManager, windowManager: WindowManager, previewWindowManager: PreviewWindowManager, diffPreviewWindowManager: DiffPreviewWindowManager, codePreviewWindowManager: CodePreviewWindowManager, terminalPreviewWindowManager: TerminalPreviewWindowManager): void {
  // Get all sessions
  ipcMain.handle(IPC_CHANNELS.GET_SESSIONS, async () => {
    return sessionManager.getSessions()
  })

  // Get workspaces
  ipcMain.handle(IPC_CHANNELS.GET_WORKSPACES, async () => {
    return sessionManager.getWorkspaces()
  })

  // ============================================================
  // Window Management
  // ============================================================

  // Get workspace ID for the calling window
  ipcMain.handle(IPC_CHANNELS.GET_WINDOW_WORKSPACE, (event) => {
    return windowManager.getWorkspaceForWindow(event.sender.id)
  })

  // Open workspace in new window (or focus existing)
  ipcMain.handle(IPC_CHANNELS.OPEN_WORKSPACE, async (_event, workspaceId: string) => {
    windowManager.focusOrCreateWindow(workspaceId)
  })

  // Get mode for the calling window
  ipcMain.handle(IPC_CHANNELS.GET_WINDOW_MODE, (event) => {
    return windowManager.getModeForWindow(event.sender.id)
  })

  // Open add workspace wizard in new window
  ipcMain.handle(IPC_CHANNELS.OPEN_ADD_WORKSPACE, async () => {
    windowManager.createWindow('', 'add-workspace')
  })

  // Close the calling window
  ipcMain.handle(IPC_CHANNELS.CLOSE_WINDOW, (event) => {
    windowManager.closeWindow(event.sender.id)
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
      console.error('[IPC] Error in sendMessage:', err)
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
  ipcMain.handle(IPC_CHANNELS.CANCEL_PROCESSING, async (_event, sessionId: string) => {
    return sessionManager.cancelProcessing(sessionId)
  })

  // Flag a session
  ipcMain.handle(IPC_CHANNELS.FLAG_SESSION, async (_event, sessionId: string) => {
    return sessionManager.flagSession(sessionId)
  })

  // Unflag a session
  ipcMain.handle(IPC_CHANNELS.UNFLAG_SESSION, async (_event, sessionId: string) => {
    return sessionManager.unflagSession(sessionId)
  })

  // Set todo state for a session
  ipcMain.handle(IPC_CHANNELS.SET_TODO_STATE, async (_event, sessionId: string, state: 'todo' | 'in-progress' | 'needs-review' | 'done' | 'cancelled') => {
    return sessionManager.setTodoState(sessionId, state)
  })

  // Mark session as read (set lastReadMessageId to last message)
  ipcMain.handle(IPC_CHANNELS.MARK_SESSION_READ, async (_event, sessionId: string) => {
    return sessionManager.markSessionRead(sessionId)
  })

  // Mark session as unread (clear lastReadMessageId)
  ipcMain.handle(IPC_CHANNELS.MARK_SESSION_UNREAD, async (_event, sessionId: string) => {
    return sessionManager.markSessionUnread(sessionId)
  })

  // Rename a session
  ipcMain.handle(IPC_CHANNELS.RENAME_SESSION, async (_event, sessionId: string, name: string) => {
    return sessionManager.renameSession(sessionId, name)
  })

  // Set skip permissions for a session
  ipcMain.handle(IPC_CHANNELS.SET_SKIP_PERMISSIONS, async (_event, sessionId: string, enabled: boolean) => {
    return sessionManager.setSkipPermissions(sessionId, enabled)
  })

  // Respond to a permission request (bash command approval)
  // Returns true if the response was delivered, false if agent/session is gone
  ipcMain.handle(IPC_CHANNELS.RESPOND_TO_PERMISSION, async (_event, sessionId: string, requestId: string, allowed: boolean, alwaysAllow: boolean) => {
    return sessionManager.respondToPermission(sessionId, requestId, allowed, alwaysAllow)
  })

  // Respond to a plan review request
  // Returns true if the response was delivered, false if agent/session is gone
  ipcMain.handle(IPC_CHANNELS.RESPOND_TO_PLAN_REVIEW, async (_event, sessionId: string, requestId: string, response: { action: string; feedback?: string; modifiedPlan?: unknown }) => {
    return sessionManager.respondToPlanReview(sessionId, requestId, response)
  })

  // Respond to an ask question request (CraftAgentsPlanModeAskQuestion tool)
  // Returns true if the response was delivered, false if agent/session is gone
  ipcMain.handle(IPC_CHANNELS.RESPOND_TO_ASK_QUESTION, async (_event, sessionId: string, requestId: string, answers: Record<string, string>) => {
    return sessionManager.respondToAskQuestion(sessionId, requestId, answers)
  })

  // Set plan mode for a session
  ipcMain.handle(IPC_CHANNELS.SET_PLAN_MODE, async (_event, sessionId: string, enabled: boolean) => {
    return sessionManager.setPlanMode(sessionId, enabled)
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
      console.error('[IPC] readFile error:', message)
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
        console.log('[IPC] Quick Look thumbnail failed (using fallback):', thumbError instanceof Error ? thumbError.message : thumbError)
      }

      return attachment
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.error('[IPC] readFileAttachment error:', message)
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
      console.log('[IPC] generateThumbnail failed:', error instanceof Error ? error.message : error)
      return null
    }
  })

  // Store an attachment to disk and generate thumbnail/markdown conversion
  // This is the core of the persistent file attachment system
  ipcMain.handle(IPC_CHANNELS.STORE_ATTACHMENT, async (_event, sessionId: string, attachment: FileAttachment): Promise<StoredAttachment> => {
    // Track files we've written for cleanup on error
    const filesToCleanup: string[] = []

    try {
      // Reject empty files early
      if (attachment.size === 0) {
        throw new Error('Cannot attach empty file')
      }

      // Create attachments directory if it doesn't exist
      const attachmentsDir = getSessionAttachmentsPath(sessionId)
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
        console.log('[IPC] Thumbnail generation failed (using fallback):', thumbError instanceof Error ? thumbError.message : thumbError)
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
          console.log(`[IPC] Converted Office file to markdown: ${mdPath}`)
        } catch (convertError) {
          // Conversion failed - throw so user knows the file can't be processed
          // Claude can't read raw Office binary, so a failed conversion = unusable file
          const errorMsg = convertError instanceof Error ? convertError.message : String(convertError)
          console.error('[IPC] Office to markdown conversion failed:', errorMsg)
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
        console.log(`[IPC] Cleaning up ${filesToCleanup.length} orphaned file(s) after storage error`)
        await Promise.all(filesToCleanup.map(f => unlink(f).catch(() => {})))
      }

      const message = error instanceof Error ? error.message : 'Unknown error'
      console.error('[IPC] storeAttachment error:', message)
      throw new Error(`Failed to store attachment: ${message}`)
    }
  })

  // Get system theme preference (dark = true, light = false)
  ipcMain.handle(IPC_CHANNELS.GET_SYSTEM_THEME, () => {
    return nativeTheme.shouldUseDarkColors
  })

  // Agent management
  ipcMain.handle(IPC_CHANNELS.GET_AGENTS, async (_event, workspaceId: string) => {
    return agentService.getAgents(workspaceId)
  })

  ipcMain.handle(IPC_CHANNELS.REFRESH_AGENTS, async (_event, workspaceId: string) => {
    return agentService.refreshAgents(workspaceId)
  })

  // Check if an agent needs authentication
  ipcMain.handle(IPC_CHANNELS.CHECK_AGENT_AUTH, async (_event, workspaceId: string, agentId: string) => {
    return agentService.checkAgentAuthStatus(workspaceId, agentId)
  })

  // Get detailed setup status (distinguishes setup needed vs auth needed)
  ipcMain.handle(IPC_CHANNELS.GET_AGENT_SETUP_STATUS, async (_event, workspaceId: string, agentId: string) => {
    return agentService.getAgentSetupStatus(workspaceId, agentId)
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
      console.error('[IPC] openUrl error:', message)
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
      console.error('[IPC] openFile error:', message)
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
      console.error('[IPC] showInFolder error:', message)
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

      console.log('[IPC] Logout complete - cleared all credentials and config')
    } catch (error) {
      console.error('[IPC] Logout error:', error)
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
      console.error('[IPC] Failed to get credits URL:', error)
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

    console.log(`[IPC] Billing method updated to: ${authType}`)

    // Reinitialize SessionManager auth to pick up new credentials
    try {
      await sessionManager.reinitializeAuth()
      console.log('[IPC] Reinitialized auth after billing update')
    } catch (authError) {
      console.error('[IPC] Failed to reinitialize auth:', authError)
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
    console.log(`[IPC] Model updated to: ${model}`)
  })

  // ============================================================
  // Settings - New Session Defaults
  // ============================================================

  // Get default plan mode for new sessions
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_DEFAULT_PLAN_MODE, async (): Promise<boolean> => {
    return getDefaultPlanMode()
  })

  // Set default plan mode for new sessions
  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET_DEFAULT_PLAN_MODE, async (_event, enabled: boolean) => {
    setDefaultPlanMode(enabled)
    console.log(`[IPC] Default plan mode updated to: ${enabled}`)
  })

  // Get default skip permissions for new sessions
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_DEFAULT_SKIP_PERMISSIONS, async (): Promise<boolean> => {
    return getDefaultSkipPermissions()
  })

  // Set default skip permissions for new sessions
  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET_DEFAULT_SKIP_PERMISSIONS, async (_event, enabled: boolean) => {
    setDefaultSkipPermissions(enabled)
    console.log(`[IPC] Default skip permissions updated to: ${enabled}`)
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
  // Preview Window
  // ============================================================

  // Open preview window for a message
  ipcMain.handle(IPC_CHANNELS.PREVIEW_OPEN, async (_event, sessionId: string, messageId: string, content: string) => {
    previewWindowManager.openPreview(sessionId, messageId, content)
  })

  // Get content for a preview (called from preview window on mount)
  ipcMain.handle(IPC_CHANNELS.PREVIEW_GET_CONTENT, async (_event, sessionId: string, messageId: string) => {
    return previewWindowManager.getContent(sessionId, messageId)
  })

  // Save edited content back to session
  ipcMain.handle(IPC_CHANNELS.PREVIEW_SAVE, async (_event, sessionId: string, messageId: string, content: string) => {
    // Update message in session storage
    sessionManager.updateMessageContent(sessionId, messageId, content)
    // Update preview window's original content
    previewWindowManager.updateOriginalContent(sessionId, messageId, content)
    // Broadcast to main window so it can update its UI
    windowManager.broadcastToAll(IPC_CHANNELS.PREVIEW_MESSAGE_UPDATED, sessionId, messageId, content)
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

  // Register onboarding handlers
  registerOnboardingHandlers(sessionManager)
}
