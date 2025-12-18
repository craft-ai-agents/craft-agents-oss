import { ipcMain, nativeTheme, nativeImage, dialog, shell, BrowserWindow } from 'electron'
import { readFile, realpath, mkdir, writeFile, unlink, rm } from 'fs/promises'
import { normalize, isAbsolute, join, basename } from 'path'
import { homedir, tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { SessionManager } from './sessions'
import { agentService } from './agent-service'
import { registerOnboardingHandlers } from './onboarding'
import { IPC_CHANNELS, type FileAttachment, type StoredAttachment, type AgentActivateOptions, type AuthType, type BillingMethodInfo } from '../shared/types'
import { readFileAttachment } from '@craft-agent/shared/utils'
import { getSessionAttachmentsPath, getAuthType, setAuthType } from '@craft-agent/shared/config'
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

export function registerIpcHandlers(sessionManager: SessionManager): void {
  // Get all sessions
  ipcMain.handle(IPC_CHANNELS.GET_SESSIONS, async () => {
    return sessionManager.getSessions()
  })

  // Get workspaces
  ipcMain.handle(IPC_CHANNELS.GET_WORKSPACES, async () => {
    return sessionManager.getWorkspaces()
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
  ipcMain.handle(IPC_CHANNELS.SEND_MESSAGE, async (_event, sessionId: string, message: string, attachments?: FileAttachment[], storedAttachments?: StoredAttachment[]) => {
    // Start processing in background, errors are sent via event stream
    sessionManager.sendMessage(sessionId, message, attachments, storedAttachments).catch(err => {
      console.error('[IPC] Error in sendMessage:', err)
      // Send error to renderer so user sees it (not just logged to console)
      const mainWindow = BrowserWindow.getAllWindows()[0]
      if (mainWindow) {
        mainWindow.webContents.send(IPC_CHANNELS.SESSION_EVENT, {
          type: 'error',
          sessionId,
          error: err instanceof Error ? err.message : 'Unknown error'
        })
        // Also send complete event to clear processing state
        mainWindow.webContents.send(IPC_CHANNELS.SESSION_EVENT, {
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

  // Archive a session
  ipcMain.handle(IPC_CHANNELS.ARCHIVE_SESSION, async (_event, sessionId: string) => {
    return sessionManager.archiveSession(sessionId)
  })

  // Unarchive a session
  ipcMain.handle(IPC_CHANNELS.UNARCHIVE_SESSION, async (_event, sessionId: string) => {
    return sessionManager.unarchiveSession(sessionId)
  })

  // Rename a session
  ipcMain.handle(IPC_CHANNELS.RENAME_SESSION, async (_event, sessionId: string, name: string) => {
    return sessionManager.renameSession(sessionId, name)
  })

  // Respond to a permission request (bash command approval)
  // Returns true if the response was delivered, false if agent/session is gone
  ipcMain.handle(IPC_CHANNELS.RESPOND_TO_PERMISSION, async (_event, sessionId: string, requestId: string, allowed: boolean, alwaysAllow: boolean) => {
    return sessionManager.respondToPermission(sessionId, requestId, allowed, alwaysAllow)
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
  ipcMain.handle(IPC_CHANNELS.RESET_AGENT, async (_event, workspaceId: string, agentId: string) => {
    return agentService.resetAgent(workspaceId, agentId)
  })

  // Agent authentication - get detailed requirements
  ipcMain.handle(IPC_CHANNELS.GET_AGENT_AUTH_REQUIREMENTS, async (_event, workspaceId: string, agentId: string) => {
    return agentService.getAuthRequirements(workspaceId, agentId)
  })

  // Agent authentication - start OAuth flow for MCP server
  ipcMain.handle(IPC_CHANNELS.START_MCP_OAUTH, async (_event, workspaceId: string, agentId: string, serverUrl: string, serverName: string) => {
    return agentService.startMcpOAuth(workspaceId, agentId, serverUrl, serverName)
  })

  // Agent authentication - save bearer token for MCP server
  ipcMain.handle(IPC_CHANNELS.SAVE_MCP_BEARER, async (_event, workspaceId: string, agentId: string, serverName: string, token: string) => {
    return agentService.saveMcpBearer(workspaceId, agentId, serverName, token)
  })

  // Agent authentication - save API credentials
  ipcMain.handle(IPC_CHANNELS.SAVE_API_CREDENTIALS, async (_event, workspaceId: string, agentId: string, apiName: string, credential: string) => {
    return agentService.saveApiCredentials(workspaceId, agentId, apiName, credential)
  })

  // Agent authentication - validate MCP connection
  ipcMain.handle(IPC_CHANNELS.VALIDATE_MCP_CONNECTION, async (_event, serverUrl: string, accessToken?: string) => {
    return agentService.validateMcpConnectionStatus(serverUrl, accessToken)
  })

  // ============================================================
  // Agent State Management (unified state machine)
  // ============================================================

  // Get current agent status for a session
  ipcMain.handle(IPC_CHANNELS.AGENT_GET_STATUS, async (_event, sessionId: string) => {
    return sessionManager.getAgentStatus(sessionId)
  })

  // Start agent activation flow
  ipcMain.handle(IPC_CHANNELS.AGENT_ACTIVATE, async (_event, sessionId: string, agentId: string, options?: AgentActivateOptions) => {
    return sessionManager.activateAgentForSession(sessionId, agentId, options)
  })

  // Continue after user completes review
  ipcMain.handle(IPC_CHANNELS.AGENT_CONTINUE_REVIEW, async (_event, sessionId: string, answers: Record<string, string>) => {
    return sessionManager.continueAfterReview(sessionId, answers)
  })

  // Continue after MCP server auth completes
  ipcMain.handle(IPC_CHANNELS.AGENT_CONTINUE_MCP_AUTH, async (_event, sessionId: string) => {
    return sessionManager.continueAfterMcpAuth(sessionId)
  })

  // Continue after API auth completes
  ipcMain.handle(IPC_CHANNELS.AGENT_CONTINUE_API_AUTH, async (_event, sessionId: string) => {
    return sessionManager.continueAfterApiAuth(sessionId)
  })

  // Deactivate agent for a session
  ipcMain.handle(IPC_CHANNELS.AGENT_DEACTIVATE, async (_event, sessionId: string) => {
    return sessionManager.deactivateAgentForSession(sessionId)
  })

  // Reload agent (clear cache, re-extract)
  ipcMain.handle(IPC_CHANNELS.AGENT_RELOAD, async (_event, sessionId: string) => {
    return sessionManager.reloadAgentForSession(sessionId)
  })

  // Reset agent (clear cache AND credentials)
  ipcMain.handle(IPC_CHANNELS.AGENT_RESET, async (_event, sessionId: string) => {
    return sessionManager.resetAgentForSession(sessionId)
  })

  // Mark agent as active (after definition applied to CraftAgent)
  ipcMain.handle(IPC_CHANNELS.AGENT_MARK_ACTIVE, async (_event, sessionId: string) => {
    return sessionManager.markAgentActive(sessionId)
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

  // Show logout confirmation dialog
  ipcMain.handle(IPC_CHANNELS.SHOW_LOGOUT_CONFIRMATION, async () => {
    const mainWindow = BrowserWindow.getAllWindows()[0]
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['Cancel', 'Log Out'],
      defaultId: 0,
      cancelId: 0,
      destructiveId: 1,  // Makes "Log Out" button red on macOS
      title: 'Log Out',
      message: 'Are you sure you want to log out?',
      detail: 'All conversations will be deleted. This action cannot be undone.',
    })
    // result.response is the index of the clicked button
    // 0 = Cancel, 1 = Log Out
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
  })

  // Register onboarding handlers
  registerOnboardingHandlers()
}
