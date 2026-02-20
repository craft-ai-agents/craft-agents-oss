/**
 * Express application setup for Craft Agents web server.
 * Translates Electron IPC handlers into HTTP REST endpoints.
 */
import express, { type Request, type Response, type NextFunction } from 'express'
import cors from 'cors'
import { join, normalize, isAbsolute, sep, resolve, basename, dirname, relative } from 'path'
import { homedir, tmpdir } from 'os'
import { existsSync, readFileSync } from 'fs'
import { readFile, readdir, stat, realpath, mkdir, writeFile, unlink, rm } from 'fs/promises'
import { randomUUID } from 'crypto'
import { ipcLog, serverLog, searchLog } from './logger.js'
import { broadcastToAll } from './broadcaster.js'

// Shared packages (no Electron dependency)
import {
  getWorkspaces,
  getWorkspaceByNameOrId,
  addWorkspace,
  setActiveWorkspace,
  loadStoredConfig,
  saveConfig,
  getLlmConnections,
  getLlmConnection,
  addLlmConnection,
  updateLlmConnection,
  deleteLlmConnection,
  getDefaultLlmConnection,
  setDefaultLlmConnection,
  getSessionDraft,
  setSessionDraft,
  deleteSessionDraft,
  getAllSessionDrafts,
  getPreferencesPath,
  type Workspace,
  type LlmConnection,
  isCompatProvider,
  isAnthropicProvider,
  isOpenAIProvider,
  isCopilotProvider,
  getDefaultModelsForConnection,
  getDefaultModelForConnection,
} from '@craft-agent/shared/config'
import { getSessionAttachmentsPath, validateSessionId } from '@craft-agent/shared/sessions'
import { loadWorkspaceSources, getSourcesBySlugs, type LoadedSource } from '@craft-agent/shared/sources'
import { getCredentialManager } from '@craft-agent/shared/credentials'
import { getAuthState, getSetupNeeds } from '@craft-agent/shared/auth'
import { listLabels, createLabel, deleteLabel } from '@craft-agent/shared/labels/storage'
import { listViews, saveViews } from '@craft-agent/shared/views/storage'
import { loadAllSkills, loadSkillBySlug } from '../../packages/shared/src/skills/index.ts'
import { loadWorkspaceConfig, saveWorkspaceConfig } from '@craft-agent/shared/workspaces'
import { readFileAttachment, perf, validateImageForClaudeAPI, IMAGE_LIMITS } from '@craft-agent/shared/utils'
import { safeJsonParse } from '@craft-agent/shared/utils/files'
import type { FileAttachment } from '@craft-agent/shared/utils'
import { IPC_CHANNELS } from '../../../electron/src/shared/types.ts'

// Session manager - imports from electron app src (uses our electron mock)
import { SessionManager } from '../../../electron/src/main/sessions.ts'
import { WebWindowManager } from './web-window-manager.ts'

// Initialize session manager and window manager
const webWindowManager = new WebWindowManager()
const sessionManager = new SessionManager()
sessionManager.setWindowManager(webWindowManager as any)

/**
 * Sanitizes a filename to prevent path traversal and filesystem issues.
 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\]/g, '_')
    .replace(/[<>:"|?*]/g, '_')
    .replace(/[\x00-\x1f]/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 200)
    || 'unnamed'
}

/**
 * Validates that a file path is within allowed directories (security check).
 */
async function validateFilePath(filePath: string): Promise<string> {
  let normalizedPath = normalize(filePath)
  if (normalizedPath.startsWith('~')) {
    normalizedPath = normalizedPath.replace(/^~/, homedir())
  }
  if (!isAbsolute(normalizedPath)) {
    throw new Error('Only absolute file paths are allowed')
  }
  let realPath: string
  try {
    realPath = await realpath(normalizedPath)
  } catch {
    realPath = normalizedPath
  }
  const allowedDirs = [homedir(), tmpdir()]
  const isAllowed = allowedDirs.some(dir => {
    const normalizedDir = normalize(dir)
    const normalizedReal = normalize(realPath)
    return normalizedReal.startsWith(normalizedDir + sep) || normalizedReal === normalizedDir
  })
  if (!isAllowed) {
    throw new Error('Access denied: file path is outside allowed directories')
  }
  return realPath
}

export async function createApp() {
  // Initialize session manager
  await sessionManager.initialize()

  // Set up initial workspace if needed
  const workspaces = getWorkspaces()
  if (workspaces.length > 0) {
    const activeWs = workspaces[0]
    webWindowManager.setWorkspaceId(activeWs.id)
    sessionManager.setupConfigWatcher(activeWs.rootPath, activeWs.id)
  }

  const app = express()

  // Middleware
  app.use(cors({ origin: true, credentials: true }))
  app.use(express.json({ limit: '50mb' }))
  app.use(express.urlencoded({ extended: true, limit: '50mb' }))

  // Serve built frontend in production
  const clientDistPath = join(new URL('.', import.meta.url).pathname, '../../dist/client')
  if (existsSync(clientDistPath)) {
    app.use(express.static(clientDistPath))
  }

  // Error handler helper
  function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) {
    return (req: Request, res: Response, next: NextFunction) => {
      fn(req, res, next).catch(next)
    }
  }

  // ============================================================
  // Session Routes
  // ============================================================

  // GET /api/sessions - Get all sessions for workspace
  app.get('/api/sessions', asyncHandler(async (req, res) => {
    await sessionManager.waitForInit()
    const workspaceId = req.query.workspaceId as string || webWindowManager.getWorkspaceId() || undefined
    const sessions = sessionManager.getSessions(workspaceId)
    res.json(sessions)
  }))

  // GET /api/sessions/:sessionId - Get session with messages
  app.get('/api/sessions/:sessionId', asyncHandler(async (req, res) => {
    const session = await sessionManager.getSession(req.params.sessionId)
    if (!session) {
      res.status(404).json({ error: 'Session not found' })
      return
    }
    res.json(session)
  }))

  // POST /api/sessions - Create new session
  app.post('/api/sessions', asyncHandler(async (req, res) => {
    const { workspaceId, options } = req.body
    const wsId = workspaceId || webWindowManager.getWorkspaceId()
    if (!wsId) {
      res.status(400).json({ error: 'workspaceId required' })
      return
    }
    const session = sessionManager.createSession(wsId, options)
    res.json(session)
  }))

  // POST /api/sessions/:parentSessionId/sub-sessions - Create sub-session
  app.post('/api/sessions/:parentSessionId/sub-sessions', asyncHandler(async (req, res) => {
    const { workspaceId, options } = req.body
    const wsId = workspaceId || webWindowManager.getWorkspaceId()
    if (!wsId) {
      res.status(400).json({ error: 'workspaceId required' })
      return
    }
    const session = await sessionManager.createSubSession(wsId, req.params.parentSessionId, options)
    res.json(session)
  }))

  // DELETE /api/sessions/:sessionId - Delete session
  app.delete('/api/sessions/:sessionId', asyncHandler(async (req, res) => {
    await sessionManager.deleteSession(req.params.sessionId)
    res.json({ success: true })
  }))

  // POST /api/sessions/:sessionId/messages - Send a message
  app.post('/api/sessions/:sessionId/messages', asyncHandler(async (req, res) => {
    const { sessionId } = req.params
    const { message, attachments, storedAttachments, options } = req.body

    // Start processing in background - results come via WebSocket
    sessionManager.sendMessage(sessionId, message, attachments, storedAttachments, options).catch(err => {
      ipcLog.error('Error in sendMessage:', err)
      broadcastToAll(IPC_CHANNELS.SESSION_EVENT, {
        type: 'error',
        sessionId,
        error: err instanceof Error ? err.message : 'Unknown error'
      })
      broadcastToAll(IPC_CHANNELS.SESSION_EVENT, {
        type: 'complete',
        sessionId
      })
    })

    res.json({ started: true })
  }))

  // POST /api/sessions/:sessionId/cancel - Cancel processing
  app.post('/api/sessions/:sessionId/cancel', asyncHandler(async (req, res) => {
    const { silent } = req.body
    await sessionManager.cancelProcessing(req.params.sessionId, silent)
    res.json({ success: true })
  }))

  // POST /api/sessions/:sessionId/kill-shell - Kill shell
  app.post('/api/sessions/:sessionId/kill-shell', asyncHandler(async (req, res) => {
    const { shellId } = req.body
    const result = await sessionManager.killShell(req.params.sessionId, shellId)
    res.json(result)
  }))

  // POST /api/sessions/:sessionId/permission - Respond to permission
  app.post('/api/sessions/:sessionId/permission', asyncHandler(async (req, res) => {
    const { requestId, allowed, alwaysAllow } = req.body
    const result = await sessionManager.respondToPermission(req.params.sessionId, requestId, allowed, alwaysAllow)
    res.json({ success: result })
  }))

  // POST /api/sessions/:sessionId/credential - Respond to credential request
  app.post('/api/sessions/:sessionId/credential', asyncHandler(async (req, res) => {
    const { requestId, response } = req.body
    const result = await sessionManager.respondToCredential(req.params.sessionId, requestId, response)
    res.json({ success: result })
  }))

  // POST /api/sessions/:sessionId/command - Consolidated session command
  app.post('/api/sessions/:sessionId/command', asyncHandler(async (req, res) => {
    const { command } = req.body
    const { sessionId } = req.params

    let result: any
    switch (command.type) {
      case 'flag': result = sessionManager.flagSession(sessionId); break
      case 'unflag': result = sessionManager.unflagSession(sessionId); break
      case 'archive': result = sessionManager.archiveSession(sessionId); break
      case 'unarchive': result = sessionManager.unarchiveSession(sessionId); break
      case 'rename': result = sessionManager.renameSession(sessionId, command.name); break
      case 'setSessionStatus': result = sessionManager.setSessionStatus(sessionId, command.state); break
      case 'setActiveViewing':
        sessionManager.setActiveViewingSession(command.workspaceId, sessionId)
        result = undefined; break
      case 'markRead': result = sessionManager.markSessionRead(sessionId); break
      case 'markUnread': result = sessionManager.markSessionUnread(sessionId); break
      case 'setPermissionMode': result = sessionManager.setSessionPermissionMode(sessionId, command.mode); break
      case 'setThinkingLevel': result = sessionManager.setThinkingLevel(sessionId, command.level); break
      case 'share': result = await sessionManager.shareSession(sessionId); break
      case 'revokeShare': result = await sessionManager.revokeSessionShare(sessionId); break
      case 'refreshTitle': result = await sessionManager.refreshSessionTitle(sessionId); break
      case 'getFamily': result = await sessionManager.getSessionFamily(sessionId); break
      case 'getChildSessions': result = await sessionManager.getChildSessions(sessionId); break
      case 'clearMessages': result = await sessionManager.clearSessionMessages(sessionId); break
      case 'compactMessages': result = await sessionManager.compactSessionMessages(sessionId); break
      case 'addLabels': result = await sessionManager.addLabels(sessionId, command.labelIds); break
      case 'removeLabels': result = await sessionManager.removeLabels(sessionId, command.labelIds); break
      case 'reorderSiblings': result = await sessionManager.reorderSiblings(sessionId, command.orderedIds); break
      default:
        res.status(400).json({ error: `Unknown command type: ${command.type}` })
        return
    }

    res.json(result ?? { success: true })
  }))

  // GET /api/sessions/:sessionId/pending-plan - Get pending plan execution
  app.get('/api/sessions/:sessionId/pending-plan', asyncHandler(async (req, res) => {
    const result = await sessionManager.getPendingPlanExecution(req.params.sessionId)
    res.json(result)
  }))

  // GET /api/sessions/:sessionId/files - Get session files
  app.get('/api/sessions/:sessionId/files', asyncHandler(async (req, res) => {
    const files = await sessionManager.getSessionFiles(req.params.sessionId)
    res.json(files)
  }))

  // GET /api/sessions/:sessionId/notes - Get session notes
  app.get('/api/sessions/:sessionId/notes', asyncHandler(async (req, res) => {
    const notes = await sessionManager.getSessionNotes(req.params.sessionId)
    res.json({ content: notes })
  }))

  // PUT /api/sessions/:sessionId/notes - Set session notes
  app.put('/api/sessions/:sessionId/notes', asyncHandler(async (req, res) => {
    await sessionManager.setSessionNotes(req.params.sessionId, req.body.content)
    res.json({ success: true })
  }))

  // GET /api/tasks/:taskId/output - Get background task output
  app.get('/api/tasks/:taskId/output', asyncHandler(async (req, res) => {
    const output = await sessionManager.getTaskOutput(req.params.taskId)
    res.json({ output })
  }))

  // POST /api/sessions/search - Search session content
  app.post('/api/sessions/search', asyncHandler(async (req, res) => {
    const { workspaceId, query, searchId } = req.body
    const results = await sessionManager.searchSessionContent(workspaceId, query, searchId)
    res.json(results)
  }))

  // ============================================================
  // Workspace Routes
  // ============================================================

  // GET /api/workspaces - Get all workspaces
  app.get('/api/workspaces', asyncHandler(async (req, res) => {
    const workspaces = sessionManager.getWorkspaces()
    res.json(workspaces)
  }))

  // POST /api/workspaces - Create workspace
  app.post('/api/workspaces', asyncHandler(async (req, res) => {
    const { folderPath, name } = req.body
    const workspace = addWorkspace({ name, rootPath: folderPath })
    setActiveWorkspace(workspace.id)
    res.json(workspace)
  }))

  // GET /api/workspaces/check-slug - Check if workspace slug exists
  app.get('/api/workspaces/check-slug', asyncHandler(async (req, res) => {
    const slug = req.query.slug as string
    const defaultWorkspacesDir = join(homedir(), '.craft-agent', 'workspaces')
    const workspacePath = join(defaultWorkspacesDir, slug)
    const exists = existsSync(workspacePath)
    res.json({ exists, path: workspacePath })
  }))

  // POST /api/workspaces/switch - Switch active workspace
  app.post('/api/workspaces/switch', asyncHandler(async (req, res) => {
    const { workspaceId } = req.body
    webWindowManager.setWorkspaceId(workspaceId)
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (workspace) {
      sessionManager.setupConfigWatcher(workspace.rootPath, workspaceId)
    }
    res.json({ success: true })
  }))

  // GET /api/workspaces/window - Get current window workspace
  app.get('/api/workspaces/window', asyncHandler(async (req, res) => {
    const workspaceId = webWindowManager.getWorkspaceId()
    if (workspaceId) {
      const workspace = getWorkspaceByNameOrId(workspaceId)
      if (workspace) {
        sessionManager.setupConfigWatcher(workspace.rootPath, workspaceId)
      }
    }
    res.json({ workspaceId })
  }))

  // GET /api/workspaces/:workspaceId/settings - Get workspace settings
  app.get('/api/workspaces/:workspaceId/settings', asyncHandler(async (req, res) => {
    const ws = getWorkspaceByNameOrId(req.params.workspaceId)
    if (!ws) { res.json(null); return }
    const config = loadWorkspaceConfig(ws.rootPath)
    res.json({
      name: config?.name,
      model: config?.defaults?.model,
      permissionMode: config?.defaults?.permissionMode,
      cyclablePermissionModes: config?.defaults?.cyclablePermissionModes,
      thinkingLevel: config?.defaults?.thinkingLevel,
      workingDirectory: config?.defaults?.workingDirectory,
      localMcpEnabled: config?.localMcpServers?.enabled ?? true,
      defaultLlmConnection: config?.defaults?.defaultLlmConnection,
      enabledSourceSlugs: config?.defaults?.enabledSourceSlugs ?? [],
    })
  }))

  // PATCH /api/workspaces/:workspaceId/settings - Update workspace setting
  app.patch('/api/workspaces/:workspaceId/settings', asyncHandler(async (req, res) => {
    const { key, value } = req.body
    const ws = getWorkspaceByNameOrId(req.params.workspaceId)
    if (!ws) { res.status(404).json({ error: 'Workspace not found' }); return }
    const config = loadWorkspaceConfig(ws.rootPath)
    if (!config) { res.status(404).json({ error: 'Workspace config not found' }); return }
    if (key === 'name') {
      config.name = String(value).trim()
    } else {
      if (!config.defaults) config.defaults = {}
      ;(config.defaults as any)[key] = value
    }
    saveWorkspaceConfig(ws.rootPath, config)
    res.json({ success: true })
  }))

  // GET /api/workspaces/:workspaceId/permissions - Get workspace permissions config
  app.get('/api/workspaces/:workspaceId/permissions', asyncHandler(async (req, res) => {
    const config = await sessionManager.getWorkspacePermissionsConfig(req.params.workspaceId)
    res.json(config)
  }))

  // GET /api/workspaces/:workspaceId/image - Read workspace image
  app.get('/api/workspaces/:workspaceId/image', asyncHandler(async (req, res) => {
    const relativePath = req.query.path as string
    const result = await sessionManager.readWorkspaceImage(req.params.workspaceId, relativePath)
    res.json({ data: result })
  }))

  // POST /api/workspaces/:workspaceId/image - Write workspace image
  app.post('/api/workspaces/:workspaceId/image', asyncHandler(async (req, res) => {
    const { relativePath, base64, mimeType } = req.body
    await sessionManager.writeWorkspaceImage(req.params.workspaceId, relativePath, base64, mimeType)
    res.json({ success: true })
  }))

  // ============================================================
  // Window Management (simplified for web)
  // ============================================================

  app.get('/api/window/mode', asyncHandler(async (req, res) => {
    res.json({ mode: 'main' })
  }))

  app.post('/api/window/open-workspace', asyncHandler(async (req, res) => {
    // In web: just switch the workspace (no multi-window support)
    const { workspaceId } = req.body
    webWindowManager.setWorkspaceId(workspaceId)
    res.json({ success: true })
  }))

  app.post('/api/window/close', asyncHandler(async (req, res) => {
    // In web: no-op (browser handles window close)
    res.json({ success: true })
  }))

  app.post('/api/window/traffic-lights', asyncHandler(async (req, res) => {
    // In web: no-op (macOS only feature)
    res.json({ success: true })
  }))

  // ============================================================
  // File Routes
  // ============================================================

  // GET /api/files/read?path=... - Read a file
  app.get('/api/files/read', asyncHandler(async (req, res) => {
    const filePath = req.query.path as string
    const validated = await validateFilePath(filePath)
    const content = await readFile(validated, 'utf-8')
    res.json({ content })
  }))

  // GET /api/files/read-binary?path=... - Read file as base64
  app.get('/api/files/read-binary', asyncHandler(async (req, res) => {
    const filePath = req.query.path as string
    const validated = await validateFilePath(filePath)
    const content = await readFile(validated)
    res.json({ base64: content.toString('base64') })
  }))

  // GET /api/files/read-data-url?path=... - Read file as data URL
  app.get('/api/files/read-data-url', asyncHandler(async (req, res) => {
    const filePath = req.query.path as string
    const validated = await validateFilePath(filePath)
    const content = await readFile(validated)
    const ext = filePath.split('.').pop()?.toLowerCase() || ''
    const mimeTypes: Record<string, string> = {
      'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
      'gif': 'image/gif', 'webp': 'image/webp', 'svg': 'image/svg+xml',
      'pdf': 'application/pdf',
    }
    const mime = mimeTypes[ext] || 'application/octet-stream'
    res.json({ dataUrl: `data:${mime};base64,${content.toString('base64')}` })
  }))

  // POST /api/files/attachment - Read file attachment
  app.post('/api/files/attachment', asyncHandler(async (req, res) => {
    const { path: filePath } = req.body
    const validated = await validateFilePath(filePath)
    const attachment = await readFileAttachment(validated)
    res.json(attachment)
  }))

  // POST /api/files/store-attachment - Store a session attachment
  app.post('/api/files/store-attachment', asyncHandler(async (req, res) => {
    const { sessionId, attachment } = req.body
    const result = await sessionManager.storeAttachment(sessionId, attachment)
    res.json(result)
  }))

  // POST /api/files/thumbnail - Generate thumbnail
  app.post('/api/files/thumbnail', asyncHandler(async (req, res) => {
    // In web context, return null for thumbnails (not needed for web)
    res.json({ thumbnail: null })
  }))

  // GET /api/files/search?basePath=...&query=... - Search files
  app.get('/api/files/search', asyncHandler(async (req, res) => {
    const { basePath, query } = req.query as { basePath: string; query: string }
    const results = await sessionManager.searchFiles(basePath, query)
    res.json(results)
  }))

  // ============================================================
  // System Routes
  // ============================================================

  app.get('/api/system/home-dir', asyncHandler(async (req, res) => {
    res.json({ homeDir: homedir() })
  }))

  app.get('/api/system/debug-mode', asyncHandler(async (req, res) => {
    res.json({ isDebugMode: process.env.CRAFT_DEBUG === '1' })
  }))

  app.get('/api/system/versions', asyncHandler(async (req, res) => {
    res.json({
      node: process.version,
      server: '1.0.0',
      app: '0.4.8',
    })
  }))

  // ============================================================
  // Theme Routes
  // ============================================================

  app.get('/api/theme/system', asyncHandler(async (req, res) => {
    // Web: check system theme via CSS media query (client-side)
    res.json({ isDark: false })
  }))

  app.get('/api/theme/app', asyncHandler(async (req, res) => {
    const theme = await sessionManager.getAppTheme()
    res.json(theme)
  }))

  app.get('/api/theme/presets', asyncHandler(async (req, res) => {
    const presets = await sessionManager.loadPresetThemes()
    res.json(presets)
  }))

  app.get('/api/theme/presets/:themeId', asyncHandler(async (req, res) => {
    const preset = await sessionManager.loadPresetTheme(req.params.themeId)
    res.json(preset)
  }))

  app.get('/api/theme/color', asyncHandler(async (req, res) => {
    const theme = await sessionManager.getColorTheme()
    res.json({ theme })
  }))

  app.post('/api/theme/color', asyncHandler(async (req, res) => {
    await sessionManager.setColorTheme(req.body.themeId)
    res.json({ success: true })
  }))

  app.get('/api/theme/workspace/:workspaceId', asyncHandler(async (req, res) => {
    const theme = await sessionManager.getWorkspaceColorTheme(req.params.workspaceId)
    res.json({ theme })
  }))

  app.post('/api/theme/workspace/:workspaceId', asyncHandler(async (req, res) => {
    await sessionManager.setWorkspaceColorTheme(req.params.workspaceId, req.body.themeId)
    res.json({ success: true })
  }))

  app.get('/api/theme/all-workspace-themes', asyncHandler(async (req, res) => {
    const themes = await sessionManager.getAllWorkspaceThemes()
    res.json(themes)
  }))

  app.post('/api/theme/broadcast-preferences', asyncHandler(async (req, res) => {
    broadcastToAll(IPC_CHANNELS.THEME_PREFERENCES_CHANGED, req.body)
    res.json({ success: true })
  }))

  app.post('/api/theme/broadcast-workspace', asyncHandler(async (req, res) => {
    broadcastToAll(IPC_CHANNELS.THEME_WORKSPACE_THEME_CHANGED, req.body)
    res.json({ success: true })
  }))

  // ============================================================
  // Auth / Onboarding Routes
  // ============================================================

  app.get('/api/auth/state', asyncHandler(async (req, res) => {
    const authState = await getAuthState()
    const setupNeeds = getSetupNeeds(authState)
    res.json({ authState, setupNeeds })
  }))

  app.post('/api/auth/logout', asyncHandler(async (req, res) => {
    const credManager = getCredentialManager()
    await credManager.clearAll()
    res.json({ success: true })
  }))

  app.get('/api/auth/credential-health', asyncHandler(async (req, res) => {
    const health = await sessionManager.getCredentialHealth()
    res.json(health)
  }))

  // Claude OAuth flow
  app.post('/api/auth/claude/start', asyncHandler(async (req, res) => {
    const { startClaudeOAuth } = await import('@craft-agent/shared/auth')
    const authUrl = await startClaudeOAuth((status) => {
      ipcLog.info('[OAuth] Claude OAuth status:', status)
    })
    res.json({ success: true, authUrl })
  }))

  app.post('/api/auth/claude/exchange', asyncHandler(async (req, res) => {
    const { code, connectionSlug } = req.body
    const { exchangeClaudeCode, hasValidOAuthState } = await import('@craft-agent/shared/auth')
    if (!hasValidOAuthState()) {
      res.json({ success: false, error: 'OAuth session expired. Please start again.' })
      return
    }
    const result = await exchangeClaudeCode(code, connectionSlug, (status) => {
      ipcLog.info('[OAuth] Exchange status:', status)
    })
    res.json(result)
  }))

  app.get('/api/auth/claude/has-state', asyncHandler(async (req, res) => {
    const { hasValidOAuthState } = await import('@craft-agent/shared/auth')
    res.json({ hasState: hasValidOAuthState() })
  }))

  app.post('/api/auth/claude/clear-state', asyncHandler(async (req, res) => {
    const { clearOAuthState } = await import('@craft-agent/shared/auth')
    clearOAuthState()
    res.json({ success: true })
  }))

  // ============================================================
  // LLM Connection Routes
  // ============================================================

  app.get('/api/llm-connections', asyncHandler(async (req, res) => {
    const connections = getLlmConnections()
    res.json(connections)
  }))

  app.get('/api/llm-connections/with-status', asyncHandler(async (req, res) => {
    const connections = await sessionManager.listLlmConnectionsWithStatus()
    res.json(connections)
  }))

  app.get('/api/llm-connections/:slug', asyncHandler(async (req, res) => {
    const connection = getLlmConnection(req.params.slug)
    res.json(connection)
  }))

  app.post('/api/llm-connections', asyncHandler(async (req, res) => {
    const connection: LlmConnection = req.body
    try {
      addLlmConnection(connection)
      res.json({ success: true })
    } catch (err) {
      res.json({ success: false, error: err instanceof Error ? err.message : 'Failed to save' })
    }
  }))

  app.put('/api/llm-connections/:slug', asyncHandler(async (req, res) => {
    const connection: LlmConnection = req.body
    updateLlmConnection(req.params.slug, connection)
    res.json({ success: true })
  }))

  app.delete('/api/llm-connections/:slug', asyncHandler(async (req, res) => {
    deleteLlmConnection(req.params.slug)
    res.json({ success: true })
  }))

  app.post('/api/llm-connections/:slug/test', asyncHandler(async (req, res) => {
    const result = await sessionManager.testLlmConnection(req.params.slug)
    res.json(result)
  }))

  app.post('/api/llm-connections/default', asyncHandler(async (req, res) => {
    setDefaultLlmConnection(req.body.slug)
    res.json({ success: true })
  }))

  app.post('/api/llm-connections/workspace-default', asyncHandler(async (req, res) => {
    const { workspaceId, slug } = req.body
    await sessionManager.setWorkspaceDefaultLlmConnection(workspaceId, slug)
    res.json({ success: true })
  }))

  // Setup LLM connection (with credential)
  app.post('/api/settings/setup-llm-connection', asyncHandler(async (req, res) => {
    const result = await sessionManager.setupLlmConnection(req.body)
    res.json(result)
  }))

  // Test API connection
  app.post('/api/settings/test-api-connection', asyncHandler(async (req, res) => {
    const { apiKey, baseUrl, models } = req.body
    const result = await sessionManager.testApiConnection(apiKey, baseUrl, models)
    res.json(result)
  }))

  app.post('/api/settings/test-openai-connection', asyncHandler(async (req, res) => {
    const { apiKey, baseUrl, models } = req.body
    const result = await sessionManager.testOpenAiConnection(apiKey, baseUrl, models)
    res.json(result)
  }))

  // ============================================================
  // Session Model Routes
  // ============================================================

  app.get('/api/sessions/:sessionId/model', asyncHandler(async (req, res) => {
    const { workspaceId } = req.query as { workspaceId: string }
    const model = await sessionManager.getSessionModel(req.params.sessionId, workspaceId)
    res.json({ model })
  }))

  app.post('/api/sessions/:sessionId/model', asyncHandler(async (req, res) => {
    const { workspaceId, model, connection } = req.body
    await sessionManager.setSessionModel(req.params.sessionId, workspaceId, model, connection)
    res.json({ success: true })
  }))

  // ============================================================
  // Preferences Routes
  // ============================================================

  app.get('/api/preferences', asyncHandler(async (req, res) => {
    const prefsPath = getPreferencesPath()
    const exists = existsSync(prefsPath)
    const content = exists ? readFileSync(prefsPath, 'utf-8') : ''
    res.json({ content, exists, path: prefsPath })
  }))

  app.put('/api/preferences', asyncHandler(async (req, res) => {
    const prefsPath = getPreferencesPath()
    await mkdir(dirname(prefsPath), { recursive: true })
    await writeFile(prefsPath, req.body.content, 'utf-8')
    res.json({ success: true })
  }))

  // ============================================================
  // Drafts Routes
  // ============================================================

  app.get('/api/drafts', asyncHandler(async (req, res) => {
    const drafts = getAllSessionDrafts()
    res.json(drafts)
  }))

  app.get('/api/drafts/:sessionId', asyncHandler(async (req, res) => {
    const draft = getSessionDraft(req.params.sessionId)
    res.json({ draft })
  }))

  app.put('/api/drafts/:sessionId', asyncHandler(async (req, res) => {
    setSessionDraft(req.params.sessionId, req.body.text)
    res.json({ success: true })
  }))

  app.delete('/api/drafts/:sessionId', asyncHandler(async (req, res) => {
    deleteSessionDraft(req.params.sessionId)
    res.json({ success: true })
  }))

  // ============================================================
  // Sources Routes
  // ============================================================

  app.get('/api/workspaces/:workspaceId/sources', asyncHandler(async (req, res) => {
    const sources = await sessionManager.getSources(req.params.workspaceId)
    res.json(sources)
  }))

  app.post('/api/workspaces/:workspaceId/sources', asyncHandler(async (req, res) => {
    const result = await sessionManager.createSource(req.params.workspaceId, req.body)
    res.json(result)
  }))

  app.delete('/api/workspaces/:workspaceId/sources/:sourceSlug', asyncHandler(async (req, res) => {
    await sessionManager.deleteSource(req.params.workspaceId, req.params.sourceSlug)
    res.json({ success: true })
  }))

  app.post('/api/workspaces/:workspaceId/sources/:sourceSlug/save-credentials', asyncHandler(async (req, res) => {
    await sessionManager.saveSourceCredentials(req.params.workspaceId, req.params.sourceSlug, req.body.credential)
    res.json({ success: true })
  }))

  app.get('/api/workspaces/:workspaceId/sources/:sourceSlug/permissions', asyncHandler(async (req, res) => {
    const config = await sessionManager.getSourcePermissionsConfig(req.params.workspaceId, req.params.sourceSlug)
    res.json(config)
  }))

  app.get('/api/workspaces/:workspaceId/sources/:sourceSlug/mcp-tools', asyncHandler(async (req, res) => {
    const result = await sessionManager.getMcpTools(req.params.workspaceId, req.params.sourceSlug)
    res.json(result)
  }))

  // Default permissions
  app.get('/api/permissions/defaults', asyncHandler(async (req, res) => {
    const result = await sessionManager.getDefaultPermissionsConfig()
    res.json(result)
  }))

  // ============================================================
  // Skills Routes
  // ============================================================

  app.get('/api/workspaces/:workspaceId/skills', asyncHandler(async (req, res) => {
    const { workingDirectory } = req.query as { workingDirectory?: string }
    const skills = await sessionManager.getSkills(req.params.workspaceId, workingDirectory)
    res.json(skills)
  }))

  app.get('/api/workspaces/:workspaceId/skills/:skillSlug/files', asyncHandler(async (req, res) => {
    const files = await sessionManager.getSkillFiles(req.params.workspaceId, req.params.skillSlug)
    res.json(files)
  }))

  app.delete('/api/workspaces/:workspaceId/skills/:skillSlug', asyncHandler(async (req, res) => {
    await sessionManager.deleteSkill(req.params.workspaceId, req.params.skillSlug)
    res.json({ success: true })
  }))

  // ============================================================
  // Statuses Routes
  // ============================================================

  app.get('/api/workspaces/:workspaceId/statuses', asyncHandler(async (req, res) => {
    const ws = getWorkspaceByNameOrId(req.params.workspaceId)
    if (!ws) { res.status(404).json({ error: 'Workspace not found' }); return }
    const { listStatuses } = await import('@craft-agent/shared/src/statuses/index.ts' as any)
    const statuses = listStatuses(ws.rootPath)
    res.json(statuses)
  }))

  app.post('/api/workspaces/:workspaceId/statuses/reorder', asyncHandler(async (req, res) => {
    const ws = getWorkspaceByNameOrId(req.params.workspaceId)
    if (!ws) { res.status(404).json({ error: 'Workspace not found' }); return }
    const { reorderStatuses } = await import('@craft-agent/shared/src/statuses/crud.ts' as any)
    reorderStatuses(ws.rootPath, req.body.orderedIds)
    res.json({ success: true })
  }))

  // ============================================================
  // Labels Routes
  // ============================================================

  app.get('/api/workspaces/:workspaceId/labels', asyncHandler(async (req, res) => {
    const ws = getWorkspaceByNameOrId(req.params.workspaceId)
    if (!ws) { res.status(404).json({ error: 'Workspace not found' }); return }
    const labels = listLabels(ws.rootPath)
    res.json(labels)
  }))

  app.post('/api/workspaces/:workspaceId/labels', asyncHandler(async (req, res) => {
    const ws = getWorkspaceByNameOrId(req.params.workspaceId)
    if (!ws) { res.status(404).json({ error: 'Workspace not found' }); return }
    const label = createLabel(ws.rootPath, req.body)
    res.json(label)
  }))

  app.delete('/api/workspaces/:workspaceId/labels/:labelId', asyncHandler(async (req, res) => {
    const ws = getWorkspaceByNameOrId(req.params.workspaceId)
    if (!ws) { res.status(404).json({ error: 'Workspace not found' }); return }
    const result = deleteLabel(ws.rootPath, req.params.labelId)
    res.json(result)
  }))

  // ============================================================
  // Views Routes
  // ============================================================

  app.get('/api/workspaces/:workspaceId/views', asyncHandler(async (req, res) => {
    const ws = getWorkspaceByNameOrId(req.params.workspaceId)
    if (!ws) { res.status(404).json({ error: 'Workspace not found' }); return }
    const views = listViews(ws.rootPath)
    res.json(views)
  }))

  app.put('/api/workspaces/:workspaceId/views', asyncHandler(async (req, res) => {
    const ws = getWorkspaceByNameOrId(req.params.workspaceId)
    if (!ws) { res.status(404).json({ error: 'Workspace not found' }); return }
    saveViews(ws.rootPath, req.body)
    res.json({ success: true })
  }))

  // ============================================================
  // Input Settings Routes
  // ============================================================

  app.get('/api/settings/auto-capitalisation', asyncHandler(async (req, res) => {
    const value = await sessionManager.getAutoCapitalisation()
    res.json({ value })
  }))

  app.post('/api/settings/auto-capitalisation', asyncHandler(async (req, res) => {
    await sessionManager.setAutoCapitalisation(req.body.enabled)
    res.json({ success: true })
  }))

  app.get('/api/settings/send-message-key', asyncHandler(async (req, res) => {
    const value = await sessionManager.getSendMessageKey()
    res.json({ value })
  }))

  app.post('/api/settings/send-message-key', asyncHandler(async (req, res) => {
    await sessionManager.setSendMessageKey(req.body.key)
    res.json({ success: true })
  }))

  app.get('/api/settings/spell-check', asyncHandler(async (req, res) => {
    const value = await sessionManager.getSpellCheck()
    res.json({ value })
  }))

  app.post('/api/settings/spell-check', asyncHandler(async (req, res) => {
    await sessionManager.setSpellCheck(req.body.enabled)
    res.json({ success: true })
  }))

  app.get('/api/settings/keep-awake', asyncHandler(async (req, res) => {
    const value = await sessionManager.getKeepAwakeWhileRunning()
    res.json({ value })
  }))

  app.post('/api/settings/keep-awake', asyncHandler(async (req, res) => {
    await sessionManager.setKeepAwakeWhileRunning(req.body.enabled)
    res.json({ success: true })
  }))

  app.get('/api/settings/rich-tool-descriptions', asyncHandler(async (req, res) => {
    const value = await sessionManager.getRichToolDescriptions()
    res.json({ value })
  }))

  app.post('/api/settings/rich-tool-descriptions', asyncHandler(async (req, res) => {
    await sessionManager.setRichToolDescriptions(req.body.enabled)
    res.json({ success: true })
  }))

  app.get('/api/settings/notifications-enabled', asyncHandler(async (req, res) => {
    const value = await sessionManager.getNotificationsEnabled()
    res.json({ value })
  }))

  app.post('/api/settings/notifications-enabled', asyncHandler(async (req, res) => {
    await sessionManager.setNotificationsEnabled(req.body.enabled)
    res.json({ success: true })
  }))

  // ============================================================
  // Tool Icons Route
  // ============================================================

  app.get('/api/tool-icons', asyncHandler(async (req, res) => {
    const icons = await sessionManager.getToolIconMappings()
    res.json(icons)
  }))

  // ============================================================
  // Shell / OS Routes (web-adapted)
  // ============================================================

  // In web, we return the URL for the client to navigate to
  app.post('/api/shell/open-url', asyncHandler(async (req, res) => {
    res.json({ url: req.body.url })
  }))

  app.post('/api/shell/open-file', asyncHandler(async (req, res) => {
    // In web context, we can't open files natively
    res.json({ success: false, error: 'Cannot open files in web mode' })
  }))

  app.post('/api/shell/show-in-folder', asyncHandler(async (req, res) => {
    // In web context: return the folder path for client display
    res.json({ success: false, error: 'Cannot show in folder in web mode' })
  }))

  // ============================================================
  // Update Routes (stubs - not applicable for web)
  // ============================================================

  app.get('/api/update/info', asyncHandler(async (req, res) => {
    res.json({ hasUpdate: false, version: null })
  }))

  app.post('/api/update/check', asyncHandler(async (req, res) => {
    res.json({ hasUpdate: false })
  }))

  app.post('/api/update/install', asyncHandler(async (req, res) => {
    res.json({ success: false, error: 'Auto-update not available in web mode' })
  }))

  app.get('/api/update/dismissed', asyncHandler(async (req, res) => {
    res.json({ version: null })
  }))

  app.post('/api/update/dismiss', asyncHandler(async (req, res) => {
    res.json({ success: true })
  }))

  app.get('/api/release-notes', asyncHandler(async (req, res) => {
    res.json({ notes: '' })
  }))

  app.get('/api/release-notes/latest-version', asyncHandler(async (req, res) => {
    res.json({ version: null })
  }))

  // ============================================================
  // Logo URL (web-adapted)
  // ============================================================

  app.get('/api/logo-url', asyncHandler(async (req, res) => {
    // Return null - in web we use favicon.ico or similar
    res.json({ url: null })
  }))

  // ============================================================
  // Git Operations
  // ============================================================

  app.get('/api/git/branch', asyncHandler(async (req, res) => {
    const { dirPath } = req.query as { dirPath: string }
    const branch = await sessionManager.getGitBranch(dirPath)
    res.json({ branch })
  }))

  // ============================================================
  // Notifications (web-adapted)
  // ============================================================

  app.post('/api/notifications/show', asyncHandler(async (req, res) => {
    // In web: broadcast via WebSocket so client can show a browser notification
    broadcastToAll('notification', {
      title: req.body.title,
      body: req.body.body,
      workspaceId: req.body.workspaceId,
      sessionId: req.body.sessionId,
    })
    res.json({ success: true })
  }))

  app.post('/api/notifications/update-badge', asyncHandler(async (req, res) => {
    // No-op in web
    res.json({ success: true })
  }))

  // ============================================================
  // Debug logging
  // ============================================================

  app.post('/api/debug/log', asyncHandler(async (req, res) => {
    const { args } = req.body
    ipcLog.info('[renderer]', ...args)
    res.json({ success: true })
  }))

  // ============================================================
  // Confirmation dialogs (web-adapted)
  // ============================================================

  // In web, these are handled client-side - server just confirms
  app.post('/api/dialog/confirm-logout', asyncHandler(async (req, res) => {
    res.json({ confirmed: true })
  }))

  app.post('/api/dialog/confirm-delete-session', asyncHandler(async (req, res) => {
    res.json({ confirmed: true })
  }))

  app.post('/api/dialog/open-folder', asyncHandler(async (req, res) => {
    // In web: can't open folder dialog - return null
    res.json({ folderPath: null })
  }))

  // ============================================================
  // Catch-all for SPA routing
  // ============================================================

  if (existsSync(clientDistPath)) {
    app.get('*', (req, res) => {
      res.sendFile(join(clientDistPath, 'index.html'))
    })
  }

  // Error handler
  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    serverLog.error('API error:', err.message)
    res.status(500).json({
      error: err.message || 'Internal server error'
    })
  })

  return app
}
