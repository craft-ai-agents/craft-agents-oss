import { readFile, writeFile, stat } from 'fs/promises'
import { join, resolve, sep } from 'path'
import { RPC_CHANNELS, type FileAttachment, type SendMessageOptions, type SessionEvent } from '@archstudio/shared/protocol'
import type { StoredAttachment } from '@archstudio/core/types'
import { getWorkspaceByNameOrId } from '@archstudio/shared/config'
import { perf } from '@archstudio/shared/utils'
import { isValidThinkingLevel, THINKING_LEVEL_IDS } from '@archstudio/shared/agent/thinking-levels'

const VALID_THINKING_LEVELS_LIST = THINKING_LEVEL_IDS.map(id => `'${id}'`).join(', ')
import { pushTyped, type RpcServer } from '@archstudio/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { setTransferableHandler } from './transfer'

interface ClientSessionWatchState {
  watcher: import('fs').FSWatcher
  sessionId: string
  debounceTimer: ReturnType<typeof setTimeout> | null
}

// Per-client session file watcher state (supports concurrent windows/clients safely)
const clientSessionWatches = new Map<string, ClientSessionWatchState>()

const SESSION_GET_LOG_ID_LIMIT = 25

/**
 * Build an Error that matches the standard `DOMException('AbortError')`
 * shape without depending on the DOMException global (which is host-defined
 * and not available in plain Node before v17). The handler checks
 * `error.name === 'AbortError'` so this matches the same contract without
 * coupling to the DOM.
 *
 * Exported so sibling handlers (./media.ts uses it via the shared recursive
 * scanner) can produce the same shape on cancel paths.
 */
export function makeAbortError(): Error {
  const err = new Error('Aborted')
  err.name = 'AbortError'
  return err
}

function summarizeIds(ids: Iterable<string>, limit = SESSION_GET_LOG_ID_LIMIT) {
  const all = Array.from(ids)
  return {
    count: all.length,
    ids: all.slice(0, limit),
    truncated: all.length > limit,
  }
}

function sessionWorkspaceDistribution(sessions: Array<{ workspaceId?: string }>): Record<string, number> {
  const distribution: Record<string, number> = {}
  for (const session of sessions) {
    const key = session.workspaceId || '(missing)'
    distribution[key] = (distribution[key] ?? 0) + 1
  }
  return distribution
}

/**
 * Clean up session file watcher for a client.
 * Called from main process disconnect hooks to prevent watcher leaks.
 */
export function cleanupSessionFileWatchForClient(clientId: string): void {
  const state = clientSessionWatches.get(clientId)
  if (!state) return

  if (state.debounceTimer) {
    clearTimeout(state.debounceTimer)
    state.debounceTimer = null
  }

  state.watcher.close()
  clientSessionWatches.delete(clientId)
}

// Recursive directory scanner for session files
// Filters out internal files (session.jsonl) and hidden files (. prefix)
// Returns only non-empty directories
//
// `signal` (optional): AbortSignal from the originating RPC. Checked between
// directory entries so a cancelled request can bail out of deep recursions
// before they finish walking the whole tree. Throws an Error with name
// 'AbortError' when signalled — the RPC layer will translate that into a
// HANDLER_ERROR reply (the renderer's pending promise was already rejected
// locally by its AbortSignal listener).
//
// `kindFilter` (optional): when provided, only files whose extension matches
// the requested media kind are emitted. Used by `media:list` (see ./media.ts)
// to short-circuit before the per-session tree walker marshals into the
// renderer's `walk()` + `classify()` flow.
export async function scanSessionDirectory(
  dirPath: string,
  signal?: AbortSignal,
  kindFilter?: import('@archstudio/shared/protocol').MediaKind,
): Promise<import('@archstudio/shared/protocol').SessionFile[]> {
  const { readdir, stat } = await import('fs/promises')
  if (signal?.aborted) throw makeAbortError()
  const entries = await readdir(dirPath, { withFileTypes: true })
  const files: import('@archstudio/shared/protocol').SessionFile[] = []

  for (const entry of entries) {
    if (signal?.aborted) throw makeAbortError()
    // Skip internal and hidden files
    if (entry.name === 'session.jsonl' || entry.name.startsWith('.')) continue

    const fullPath = join(dirPath, entry.name)

    if (entry.isDirectory()) {
      // Recursively scan subdirectory
      const children = await scanSessionDirectory(fullPath, signal, kindFilter)
      // Only include non-empty directories (empty after the kind filter is
      // also empty for our purposes — prune so the renderer's tree view
      // doesn't show ghost parent directories)
      if (children.length > 0) {
        files.push({
          name: entry.name,
          path: fullPath,
          type: 'directory',
          children,
        })
      }
    } else {
      // Cheap pre-classify when a filter is requested; skip without stat.
      if (kindFilter && !matchesMediaKind(entry.name, kindFilter)) continue
      const stats = await stat(fullPath)
      files.push({
        name: entry.name,
        path: fullPath,
        type: 'file',
        size: stats.size,
        mtime: stats.mtimeMs,
      })
    }
  }

  // Sort: directories first, then alphabetically
  return files.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

/**
 * Cheap extension check used by `scanSessionDirectory` to short-circuit when
 * the renderer has asked for a single kind. Centralizing the EXT map server-
 * side also keeps the renderer's `classify()` and the server's classification
 * in sync (single source of truth).
 */
export const MEDIA_KIND_EXTENSIONS: Record<import('@archstudio/shared/protocol').MediaKind, readonly string[]> = {
  image: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.avif'],
  video: ['.mp4', '.mov', '.webm', '.mkv', '.avi'],
  audio: ['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac'],
  doc: ['.pdf', '.docx', '.pptx', '.xlsx', '.csv', '.md'],
}

export function matchesMediaKind(
  fileName: string,
  kind: import('@archstudio/shared/protocol').MediaKind,
): boolean {
  const lower = fileName.toLowerCase()
  return MEDIA_KIND_EXTENSIONS[kind].some((ext) => lower.endsWith(ext))
}

/**
 * Classify a basename into a media kind, or null when the file isn't a known
 * media extension. Mirror of the renderer's old `classify()` — kept here so
 * the `media:list` handler can tag every emitted `MediaItem` with its kind
 * in a single pass, without shipping the EXT map to the renderer.
 */
export function classifyMedia(
  fileName: string,
): import('@archstudio/shared/protocol').MediaKind | null {
  for (const kind of Object.keys(MEDIA_KIND_EXTENSIONS) as import('@archstudio/shared/protocol').MediaKind[]) {
    if (matchesMediaKind(fileName, kind)) return kind
  }
  return null
}

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.sessions.GET,
  RPC_CHANNELS.sessions.GET_UNREAD_SUMMARY,
  RPC_CHANNELS.sessions.MARK_ALL_READ,
  RPC_CHANNELS.sessions.CREATE,
  RPC_CHANNELS.sessions.DELETE,
  RPC_CHANNELS.sessions.GET_MESSAGES,
  RPC_CHANNELS.sessions.SEND_MESSAGE,
  RPC_CHANNELS.sessions.CANCEL,
  RPC_CHANNELS.sessions.KILL_SHELL,
  RPC_CHANNELS.tasks.GET_OUTPUT,
  RPC_CHANNELS.sessions.RESPOND_TO_PERMISSION,
  RPC_CHANNELS.sessions.RESPOND_TO_CREDENTIAL,
  RPC_CHANNELS.sessions.COMMAND,
  RPC_CHANNELS.sessions.GET_PENDING_PLAN_EXECUTION,
  RPC_CHANNELS.sessions.GET_PERMISSION_MODE_STATE,
  RPC_CHANNELS.sessions.SEARCH_CONTENT,
  RPC_CHANNELS.sessions.GET_FILES,
  RPC_CHANNELS.sessions.GET_NOTES,
  RPC_CHANNELS.sessions.SET_NOTES,
  RPC_CHANNELS.sessions.WATCH_FILES,
  RPC_CHANNELS.sessions.UNWATCH_FILES,
  RPC_CHANNELS.sessions.EXPORT,
  RPC_CHANNELS.sessions.IMPORT,
  RPC_CHANNELS.sessions.EXPORT_REMOTE_TRANSFER,
  RPC_CHANNELS.sessions.IMPORT_REMOTE_TRANSFER,
] as const

export function registerSessionsHandlers(server: RpcServer, deps: HandlerDeps): void {
  const { sessionManager, platform } = deps
  const log = platform.logger

  // Get all sessions for the calling window's workspace
  // Waits for initialization to complete so sessions are never returned empty during startup
  server.handle(RPC_CHANNELS.sessions.GET, async (ctx) => {
    try {
      await sessionManager.waitForInit()
    } catch (error) {
      log.error('GET_SESSIONS continuing after initialization failure:', error)
    }
    const end = perf.start('rpc.getSessions')
    const windowWorkspaceId = ctx.webContentsId != null
      ? deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId)
      : undefined
    const workspaceId = ctx.workspaceId ?? windowWorkspaceId
    const sessions = sessionManager.getSessions(workspaceId ?? undefined)
    end()

    log.info('[sessions:get] result', {
      ctxWorkspaceId: ctx.workspaceId,
      webContentsId: ctx.webContentsId,
      windowWorkspaceId,
      resolvedWorkspaceId: workspaceId,
      returnedCount: sessions.length,
      returnedWorkspaceIds: sessionWorkspaceDistribution(sessions),
      returnedIds: summarizeIds(sessions.map(s => s.id)),
    })

    return sessions
  })

  // Get unread summary across all workspaces
  server.handle(RPC_CHANNELS.sessions.GET_UNREAD_SUMMARY, async () => {
    try {
      await sessionManager.waitForInit()
    } catch (error) {
      log.error('GET_UNREAD_SUMMARY continuing after initialization failure:', error)
    }
    return sessionManager.getUnreadSummary()
  })

  server.handle(RPC_CHANNELS.sessions.MARK_ALL_READ, async (_ctx, workspaceId: string) => {
    return sessionManager.markAllSessionsRead(workspaceId)
  })

  // Get a single session with messages (for lazy loading)
  server.handle(RPC_CHANNELS.sessions.GET_MESSAGES, async (_ctx, sessionId: string) => {
    const end = perf.start('rpc.getSessionMessages')
    const session = await sessionManager.getSession(sessionId)
    end()
    return session
  })

  // Create a new session
  server.handle(RPC_CHANNELS.sessions.CREATE, async (_ctx, workspaceId: string, options?: import('@archstudio/shared/protocol').CreateSessionOptions) => {
    const end = perf.start('rpc.createSession', { workspaceId })
    // The renderer adds the session synchronously from this return value (App.tsx handleCreateSession),
    // so suppress the broadcast to avoid a redundant hydrate round-trip.
    const session = await sessionManager.createSession(workspaceId, options, { emitCreatedEvent: false })
    end()
    return session
  })

  // Delete a session
  server.handle(RPC_CHANNELS.sessions.DELETE, async (_ctx, sessionId: string) => {
    return sessionManager.deleteSession(sessionId)
  })

  // Send a message to a session (with optional file attachments).
  //
  // Behavior:
  //   - Awaits until the user message is persisted to disk, then returns
  //     `{ accepted: true, messageId }`. This guarantees the message survives
  //     a mid-stream crash (#616).
  //   - The actual model-streaming work continues in the background; results
  //     flow back via SESSION_EVENT as before.
  //   - Pre-persist errors (session not found, etc.) reject the RPC so the
  //     caller can show a synchronous error.
  //   - Post-persist errors (model API failures, etc.) are routed via the
  //     event stream as today.
  // attachments: FileAttachment[] for Claude (has content), storedAttachments: StoredAttachment[] for persistence (has thumbnailBase64)
  server.handle(RPC_CHANNELS.sessions.SEND_MESSAGE, async (ctx, sessionId: string, message: string, attachments?: FileAttachment[], storedAttachments?: StoredAttachment[], options?: SendMessageOptions) => {
    // Capture the caller's clientId for error routing
    const callerClientId = ctx.clientId

    return await new Promise<{ accepted: true; messageId: string }>((resolve, reject) => {
      let acked = false
      const onAck = (messageId: string) => {
        if (!acked) {
          acked = true
          resolve({ accepted: true, messageId })
        }
      }

      sessionManager
        .sendMessage(sessionId, message, attachments, storedAttachments, options, undefined, undefined, onAck, { callerClientId })
        .then(() => {
          // sendMessage finished without firing onAck — should not happen in
          // practice (every code path that creates a user message acks).
          // Treat as a defensive failure rather than silently dropping.
          if (!acked) {
            acked = true
            reject(new Error('sendMessage completed without persisting a user message'))
          }
        })
        .catch(err => {
          log.error('Error in sendMessage:', err)
          if (!acked) {
            // Pre-persist error — surface synchronously to the caller.
            acked = true
            reject(err)
            return
          }
          // Post-persist error — route via the event stream as today.
          pushTyped(server, RPC_CHANNELS.sessions.EVENT, { to: 'client', clientId: callerClientId }, {
            type: 'error',
            sessionId,
            error: err instanceof Error ? err.message : 'Unknown error'
          } as SessionEvent)
          pushTyped(server, RPC_CHANNELS.sessions.EVENT, { to: 'client', clientId: callerClientId }, {
            type: 'complete',
            sessionId
          } as SessionEvent)
        })
    })
  })

  // Cancel processing
  server.handle(RPC_CHANNELS.sessions.CANCEL, async (_ctx, sessionId: string, silent?: boolean) => {
    return sessionManager.cancelProcessing(sessionId, silent)
  })

  // Kill background shell
  server.handle(RPC_CHANNELS.sessions.KILL_SHELL, async (_ctx, sessionId: string, shellId: string) => {
    return sessionManager.killShell(sessionId, shellId)
  })

  // Get background task output
  server.handle(RPC_CHANNELS.tasks.GET_OUTPUT, async (_ctx, taskId: string) => {
    try {
      const output = await sessionManager.getTaskOutput(taskId)
      return output
    } catch (err) {
      log.error('Failed to get task output:', err)
      throw err
    }
  })

  // Respond to a permission request (bash command approval)
  // Returns true if the response was delivered, false if agent/session is gone
  server.handle(RPC_CHANNELS.sessions.RESPOND_TO_PERMISSION, async (_ctx, sessionId: string, requestId: string, allowed: boolean, alwaysAllow: boolean) => {
    return sessionManager.respondToPermission(sessionId, requestId, allowed, alwaysAllow)
  })

  // Respond to a credential request (secure auth input)
  // Returns true if the response was delivered, false if agent/session is gone
  server.handle(RPC_CHANNELS.sessions.RESPOND_TO_CREDENTIAL, async (_ctx, sessionId: string, requestId: string, response: import('@archstudio/shared/protocol').CredentialResponse) => {
    return sessionManager.respondToCredential(sessionId, requestId, response)
  })

  // ==========================================================================
  // Consolidated Command Handlers
  // ==========================================================================

  // Session commands - consolidated handler for session operations
  server.handle(RPC_CHANNELS.sessions.COMMAND, async (
    _ctx,
    sessionId: string,
    command: import('@archstudio/shared/protocol').SessionCommand
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
          throw new Error(`Invalid thinking level: ${command.level}. Valid values: ${VALID_THINKING_LEVELS_LIST}`)
        }
        return sessionManager.setSessionThinkingLevel(sessionId, command.level)
      case 'updateWorkingDirectory':
        return sessionManager.updateWorkingDirectory(sessionId, command.dir)
      case 'setSources':
        return sessionManager.setSessionSources(sessionId, command.sourceSlugs)
      case 'setLabels':
        return sessionManager.setSessionLabels(sessionId, command.labels)
      case 'setProjectId':
        return sessionManager.setSessionProjectId(sessionId, command.projectId)
      case 'setKanbanColumn':
        return sessionManager.setKanbanColumn(sessionId, command.column)
      case 'showInFinder': {
        const sessionPath = sessionManager.getSessionPath(sessionId)
        if (sessionPath) {
          deps.platform.showItemInFolder?.(sessionPath)
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
      case 'refreshTitle':
        log.info(`IPC: refreshTitle received for session ${sessionId}`)
        return sessionManager.refreshTitle(sessionId)
      // Connection selection (locked after first message)
      case 'setConnection':
        log.info(`IPC: setConnection received for session ${sessionId}, connection: ${command.connectionSlug}`)
        return sessionManager.setSessionConnection(sessionId, command.connectionSlug)
      // Pending plan execution (Accept & Compact flow)
      case 'setPendingPlanExecution':
        return sessionManager.setPendingPlanExecution(sessionId, command.planPath, command.draftInputSnapshot)
      case 'markCompactionComplete':
        return sessionManager.markCompactionComplete(sessionId)
      case 'markPendingPlanExecutionDispatched':
        return sessionManager.markPendingPlanExecutionDispatched(sessionId)
      case 'clearPendingPlanExecution':
        return sessionManager.clearPendingPlanExecution(sessionId)
      case 'addAnnotation':
        return sessionManager.addMessageAnnotation(sessionId, command.messageId, command.annotation)
      case 'removeAnnotation':
        return sessionManager.removeMessageAnnotation(sessionId, command.messageId, command.annotationId)
      case 'updateAnnotation':
        return sessionManager.updateMessageAnnotation(sessionId, command.messageId, command.annotationId, command.patch)
      case 'removeAttachment':
        return sessionManager.removeMessageAttachment(sessionId, command.messageId, command.attachmentId)
      case 'clearAttachments':
        return sessionManager.clearMessageAttachments(sessionId)
      case 'gitCheckout': {
        // Discard working-tree changes for an unstaged modified file. Mirrors
        // `git checkout -- <path>` semantics: doesn't touch staged or the
        // index, just reverts the file on disk to HEAD.
        const session = await sessionManager.getSession(sessionId)
        if (!session) return { success: false, error: 'Session not found' }
        const cwd = session.workingDirectory
        if (!cwd) return { success: false, error: 'No working directory set for this session' }
        const filePath = command.filePath
        if (!filePath) {
          return { success: false, error: 'Invalid file path' }
        }
        // Resolve-and-containment check defends against concat-time escape
        // (e.g. 'goodDir/../badDir') that a string-level filter would miss.
        // Server runs with full user privileges, so this is a hard guard.
        const absCwd = resolve(cwd)
        const absFile = resolve(cwd, filePath)
        if (absFile !== absCwd && !absFile.startsWith(absCwd + sep)) {
          return { success: false, error: 'Invalid file path' }
        }
        const result = Bun.spawnSync(['git', 'checkout', '--', filePath], {
          cwd,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, // never prompt for credentials
        })
        if (result.exitCode !== 0) {
          const stderr = result.stderr instanceof Buffer ? result.stderr.toString() : String(result.stderr ?? '')
          return { success: false, error: stderr.trim() || 'git checkout failed' }
        }
        return { success: true }
      }
      default: {
        const _exhaustive: never = command
        throw new Error(`Unknown session command: ${JSON.stringify(command)}`)
      }
    }
  })

  // Get pending plan execution state (for reload recovery)
  server.handle(RPC_CHANNELS.sessions.GET_PENDING_PLAN_EXECUTION, async (
    _ctx,
    sessionId: string
  ) => {
    return sessionManager.getPendingPlanExecution(sessionId)
  })

  // Get authoritative permission mode diagnostics for renderer reconciliation
  server.handle(RPC_CHANNELS.sessions.GET_PERMISSION_MODE_STATE, async (
    _ctx,
    sessionId: string
  ) => {
    return sessionManager.getSessionPermissionModeState(sessionId)
  })

  // ============================================================
  // Session Content Search
  // ============================================================

  // Search session content using ripgrep
  server.handle(RPC_CHANNELS.sessions.SEARCH_CONTENT, async (_ctx, workspaceId: string, query: string, searchId?: string) => {
    const id = searchId || Date.now().toString(36)
    log.info('[search]','ipc:request', { searchId: id, query })

    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      log.warn('SEARCH_SESSIONS: Workspace not found:', workspaceId)
      return []
    }

    const { searchSessions } = await import('@archstudio/server-core/services')
    const { getWorkspaceSessionsPath } = await import('@archstudio/shared/workspaces')

    const sessionsDir = getWorkspaceSessionsPath(workspace.rootPath)
    log.debug(`SEARCH_SESSIONS: Searching "${query}" in ${sessionsDir}`)

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

    log.info('[search]','ipc:response', { searchId: id, resultCount: filteredResults.length, totalFound: results.length })
    return filteredResults
  })

  // ============================================================
  // Session Info Panel (files, notes, file watching)
  // ============================================================

  // Get files in session directory (recursive tree structure)
  server.handle(RPC_CHANNELS.sessions.GET_FILES, async (ctx, sessionId: string) => {
    const sessionPath = sessionManager.getSessionPath(sessionId)
    if (!sessionPath) return []

    try {
      return await scanSessionDirectory(sessionPath, ctx.signal)
    } catch (error) {
      // Re-throw aborts so the RPC layer can surface them as HANDLER_ERROR;
      // swallow everything else as an empty tree (preserves prior behavior).
      if ((error as { name?: string } | null)?.name === 'AbortError') throw error
      log.error('Failed to get session files:', error)
      return []
    }
  })

  // Start watching a session directory for file changes (per client)
  server.handle(RPC_CHANNELS.sessions.WATCH_FILES, async (ctx, sessionId: string) => {
    const clientId = ctx.clientId
    cleanupSessionFileWatchForClient(clientId)

    const sessionPath = sessionManager.getSessionPath(sessionId)
    if (!sessionPath) return

    try {
      const { watch } = await import('fs')

      const state: ClientSessionWatchState = {
        watcher: null as unknown as import('fs').FSWatcher,
        sessionId,
        debounceTimer: null,
      }

      state.watcher = watch(sessionPath, { recursive: true }, (_eventType, filename) => {
        // Ignore internal files and hidden files
        if (filename && (filename.includes('session.jsonl') || filename.startsWith('.'))) {
          return
        }

        // Debounce: wait 100ms before notifying to batch rapid changes
        if (state.debounceTimer) {
          clearTimeout(state.debounceTimer)
        }

        state.debounceTimer = setTimeout(() => {
          pushTyped(server, RPC_CHANNELS.sessions.FILES_CHANGED, { to: 'client', clientId }, state.sessionId)
        }, 100)
      })

      clientSessionWatches.set(clientId, state)
    } catch (error) {
      log.error('Failed to start session file watcher:', error)
    }
  })

  // Stop watching session files for the calling client
  server.handle(RPC_CHANNELS.sessions.UNWATCH_FILES, async (ctx) => {
    cleanupSessionFileWatchForClient(ctx.clientId)
  })

  // Get session notes (reads notes.md from session directory)
  server.handle(RPC_CHANNELS.sessions.GET_NOTES, async (_ctx, sessionId: string) => {
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
  server.handle(RPC_CHANNELS.sessions.SET_NOTES, async (_ctx, sessionId: string, content: string) => {
    const sessionPath = sessionManager.getSessionPath(sessionId)
    if (!sessionPath) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    try {
      const notesPath = join(sessionPath, 'notes.md')
      await writeFile(notesPath, content, 'utf-8')
    } catch (error) {
      log.error('Failed to save session notes:', error)
      throw error
    }
  })

  // ============================================
  // Export / Import / Dispatch
  // ============================================

  // Export a session as a portable bundle
  server.handle(RPC_CHANNELS.sessions.EXPORT, async (ctx, sessionId: string) => {
    await sessionManager.waitForInit()
    const workspaceId = ctx.workspaceId ?? deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId!)
    if (!workspaceId) throw new Error('No workspace context')

    const bundle = await sessionManager.exportSession(sessionId, workspaceId)
    if (!bundle) throw new Error(`Failed to export session ${sessionId}`)
    return bundle
  })

  // Import a session bundle into a target workspace
  // targetWorkspaceId is passed explicitly (not from context) so the renderer
  // can import into any workspace the server manages, not just the active one.
  const importHandler = async (_ctx: any, targetWorkspaceId: string, bundle: unknown, mode: string) => {
    await sessionManager.waitForInit()
    if (!targetWorkspaceId || typeof targetWorkspaceId !== 'string') throw new Error('targetWorkspaceId is required')
    if (mode !== 'move' && mode !== 'fork') throw new Error(`Invalid dispatch mode: ${mode}`)

    return sessionManager.importSession(targetWorkspaceId, bundle as import('@archstudio/shared/sessions').SessionBundle, mode)
  }
  server.handle(RPC_CHANNELS.sessions.IMPORT, importHandler)
  // Also register as transferable so chunked transfer can invoke it on commit
  setTransferableHandler(RPC_CHANNELS.sessions.IMPORT, importHandler)

  // Export a session as a summarized remote-transfer payload.
  server.handle(RPC_CHANNELS.sessions.EXPORT_REMOTE_TRANSFER, async (ctx, sessionId: string) => {
    await sessionManager.waitForInit()
    const workspaceId = ctx.workspaceId ?? deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId!)
    if (!workspaceId) throw new Error('No workspace context')

    const payload = await sessionManager.exportRemoteSessionTransfer(sessionId, workspaceId)
    if (!payload) throw new Error(`Failed to export remote transfer for session ${sessionId}`)
    return payload
  })

  // Import a summarized remote-transfer payload into a target workspace.
  server.handle(RPC_CHANNELS.sessions.IMPORT_REMOTE_TRANSFER, async (_ctx, targetWorkspaceId: string, payload: import('@archstudio/shared/protocol').RemoteSessionTransferPayload) => {
    await sessionManager.waitForInit()
    if (!targetWorkspaceId || typeof targetWorkspaceId !== 'string') throw new Error('targetWorkspaceId is required')
    return sessionManager.importRemoteSessionTransfer(targetWorkspaceId, payload)
  })
}
