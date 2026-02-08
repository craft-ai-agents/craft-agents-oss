import { app } from 'electron'
import * as Sentry from '@sentry/electron/main'
import { join } from 'path'
import { existsSync } from 'fs'
import { rm, readFile } from 'fs/promises'
import { CraftAgent, type AgentEvent, setPermissionMode, type PermissionMode, unregisterSessionScopedToolCallbacks, AbortReason, type AuthRequest, type AuthResult, type CredentialAuthRequest } from '@craft-agent/shared/agent'
import { sessionLog, isDebugMode, getLogFilePath } from './logger'
import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk'
import type { WindowManager } from './window-manager'
import {
  loadStoredConfig,
  getWorkspaces,
  getWorkspaceByNameOrId,
  loadConfigDefaults,
  getAnthropicBaseUrl,
  resolveModelId,
  type Workspace,
} from '@craft-agent/shared/config'
import { loadWorkspaceConfig } from '@craft-agent/shared/workspaces'
import {
  // Session persistence functions
  listSessions as listStoredSessions,
  loadSession as loadStoredSession,
  saveSession as saveStoredSession,
  createSession as createStoredSession,
  deleteSession as deleteStoredSession,
  updateSessionMetadata,
  setPendingPlanExecution as setStoredPendingPlanExecution,
  markCompactionComplete as markStoredCompactionComplete,
  clearPendingPlanExecution as clearStoredPendingPlanExecution,
  getPendingPlanExecution as getStoredPendingPlanExecution,
  getSessionAttachmentsPath,
  getSessionPath as getSessionStoragePath,
  sessionPersistenceQueue,
  type StoredSession,
  type StoredMessage,
  type SessionMetadata,
  type TodoState,
} from '@craft-agent/shared/sessions'
import { loadWorkspaceSources, loadAllSources, getSourcesBySlugs, type LoadedSource, type McpServerConfig, getSourcesNeedingAuth, getSourceCredentialManager, getSourceServerBuilder, type SourceWithCredential, isApiOAuthProvider, SERVER_BUILD_ERRORS, TokenRefreshManager, createTokenGetter } from '@craft-agent/shared/sources'
import { ConfigWatcher, type ConfigWatcherCallbacks } from '@craft-agent/shared/config'
import { getAuthState } from '@craft-agent/shared/auth'
import { resolveAuthEnv } from '@craft-agent/shared/auth/resolve-auth-env'
import { setAnthropicOptionsEnv, setPathToClaudeCodeExecutable, setInterceptorPath, setExecutable } from '@craft-agent/shared/agent'
import { getCredentialManager } from '@craft-agent/shared/credentials'
import { CraftMcpClient } from '@craft-agent/shared/mcp'
import { type Session, type Message, type SessionEvent, type FileAttachment, type StoredAttachment, type SendMessageOptions, IPC_CHANNELS, generateMessageId } from '../shared/types'
import { generateSessionTitle, regenerateSessionTitle, formatPathsToRelative, formatToolInputPaths, perf, encodeIconToDataUrl, getEmojiIcon, resetSummarizationClient, resolveToolIcon } from '@craft-agent/shared/utils'
import { loadWorkspaceSkills, type LoadedSkill } from '@craft-agent/shared/skills'
import type { ToolDisplayMeta } from '@craft-agent/core/types'
import { DEFAULT_MODEL, getToolIconsDir } from '@craft-agent/shared/config'
import { type ThinkingLevel, DEFAULT_THINKING_LEVEL } from '@craft-agent/shared/agent/thinking-levels'
import { evaluateAutoLabels } from '@craft-agent/shared/labels/auto'
import { listLabels } from '@craft-agent/shared/labels/storage'
import { extractLabelId } from '@craft-agent/shared/labels'

/**
 * Sanitize message content for use as session title.
 * Strips XML blocks (e.g. <edit_request>) and normalizes whitespace.
 */
function sanitizeForTitle(content: string): string {
  return content
    .replace(/<edit_request>[\s\S]*?<\/edit_request>/g, '') // Strip entire edit_request blocks
    .replace(/<[^>]+>/g, '')     // Strip remaining XML/HTML tags
    .replace(/\[skill:(?:[\w-]+:)?[\w-]+\]/g, '')   // Strip [skill:...] mentions
    .replace(/\[source:[\w-]+\]/g, '')                // Strip [source:...] mentions
    .replace(/\[file:[^\]]+\]/g, '')                  // Strip [file:...] mentions
    .replace(/\[folder:[^\]]+\]/g, '')                // Strip [folder:...] mentions
    .replace(/\s+/g, ' ')        // Collapse whitespace
    .trim()
}

/**
 * Feature flags for agent behavior
 */
export const AGENT_FLAGS = {
  /** Default modes enabled for new sessions */
  defaultModesEnabled: true,
} as const

/**
 * Build MCP and API servers from sources using the new unified modules.
 * Handles credential loading and server building in one step.
 * When auth errors occur, updates source configs to reflect actual state.
 *
 * @param sources - Sources to build servers for
 * @param sessionPath - Optional path to session folder for saving large API responses
 * @param tokenRefreshManager - Optional TokenRefreshManager for OAuth token refresh
 */
async function buildServersFromSources(
  sources: LoadedSource[],
  sessionPath?: string,
  tokenRefreshManager?: TokenRefreshManager
) {
  const span = perf.span('sources.buildServers', { count: sources.length })
  const credManager = getSourceCredentialManager()
  const serverBuilder = getSourceServerBuilder()

  // Load credentials for all sources
  const sourcesWithCreds: SourceWithCredential[] = await Promise.all(
    sources.map(async (source) => ({
      source,
      token: await credManager.getToken(source),
      credential: await credManager.getApiCredential(source),
    }))
  )
  span.mark('credentials.loaded')

  // Build token getter for OAuth sources (Google, Slack, Microsoft use OAuth)
  // Uses TokenRefreshManager for unified refresh logic (DRY principle)
  const getTokenForSource = (source: LoadedSource) => {
    const provider = source.config.provider
    if (isApiOAuthProvider(provider)) {
      // Use TokenRefreshManager if provided, otherwise create temporary one
      const manager = tokenRefreshManager ?? new TokenRefreshManager(credManager, {
        log: (msg) => sessionLog.debug(msg),
      })
      return createTokenGetter(manager, source)
    }
    return undefined
  }

  // Pass sessionPath to enable saving large API responses to session folder
  const result = await serverBuilder.buildAll(sourcesWithCreds, getTokenForSource, sessionPath)
  span.mark('servers.built')
  span.setMetadata('mcpCount', Object.keys(result.mcpServers).length)
  span.setMetadata('apiCount', Object.keys(result.apiServers).length)

  // Update source configs for auth errors so UI reflects actual state
  for (const error of result.errors) {
    if (error.error === SERVER_BUILD_ERRORS.AUTH_REQUIRED) {
      const source = sources.find(s => s.config.slug === error.sourceSlug)
      if (source) {
        credManager.markSourceNeedsReauth(source, 'Token missing or expired')
        sessionLog.info(`Marked source ${error.sourceSlug} as needing re-auth`)
      }
    }
  }

  span.end()
  return result
}

/**
 * Result of MCP OAuth token refresh operation.
 */
interface McpTokenRefreshResult {
  /** Whether any tokens were refreshed (configs were updated) */
  tokensRefreshed: boolean
  /** Sources that failed to refresh (for warning display) */
  failedSources: Array<{ slug: string; reason: string }>
}

/**
 * Refresh expired MCP OAuth tokens and rebuild server configs.
 * Uses TokenRefreshManager for unified refresh logic (DRY/SOLID principles).
 *
 * This implements "lazy refresh at query time" - tokens are refreshed before
 * each agent.chat() call, then server configs are rebuilt with fresh headers.
 *
 * @param agent - The agent to update server configs on
 * @param sources - All loaded sources for the session
 * @param sessionPath - Path to session folder for API response storage
 * @param tokenRefreshManager - TokenRefreshManager instance for this session
 */
async function refreshMcpOAuthTokensIfNeeded(
  agent: CraftAgent,
  sources: LoadedSource[],
  sessionPath: string,
  tokenRefreshManager: TokenRefreshManager
): Promise<McpTokenRefreshResult> {
  sessionLog.debug('[OAuth] Checking if any MCP OAuth tokens need refresh')

  // Use TokenRefreshManager to find sources needing refresh (handles rate limiting)
  const needRefresh = await tokenRefreshManager.getSourcesNeedingRefresh(sources)

  if (needRefresh.length === 0) {
    return { tokensRefreshed: false, failedSources: [] }
  }

  sessionLog.debug(`[OAuth] Found ${needRefresh.length} source(s) needing token refresh: ${needRefresh.map(s => s.config.slug).join(', ')}`)

  // Use TokenRefreshManager to refresh all tokens (handles rate limiting and error tracking)
  const { refreshed, failed } = await tokenRefreshManager.refreshSources(needRefresh)

  // Convert failed results to the expected format
  const failedSources = failed.map(({ source, reason }) => ({
    slug: source.config.slug,
    reason,
  }))

  if (refreshed.length > 0) {
    // Rebuild server configs with fresh tokens
    sessionLog.debug(`[OAuth] Rebuilding servers after ${refreshed.length} token refresh(es)`)
    const enabledSources = sources.filter(s => s.config.enabled && s.config.isAuthenticated)
    const { mcpServers, apiServers } = await buildServersFromSources(
      enabledSources,
      sessionPath,
      tokenRefreshManager
    )
    const intendedSlugs = enabledSources.map(s => s.config.slug)
    agent.setSourceServers(mcpServers, apiServers, intendedSlugs)
    return { tokensRefreshed: true, failedSources }
  }

  return { tokensRefreshed: false, failedSources }
}

/**
 * Resolve tool display metadata for a tool call.
 * Returns metadata with base64-encoded icon for viewer compatibility.
 *
 * @param toolName - Tool name from the event (e.g., "Skill", "mcp__linear__list_issues")
 * @param toolInput - Tool input (used for Skill tool to get skill identifier)
 * @param workspaceRootPath - Path to workspace for loading skills/sources
 * @param sources - Loaded sources for the workspace
 */
function resolveToolDisplayMeta(
  toolName: string,
  toolInput: Record<string, unknown> | undefined,
  workspaceRootPath: string,
  sources: LoadedSource[]
): ToolDisplayMeta | undefined {
  // Check if it's an MCP source tool (format: mcp__<sourceSlug>__<toolName>)
  if (toolName.startsWith('mcp__')) {
    const parts = toolName.split('__')
    if (parts.length >= 2) {
      const sourceSlug = parts[1]
      const source = sources.find(s => s.config.slug === sourceSlug)
      if (source) {
        // Try file-based icon first, fall back to emoji icon from config
        const iconDataUrl = source.iconPath
          ? encodeIconToDataUrl(source.iconPath)
          : getEmojiIcon(source.config.icon)
        return {
          displayName: source.config.name,
          iconDataUrl,
          description: source.config.tagline,
          category: 'source' as const,
        }
      }
    }
    return undefined
  }

  // Check if it's the Skill tool
  if (toolName === 'Skill' && toolInput) {
    // Skill input has 'skill' param with format: "skillSlug" or "workspaceId:skillSlug"
    const skillParam = toolInput.skill as string | undefined
    if (skillParam) {
      // Extract skill slug (remove workspace prefix if present)
      const skillSlug = skillParam.includes(':') ? skillParam.split(':').pop() : skillParam
      if (skillSlug) {
        // Load skills and find the one being invoked
        try {
          const skills = loadWorkspaceSkills(workspaceRootPath)
          const skill = skills.find(s => s.slug === skillSlug)
          if (skill) {
            // Try file-based icon first, fall back to emoji icon from metadata
            const iconDataUrl = skill.iconPath
              ? encodeIconToDataUrl(skill.iconPath)
              : getEmojiIcon(skill.metadata.icon)
            return {
              displayName: skill.metadata.name,
              iconDataUrl,
              description: skill.metadata.description,
              category: 'skill' as const,
            }
          }
        } catch {
          // Skills loading failed, skip
        }
      }
    }
    return undefined
  }

  // CLI tool icon resolution for Bash commands
  // Parses the command string to detect known tools (git, npm, docker, etc.)
  // and resolves their brand icon from ~/.craft-agent/tool-icons/
  if (toolName === 'Bash' && toolInput?.command) {
    const toolIconsDir = getToolIconsDir()
    const match = resolveToolIcon(String(toolInput.command), toolIconsDir)
    if (match) {
      return {
        displayName: match.displayName,
        iconDataUrl: match.iconDataUrl,
        category: 'native' as const,
      }
    }
  }

  // Native tool display names (no icons - UI handles these with built-in icons)
  // This ensures toolDisplayMeta is always populated for consistent display
  const nativeToolNames: Record<string, string> = {
    'Read': 'Read',
    'Write': 'Write',
    'Edit': 'Edit',
    'Bash': 'Terminal',
    'Grep': 'Search',
    'Glob': 'Find Files',
    'Task': 'Agent',
    'WebFetch': 'Fetch URL',
    'WebSearch': 'Web Search',
    'TodoWrite': 'Update Todos',
    'NotebookEdit': 'Edit Notebook',
    'KillShell': 'Kill Shell',
    'TaskOutput': 'Task Output',
  }

  const nativeDisplayName = nativeToolNames[toolName]
  if (nativeDisplayName) {
    return {
      displayName: nativeDisplayName,
      category: 'native' as const,
    }
  }

  // Unknown tool - no display metadata (will fall back to tool name in UI)
  return undefined
}

interface ManagedSession {
  id: string
  workspace: Workspace
  agent: CraftAgent | null  // Lazy-loaded - null until first message
  messages: Message[]
  isProcessing: boolean
  lastMessageAt: number
  streamingText: string
  // Incremented each time a new message starts processing.
  // Used to detect if a follow-up message has superseded the current one (stale-request guard).
  processingGeneration: number
  // NOTE: Parent-child tracking state (pendingTools, parentToolStack, toolToParentMap,
  // pendingTextParent) has been removed. CraftAgent now provides parentToolUseId
  // directly on all events using the SDK's authoritative parent_tool_use_id field.
  // See: packages/shared/src/agent/tool-matching.ts
  // Session name (user-defined or AI-generated)
  name?: string
  isFlagged: boolean
  /** Permission mode for this session ('safe', 'ask', 'allow-all') */
  permissionMode?: PermissionMode
  // SDK session ID for conversation continuity
  sdkSessionId?: string
  // Token usage for display
  tokenUsage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    contextTokens: number
    costUsd: number
    cacheReadTokens?: number
    cacheCreationTokens?: number
    /** Model's context window size in tokens (from SDK modelUsage) */
    contextWindow?: number
  }
  // Todo state (user-controlled) - determines open vs closed
  // Dynamic status ID referencing workspace status config
  todoState?: string
  // Read/unread tracking - ID of last message user has read
  lastReadMessageId?: string
  /**
   * Explicit unread flag - single source of truth for NEW badge.
   * Set to true when assistant message completes while user is NOT viewing.
   * Set to false when user views the session (and not processing).
   */
  hasUnread?: boolean
  // Per-session source selection (slugs of enabled sources)
  enabledSourceSlugs?: string[]
  // Labels applied to this session (additive tags, many-per-session)
  labels?: string[]
  // Working directory for this session (used by agent for bash commands)
  workingDirectory?: string
  // SDK cwd for session storage - set once at creation, never changes.
  // Ensures SDK can find session transcripts regardless of workingDirectory changes.
  sdkCwd?: string
  // Shared viewer URL (if shared via viewer)
  sharedUrl?: string
  // Shared session ID in viewer (for revoke)
  sharedId?: string
  // Model to use for this session (overrides global config if set)
  model?: string
  // Thinking level for this session ('off', 'think', 'max')
  thinkingLevel?: ThinkingLevel
  // System prompt preset for mini agents ('default' | 'mini')
  systemPromptPreset?: 'default' | 'mini' | string
  // Role/type of the last message (for badge display without loading messages)
  lastMessageRole?: 'user' | 'assistant' | 'plan' | 'tool' | 'error'
  // ID of the last final (non-intermediate) assistant message - pre-computed for unread detection
  lastFinalMessageId?: string
  // Whether an async operation is ongoing (sharing, updating share, revoking, title regeneration)
  // Used for shimmer effect on session title
  isAsyncOperationOngoing?: boolean
  // Preview of first user message (for sidebar display fallback)
  preview?: string
  // When the session was first created (ms timestamp from JSONL header)
  createdAt?: number
  // Total message count (pre-computed in JSONL header for fast list loading)
  messageCount?: number
  // Message queue for handling new messages while processing
  // When a message arrives during processing, we interrupt and queue
  messageQueue: Array<{
    message: string
    attachments?: FileAttachment[]
    storedAttachments?: StoredAttachment[]
    options?: SendMessageOptions
    messageId?: string  // Pre-generated ID for matching with UI
  }>
  // Map of shellId -> command for killing background shells
  backgroundShellCommands: Map<string, string>
  // Whether messages have been loaded from disk (for lazy loading)
  messagesLoaded: boolean
  // Pending auth request tracking (for unified auth flow)
  pendingAuthRequestId?: string
  pendingAuthRequest?: AuthRequest
  // Auth retry tracking (for mid-session token expiry)
  // Store last sent message/attachments to enable retry after token refresh
  lastSentMessage?: string
  lastSentAttachments?: FileAttachment[]
  lastSentStoredAttachments?: StoredAttachment[]
  lastSentOptions?: SendMessageOptions
  // Flag to prevent infinite retry loops (reset at start of each sendMessage)
  authRetryAttempted?: boolean
  // Flag indicating auth retry is in progress (to prevent complete handler from interfering)
  authRetryInProgress?: boolean
  // Whether this session is hidden from session list (e.g., mini edit sessions)
  hidden?: boolean
  // Token refresh manager for this session (handles OAuth token refresh with rate limiting)
  tokenRefreshManager?: TokenRefreshManager
}

// Convert runtime Message to StoredMessage for persistence
// Only excludes transient field: isStreaming
function messageToStored(msg: Message): StoredMessage {
  return {
    id: msg.id,
    type: msg.role,  // Message uses 'role', StoredMessage uses 'type'
    content: msg.content,
    timestamp: msg.timestamp,
    // Tool fields
    toolName: msg.toolName,
    toolUseId: msg.toolUseId,
    toolInput: msg.toolInput,
    toolResult: msg.toolResult,
    toolStatus: msg.toolStatus,
    toolDuration: msg.toolDuration,
    toolIntent: msg.toolIntent,
    toolDisplayName: msg.toolDisplayName,
    toolDisplayMeta: msg.toolDisplayMeta,  // Includes base64 icon for viewer
    parentToolUseId: msg.parentToolUseId,
    isError: msg.isError,
    attachments: msg.attachments,
    badges: msg.badges,  // Content badges for inline display (sources, skills, context)
    // Turn grouping
    isIntermediate: msg.isIntermediate,
    turnId: msg.turnId,
    // Error display
    errorCode: msg.errorCode,
    errorTitle: msg.errorTitle,
    errorDetails: msg.errorDetails,
    errorOriginal: msg.errorOriginal,
    errorCanRetry: msg.errorCanRetry,
    // Ultrathink
    ultrathink: msg.ultrathink,
    // Auth request fields
    authRequestId: msg.authRequestId,
    authRequestType: msg.authRequestType,
    authSourceSlug: msg.authSourceSlug,
    authSourceName: msg.authSourceName,
    authStatus: msg.authStatus,
    authCredentialMode: msg.authCredentialMode,
    authHeaderName: msg.authHeaderName,
    authLabels: msg.authLabels,
    authDescription: msg.authDescription,
    authHint: msg.authHint,
    authSourceUrl: msg.authSourceUrl,
    authError: msg.authError,
    authEmail: msg.authEmail,
    authWorkspace: msg.authWorkspace,
  }
}

// Convert StoredMessage to runtime Message
function storedToMessage(stored: StoredMessage): Message {
  return {
    id: stored.id,
    role: stored.type,  // StoredMessage uses 'type', Message uses 'role'
    content: stored.content,
    timestamp: stored.timestamp ?? Date.now(),
    // Tool fields
    toolName: stored.toolName,
    toolUseId: stored.toolUseId,
    toolInput: stored.toolInput,
    toolResult: stored.toolResult,
    toolStatus: stored.toolStatus,
    toolDuration: stored.toolDuration,
    toolIntent: stored.toolIntent,
    toolDisplayName: stored.toolDisplayName,
    toolDisplayMeta: stored.toolDisplayMeta,  // Includes base64 icon for viewer
    parentToolUseId: stored.parentToolUseId,
    isError: stored.isError,
    attachments: stored.attachments,
    badges: stored.badges,  // Content badges for inline display (sources, skills, context)
    // Turn grouping
    isIntermediate: stored.isIntermediate,
    turnId: stored.turnId,
    // Error display
    errorCode: stored.errorCode,
    errorTitle: stored.errorTitle,
    errorDetails: stored.errorDetails,
    errorOriginal: stored.errorOriginal,
    errorCanRetry: stored.errorCanRetry,
    // Ultrathink
    ultrathink: stored.ultrathink,
    // Auth request fields
    authRequestId: stored.authRequestId,
    authRequestType: stored.authRequestType,
    authSourceSlug: stored.authSourceSlug,
    authSourceName: stored.authSourceName,
    authStatus: stored.authStatus,
    authCredentialMode: stored.authCredentialMode,
    authHeaderName: stored.authHeaderName,
    authLabels: stored.authLabels,
    authDescription: stored.authDescription,
    authHint: stored.authHint,
    authSourceUrl: stored.authSourceUrl,
    authError: stored.authError,
    authEmail: stored.authEmail,
    authWorkspace: stored.authWorkspace,
  }
}

// Performance: Batch IPC delta events to reduce renderer load
const DELTA_BATCH_INTERVAL_MS = 50  // Flush batched deltas every 50ms

interface PendingDelta {
  delta: string
  turnId?: string
}

export class SessionManager {
  private sessions: Map<string, ManagedSession> = new Map()
  private windowManager: WindowManager | null = null
  // Delta batching for performance - reduces IPC events from 50+/sec to ~20/sec
  private pendingDeltas: Map<string, PendingDelta> = new Map()
  private deltaFlushTimers: Map<string, NodeJS.Timeout> = new Map()
  // Config watchers for live updates (sources, etc.) - one per workspace
  private configWatchers: Map<string, ConfigWatcher> = new Map()
  // Pending credential request resolvers (keyed by requestId)
  private pendingCredentialResolvers: Map<string, (response: import('../shared/types').CredentialResponse) => void> = new Map()
  // Promise deduplication for lazy-loading messages (prevents race conditions)
  private messageLoadingPromises: Map<string, Promise<void>> = new Map()
  /**
   * Track which session the user is actively viewing (per workspace).
   * Map of workspaceId -> sessionId. Used to determine if a session should be
   * marked as unread when assistant completes - if user is viewing it, don't mark unread.
   */
  private activeViewingSession: Map<string, string> = new Map()

  setWindowManager(wm: WindowManager): void {
    this.windowManager = wm
  }

  /**
   * Set up ConfigWatcher for a workspace to broadcast live updates
   * (sources added/removed, guide.md changes, etc.)
   * Called during window init (GET_WINDOW_WORKSPACE) and workspace switch.
   * workspaceId must be the global config ID (what the renderer knows).
   */
  setupConfigWatcher(workspaceRootPath: string, workspaceId: string): void {
    // Check if already watching this workspace
    if (this.configWatchers.has(workspaceRootPath)) {
      return // Already watching this workspace
    }

    sessionLog.info(`Setting up ConfigWatcher for workspace: ${workspaceId} (${workspaceRootPath})`)

    const callbacks: ConfigWatcherCallbacks = {
      onSourcesListChange: async (sources: LoadedSource[]) => {
        sessionLog.info(`Sources list changed in ${workspaceRootPath} (${sources.length} sources)`)
        // Broadcast to UI
        this.broadcastSourcesChanged(sources)
        // Reload sources for all sessions in this workspace
        for (const [_, managed] of this.sessions) {
          if (managed.workspace.rootPath === workspaceRootPath) {
            await this.reloadSessionSources(managed)
          }
        }
      },
      onSourceChange: async (slug: string, source: LoadedSource | null) => {
        sessionLog.info(`Source '${slug}' changed:`, source ? 'updated' : 'deleted')
        // Broadcast updated list to UI
        const sources = loadWorkspaceSources(workspaceRootPath)
        this.broadcastSourcesChanged(sources)
        // Reload sources for all sessions in this workspace
        for (const [_, managed] of this.sessions) {
          if (managed.workspace.rootPath === workspaceRootPath) {
            await this.reloadSessionSources(managed)
          }
        }
      },
      onSourceGuideChange: (sourceSlug: string) => {
        sessionLog.info(`Source guide changed: ${sourceSlug}`)
        // Broadcast the updated sources list so sidebar picks up guide changes
        // Note: Guide changes don't require session source reload (no server changes)
        const sources = loadWorkspaceSources(workspaceRootPath)
        this.broadcastSourcesChanged(sources)
      },
      onStatusConfigChange: () => {
        sessionLog.info(`Status config changed in ${workspaceId}`)
        this.broadcastStatusesChanged(workspaceId)
      },
      onStatusIconChange: (_workspaceId: string, iconFilename: string) => {
        sessionLog.info(`Status icon changed: ${iconFilename} in ${workspaceId}`)
        this.broadcastStatusesChanged(workspaceId)
      },
      onLabelConfigChange: () => {
        sessionLog.info(`Label config changed in ${workspaceId}`)
        this.broadcastLabelsChanged(workspaceId)
      },
      onAppThemeChange: (theme) => {
        sessionLog.info(`App theme changed`)
        this.broadcastAppThemeChanged(theme)
      },
      onDefaultPermissionsChange: () => {
        sessionLog.info('Default permissions changed')
        this.broadcastDefaultPermissionsChanged()
      },
      onSkillsListChange: async (skills) => {
        sessionLog.info(`Skills list changed in ${workspaceRootPath} (${skills.length} skills)`)
        this.broadcastSkillsChanged(skills)
      },
      onSkillChange: async (slug, skill) => {
        sessionLog.info(`Skill '${slug}' changed:`, skill ? 'updated' : 'deleted')
        // Broadcast updated list to UI
        const { loadWorkspaceSkills } = await import('@craft-agent/shared/skills')
        const skills = loadWorkspaceSkills(workspaceRootPath)
        this.broadcastSkillsChanged(skills)
      },

      // Session metadata changes (external edits to session.jsonl headers).
      // Detects label/flag/name/todoState changes made by other instances or scripts.
      // Compares with in-memory state and only emits events for actual differences.
      onSessionMetadataChange: (sessionId, header) => {
        const managed = this.sessions.get(sessionId)
        if (!managed) return

        // Skip if session is currently processing — in-memory state is authoritative during streaming
        if (managed.isProcessing) return

        let changed = false

        // Labels
        const oldLabels = JSON.stringify(managed.labels ?? [])
        const newLabels = JSON.stringify(header.labels ?? [])
        if (oldLabels !== newLabels) {
          managed.labels = header.labels
          this.sendEvent({ type: 'labels_changed', sessionId, labels: header.labels ?? [] }, managed.workspace.id)
          changed = true
        }

        // Flagged
        if ((managed.isFlagged ?? false) !== (header.isFlagged ?? false)) {
          managed.isFlagged = header.isFlagged ?? false
          this.sendEvent(
            { type: header.isFlagged ? 'session_flagged' : 'session_unflagged', sessionId },
            managed.workspace.id
          )
          changed = true
        }

        // Todo state
        if (managed.todoState !== header.todoState) {
          managed.todoState = header.todoState
          this.sendEvent({ type: 'todo_state_changed', sessionId, todoState: header.todoState ?? '' }, managed.workspace.id)
          changed = true
        }

        // Name
        if (managed.name !== header.name) {
          managed.name = header.name
          this.sendEvent({ type: 'name_changed', sessionId, name: header.name }, managed.workspace.id)
          changed = true
        }

        if (changed) {
          sessionLog.info(`External metadata change detected for session ${sessionId}`)
        }
      },
    }

    const watcher = new ConfigWatcher(workspaceRootPath, callbacks)
    watcher.start()
    this.configWatchers.set(workspaceRootPath, watcher)
  }

  /**
   * Broadcast sources changed event to all windows
   */
  private broadcastSourcesChanged(sources: LoadedSource[]): void {
    if (!this.windowManager) return

    this.windowManager.broadcastToAll(IPC_CHANNELS.SOURCES_CHANGED, sources)
  }

  /**
   * Broadcast statuses changed event to all windows
   */
  private broadcastStatusesChanged(workspaceId: string): void {
    if (!this.windowManager) return
    sessionLog.info(`Broadcasting statuses changed for ${workspaceId}`)
    this.windowManager.broadcastToAll(IPC_CHANNELS.STATUSES_CHANGED, workspaceId)
  }

  /**
   * Broadcast labels changed event to all windows
   */
  private broadcastLabelsChanged(workspaceId: string): void {
    if (!this.windowManager) return
    sessionLog.info(`Broadcasting labels changed for ${workspaceId}`)
    this.windowManager.broadcastToAll(IPC_CHANNELS.LABELS_CHANGED, workspaceId)
  }

  /**
   * Broadcast app theme changed event to all windows
   */
  private broadcastAppThemeChanged(theme: import('@craft-agent/shared/config').ThemeOverrides | null): void {
    if (!this.windowManager) return
    sessionLog.info(`Broadcasting app theme changed`)
    this.windowManager.broadcastToAll(IPC_CHANNELS.THEME_APP_CHANGED, theme)
  }

  /**
   * Broadcast skills changed event to all windows
   */
  private broadcastSkillsChanged(skills: import('@craft-agent/shared/skills').LoadedSkill[]): void {
    if (!this.windowManager) return
    sessionLog.info(`Broadcasting skills changed (${skills.length} skills)`)
    this.windowManager.broadcastToAll(IPC_CHANNELS.SKILLS_CHANGED, skills)
  }

  /**
   * Broadcast default permissions changed event to all windows
   * Triggered when ~/.craft-agent/permissions/default.json changes
   */
  private broadcastDefaultPermissionsChanged(): void {
    if (!this.windowManager) return
    sessionLog.info('Broadcasting default permissions changed')
    this.windowManager.broadcastToAll(IPC_CHANNELS.DEFAULT_PERMISSIONS_CHANGED, null)
  }

  /**
   * Reload sources for a session with an active agent.
   * Called by ConfigWatcher when source files change on disk.
   * If agent is null (session hasn't sent any messages), skip - fresh build happens on next message.
   */
  private async reloadSessionSources(managed: ManagedSession): Promise<void> {
    if (!managed.agent) return  // No agent = nothing to update (fresh build on next message)

    const workspaceRootPath = managed.workspace.rootPath
    sessionLog.info(`Reloading sources for session ${managed.id}`)

    // Reload all sources from disk (craft-agents-docs is always available as MCP server)
    const allSources = loadAllSources(workspaceRootPath)
    managed.agent.setAllSources(allSources)

    // Rebuild MCP and API servers for session's enabled sources
    const enabledSlugs = managed.enabledSourceSlugs || []
    const enabledSources = allSources.filter(s =>
      enabledSlugs.includes(s.config.slug) && s.config.enabled && s.config.isAuthenticated
    )
    // Pass session path so large API responses can be saved to session folder
    const sessionPath = getSessionStoragePath(workspaceRootPath, managed.id)
    const { mcpServers, apiServers } = await buildServersFromSources(enabledSources, sessionPath)
    const intendedSlugs = enabledSources.map(s => s.config.slug)
    managed.agent.setSourceServers(mcpServers, apiServers, intendedSlugs)

    sessionLog.info(`Sources reloaded for session ${managed.id}: ${Object.keys(mcpServers).length} MCP, ${Object.keys(apiServers).length} API`)
  }

  /**
   * Reinitialize authentication environment variables.
   * Call this after onboarding or settings changes to pick up new credentials.
   *
   * SECURITY NOTE: These env vars are propagated to the SDK subprocess via options.ts.
   * Bun's automatic .env loading is disabled in the subprocess (--env-file=/dev/null)
   * to prevent a user's project .env from injecting ANTHROPIC_API_KEY and overriding
   * OAuth auth — Claude Code prioritizes API key over OAuth token when both are set.
   * See: https://github.com/lukilabs/craft-agents-oss/issues/39
   */
  async reinitializeAuth(): Promise<void> {
    try {
      const authState = await getAuthState()
      const customBaseUrl = getAnthropicBaseUrl()

      sessionLog.info('Reinitializing auth with billing type:', authState.billing.type, customBaseUrl ? `(custom base URL: ${customBaseUrl})` : '')

      const result = resolveAuthEnv({
        billing: authState.billing,
        customBaseUrl,
      })

      // Apply env var changes
      for (const [key, value] of Object.entries(result.set)) {
        process.env[key] = value
      }
      for (const key of result.delete) {
        delete process.env[key]
      }

      if (result.error) {
        sessionLog.error(result.error)
      }

      // Reset cached summarization client so it picks up new credentials/base URL
      resetSummarizationClient()
    } catch (error) {
      sessionLog.error('Failed to reinitialize auth:', error)
      throw error
    }
  }

  async initialize(): Promise<void> {
    // Set path to Claude Code executable (cli.js from SDK)
    // In packaged app: use app.getAppPath() (points to app folder, ASAR is disabled)
    // In development: use process.cwd()
    const basePath = app.isPackaged ? app.getAppPath() : process.cwd()

    // In monorepos, dependencies may be hoisted to the root node_modules
    // Try local first, then check monorepo root (two levels up from apps/electron)
    const sdkRelativePath = join('node_modules', '@anthropic-ai', 'claude-agent-sdk', 'cli.js')
    let cliPath = join(basePath, sdkRelativePath)
    if (!existsSync(cliPath) && !app.isPackaged) {
      // Try monorepo root (../../node_modules from apps/electron)
      const monorepoRoot = join(basePath, '..', '..')
      cliPath = join(monorepoRoot, sdkRelativePath)
    }
    if (!existsSync(cliPath)) {
      const error = `Claude Code SDK not found at ${cliPath}. The app package may be corrupted.`
      sessionLog.error(error)
      throw new Error(error)
    }
    sessionLog.info('Setting pathToClaudeCodeExecutable:', cliPath)
    setPathToClaudeCodeExecutable(cliPath)

    // Set path to fetch interceptor for SDK subprocess
    // This interceptor captures API errors and adds metadata to MCP tool schemas
    // In monorepos, packages may be at the root level, not inside apps/electron
    const interceptorRelativePath = join('packages', 'shared', 'src', 'network-interceptor.ts')
    let interceptorPath = join(basePath, interceptorRelativePath)
    if (!existsSync(interceptorPath) && !app.isPackaged) {
      // Try monorepo root (../../packages from apps/electron)
      const monorepoRoot = join(basePath, '..', '..')
      interceptorPath = join(monorepoRoot, interceptorRelativePath)
    }
    if (!existsSync(interceptorPath)) {
      const error = `Network interceptor not found at ${interceptorPath}. The app package may be corrupted.`
      sessionLog.error(error)
      throw new Error(error)
    }
    // Set interceptor path (used for --preload flag with bun)
    sessionLog.info('Setting interceptorPath:', interceptorPath)
    setInterceptorPath(interceptorPath)

    // In packaged app: use bundled Bun binary
    // In development: use system 'bun' command
    if (app.isPackaged) {
      // Use platform-specific binary name (bun.exe on Windows, bun on macOS/Linux)
      const bunBinary = process.platform === 'win32' ? 'bun.exe' : 'bun'
      // On Windows, bun.exe is in extraResources (process.resourcesPath) to avoid EBUSY errors.
      // On macOS/Linux, bun is in the app files (basePath). See electron-builder.yml for details.
      const bunBasePath = process.platform === 'win32' ? process.resourcesPath : basePath
      const bunPath = join(bunBasePath, 'vendor', 'bun', bunBinary)
      if (!existsSync(bunPath)) {
        const error = `Bundled Bun runtime not found at ${bunPath}. The app package may be corrupted.`
        sessionLog.error(error)
        throw new Error(error)
      }
      sessionLog.info('Setting executable:', bunPath)
      setExecutable(bunPath)
    }
    // In development: use system 'bun' (works on Windows now, supports --preload for interceptor)

    // Set up authentication environment variables (critical for SDK to work)
    await this.reinitializeAuth()

    // Load existing sessions from disk
    this.loadSessionsFromDisk()
  }

  // Load all existing sessions from disk into memory (metadata only - messages are lazy-loaded)
  private loadSessionsFromDisk(): void {
    try {
      const workspaces = getWorkspaces()
      let totalSessions = 0

      // Iterate over each workspace and load its sessions
      for (const workspace of workspaces) {
        const workspaceRootPath = workspace.rootPath
        const sessionMetadata = listStoredSessions(workspaceRootPath)
        // Load workspace config once per workspace for default working directory
        const wsConfig = loadWorkspaceConfig(workspaceRootPath)
        const wsDefaultWorkingDir = wsConfig?.defaults?.workingDirectory

        for (const meta of sessionMetadata) {
          // Create managed session from metadata only (messages lazy-loaded on demand)
          // This dramatically reduces memory usage at startup - messages are loaded
          // when getSession() is called for a specific session
          const managed: ManagedSession = {
            id: meta.id,
            workspace,
            agent: null,  // Lazy-load agent when needed
            messages: [],  // Lazy-load messages when needed
            isProcessing: false,
            lastMessageAt: meta.lastMessageAt ?? meta.lastUsedAt,  // Fallback for sessions saved before lastMessageAt was persisted
            streamingText: '',
            processingGeneration: 0,
            name: meta.name,
            preview: meta.preview,
            createdAt: meta.createdAt,
            messageCount: meta.messageCount,
            isFlagged: meta.isFlagged ?? false,
            permissionMode: meta.permissionMode,
            sdkSessionId: meta.sdkSessionId,
            tokenUsage: meta.tokenUsage,  // From JSONL header (updated on save)
            todoState: meta.todoState,
            lastReadMessageId: meta.lastReadMessageId,  // Pre-computed for unread detection
            lastFinalMessageId: meta.lastFinalMessageId,  // Pre-computed for unread detection
            hasUnread: meta.hasUnread,  // Explicit unread flag for NEW badge state machine
            enabledSourceSlugs: undefined,  // Loaded with messages
            labels: meta.labels,
            workingDirectory: meta.workingDirectory ?? wsDefaultWorkingDir,
            sdkCwd: meta.sdkCwd,
            model: meta.model,
            thinkingLevel: meta.thinkingLevel,
            lastMessageRole: meta.lastMessageRole,
            messageQueue: [],
            backgroundShellCommands: new Map(),
            messagesLoaded: false,  // Mark as not loaded
            // Shared viewer state - loaded from metadata for persistence across restarts
            sharedUrl: meta.sharedUrl,
            sharedId: meta.sharedId,
            hidden: meta.hidden,
            // Initialize TokenRefreshManager for this session
            tokenRefreshManager: new TokenRefreshManager(getSourceCredentialManager(), {
              log: (msg) => sessionLog.debug(msg),
            }),
          }

          this.sessions.set(meta.id, managed)
          totalSessions++
        }
      }

      sessionLog.info(`Loaded ${totalSessions} sessions from disk (metadata only)`)
    } catch (error) {
      sessionLog.error('Failed to load sessions from disk:', error)
    }
  }

  // Persist a session to disk (async with debouncing)
  private persistSession(managed: ManagedSession): void {
    try {
      // Filter out transient status messages (progress indicators like "Compacting...")
      // Error messages are now persisted with rich fields for diagnostics
      const persistableMessages = managed.messages.filter(m =>
        m.role !== 'status'
      )

      const workspaceRootPath = managed.workspace.rootPath
      const storedSession: StoredSession = {
        id: managed.id,
        workspaceRootPath,
        name: managed.name,
        createdAt: managed.lastMessageAt,  // Approximate, will be overwritten if already exists
        lastUsedAt: Date.now(),
        lastMessageAt: managed.lastMessageAt,  // Preserve actual message time (not persist time)
        sdkSessionId: managed.sdkSessionId,
        isFlagged: managed.isFlagged,
        permissionMode: managed.permissionMode,
        todoState: managed.todoState,
        lastReadMessageId: managed.lastReadMessageId,  // For unread detection
        hasUnread: managed.hasUnread,  // Explicit unread flag for NEW badge state machine
        enabledSourceSlugs: managed.enabledSourceSlugs,
        labels: managed.labels,
        workingDirectory: managed.workingDirectory,
        sdkCwd: managed.sdkCwd,
        thinkingLevel: managed.thinkingLevel,
        messages: persistableMessages.map(messageToStored),
        tokenUsage: managed.tokenUsage ?? {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          contextTokens: 0,
          costUsd: 0,
        },
        hidden: managed.hidden,
      }

      // Queue for async persistence with debouncing
      sessionPersistenceQueue.enqueue(storedSession)
    } catch (error) {
      sessionLog.error(`Failed to queue session ${managed.id} for persistence:`, error)
    }
  }

  // Flush a specific session immediately (call on session close/switch)
  async flushSession(sessionId: string): Promise<void> {
    await sessionPersistenceQueue.flush(sessionId)
  }

  // Flush all pending sessions (call on app quit)
  async flushAllSessions(): Promise<void> {
    await sessionPersistenceQueue.flushAll()
  }

  // ============================================
  // Unified Auth Request Helpers
  // ============================================

  /**
   * Get human-readable description for auth request
   */
  private getAuthRequestDescription(request: AuthRequest): string {
    switch (request.type) {
      case 'credential':
        return `Authentication required for ${request.sourceName}`
      case 'oauth':
        return `OAuth authentication for ${request.sourceName}`
      case 'oauth-google':
        return `Sign in with Google for ${request.sourceName}`
      case 'oauth-slack':
        return `Sign in with Slack for ${request.sourceName}`
      case 'oauth-microsoft':
        return `Sign in with Microsoft for ${request.sourceName}`
    }
  }

  /**
   * Format auth result message to send back to agent
   */
  private formatAuthResultMessage(result: AuthResult): string {
    if (result.success) {
      let msg = `Authentication completed for ${result.sourceSlug}.`
      if (result.email) msg += ` Signed in as ${result.email}.`
      if (result.workspace) msg += ` Connected to workspace: ${result.workspace}.`
      msg += ' Credentials have been saved.'
      return msg
    }
    if (result.cancelled) {
      return `Authentication cancelled for ${result.sourceSlug}.`
    }
    return `Authentication failed for ${result.sourceSlug}: ${result.error || 'Unknown error'}`
  }

  /**
   * Run OAuth flow for a given auth request (non-credential types)
   * Called after forceAbort to execute the OAuth flow asynchronously
   */
  private async runOAuthFlow(managed: ManagedSession, request: AuthRequest): Promise<void> {
    if (request.type === 'credential') return // Credentials handled by UI

    sessionLog.info(`Running OAuth flow for ${request.sourceSlug} (type: ${request.type})`)

    // Find the source in workspace sources
    const sources = loadWorkspaceSources(managed.workspace.rootPath)
    const source = sources.find(s => s.config.slug === request.sourceSlug)

    if (!source) {
      sessionLog.error(`Source ${request.sourceSlug} not found for OAuth`)
      await this.completeAuthRequest(managed.id, {
        requestId: request.requestId,
        sourceSlug: request.sourceSlug,
        success: false,
        error: `Source ${request.sourceSlug} not found`,
      })
      return
    }

    // Get credential manager and run OAuth
    const credManager = getSourceCredentialManager()

    try {
      const result = await credManager.authenticate(source, {
        onStatus: (msg) => sessionLog.info(`[OAuth ${request.sourceSlug}] ${msg}`),
        onError: (err) => sessionLog.error(`[OAuth ${request.sourceSlug}] ${err}`),
      }, {
        sessionId: managed.id,
        deeplinkScheme: process.env.CRAFT_DEEPLINK_SCHEME || 'craftagents',
      })

      if (result.success) {
        await this.completeAuthRequest(managed.id, {
          requestId: request.requestId,
          sourceSlug: request.sourceSlug,
          success: true,
          email: result.email,
        })
      } else {
        await this.completeAuthRequest(managed.id, {
          requestId: request.requestId,
          sourceSlug: request.sourceSlug,
          success: false,
          error: result.error,
        })
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      sessionLog.error(`OAuth flow failed for ${request.sourceSlug}:`, errorMessage)
      await this.completeAuthRequest(managed.id, {
        requestId: request.requestId,
        sourceSlug: request.sourceSlug,
        success: false,
        error: errorMessage,
      })
    }
  }

  /**
   * Start OAuth flow for a pending auth request (called when user clicks "Sign in")
   * This is the user-initiated trigger - OAuth no longer starts automatically
   */
  async startSessionOAuth(sessionId: string, requestId: string): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (!managed) {
      sessionLog.warn(`Cannot start OAuth - session ${sessionId} not found`)
      return
    }

    // Find the pending auth request
    if (managed.pendingAuthRequestId !== requestId || !managed.pendingAuthRequest) {
      sessionLog.warn(`Cannot start OAuth - no pending request with id ${requestId}`)
      return
    }

    const request = managed.pendingAuthRequest
    if (request.type === 'credential') {
      sessionLog.warn(`Cannot start OAuth for credential request`)
      return
    }

    // Run the OAuth flow
    await this.runOAuthFlow(managed, request)
  }

  /**
   * Complete an auth request and send result back to agent
   * This updates the auth message status and sends a faked user message
   */
  async completeAuthRequest(sessionId: string, result: AuthResult): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (!managed) {
      sessionLog.warn(`Cannot complete auth request - session ${sessionId} not found`)
      return
    }

    // Find and update the pending auth-request message
    const authMessage = managed.messages.find(m =>
      m.role === 'auth-request' &&
      m.authRequestId === result.requestId &&
      m.authStatus === 'pending'
    )

    if (authMessage) {
      authMessage.authStatus = result.success ? 'completed' :
                               result.cancelled ? 'cancelled' : 'failed'
      authMessage.authError = result.error
      authMessage.authEmail = result.email
      authMessage.authWorkspace = result.workspace
    }

    // Emit auth_completed event to update UI
    this.sendEvent({
      type: 'auth_completed',
      sessionId,
      requestId: result.requestId,
      success: result.success,
      cancelled: result.cancelled,
      error: result.error,
    }, managed.workspace.id)

    // Create faked user message with result
    const resultContent = this.formatAuthResultMessage(result)

    // Clear pending auth state
    managed.pendingAuthRequestId = undefined
    managed.pendingAuthRequest = undefined

    // Persist session with updated auth message
    this.persistSession(managed)

    // Send the result as a new message to resume conversation
    // Use empty arrays for attachments since this is a system-generated message
    await this.sendMessage(sessionId, resultContent, [], [], {})

    sessionLog.info(`Auth request completed for ${result.sourceSlug}: ${result.success ? 'success' : 'failed'}`)
  }

  /**
   * Handle credential input from the UI (for non-OAuth auth)
   * Called when user submits credentials via the inline form
   */
  async handleCredentialInput(
    sessionId: string,
    requestId: string,
    response: import('../shared/types').CredentialResponse
  ): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (!managed?.pendingAuthRequest) {
      sessionLog.warn(`Cannot handle credential input - no pending auth request for session ${sessionId}`)
      return
    }

    const request = managed.pendingAuthRequest as CredentialAuthRequest
    if (request.requestId !== requestId) {
      sessionLog.warn(`Credential request ID mismatch: expected ${request.requestId}, got ${requestId}`)
      return
    }

    if (response.cancelled) {
      await this.completeAuthRequest(sessionId, {
        requestId,
        sourceSlug: request.sourceSlug,
        success: false,
        cancelled: true,
      })
      return
    }

    try {
      // Store credentials using existing workspace ID extraction pattern
      const credManager = getCredentialManager()
      // Extract workspace ID from root path (last segment of path)
      const wsId = managed.workspace.rootPath.split('/').pop() || managed.workspace.id

      if (request.mode === 'basic') {
        // Store value as JSON string {username, password} - credential-manager.ts parses it for basic auth
        await credManager.set(
          { type: 'source_basic', workspaceId: wsId, sourceId: request.sourceSlug },
          { value: JSON.stringify({ username: response.username, password: response.password }) }
        )
      } else if (request.mode === 'bearer') {
        await credManager.set(
          { type: 'source_bearer', workspaceId: wsId, sourceId: request.sourceSlug },
          { value: response.value! }
        )
      } else if (request.mode === 'multi-header') {
        // Store multi-header credentials as JSON { "DD-API-KEY": "...", "DD-APPLICATION-KEY": "..." }
        await credManager.set(
          { type: 'source_apikey', workspaceId: wsId, sourceId: request.sourceSlug },
          { value: JSON.stringify(response.headers) }
        )
      } else {
        // header or query - both use API key storage
        await credManager.set(
          { type: 'source_apikey', workspaceId: wsId, sourceId: request.sourceSlug },
          { value: response.value! }
        )
      }

      // Update source config to mark as authenticated
      const { markSourceAuthenticated } = await import('@craft-agent/shared/sources')
      markSourceAuthenticated(managed.workspace.rootPath, request.sourceSlug)

      // Mark source as unseen so fresh guide is injected on next message
      if (managed.agent) {
        managed.agent.markSourceUnseen(request.sourceSlug)
      }

      await this.completeAuthRequest(sessionId, {
        requestId,
        sourceSlug: request.sourceSlug,
        success: true,
      })
    } catch (error) {
      sessionLog.error(`Failed to save credentials for ${request.sourceSlug}:`, error)
      await this.completeAuthRequest(sessionId, {
        requestId,
        sourceSlug: request.sourceSlug,
        success: false,
        error: error instanceof Error ? error.message : 'Failed to save credentials',
      })
    }
  }

  getWorkspaces(): Workspace[] {
    return getWorkspaces()
  }

  /**
   * Reload all sessions from disk.
   * Used after importing sessions to refresh the in-memory session list.
   */
  reloadSessions(): void {
    this.loadSessionsFromDisk()
  }

  getSessions(): Session[] {
    // Returns session metadata only - messages are NOT included to save memory
    // Use getSession(id) to load messages for a specific session
    return Array.from(this.sessions.values())
      .map(m => ({
        id: m.id,
        workspaceId: m.workspace.id,
        workspaceName: m.workspace.name,
        name: m.name,
        preview: m.preview,
        lastMessageAt: m.lastMessageAt,
        messages: [],  // Never send all messages - use getSession(id) for specific session
        isProcessing: m.isProcessing,
        isFlagged: m.isFlagged,
        permissionMode: m.permissionMode,
        thinkingLevel: m.thinkingLevel,
        todoState: m.todoState,
        lastReadMessageId: m.lastReadMessageId,
        lastFinalMessageId: m.lastFinalMessageId,
        hasUnread: m.hasUnread,  // Explicit unread flag for NEW badge state machine
        workingDirectory: m.workingDirectory,
        model: m.model,
        enabledSourceSlugs: m.enabledSourceSlugs,
        labels: m.labels,
        sharedUrl: m.sharedUrl,
        sharedId: m.sharedId,
        lastMessageRole: m.lastMessageRole,
        tokenUsage: m.tokenUsage,
        createdAt: m.createdAt,
        messageCount: m.messageCount,
        hidden: m.hidden,
      }))
      .sort((a, b) => b.lastMessageAt - a.lastMessageAt)
  }

  /**
   * Get a single session by ID with all messages loaded.
   * Used for lazy loading session messages when session is selected.
   * Messages are loaded from disk on first access to reduce memory usage.
   */
  async getSession(sessionId: string): Promise<Session | null> {
    const m = this.sessions.get(sessionId)
    if (!m) return null

    // Lazy-load messages from disk if not yet loaded
    await this.ensureMessagesLoaded(m)

    return {
      id: m.id,
      workspaceId: m.workspace.id,
      workspaceName: m.workspace.name,
      name: m.name,
      preview: m.preview,  // Include preview for title fallback consistency with getSessions()
      lastMessageAt: m.lastMessageAt,
      messages: m.messages,
      isProcessing: m.isProcessing,
      isFlagged: m.isFlagged,
      permissionMode: m.permissionMode,
      thinkingLevel: m.thinkingLevel,
      todoState: m.todoState,
      lastReadMessageId: m.lastReadMessageId,
      lastFinalMessageId: m.lastFinalMessageId,
      hasUnread: m.hasUnread,  // Explicit unread flag for NEW badge state machine
      workingDirectory: m.workingDirectory,
      model: m.model,
      sessionFolderPath: getSessionStoragePath(m.workspace.rootPath, m.id),
      enabledSourceSlugs: m.enabledSourceSlugs,
      labels: m.labels,
      sharedUrl: m.sharedUrl,
      sharedId: m.sharedId,
      lastMessageRole: m.lastMessageRole,
      tokenUsage: m.tokenUsage,
      hidden: m.hidden,
    }
  }

  /**
   * Ensure messages are loaded for a managed session.
   * Uses promise deduplication to prevent race conditions when multiple
   * concurrent calls (e.g., rapid session switches + message send) try
   * to load messages simultaneously.
   */
  private async ensureMessagesLoaded(managed: ManagedSession): Promise<void> {
    if (managed.messagesLoaded) return

    // Deduplicate concurrent loads - return existing promise if already loading
    const existingPromise = this.messageLoadingPromises.get(managed.id)
    if (existingPromise) {
      return existingPromise
    }

    const loadPromise = this.loadMessagesFromDisk(managed)
    this.messageLoadingPromises.set(managed.id, loadPromise)

    try {
      await loadPromise
    } finally {
      this.messageLoadingPromises.delete(managed.id)
    }
  }

  /**
   * Internal: Load messages from disk storage into the managed session.
   */
  private async loadMessagesFromDisk(managed: ManagedSession): Promise<void> {
    const storedSession = loadStoredSession(managed.workspace.rootPath, managed.id)
    if (storedSession) {
      managed.messages = (storedSession.messages || []).map(storedToMessage)
      managed.tokenUsage = storedSession.tokenUsage
      managed.lastReadMessageId = storedSession.lastReadMessageId
      managed.hasUnread = storedSession.hasUnread  // Explicit unread flag for NEW badge state machine
      managed.enabledSourceSlugs = storedSession.enabledSourceSlugs
      managed.sharedUrl = storedSession.sharedUrl
      managed.sharedId = storedSession.sharedId
      // Sync name from disk - ensures title persistence across lazy loading
      managed.name = storedSession.name
      sessionLog.debug(`Lazy-loaded ${managed.messages.length} messages for session ${managed.id}`)
    }
    managed.messagesLoaded = true
  }

  /**
   * Get the filesystem path to a session's folder
   */
  getSessionPath(sessionId: string): string | null {
    const managed = this.sessions.get(sessionId)
    if (!managed) return null
    return getSessionStoragePath(managed.workspace.rootPath, sessionId)
  }

  async createSession(workspaceId: string, options?: import('../shared/types').CreateSessionOptions): Promise<Session> {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`)
    }

    // Get new session defaults from workspace config (with global fallback)
    // Options.permissionMode overrides the workspace default (used by EditPopover for auto-execute)
    const workspaceRootPath = workspace.rootPath
    const wsConfig = loadWorkspaceConfig(workspaceRootPath)
    const globalDefaults = loadConfigDefaults()

    // Read permission mode from workspace config, fallback to global defaults
    const defaultPermissionMode = options?.permissionMode
      ?? wsConfig?.defaults?.permissionMode
      ?? globalDefaults.workspaceDefaults.permissionMode

    const userDefaultWorkingDir = wsConfig?.defaults?.workingDirectory || undefined
    // Get default thinking level from workspace config, fallback to global defaults
    const defaultThinkingLevel = wsConfig?.defaults?.thinkingLevel ?? globalDefaults.workspaceDefaults.thinkingLevel
    // Get default model from workspace config (used when no session-specific model is set)
    const defaultModel = wsConfig?.defaults?.model

    // Resolve working directory from options:
    // - 'user_default' or undefined: Use workspace's configured default
    // - 'none': No working directory (empty string means session folder only)
    // - Absolute path: Use as-is
    let resolvedWorkingDir: string | undefined
    if (options?.workingDirectory === 'none') {
      resolvedWorkingDir = undefined  // No working directory
    } else if (options?.workingDirectory === 'user_default' || options?.workingDirectory === undefined) {
      resolvedWorkingDir = userDefaultWorkingDir
    } else {
      resolvedWorkingDir = options.workingDirectory
    }

    // Use storage layer to create and persist the session
    const storedSession = await createStoredSession(workspaceRootPath, {
      permissionMode: defaultPermissionMode,
      workingDirectory: resolvedWorkingDir,
      hidden: options?.hidden,
      todoState: options?.todoState,
      labels: options?.labels,
      isFlagged: options?.isFlagged,
    })

    // Model priority: options.model > storedSession.model > workspace default
    const resolvedModel = options?.model || storedSession.model || defaultModel

    // Log mini agent session creation
    if (options?.systemPromptPreset === 'mini' || options?.model) {
      sessionLog.info(`🤖 Creating mini agent session: model=${resolvedModel}, systemPromptPreset=${options?.systemPromptPreset}`)
    }

    const managed: ManagedSession = {
      id: storedSession.id,
      workspace,
      agent: null,  // Lazy-load agent on first message
      messages: [],
      isProcessing: false,
      lastMessageAt: storedSession.lastMessageAt ?? storedSession.lastUsedAt,  // Fallback for sessions saved before lastMessageAt was persisted
      streamingText: '',
      processingGeneration: 0,
      isFlagged: options?.isFlagged ?? false,
      todoState: options?.todoState,
      labels: options?.labels,
      permissionMode: defaultPermissionMode,
      workingDirectory: resolvedWorkingDir,
      sdkCwd: storedSession.sdkCwd,
      // Session-specific model takes priority, then workspace default
      model: resolvedModel,
      thinkingLevel: defaultThinkingLevel,
      // System prompt preset for mini agents
      systemPromptPreset: options?.systemPromptPreset,
      messageQueue: [],
      backgroundShellCommands: new Map(),
      messagesLoaded: true,  // New sessions don't need to load messages from disk
      hidden: options?.hidden,
      // Initialize TokenRefreshManager for this session (handles OAuth token refresh with rate limiting)
      tokenRefreshManager: new TokenRefreshManager(getSourceCredentialManager(), {
        log: (msg) => sessionLog.debug(msg),
      }),
    }

    this.sessions.set(storedSession.id, managed)

    return {
      id: storedSession.id,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      lastMessageAt: managed.lastMessageAt,
      messages: [],
      isProcessing: false,
      isFlagged: options?.isFlagged ?? false,
      permissionMode: defaultPermissionMode,
      todoState: options?.todoState,
      labels: options?.labels,
      workingDirectory: resolvedWorkingDir,
      model: managed.model,
      thinkingLevel: defaultThinkingLevel,
      sessionFolderPath: getSessionStoragePath(workspaceRootPath, storedSession.id),
      hidden: options?.hidden,
    }
  }

  /**
   * Get or create agent for a session (lazy loading)
   */
  private async getOrCreateAgent(managed: ManagedSession): Promise<CraftAgent> {
    if (!managed.agent) {
      const end = perf.start('agent.create', { sessionId: managed.id })
      const config = loadStoredConfig()
      managed.agent = new CraftAgent({
        workspace: managed.workspace,
        // Session model takes priority, fallback to global config, then resolve with customModel override
        model: resolveModelId(managed.model || config?.model || DEFAULT_MODEL),
        // Initialize thinking level at construction to avoid race conditions
        thinkingLevel: managed.thinkingLevel,
        isHeadless: !AGENT_FLAGS.defaultModesEnabled,
        // System prompt preset for mini agents (focused prompts for quick edits)
        systemPromptPreset: managed.systemPromptPreset,
        // Always pass session object - id is required for plan mode callbacks
        // sdkSessionId is optional and used for conversation resumption
        session: {
          id: managed.id,
          workspaceRootPath: managed.workspace.rootPath,
          sdkSessionId: managed.sdkSessionId,
          createdAt: managed.lastMessageAt,
          lastUsedAt: managed.lastMessageAt,
          workingDirectory: managed.workingDirectory,
          sdkCwd: managed.sdkCwd,
          model: managed.model,
        },
        // Critical: Immediately persist SDK session ID when captured to prevent loss on crash.
        // Without this, the ID is only saved via debounced persistSession() which may not
        // complete before app crash/quit, causing session resumption to fail.
        onSdkSessionIdUpdate: (sdkSessionId: string) => {
          managed.sdkSessionId = sdkSessionId
          sessionLog.info(`SDK session ID captured for ${managed.id}: ${sdkSessionId}`)
          // Persist immediately and flush - critical for resumption reliability
          this.persistSession(managed)
          sessionPersistenceQueue.flush(managed.id)
        },
        // Called when SDK session ID is cleared after failed resume (empty response recovery)
        onSdkSessionIdCleared: () => {
          managed.sdkSessionId = undefined
          sessionLog.info(`SDK session ID cleared for ${managed.id} (resume recovery)`)
          // Persist immediately to prevent repeated resume attempts
          this.persistSession(managed)
          sessionPersistenceQueue.flush(managed.id)
        },
        // Called to get recent messages for recovery context when resume fails.
        // Returns last 6 messages (3 exchanges) of user/assistant content.
        getRecoveryMessages: () => {
          const relevantMessages = managed.messages
            .filter(m => m.role === 'user' || m.role === 'assistant')
            .filter(m => !m.isIntermediate)  // Skip intermediate assistant messages
            .slice(-6);  // Last 6 messages (3 exchanges)

          return relevantMessages.map(m => ({
            type: m.role as 'user' | 'assistant',
            content: m.content,
          }));
        },
        // Debug mode - enables log file path injection into system prompt
        debugMode: isDebugMode ? {
          enabled: true,
          logFilePath: getLogFilePath(),
        } : undefined,
      })
      sessionLog.info(`Created agent for session ${managed.id}${managed.sdkSessionId ? ' (resuming)' : ''}`)

      // Set up permission handler to forward requests to renderer
      managed.agent.onPermissionRequest = (request) => {
        sessionLog.info(`Permission request for session ${managed.id}:`, request.command)
        this.sendEvent({
          type: 'permission_request',
          sessionId: managed.id,
          request: {
            ...request,
            sessionId: managed.id,
          }
        }, managed.workspace.id)
      }

      // Note: Credential requests now flow through onAuthRequest (unified auth flow)
      // The legacy onCredentialRequest callback has been removed from CraftAgent
      // Auth refresh for mid-session token expiry is handled by the error handler in sendMessage
      // which destroys/recreates the agent to get fresh credentials

      // Set up mode change handlers
      managed.agent.onPermissionModeChange = (mode) => {
        sessionLog.info(`Permission mode changed for session ${managed.id}:`, mode)
        managed.permissionMode = mode
        this.sendEvent({
          type: 'permission_mode_changed',
          sessionId: managed.id,
          permissionMode: managed.permissionMode,
        }, managed.workspace.id)
      }

      // Wire up onPlanSubmitted to add plan message to conversation
      managed.agent.onPlanSubmitted = async (planPath) => {
        sessionLog.info(`Plan submitted for session ${managed.id}:`, planPath)
        try {
          // Read the plan file content
          const planContent = await readFile(planPath, 'utf-8')

          // Create a plan message
          const planMessage = {
            id: `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            role: 'plan' as const,
            content: planContent,
            timestamp: Date.now(),
            planPath,
          }

          // Add to session messages
          managed.messages.push(planMessage)

          // Update lastMessageRole for badge display
          managed.lastMessageRole = 'plan'

          // Send event to renderer
          this.sendEvent({
            type: 'plan_submitted',
            sessionId: managed.id,
            message: planMessage,
          }, managed.workspace.id)

          // Force-abort execution - plan presentation is a stopping point
          // The user needs to review and respond before continuing
          if (managed.isProcessing && managed.agent) {
            sessionLog.info(`Force-aborting after plan submission for session ${managed.id}`)
            managed.agent.forceAbort(AbortReason.PlanSubmitted)
            managed.isProcessing = false

            // Send complete event so renderer knows processing stopped (include tokenUsage for real-time updates)
            this.sendEvent({ type: 'complete', sessionId: managed.id, tokenUsage: managed.tokenUsage }, managed.workspace.id)

            // Persist session state
            this.persistSession(managed)
          }
        } catch (error) {
          sessionLog.error(`Failed to read plan file:`, error)
        }
      }

      // Wire up onAuthRequest to add auth message to conversation and pause execution
      managed.agent.onAuthRequest = (request) => {
        sessionLog.info(`Auth request for session ${managed.id}:`, request.type, request.sourceSlug)

        // Create auth-request message
        const authMessage: Message = {
          id: generateMessageId(),
          role: 'auth-request',
          content: this.getAuthRequestDescription(request),
          timestamp: Date.now(),
          authRequestId: request.requestId,
          authRequestType: request.type,
          authSourceSlug: request.sourceSlug,
          authSourceName: request.sourceName,
          authStatus: 'pending',
          // Copy type-specific fields for credentials
          ...(request.type === 'credential' && {
            authCredentialMode: request.mode,
            authLabels: request.labels,
            authDescription: request.description,
            authHint: request.hint,
            authHeaderName: request.headerName,
            authHeaderNames: request.headerNames,
            authSourceUrl: request.sourceUrl,
            authPasswordRequired: request.passwordRequired,
          }),
        }

        // Add to session messages
        managed.messages.push(authMessage)

        // Store pending auth request for later resolution
        managed.pendingAuthRequestId = request.requestId
        managed.pendingAuthRequest = request

        // Force-abort execution (like SubmitPlan)
        if (managed.isProcessing && managed.agent) {
          sessionLog.info(`Force-aborting after auth request for session ${managed.id}`)
          managed.agent.forceAbort(AbortReason.AuthRequest)
          managed.isProcessing = false

          // Send complete event so renderer knows processing stopped (include tokenUsage for real-time updates)
          this.sendEvent({ type: 'complete', sessionId: managed.id, tokenUsage: managed.tokenUsage }, managed.workspace.id)
        }

        // Emit auth_request event to renderer
        this.sendEvent({
          type: 'auth_request',
          sessionId: managed.id,
          message: authMessage,
          request: request,
        }, managed.workspace.id)

        // Persist session state
        this.persistSession(managed)

        // OAuth flow is now user-initiated via startSessionOAuth()
        // The UI will call sessionCommand({ type: 'startOAuth' }) when user clicks "Sign in"
      }

      // Wire up onSourceActivationRequest to auto-enable sources when agent tries to use them
      managed.agent.onSourceActivationRequest = async (sourceSlug: string): Promise<boolean> => {
        sessionLog.info(`Source activation request for session ${managed.id}:`, sourceSlug)

        const workspaceRootPath = managed.workspace.rootPath

        // Check if source is already enabled
        if (managed.enabledSourceSlugs?.includes(sourceSlug)) {
          sessionLog.info(`Source ${sourceSlug} already in enabledSourceSlugs, checking server status`)
          // Source is in the list but server might not be active (e.g., build failed previously)
        }

        // Load the source to check if it exists and is ready
        const sources = getSourcesBySlugs(workspaceRootPath, [sourceSlug])
        if (sources.length === 0) {
          sessionLog.warn(`Source ${sourceSlug} not found in workspace`)
          return false
        }

        const source = sources[0]

        // Check if source is enabled at workspace level
        if (!source.config.enabled) {
          sessionLog.warn(`Source ${sourceSlug} is disabled at workspace level`)
          return false
        }

        // Check if source is authenticated (if it requires auth)
        if (!source.config.isAuthenticated) {
          sessionLog.warn(`Source ${sourceSlug} requires authentication`)
          return false
        }

        // Track whether we added this slug (for rollback on failure)
        const slugSet = new Set(managed.enabledSourceSlugs || [])
        const wasAlreadyEnabled = slugSet.has(sourceSlug)

        // Add to enabled sources if not already there
        if (!wasAlreadyEnabled) {
          slugSet.add(sourceSlug)
          managed.enabledSourceSlugs = Array.from(slugSet)
          sessionLog.info(`Added source ${sourceSlug} to session enabled sources`)
        }

        // Build server configs for all enabled sources
        const allEnabledSources = getSourcesBySlugs(workspaceRootPath, managed.enabledSourceSlugs || [])
        // Pass session path so large API responses can be saved to session folder
        const sessionPath = getSessionStoragePath(workspaceRootPath, managed.id)
        const { mcpServers, apiServers, errors } = await buildServersFromSources(allEnabledSources, sessionPath)

        if (errors.length > 0) {
          sessionLog.warn(`Source build errors during auto-enable:`, errors)
        }

        // Check if our target source was built successfully
        const sourceBuilt = sourceSlug in mcpServers || sourceSlug in apiServers
        if (!sourceBuilt) {
          sessionLog.warn(`Source ${sourceSlug} failed to build`)
          // Only remove if WE added it (not if it was already there)
          if (!wasAlreadyEnabled) {
            slugSet.delete(sourceSlug)
            managed.enabledSourceSlugs = Array.from(slugSet)
          }
          return false
        }

        // Apply source servers to the agent
        const intendedSlugs = allEnabledSources
          .filter(s => s.config.enabled && s.config.isAuthenticated)
          .map(s => s.config.slug)
        managed.agent!.setSourceServers(mcpServers, apiServers, intendedSlugs)

        sessionLog.info(`Auto-enabled source ${sourceSlug} for session ${managed.id}`)

        // Persist session with updated enabled sources
        this.persistSession(managed)

        // Notify renderer of source change
        this.sendEvent({
          type: 'sources_changed',
          sessionId: managed.id,
          enabledSourceSlugs: managed.enabledSourceSlugs || [],
        }, managed.workspace.id)

        return true
      }

      // NOTE: Source reloading is now handled by ConfigWatcher callbacks
      // which detect filesystem changes and update all affected sessions.
      // See setupConfigWatcher() for the full reload logic.

      // Apply session-scoped permission mode to the newly created agent
      // This ensures the UI toggle state is reflected in the agent before first message
      if (managed.permissionMode) {
        setPermissionMode(managed.id, managed.permissionMode)
        sessionLog.info(`Applied permission mode '${managed.permissionMode}' to agent for session ${managed.id}`)
      }
      end()
    }
    return managed.agent
  }

  async flagSession(sessionId: string): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (managed) {
      managed.isFlagged = true
      // Persist in-memory state directly to avoid race with pending queue writes
      this.persistSession(managed)
      await this.flushSession(managed.id)
      // Notify all windows for this workspace
      this.sendEvent({ type: 'session_flagged', sessionId }, managed.workspace.id)
    }
  }

  async unflagSession(sessionId: string): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (managed) {
      managed.isFlagged = false
      // Persist in-memory state directly to avoid race with pending queue writes
      this.persistSession(managed)
      await this.flushSession(managed.id)
      // Notify all windows for this workspace
      this.sendEvent({ type: 'session_unflagged', sessionId }, managed.workspace.id)
    }
  }

  async setTodoState(sessionId: string, todoState: TodoState): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (managed) {
      managed.todoState = todoState
      // Persist in-memory state directly to avoid race with pending queue writes
      this.persistSession(managed)
      await this.flushSession(managed.id)
      // Notify all windows for this workspace
      this.sendEvent({ type: 'todo_state_changed', sessionId, todoState }, managed.workspace.id)
    }
  }

  // ============================================
  // Pending Plan Execution (Accept & Compact)
  // ============================================

  /**
   * Set pending plan execution state.
   * Called when user clicks "Accept & Compact" to persist the plan path
   * so execution can resume after compaction (even if page reloads).
   */
  async setPendingPlanExecution(sessionId: string, planPath: string): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (managed) {
      await setStoredPendingPlanExecution(managed.workspace.rootPath, sessionId, planPath)
      sessionLog.info(`Session ${sessionId}: set pending plan execution for ${planPath}`)
    }
  }

  /**
   * Mark compaction as complete for pending plan execution.
   * Called when compaction_complete event fires - allows reload recovery
   * to know that compaction finished and plan can be executed.
   */
  async markCompactionComplete(sessionId: string): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (managed) {
      await markStoredCompactionComplete(managed.workspace.rootPath, sessionId)
      sessionLog.info(`Session ${sessionId}: compaction marked complete for pending plan`)
    }
  }

  /**
   * Clear pending plan execution state.
   * Called after plan execution is triggered, on new user message,
   * or when the pending execution is no longer relevant.
   */
  async clearPendingPlanExecution(sessionId: string): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (managed) {
      await clearStoredPendingPlanExecution(managed.workspace.rootPath, sessionId)
      sessionLog.info(`Session ${sessionId}: cleared pending plan execution`)
    }
  }

  /**
   * Get pending plan execution state for a session.
   * Used on reload/init to check if we need to resume plan execution.
   */
  getPendingPlanExecution(sessionId: string): { planPath: string; awaitingCompaction: boolean } | null {
    const managed = this.sessions.get(sessionId)
    if (!managed) return null
    return getStoredPendingPlanExecution(managed.workspace.rootPath, sessionId)
  }

  // ============================================
  // Session Sharing
  // ============================================

  /**
   * Share session to the web viewer
   * Uploads session data and returns shareable URL
   */
  async shareToViewer(sessionId: string): Promise<import('../shared/types').ShareResult> {
    const managed = this.sessions.get(sessionId)
    if (!managed) {
      return { success: false, error: 'Session not found' }
    }

    // Signal async operation start for shimmer effect
    managed.isAsyncOperationOngoing = true
    this.sendEvent({ type: 'async_operation', sessionId, isOngoing: true }, managed.workspace.id)

    try {
      // Load session directly from disk (already in correct format)
      const storedSession = loadStoredSession(managed.workspace.rootPath, sessionId)
      if (!storedSession) {
        return { success: false, error: 'Session file not found' }
      }

      const { VIEWER_URL } = await import('@craft-agent/shared/branding')
      const response = await fetch(`${VIEWER_URL}/s/api`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(storedSession)
      })

      if (!response.ok) {
        sessionLog.error(`Share failed with status ${response.status}`)
        if (response.status === 413) {
          return { success: false, error: 'Session file is too large to share' }
        }
        return { success: false, error: 'Failed to upload session' }
      }

      const data = await response.json() as { id: string; url: string }

      // Store shared info in session
      managed.sharedUrl = data.url
      managed.sharedId = data.id
      const workspaceRootPath = managed.workspace.rootPath
      await updateSessionMetadata(workspaceRootPath, sessionId, {
        sharedUrl: data.url,
        sharedId: data.id,
      })

      sessionLog.info(`Session ${sessionId} shared at ${data.url}`)
      // Notify all windows for this workspace
      this.sendEvent({ type: 'session_shared', sessionId, sharedUrl: data.url }, managed.workspace.id)
      return { success: true, url: data.url }
    } catch (error) {
      sessionLog.error('Share error:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    } finally {
      // Signal async operation end
      managed.isAsyncOperationOngoing = false
      this.sendEvent({ type: 'async_operation', sessionId, isOngoing: false }, managed.workspace.id)
    }
  }

  /**
   * Update an existing shared session
   * Re-uploads session data to the same URL
   */
  async updateShare(sessionId: string): Promise<import('../shared/types').ShareResult> {
    const managed = this.sessions.get(sessionId)
    if (!managed) {
      return { success: false, error: 'Session not found' }
    }
    if (!managed.sharedId) {
      return { success: false, error: 'Session not shared' }
    }

    // Signal async operation start for shimmer effect
    managed.isAsyncOperationOngoing = true
    this.sendEvent({ type: 'async_operation', sessionId, isOngoing: true }, managed.workspace.id)

    try {
      // Load session directly from disk (already in correct format)
      const storedSession = loadStoredSession(managed.workspace.rootPath, sessionId)
      if (!storedSession) {
        return { success: false, error: 'Session file not found' }
      }

      const { VIEWER_URL } = await import('@craft-agent/shared/branding')
      const response = await fetch(`${VIEWER_URL}/s/api/${managed.sharedId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(storedSession)
      })

      if (!response.ok) {
        sessionLog.error(`Update share failed with status ${response.status}`)
        if (response.status === 413) {
          return { success: false, error: 'Session file is too large to share' }
        }
        return { success: false, error: 'Failed to update shared session' }
      }

      sessionLog.info(`Session ${sessionId} share updated at ${managed.sharedUrl}`)
      return { success: true, url: managed.sharedUrl }
    } catch (error) {
      sessionLog.error('Update share error:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    } finally {
      // Signal async operation end
      managed.isAsyncOperationOngoing = false
      this.sendEvent({ type: 'async_operation', sessionId, isOngoing: false }, managed.workspace.id)
    }
  }

  /**
   * Revoke a shared session
   * Deletes from viewer and clears local shared state
   */
  async revokeShare(sessionId: string): Promise<import('../shared/types').ShareResult> {
    const managed = this.sessions.get(sessionId)
    if (!managed) {
      return { success: false, error: 'Session not found' }
    }
    if (!managed.sharedId) {
      return { success: false, error: 'Session not shared' }
    }

    // Signal async operation start for shimmer effect
    managed.isAsyncOperationOngoing = true
    this.sendEvent({ type: 'async_operation', sessionId, isOngoing: true }, managed.workspace.id)

    try {
      const { VIEWER_URL } = await import('@craft-agent/shared/branding')
      const response = await fetch(
        `${VIEWER_URL}/s/api/${managed.sharedId}`,
        { method: 'DELETE' }
      )

      if (!response.ok) {
        sessionLog.error(`Revoke failed with status ${response.status}`)
        return { success: false, error: 'Failed to revoke share' }
      }

      // Clear shared info
      delete managed.sharedUrl
      delete managed.sharedId
      const workspaceRootPath = managed.workspace.rootPath
      await updateSessionMetadata(workspaceRootPath, sessionId, {
        sharedUrl: undefined,
        sharedId: undefined,
      })

      sessionLog.info(`Session ${sessionId} share revoked`)
      // Notify all windows for this workspace
      this.sendEvent({ type: 'session_unshared', sessionId }, managed.workspace.id)
      return { success: true }
    } catch (error) {
      sessionLog.error('Revoke error:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    } finally {
      // Signal async operation end
      managed.isAsyncOperationOngoing = false
      this.sendEvent({ type: 'async_operation', sessionId, isOngoing: false }, managed.workspace.id)
    }
  }

  // ============================================
  // Session Sources
  // ============================================

  /**
   * Update session's enabled sources
   * If agent exists, builds and applies servers immediately.
   * Otherwise, servers will be built fresh on next message.
   */
  async setSessionSources(sessionId: string, sourceSlugs: string[]): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (!managed) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    const workspaceRootPath = managed.workspace.rootPath
    sessionLog.info(`Setting sources for session ${sessionId}:`, sourceSlugs)

    // Store the selection
    managed.enabledSourceSlugs = sourceSlugs

    // If agent exists, build and apply servers immediately
    if (managed.agent) {
      const sources = getSourcesBySlugs(workspaceRootPath, sourceSlugs)
      // Pass session path so large API responses can be saved to session folder
      const sessionPath = getSessionStoragePath(workspaceRootPath, sessionId)
      const { mcpServers, apiServers, errors } = await buildServersFromSources(sources, sessionPath)
      if (errors.length > 0) {
        sessionLog.warn(`Source build errors:`, errors)
      }

      // Set all sources for context (agent sees full list with descriptions, including built-ins)
      const allSources = loadAllSources(workspaceRootPath)
      managed.agent.setAllSources(allSources)

      // Set active source servers (tools are only available from these)
      const intendedSlugs = sources.filter(s => s.config.enabled && s.config.isAuthenticated).map(s => s.config.slug)
      managed.agent.setSourceServers(mcpServers, apiServers, intendedSlugs)
      sessionLog.info(`Applied ${Object.keys(mcpServers).length} MCP + ${Object.keys(apiServers).length} API sources to active agent (${allSources.length} total)`)
    }

    // Persist the session with updated sources
    this.persistSession(managed)

    // Notify renderer of the source change
    this.sendEvent({
      type: 'sources_changed',
      sessionId,
      enabledSourceSlugs: sourceSlugs,
    }, managed.workspace.id)

    sessionLog.info(`Session ${sessionId} sources updated: ${sourceSlugs.length} sources`)
  }

  /**
   * Get the enabled source slugs for a session
   */
  getSessionSources(sessionId: string): string[] {
    const managed = this.sessions.get(sessionId)
    return managed?.enabledSourceSlugs ?? []
  }

  /**
   * Get the last final assistant message ID from a list of messages
   * A "final" message is one where:
   * - role === 'assistant' AND
   * - isIntermediate !== true (not commentary between tool calls)
   * Returns undefined if no final assistant message exists
   */
  private getLastFinalAssistantMessageId(messages: Message[]): string | undefined {
    // Iterate backwards to find the most recent final assistant message
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.role === 'assistant' && !msg.isIntermediate) {
        return msg.id
      }
    }
    return undefined
  }

  /**
   * Set which session the user is actively viewing.
   * Called when user navigates to a session. Used to determine whether to mark
   * new messages as unread - if user is viewing, don't mark unread.
   */
  setActiveViewingSession(sessionId: string | null, workspaceId: string): void {
    if (sessionId) {
      this.activeViewingSession.set(workspaceId, sessionId)
      // When user starts viewing a session that's not processing, clear unread
      const managed = this.sessions.get(sessionId)
      if (managed && !managed.isProcessing && managed.hasUnread) {
        this.markSessionRead(sessionId)
      }
    } else {
      this.activeViewingSession.delete(workspaceId)
    }
  }

  /**
   * Clear active viewing session for a workspace.
   * Called when all windows leave a workspace to ensure read/unread state is correct.
   */
  clearActiveViewingSession(workspaceId: string): void {
    this.activeViewingSession.delete(workspaceId)
  }

  /**
   * Check if a session is currently being viewed by the user
   */
  private isSessionBeingViewed(sessionId: string, workspaceId: string): boolean {
    return this.activeViewingSession.get(workspaceId) === sessionId
  }

  /**
   * Mark a session as read by setting lastReadMessageId and clearing hasUnread.
   * Called when user navigates to a session (and it's not processing).
   */
  async markSessionRead(sessionId: string): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (!managed) return

    // Only mark as read if not currently processing
    // (user is viewing but we want to wait for processing to complete)
    if (managed.isProcessing) return

    let needsPersist = false
    const updates: { lastReadMessageId?: string; hasUnread?: boolean } = {}

    // Update lastReadMessageId for legacy/manual unread functionality
    if (managed.messages.length > 0) {
      const lastFinalId = this.getLastFinalAssistantMessageId(managed.messages)
      if (lastFinalId && managed.lastReadMessageId !== lastFinalId) {
        managed.lastReadMessageId = lastFinalId
        updates.lastReadMessageId = lastFinalId
        needsPersist = true
      }
    }

    // Clear hasUnread flag (primary source of truth for NEW badge)
    if (managed.hasUnread) {
      managed.hasUnread = false
      updates.hasUnread = false
      needsPersist = true
    }

    // Persist changes
    if (needsPersist) {
      const workspaceRootPath = managed.workspace.rootPath
      await updateSessionMetadata(workspaceRootPath, sessionId, updates)
    }
  }

  /**
   * Mark a session as unread by setting hasUnread flag.
   * Called when user manually marks a session as unread via context menu.
   */
  async markSessionUnread(sessionId: string): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (managed) {
      managed.hasUnread = true
      managed.lastReadMessageId = undefined
      // Persist to disk
      const workspaceRootPath = managed.workspace.rootPath
      await updateSessionMetadata(workspaceRootPath, sessionId, { hasUnread: true, lastReadMessageId: undefined })
    }
  }

  async renameSession(sessionId: string, name: string): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (managed) {
      managed.name = name
      this.persistSession(managed)
      // Notify renderer of the name change
      this.sendEvent({ type: 'title_generated', sessionId, title: name }, managed.workspace.id)
    }
  }

  /**
   * Regenerate the session title based on recent messages.
   * Uses the last few user messages to capture what the session has evolved into.
   */
  async refreshTitle(sessionId: string): Promise<{ success: boolean; title?: string; error?: string }> {
    sessionLog.info(`refreshTitle called for session ${sessionId}`)
    const managed = this.sessions.get(sessionId)
    if (!managed) {
      sessionLog.warn(`refreshTitle: Session ${sessionId} not found`)
      return { success: false, error: 'Session not found' }
    }

    // Get recent user messages (last 3) for context
    const userMessages = managed.messages
      .filter((m) => m.role === 'user')
      .slice(-3)
      .map((m) => m.content)

    sessionLog.info(`refreshTitle: Found ${userMessages.length} user messages`)

    if (userMessages.length === 0) {
      sessionLog.warn(`refreshTitle: No user messages found`)
      return { success: false, error: 'No user messages to generate title from' }
    }

    // Get the most recent assistant response
    const lastAssistantMsg = managed.messages
      .filter((m) => m.role === 'assistant' && !m.isIntermediate)
      .slice(-1)[0]

    const assistantResponse = lastAssistantMsg?.content ?? ''
    sessionLog.info(`refreshTitle: Calling regenerateSessionTitle...`)

    // Notify renderer that title regeneration has started (for shimmer effect)
    managed.isAsyncOperationOngoing = true
    this.sendEvent({ type: 'async_operation', sessionId, isOngoing: true }, managed.workspace.id)
    // Keep legacy event for backward compatibility
    this.sendEvent({ type: 'title_regenerating', sessionId, isRegenerating: true }, managed.workspace.id)

    try {
      const title = await regenerateSessionTitle(userMessages, assistantResponse)
      sessionLog.info(`refreshTitle: regenerateSessionTitle returned: ${title ? `"${title}"` : 'null'}`)
      if (title) {
        managed.name = title
        this.persistSession(managed)
        // title_generated will also clear isRegeneratingTitle via the event handler
        this.sendEvent({ type: 'title_generated', sessionId, title }, managed.workspace.id)
        sessionLog.info(`Refreshed title for session ${sessionId}: "${title}"`)
        return { success: true, title }
      }
      // Failed to generate - clear regenerating state
      this.sendEvent({ type: 'title_regenerating', sessionId, isRegenerating: false }, managed.workspace.id)
      return { success: false, error: 'Failed to generate title' }
    } catch (error) {
      // Error occurred - clear regenerating state
      this.sendEvent({ type: 'title_regenerating', sessionId, isRegenerating: false }, managed.workspace.id)
      const message = error instanceof Error ? error.message : 'Unknown error'
      sessionLog.error(`Failed to refresh title for session ${sessionId}:`, error)
      return { success: false, error: message }
    } finally {
      // Signal async operation end
      managed.isAsyncOperationOngoing = false
      this.sendEvent({ type: 'async_operation', sessionId, isOngoing: false }, managed.workspace.id)
    }
  }

  /**
   * Update the working directory for a session
   */
  updateWorkingDirectory(sessionId: string, path: string): void {
    const managed = this.sessions.get(sessionId)
    if (managed) {
      managed.workingDirectory = path
      // Also update the agent's session config if agent exists
      if (managed.agent) {
        managed.agent.updateWorkingDirectory(path)
      }
      this.persistSession(managed)
      // Notify renderer of the working directory change
      this.sendEvent({ type: 'working_directory_changed', sessionId, workingDirectory: path }, managed.workspace.id)
    }
  }

  /**
   * Update the model for a session
   * Pass null to clear the session-specific model (will use global config)
   */
  async updateSessionModel(sessionId: string, workspaceId: string, model: string | null): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (managed) {
      managed.model = model ?? undefined
      // Persist to disk
      await updateSessionMetadata(managed.workspace.rootPath, sessionId, { model: model ?? undefined })
      // Update agent model if it already exists (takes effect on next query)
      if (managed.agent) {
        // Fallback chain: session model > workspace default > global config > DEFAULT_MODEL
        const wsConfig = loadWorkspaceConfig(managed.workspace.rootPath)
        const effectiveModel = model ?? wsConfig?.defaults?.model ?? loadStoredConfig()?.model ?? DEFAULT_MODEL
        const resolvedModel = resolveModelId(effectiveModel)
        managed.agent.setModel(resolvedModel)
      }
      // Notify renderer of the model change
      this.sendEvent({ type: 'session_model_changed', sessionId, model }, managed.workspace.id)
      sessionLog.info(`Session ${sessionId} model updated to: ${model ?? '(global config)'}`)
    }
  }

  /**
   * Update the content of a specific message in a session
   * Used by preview window to save edited content back to the original message
   */
  updateMessageContent(sessionId: string, messageId: string, content: string): void {
    const managed = this.sessions.get(sessionId)
    if (!managed) {
      sessionLog.warn(`Cannot update message: session ${sessionId} not found`)
      return
    }

    const message = managed.messages.find(m => m.id === messageId)
    if (!message) {
      sessionLog.warn(`Cannot update message: message ${messageId} not found in session ${sessionId}`)
      return
    }

    // Update the message content
    message.content = content
    // Persist the updated session
    this.persistSession(managed)
    sessionLog.info(`Updated message ${messageId} content in session ${sessionId}`)
  }

  async deleteSession(sessionId: string): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (!managed) {
      sessionLog.warn(`Cannot delete session: ${sessionId} not found`)
      return
    }

    // Get workspace slug before deleting
    const workspaceRootPath = managed.workspace.rootPath

    // If processing is in progress, force-abort via Query.close() and wait for cleanup
    if (managed.isProcessing && managed.agent) {
      managed.agent.forceAbort(AbortReason.UserStop)
      // Brief wait for the query to finish tearing down before we delete session files.
      // Prevents file corruption from overlapping writes during rapid delete operations.
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    // Clean up delta flush timers to prevent orphaned timers
    const timer = this.deltaFlushTimers.get(sessionId)
    if (timer) {
      clearTimeout(timer)
      this.deltaFlushTimers.delete(sessionId)
    }
    this.pendingDeltas.delete(sessionId)

    // Cancel any pending persistence write (session is being deleted, no need to save)
    sessionPersistenceQueue.cancel(sessionId)

    // Clean up session-scoped tool callbacks to prevent memory accumulation
    unregisterSessionScopedToolCallbacks(sessionId)

    // Dispose agent to clean up ConfigWatchers, event listeners, MCP connections
    if (managed.agent) {
      managed.agent.dispose()
    }

    this.sessions.delete(sessionId)

    // Delete from disk too
    deleteStoredSession(workspaceRootPath, sessionId)

    // Notify all windows for this workspace that the session was deleted
    this.sendEvent({ type: 'session_deleted', sessionId }, managed.workspace.id)

    // Clean up attachments directory (handled by deleteStoredSession for workspace-scoped storage)
    sessionLog.info(`Deleted session ${sessionId}`)
  }

  async sendMessage(sessionId: string, message: string, attachments?: FileAttachment[], storedAttachments?: StoredAttachment[], options?: SendMessageOptions, existingMessageId?: string, _isAuthRetry?: boolean): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (!managed) {
      throw new Error(`Session ${sessionId} not found`)
    }

    // Clear any pending plan execution state when a new user message is sent.
    // This acts as a safety valve - if the user moves on, we don't want to
    // auto-execute an old plan later.
    await clearStoredPendingPlanExecution(managed.workspace.rootPath, sessionId)

    // Ensure messages are loaded before we try to add new ones
    await this.ensureMessagesLoaded(managed)

    // If currently processing, queue the message and interrupt via forceAbort.
    // The abort throws an AbortError (caught in the catch block) which calls
    // onProcessingStopped → processNextQueuedMessage to drain the queue.
    if (managed.isProcessing) {
      sessionLog.info(`Session ${sessionId} is processing, queueing message and interrupting`)

      // Create user message for queued state (so UI can show it)
      const queuedMessage: Message = {
        id: generateMessageId(),
        role: 'user',
        content: message,
        timestamp: Date.now(),
        attachments: storedAttachments,
        badges: options?.badges,
      }

      // Add to messages immediately so it's persisted
      managed.messages.push(queuedMessage)

      // Queue the message info (with the generated ID for later matching)
      managed.messageQueue.push({ message, attachments, storedAttachments, options, messageId: queuedMessage.id })

      // Emit user_message event so UI can show queued state
      this.sendEvent({
        type: 'user_message',
        sessionId,
        message: queuedMessage,
        status: 'queued'
      }, managed.workspace.id)

      // Force-abort via Query.close() - immediately stops processing.
      // The for-await loop will complete, triggering onProcessingStopped → queue drain.
      managed.agent?.forceAbort(AbortReason.Redirect)

      return
    }

    // Add user message with stored attachments for persistence
    // Skip if existingMessageId is provided (message was already created when queued)
    let userMessage: Message
    if (existingMessageId) {
      // Find existing message (already added when queued)
      userMessage = managed.messages.find(m => m.id === existingMessageId)!
      if (!userMessage) {
        throw new Error(`Existing message ${existingMessageId} not found`)
      }
    } else {
      // Create new message
      userMessage = {
        id: generateMessageId(),
        role: 'user',
        content: message,
        timestamp: Date.now(),
        attachments: storedAttachments, // Include for persistence (has thumbnailBase64)
        badges: options?.badges,  // Include content badges (sources, skills with embedded icons)
      }
      managed.messages.push(userMessage)

      // Update lastMessageRole for badge display
      managed.lastMessageRole = 'user'

      // Emit user_message event so UI can confirm the optimistic message
      this.sendEvent({
        type: 'user_message',
        sessionId,
        message: userMessage,
        status: 'accepted'
      }, managed.workspace.id)

      // If this is the first user message and no title exists, set one immediately
      // AI generation will enhance it later, but we always have a title from the start
      const isFirstUserMessage = managed.messages.filter(m => m.role === 'user').length === 1
      if (isFirstUserMessage && !managed.name) {
        // Replace bracket mentions with their display labels (e.g. [skill:ws:commit] → "Commit")
        // so titles show human-readable names instead of raw IDs
        let titleSource = message
        if (options?.badges) {
          for (const badge of options.badges) {
            if (badge.rawText && badge.label) {
              titleSource = titleSource.replace(badge.rawText, badge.label)
            }
          }
        }
        // Sanitize: strip any remaining bracket mentions, XML blocks, tags
        const sanitized = sanitizeForTitle(titleSource)
        const initialTitle = sanitized.slice(0, 50) + (sanitized.length > 50 ? '…' : '')
        managed.name = initialTitle
        this.persistSession(managed)
        // Flush immediately so disk is authoritative before notifying renderer
        await this.flushSession(managed.id)
        this.sendEvent({
          type: 'title_generated',
          sessionId,
          title: initialTitle,
        }, managed.workspace.id)

        // Generate AI title asynchronously (will update the initial title)
        this.generateTitle(managed, sanitized)
      }
    }

    // Evaluate auto-label rules against the user message (common path for both
    // fresh and queued messages). Scans regex patterns configured on labels,
    // then merges any new matches into the session's label array.
    try {
      const labelTree = listLabels(managed.workspace.rootPath)
      const autoMatches = evaluateAutoLabels(message, labelTree)

      if (autoMatches.length > 0) {
        const existingLabels = managed.labels ?? []
        const newEntries = autoMatches
          .map(m => `${m.labelId}::${m.value}`)
          .filter(entry => !existingLabels.includes(entry))

        if (newEntries.length > 0) {
          managed.labels = [...existingLabels, ...newEntries]
          this.persistSession(managed)
          this.sendEvent({
            type: 'labels_changed',
            sessionId,
            labels: managed.labels,
          }, managed.workspace.id)
        }
      }
    } catch (e) {
      sessionLog.warn(`Auto-label evaluation failed for session ${sessionId}:`, e)
    }

    managed.lastMessageAt = Date.now()
    managed.isProcessing = true
    managed.streamingText = ''
    managed.processingGeneration++

    // Reset auth retry flag for this new message (allows one retry per message)
    // IMPORTANT: Skip reset if this is an auth retry call - the flag is already true
    // and resetting it would allow infinite retry loops
    // Note: authRetryInProgress is NOT reset here - it's managed by the retry logic
    if (!_isAuthRetry) {
      managed.authRetryAttempted = false
    }

    // Store message/attachments for potential retry after auth refresh
    // (SDK subprocess caches token at startup, so if it expires mid-session,
    // we need to recreate the agent and retry the message)
    managed.lastSentMessage = message
    managed.lastSentAttachments = attachments
    managed.lastSentStoredAttachments = storedAttachments
    managed.lastSentOptions = options

    // Capture the generation to detect if a new request supersedes this one.
    // This prevents the finally block from clobbering state when a follow-up message arrives.
    const myGeneration = managed.processingGeneration

    // Start perf span for entire sendMessage flow
    const sendSpan = perf.span('session.sendMessage', { sessionId })

    // Get or create the agent (lazy loading)
    const agent = await this.getOrCreateAgent(managed)
    sendSpan.mark('agent.ready')

    // Always set all sources for context (even if none are enabled), including built-ins
    const workspaceRootPath = managed.workspace.rootPath
    const allSources = loadAllSources(workspaceRootPath)
    agent.setAllSources(allSources)
    sendSpan.mark('sources.loaded')

    // Apply source servers if any are enabled
    if (managed.enabledSourceSlugs?.length) {
      // Always build server configs fresh (no caching - single source of truth)
      const sources = getSourcesBySlugs(workspaceRootPath, managed.enabledSourceSlugs)
      // Pass session path so large API responses can be saved to session folder
      const sessionPath = getSessionStoragePath(workspaceRootPath, sessionId)
      const { mcpServers, apiServers, errors } = await buildServersFromSources(sources, sessionPath)
      if (errors.length > 0) {
        sessionLog.warn(`Source build errors:`, errors)
      }

      // Apply source servers to the agent
      const mcpCount = Object.keys(mcpServers).length
      const apiCount = Object.keys(apiServers).length
      if (mcpCount > 0 || apiCount > 0 || managed.enabledSourceSlugs.length > 0) {
        // Pass intended slugs so agent shows sources as active even if build failed
        const intendedSlugs = sources.filter(s => s.config.enabled && s.config.isAuthenticated).map(s => s.config.slug)
        agent.setSourceServers(mcpServers, apiServers, intendedSlugs)
        sessionLog.info(`Applied ${mcpCount} MCP + ${apiCount} API sources to session ${sessionId} (${allSources.length} total)`)
      }
      sendSpan.mark('servers.applied')

      // Refresh MCP OAuth tokens if needed (before chat uses them)
      // This handles the case where tokens expired mid-session
      // Ensure tokenRefreshManager exists (created at session initialization)
      if (!managed.tokenRefreshManager) {
        managed.tokenRefreshManager = new TokenRefreshManager(getSourceCredentialManager(), {
          log: (msg) => sessionLog.debug(msg),
        })
      }
      const refreshResult = await refreshMcpOAuthTokensIfNeeded(
        agent,
        sources,
        sessionPath,
        managed.tokenRefreshManager
      )
      if (refreshResult.tokensRefreshed) {
        sendSpan.mark('oauth.tokens.refreshed')
      }
      // Emit warnings for any sources that failed to refresh
      for (const failed of refreshResult.failedSources) {
        this.sendEvent({
          type: 'info',
          sessionId,
          message: `Token refresh failed for "${failed.slug}" - source may need re-authentication`,
          level: 'warning'
        }, managed.workspace.id)
      }
    }

    try {
      sessionLog.info('Starting chat for session:', sessionId)
      sessionLog.info('Workspace:', JSON.stringify(managed.workspace, null, 2))
      sessionLog.info('Message:', message)
      sessionLog.info('Agent model:', agent.getModel())
      sessionLog.info('process.cwd():', process.cwd())

      // Set ultrathink override if enabled (single-shot - resets after query)
      // This boosts the session's thinkingLevel to 'max' for this message only
      if (options?.ultrathinkEnabled) {
        sessionLog.info('Ultrathink override ENABLED')
        agent.setUltrathinkOverride(true)
      }

      // Process the message through the agent
      sessionLog.info('Calling agent.chat()...')
      if (attachments?.length) {
        sessionLog.info('Attachments:', attachments.length)
      }

      // Skills mentioned via @mentions are handled by the SDK's Skill tool.
      // The UI layer (extractBadges in mentions.ts) injects fully-qualified names
      // in the rawText, and canUseTool in craft-agent.ts provides a fallback
      // to qualify short names. No transformation needed here.

      sendSpan.mark('chat.starting')
      const chatIterator = agent.chat(message, attachments)
      sessionLog.info('Got chat iterator, starting iteration...')

      for await (const event of chatIterator) {
        // Log events (skip noisy text_delta)
        if (event.type !== 'text_delta') {
          if (event.type === 'tool_start') {
            sessionLog.info(`tool_start: ${event.toolName} (${event.toolUseId})`)
          } else if (event.type === 'tool_result') {
            sessionLog.info(`tool_result: ${event.toolUseId} isError=${event.isError}`)
          } else {
            sessionLog.info('Got event:', event.type)
          }
        }

        // Process the event first
        this.processEvent(managed, event)

        // Fallback: Capture SDK session ID if the onSdkSessionIdUpdate callback didn't fire.
        // Primary capture happens in getOrCreateAgent() via onSdkSessionIdUpdate callback,
        // which immediately flushes to disk. This fallback handles edge cases where the
        // callback might not fire (e.g., SDK version mismatch, callback not supported).
        if (!managed.sdkSessionId) {
          const sdkId = agent.getSessionId()
          if (sdkId) {
            managed.sdkSessionId = sdkId
            sessionLog.info(`Captured SDK session ID via fallback: ${sdkId}`)
            // Also flush here since we're in fallback mode
            this.persistSession(managed)
            sessionPersistenceQueue.flush(managed.id)
          }
        }

        // Handle complete event - SDK always sends this (even after interrupt)
        // This is the central place where processing ends
        if (event.type === 'complete') {
          // Skip normal completion handling if auth retry is in progress
          // The retry will handle its own completion
          if (managed.authRetryInProgress) {
            sessionLog.info('Chat completed but auth retry is in progress, skipping normal completion handling')
            sendSpan.mark('chat.complete.auth_retry_pending')
            sendSpan.end()
            return  // Exit function - retry will handle completion
          }

          sessionLog.info('Chat completed via complete event')

          // Check if we got an assistant response in this turn
          // If not, the SDK may have hit context limits or other issues
          const lastAssistantMsg = [...managed.messages].reverse().find(m =>
            m.role === 'assistant' && !m.isIntermediate
          )
          const lastUserMsg = [...managed.messages].reverse().find(m => m.role === 'user')

          // If the last user message is newer than any assistant response, we got no reply
          // This can happen due to context overflow or API issues - log for debugging but don't show UI warning
          if (lastUserMsg && (!lastAssistantMsg || lastUserMsg.timestamp > lastAssistantMsg.timestamp)) {
            sessionLog.warn(`Session ${sessionId} completed without assistant response - possible context overflow or API issue`)
          }

          sendSpan.mark('chat.complete')
          sendSpan.end()
          this.onProcessingStopped(sessionId, 'complete')
          return  // Exit function, skip finally block (onProcessingStopped handles cleanup)
        }

        // Check if cancelled via cancelProcessing (Stop button)
        // The SDK will still send a complete event, but we break early here
        // since cancelProcessing already cleared the state
        if (!managed.isProcessing) {
          sessionLog.info('Processing flag cleared, breaking out of event loop')
          break
        }
      }

      // Loop exited without complete event (shouldn't happen normally)
      sessionLog.info('Chat loop exited unexpectedly')
    } catch (error) {
      // Check if this is an abort error (expected when interrupted)
      const isAbortError = error instanceof Error && (
        error.name === 'AbortError' ||
        error.message === 'Request was aborted.' ||
        error.message.includes('aborted')
      )

      if (isAbortError) {
        // Extract abort reason if available (safety net for unexpected abort propagation)
        const reason = (error as DOMException).cause as AbortReason | undefined

        sessionLog.info(`Chat aborted (reason: ${reason || 'unknown'})`)
        sendSpan.mark('chat.aborted')
        sendSpan.setMetadata('abort_reason', reason || 'unknown')
        sendSpan.end()

        // Plan submissions handle their own cleanup (they set isProcessing = false directly).
        // All other abort reasons route through onProcessingStopped for queue draining.
        if (reason === AbortReason.UserStop || reason === AbortReason.Redirect || reason === undefined) {
          this.onProcessingStopped(sessionId, 'interrupted')
        }
      } else {
        sessionLog.error('Error in chat:', error)
        sessionLog.error('Error message:', error instanceof Error ? error.message : String(error))
        sessionLog.error('Error stack:', error instanceof Error ? error.stack : 'No stack')

        // Report chat/SDK errors to Sentry for crash tracking
        Sentry.captureException(error, {
          tags: { errorSource: 'chat', sessionId },
        })

        sendSpan.mark('chat.error')
        sendSpan.setMetadata('error', error instanceof Error ? error.message : String(error))
        sendSpan.end()
        this.sendEvent({
          type: 'error',
          sessionId,
          error: error instanceof Error ? error.message : 'Unknown error'
        }, managed.workspace.id)
        // Handle error via centralized handler
        this.onProcessingStopped(sessionId, 'error')
      }
    } finally {
      // Only handle cleanup for unexpected exits (loop break without complete event)
      // Normal completion returns early after calling onProcessingStopped
      // Errors are handled in catch block
      if (managed.isProcessing && managed.processingGeneration === myGeneration) {
        sessionLog.info('Finally block cleanup - unexpected exit')
        sendSpan.mark('chat.unexpected_exit')
        sendSpan.end()
        this.onProcessingStopped(sessionId, 'interrupted')
      }
    }
  }

  async cancelProcessing(sessionId: string, silent = false): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (!managed?.isProcessing) {
      return // Not processing, nothing to cancel
    }

    sessionLog.info('Cancelling processing for session:', sessionId, silent ? '(silent)' : '')

    // Clear queue - user explicitly stopped, don't process queued messages
    managed.messageQueue = []

    // Force-abort via Query.close() - immediately stops processing
    if (managed.agent) {
      managed.agent.forceAbort(AbortReason.UserStop)
    }

    // Set state immediately - the SDK will send a complete event
    // but since we cleared isProcessing, onProcessingStopped won't be called again
    managed.isProcessing = false

    // Only show "Response interrupted" message when user explicitly clicked Stop
    // Silent mode is used when redirecting (sending new message while processing)
    if (!silent) {
      const interruptedMessage: Message = {
        id: generateMessageId(),
        role: 'info',
        content: 'Response interrupted',
        timestamp: Date.now(),
      }
      managed.messages.push(interruptedMessage)
      this.sendEvent({ type: 'interrupted', sessionId, message: interruptedMessage }, managed.workspace.id)
    } else {
      // Still send interrupted event but without the message (for UI state update)
      this.sendEvent({ type: 'interrupted', sessionId }, managed.workspace.id)
    }

    // Emit complete since we're stopping and queue is cleared (include tokenUsage for real-time updates)
    this.sendEvent({ type: 'complete', sessionId, tokenUsage: managed.tokenUsage }, managed.workspace.id)

    // Persist session
    this.persistSession(managed)
  }

  /**
   * Central handler for when processing stops (any reason).
   * Single source of truth for cleanup and queue processing.
   *
   * @param sessionId - The session that stopped processing
   * @param reason - Why processing stopped ('complete' | 'interrupted' | 'error')
   */
  private async onProcessingStopped(
    sessionId: string,
    reason: 'complete' | 'interrupted' | 'error'
  ): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (!managed) return

    sessionLog.info(`Processing stopped for session ${sessionId}: ${reason}`)

    // 1. Cleanup state
    managed.isProcessing = false

    // 2. Handle unread state based on whether user is viewing this session
    //    This is the explicit state machine for NEW badge:
    //    - If user is viewing: mark as read (they saw it complete)
    //    - If user is NOT viewing: mark as unread (they have new content)
    const isViewing = this.isSessionBeingViewed(sessionId, managed.workspace.id)
    const hasFinalMessage = this.getLastFinalAssistantMessageId(managed.messages) !== undefined

    if (reason === 'complete' && hasFinalMessage) {
      if (isViewing) {
        // User is watching - mark as read immediately
        await this.markSessionRead(sessionId)
      } else {
        // User is not watching - mark as unread for NEW badge
        if (!managed.hasUnread) {
          managed.hasUnread = true
          await updateSessionMetadata(managed.workspace.rootPath, sessionId, { hasUnread: true })
        }
      }
    }

    // 3. Auto-complete mini agent sessions to avoid session list clutter
    //    Mini agents are spawned from EditPopovers for quick config edits
    //    and should automatically move to 'done' when finished
    if (reason === 'complete' && managed.systemPromptPreset === 'mini' && managed.todoState !== 'done') {
      sessionLog.info(`Auto-completing mini agent session ${sessionId}`)
      await this.setTodoState(sessionId, 'done')
    }

    // 4. Check queue and process or complete
    if (managed.messageQueue.length > 0) {
      // Has queued messages - process next
      this.processNextQueuedMessage(sessionId)
    } else {
      // No queue - emit complete to UI (include tokenUsage and hasUnread for state updates)
      this.sendEvent({
        type: 'complete',
        sessionId,
        tokenUsage: managed.tokenUsage,
        hasUnread: managed.hasUnread,  // Propagate unread state to renderer
      }, managed.workspace.id)
    }

    // 5. Always persist
    this.persistSession(managed)
  }

  /**
   * Process the next message in the queue.
   * Called by onProcessingStopped when queue has messages.
   */
  private processNextQueuedMessage(sessionId: string): void {
    const managed = this.sessions.get(sessionId)
    if (!managed || managed.messageQueue.length === 0) return

    const next = managed.messageQueue.shift()!
    sessionLog.info(`Processing queued message for session ${sessionId}`)

    // Update UI: queued → processing
    if (next.messageId) {
      const existingMessage = managed.messages.find(m => m.id === next.messageId)
      if (existingMessage) {
        this.sendEvent({
          type: 'user_message',
          sessionId,
          message: existingMessage,
          status: 'processing'
        }, managed.workspace.id)
      }
    }

    // Process message (use setImmediate to allow current stack to clear)
    setImmediate(() => {
      this.sendMessage(
        sessionId,
        next.message,
        next.attachments,
        next.storedAttachments,
        next.options,
        next.messageId
      ).catch(err => {
        sessionLog.error('Error processing queued message:', err)
        // Report queued message failures to Sentry — these indicate SDK/chat pipeline errors
        Sentry.captureException(err, {
          tags: { errorSource: 'chat-queue', sessionId },
        })
        this.sendEvent({
          type: 'error',
          sessionId,
          error: err instanceof Error ? err.message : 'Unknown error'
        }, managed.workspace.id)
        // Call onProcessingStopped to handle cleanup and check for more queued messages
        this.onProcessingStopped(sessionId, 'error')
      })
    })
  }

  async killShell(sessionId: string, shellId: string): Promise<{ success: boolean; error?: string }> {
    const managed = this.sessions.get(sessionId)
    if (!managed) {
      return { success: false, error: 'Session not found' }
    }

    sessionLog.info(`Killing shell ${shellId} for session: ${sessionId}`)

    // Try to kill the actual process using the stored command
    const command = managed.backgroundShellCommands.get(shellId)
    if (command) {
      try {
        // Use pkill to find and kill processes matching the command
        // The -f flag matches against the full command line
        const { exec } = await import('child_process')
        const { promisify } = await import('util')
        const execAsync = promisify(exec)

        // Escape the command for use in pkill pattern
        // We search for the unique command string in process args
        const escapedCommand = command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

        sessionLog.info(`Attempting to kill process with command: ${command.slice(0, 100)}...`)

        // Use pgrep first to find the PID, then kill it
        // This is safer than pkill -f which can match too broadly
        try {
          const { stdout } = await execAsync(`pgrep -f "${escapedCommand}"`)
          const pids = stdout.trim().split('\n').filter(Boolean)

          if (pids.length > 0) {
            sessionLog.info(`Found ${pids.length} process(es) to kill: ${pids.join(', ')}`)
            // Kill each process
            for (const pid of pids) {
              try {
                await execAsync(`kill -TERM ${pid}`)
                sessionLog.info(`Sent SIGTERM to process ${pid}`)
              } catch (killErr) {
                // Process may have already exited
                sessionLog.warn(`Failed to kill process ${pid}: ${killErr}`)
              }
            }
          } else {
            sessionLog.info(`No processes found matching command`)
          }
        } catch (pgrepErr) {
          // pgrep returns exit code 1 when no processes found, which is fine
          sessionLog.info(`No matching processes found (pgrep returned no results)`)
        }

        // Clean up the stored command
        managed.backgroundShellCommands.delete(shellId)
      } catch (err) {
        sessionLog.error(`Error killing shell process: ${err}`)
      }
    } else {
      sessionLog.warn(`No command stored for shell ${shellId}, cannot kill process`)
    }

    // Always emit shell_killed to remove from UI regardless of process kill success
    this.sendEvent({
      type: 'shell_killed',
      sessionId,
      shellId,
    }, managed.workspace.id)

    return { success: true }
  }

  /**
   * Get output from a background task or shell
   *
   * NOT YET IMPLEMENTED - This is a placeholder.
   *
   * Background task output retrieval requires infrastructure that doesn't exist yet:
   * 1. Storing shell output streams as they come in (tool_result events only have final output)
   * 2. Associating outputs with task/shell IDs in a queryable store
   * 3. Handling the BashOutput tool results for ongoing shells
   *
   * Current workaround: Users can view task output in the main chat panel where
   * tool results are displayed inline with the conversation.
   *
   * @param taskId - The task or shell ID
   * @returns Placeholder message explaining the limitation
   */
  async getTaskOutput(taskId: string): Promise<string | null> {
    sessionLog.info(`Getting output for task: ${taskId} (not implemented)`)

    // This functionality requires a dedicated output tracking system.
    // The SDK manages shells internally but doesn't expose an API for querying
    // their output history outside of tool_result events.
    return `Background task output retrieval is not yet implemented.

Task ID: ${taskId}

To view this task's output:
• Check the main chat panel where tool results are displayed
• Look for the tool_result message associated with this task
• For ongoing shells, the agent can use BashOutput to check status`
  }

  /**
   * Respond to a pending permission request
   * Returns true if the response was delivered, false if agent/session is gone
   */
  respondToPermission(sessionId: string, requestId: string, allowed: boolean, alwaysAllow: boolean): boolean {
    const managed = this.sessions.get(sessionId)
    if (managed?.agent) {
      sessionLog.info(`Permission response for ${requestId}: allowed=${allowed}, alwaysAllow=${alwaysAllow}`)
      managed.agent.respondToPermission(requestId, allowed, alwaysAllow)
      return true
    } else {
      sessionLog.warn(`Cannot respond to permission - no agent for session ${sessionId}`)
      return false
    }
  }

  /**
   * Respond to a pending credential request
   * Returns true if the response was delivered, false if no pending request found
   *
   * Supports both:
   * - New unified auth flow (via handleCredentialInput)
   * - Legacy callback flow (via pendingCredentialResolvers)
   */
  async respondToCredential(sessionId: string, requestId: string, response: import('../shared/types').CredentialResponse): Promise<boolean> {
    // First, check if this is a new unified auth flow request
    const managed = this.sessions.get(sessionId)
    if (managed?.pendingAuthRequest && managed.pendingAuthRequest.requestId === requestId) {
      sessionLog.info(`Credential response (unified flow) for ${requestId}: cancelled=${response.cancelled}`)
      await this.handleCredentialInput(sessionId, requestId, response)
      return true
    }

    // Fall back to legacy callback flow
    const resolver = this.pendingCredentialResolvers.get(requestId)
    if (resolver) {
      sessionLog.info(`Credential response (legacy flow) for ${requestId}: cancelled=${response.cancelled}`)
      resolver(response)
      this.pendingCredentialResolvers.delete(requestId)
      return true
    } else {
      sessionLog.warn(`Cannot respond to credential - no pending request for ${requestId}`)
      return false
    }
  }

  /**
   * Set the permission mode for a session ('safe', 'ask', 'allow-all')
   */
  setSessionPermissionMode(sessionId: string, mode: PermissionMode): void {
    const managed = this.sessions.get(sessionId)
    if (managed) {
      // Update permission mode
      managed.permissionMode = mode

      // Update the mode state for this specific session via mode manager
      setPermissionMode(sessionId, mode)

      this.sendEvent({
        type: 'permission_mode_changed',
        sessionId: managed.id,
        permissionMode: mode,
      }, managed.workspace.id)
      // Persist to disk
      this.persistSession(managed)
    }
  }

  /**
   * Set labels for a session (additive tags, many-per-session).
   * Labels are IDs referencing workspace labels/config.json.
   */
  setSessionLabels(sessionId: string, labels: string[]): void {
    const managed = this.sessions.get(sessionId)
    if (managed) {
      managed.labels = labels

      this.sendEvent({
        type: 'labels_changed',
        sessionId: managed.id,
        labels: managed.labels,
      }, managed.workspace.id)
      // Persist to disk
      this.persistSession(managed)
    }
  }

  /**
   * Set the thinking level for a session ('off', 'think', 'max')
   * This is sticky and persisted across messages.
   */
  setSessionThinkingLevel(sessionId: string, level: ThinkingLevel): void {
    const managed = this.sessions.get(sessionId)
    if (managed) {
      // Update thinking level in managed session
      managed.thinkingLevel = level

      // Update the agent's thinking level if it exists
      if (managed.agent) {
        managed.agent.setThinkingLevel(level)
      }

      sessionLog.info(`Session ${sessionId}: thinking level set to ${level}`)
      // Persist to disk
      this.persistSession(managed)
    }
  }

  /**
   * Generate an AI title for a session from the user's first message.
   * Called asynchronously when the first user message is received.
   */
  private async generateTitle(managed: ManagedSession, userMessage: string): Promise<void> {
    sessionLog.info(`Starting title generation for session ${managed.id}`)
    try {
      const title = await generateSessionTitle(userMessage)
      if (title) {
        managed.name = title
        this.persistSession(managed)
        // Flush immediately to ensure disk is up-to-date before notifying renderer.
        // This prevents race condition where lazy loading reads stale disk data
        // (the persistence queue has a 500ms debounce).
        await this.flushSession(managed.id)
        // Now safe to notify renderer - disk is authoritative
        this.sendEvent({ type: 'title_generated', sessionId: managed.id, title }, managed.workspace.id)
        sessionLog.info(`Generated title for session ${managed.id}: "${title}"`)
      } else {
        sessionLog.warn(`Title generation returned null for session ${managed.id}`)
      }
    } catch (error) {
      sessionLog.error(`Failed to generate title for session ${managed.id}:`, error)
    }
  }

  private processEvent(managed: ManagedSession, event: AgentEvent): void {
    const sessionId = managed.id
    const workspaceId = managed.workspace.id

    switch (event.type) {
      case 'text_delta':
        managed.streamingText += event.text
        // Queue delta for batched sending (performance: reduces IPC from 50+/sec to ~20/sec)
        this.queueDelta(sessionId, workspaceId, event.text, event.turnId)
        break

      case 'text_complete': {
        // Flush any pending deltas before sending complete (ensures renderer has all content)
        this.flushDelta(sessionId, workspaceId)

        // SDK's parent_tool_use_id identifies the subagent context for this text
        // (undefined = main agent / top-level, Task ID = inside subagent)
        // Only intermediate text (text before a tool_use) gets a parent assignment
        const textParentToolUseId = event.isIntermediate ? event.parentToolUseId : undefined

        const assistantMessage: Message = {
          id: generateMessageId(),
          role: 'assistant',
          content: event.text,
          timestamp: Date.now(),
          isIntermediate: event.isIntermediate,
          turnId: event.turnId,
          parentToolUseId: textParentToolUseId,
        }
        managed.messages.push(assistantMessage)
        managed.streamingText = ''

        // Update lastMessageRole and lastFinalMessageId for badge/unread display (only for final messages)
        if (!event.isIntermediate) {
          managed.lastMessageRole = 'assistant'
          managed.lastFinalMessageId = assistantMessage.id
        }

        this.sendEvent({ type: 'text_complete', sessionId, text: event.text, isIntermediate: event.isIntermediate, turnId: event.turnId, parentToolUseId: textParentToolUseId }, workspaceId)

        // Persist session after complete message to prevent data loss on quit
        this.persistSession(managed)
        break
      }

      case 'tool_start': {
        // Format tool input paths to relative for better readability
        const formattedToolInput = formatToolInputPaths(event.input)

        // Resolve tool display metadata (icon, displayName) for skills/sources
        // Only resolve when we have input (second event for SDK dual-event pattern)
        const workspaceRootPath = managed.workspace.rootPath
        let toolDisplayMeta: ToolDisplayMeta | undefined
        if (formattedToolInput && Object.keys(formattedToolInput).length > 0) {
          const allSources = loadAllSources(workspaceRootPath)
          toolDisplayMeta = resolveToolDisplayMeta(event.toolName, formattedToolInput, workspaceRootPath, allSources)
        }

        // Check if a message with this toolUseId already exists FIRST
        // SDK sends two events per tool: first from stream_event (empty input),
        // second from assistant message (complete input)
        const existingStartMsg = managed.messages.find(m => m.toolUseId === event.toolUseId)
        const isDuplicateEvent = !!existingStartMsg

        // Use parentToolUseId directly from the event — CraftAgent resolves this
        // from SDK's parent_tool_use_id (authoritative, handles parallel Tasks correctly).
        // No stack or map needed; the event carries the correct parent from the start.
        const parentToolUseId = event.parentToolUseId

        // Track if we need to send an event to the renderer
        // Send on: first occurrence OR when we have new input data to update
        let shouldSendEvent = !isDuplicateEvent

        if (existingStartMsg) {
          // Update existing message with complete input (second event has full input)
          if (formattedToolInput && Object.keys(formattedToolInput).length > 0) {
            const hadInputBefore = existingStartMsg.toolInput && Object.keys(existingStartMsg.toolInput).length > 0
            existingStartMsg.toolInput = formattedToolInput
            // Send update event if we're adding input that wasn't there before
            if (!hadInputBefore) {
              shouldSendEvent = true
            }
          }
          // Also set parent if not already set
          if (parentToolUseId && !existingStartMsg.parentToolUseId) {
            existingStartMsg.parentToolUseId = parentToolUseId
          }
          // Set toolDisplayMeta if not already set (has base64 icon for viewer)
          if (toolDisplayMeta && !existingStartMsg.toolDisplayMeta) {
            existingStartMsg.toolDisplayMeta = toolDisplayMeta
          }
          // Update toolIntent if not already set (second event has intent from complete input)
          if (event.intent && !existingStartMsg.toolIntent) {
            existingStartMsg.toolIntent = event.intent
          }
          // Update toolDisplayName if not already set
          if (event.displayName && !existingStartMsg.toolDisplayName) {
            existingStartMsg.toolDisplayName = event.displayName
          }
        } else {
          // Add tool message immediately (will be updated on tool_result)
          // This ensures tool calls are persisted even if they don't complete
          const toolStartMessage: Message = {
            id: generateMessageId(),
            role: 'tool',
            content: `Running ${event.toolName}...`,
            timestamp: Date.now(),
            toolName: event.toolName,
            toolUseId: event.toolUseId,
            toolInput: formattedToolInput,
            toolStatus: 'executing',
            toolIntent: event.intent,
            toolDisplayName: event.displayName,
            toolDisplayMeta,  // Includes base64 icon for viewer compatibility
            turnId: event.turnId,
            parentToolUseId,
          }
          managed.messages.push(toolStartMessage)
        }

        // Send event to renderer on first occurrence OR when input data is updated
        if (shouldSendEvent) {
          this.sendEvent({
            type: 'tool_start',
            sessionId,
            toolName: event.toolName,
            toolUseId: event.toolUseId,
            toolInput: formattedToolInput ?? {},
            toolIntent: event.intent,
            toolDisplayName: event.displayName,
            toolDisplayMeta,  // Includes base64 icon for viewer compatibility
            turnId: event.turnId,
            parentToolUseId,
          }, workspaceId)
        }
        break
      }

      case 'tool_result': {
        // toolName comes directly from CraftAgent (resolved via ToolIndex)
        const toolName = event.toolName || 'unknown'

        // Format absolute paths to relative paths for better readability
        const formattedResult = event.result ? formatPathsToRelative(event.result) : ''

        // Update existing tool message (created on tool_start) instead of creating new one
        const existingToolMsg = managed.messages.find(m => m.toolUseId === event.toolUseId)
        // Track if already completed to avoid sending duplicate events
        const wasAlreadyComplete = existingToolMsg?.toolStatus === 'completed'

        sessionLog.info(`RESULT MATCH: toolUseId=${event.toolUseId}, found=${!!existingToolMsg}, toolName=${existingToolMsg?.toolName || toolName}, wasComplete=${wasAlreadyComplete}`)

        // parentToolUseId comes from CraftAgent (SDK-authoritative) or existing message
        const parentToolUseId = existingToolMsg?.parentToolUseId || event.parentToolUseId

        if (existingToolMsg) {
          existingToolMsg.content = formattedResult
          existingToolMsg.toolResult = formattedResult
          existingToolMsg.toolStatus = 'completed'
          existingToolMsg.isError = event.isError
          // If message doesn't have parent set, use event's parentToolUseId
          if (!existingToolMsg.parentToolUseId && event.parentToolUseId) {
            existingToolMsg.parentToolUseId = event.parentToolUseId
          }
        } else {
          // No matching tool_start found — create message from result.
          // This is normal for background subagent child tools where tool_result arrives
          // without a prior tool_start. If tool_start arrives later, findToolMessage will
          // locate this message by toolUseId and update it with input/intent/displayMeta.
          sessionLog.info(`RESULT WITHOUT START: toolUseId=${event.toolUseId}, toolName=${toolName} (creating message from result)`)
          const fallbackWorkspaceRootPath = managed.workspace.rootPath
          const fallbackSources = loadAllSources(fallbackWorkspaceRootPath)
          const fallbackToolDisplayMeta = resolveToolDisplayMeta(toolName, undefined, fallbackWorkspaceRootPath, fallbackSources)

          const toolMessage: Message = {
            id: generateMessageId(),
            role: 'tool',
            content: formattedResult,
            timestamp: Date.now(),
            toolName: toolName,
            toolUseId: event.toolUseId,
            toolResult: formattedResult,
            toolStatus: 'completed',
            toolDisplayMeta: fallbackToolDisplayMeta,
            parentToolUseId,
            isError: event.isError,
          }
          managed.messages.push(toolMessage)
        }

        // Send event to renderer if: (a) first completion, or (b) result content changed
        // (e.g., safety net auto-completed with empty result, then real result arrived later)
        const resultChanged = wasAlreadyComplete && formattedResult && existingToolMsg?.toolResult !== formattedResult
        if (!wasAlreadyComplete || resultChanged) {
          this.sendEvent({
            type: 'tool_result',
            sessionId,
            toolUseId: event.toolUseId,
            toolName: toolName,
            result: formattedResult,
            turnId: event.turnId,
            parentToolUseId,
            isError: event.isError,
          }, workspaceId)
        }

        // Safety net: when a parent Task completes, mark all its still-pending child tools as completed.
        // This handles the case where child tool_result events never arrive (e.g., subagent internal tools
        // whose results aren't surfaced through the parent stream).
        const PARENT_TOOLS_FOR_CLEANUP = ['Task', 'TaskOutput']
        if (PARENT_TOOLS_FOR_CLEANUP.includes(toolName)) {
          const pendingChildren = managed.messages.filter(
            m => m.parentToolUseId === event.toolUseId
              && m.toolStatus !== 'completed'
              && m.toolStatus !== 'error'
          )
          for (const child of pendingChildren) {
            child.toolStatus = 'completed'
            child.toolResult = child.toolResult || ''
            sessionLog.info(`CHILD AUTO-COMPLETED: toolUseId=${child.toolUseId}, toolName=${child.toolName} (parent ${toolName} completed)`)
            this.sendEvent({
              type: 'tool_result',
              sessionId,
              toolUseId: child.toolUseId!,
              toolName: child.toolName || 'unknown',
              result: child.toolResult || '',
              turnId: child.turnId,
              parentToolUseId: event.toolUseId,
            }, workspaceId)
          }
        }

        // Persist session after tool completes to prevent data loss on quit
        this.persistSession(managed)
        break
      }

      case 'status':
        this.sendEvent({
          type: 'status',
          sessionId,
          message: event.message,
          statusType: event.message.includes('Compacting') ? 'compacting' : undefined
        }, workspaceId)
        break

      case 'info': {
        const isCompactionComplete = event.message.startsWith('Compacted')

        // Persist compaction messages so they survive reload
        // Other info messages are transient (just sent to renderer)
        if (isCompactionComplete) {
          const compactionMessage: Message = {
            id: generateMessageId(),
            role: 'info',
            content: event.message,
            timestamp: Date.now(),
            statusType: 'compaction_complete',
          }
          managed.messages.push(compactionMessage)

          // Mark compaction complete in the session state.
          // This is done here (backend) rather than in the renderer so it's
          // not affected by CMD+R during compaction. The frontend reload
          // recovery will see awaitingCompaction=false and trigger execution.
          void markStoredCompactionComplete(managed.workspace.rootPath, sessionId)
          sessionLog.info(`Session ${sessionId}: compaction complete, marked pending plan ready`)

          // Emit usage_update so the context count badge refreshes immediately
          // after compaction, without waiting for the next message
          if (managed.tokenUsage) {
            this.sendEvent({
              type: 'usage_update',
              sessionId,
              tokenUsage: {
                inputTokens: managed.tokenUsage.inputTokens,
                contextWindow: managed.tokenUsage.contextWindow,
              },
            }, workspaceId)
          }
        }

        this.sendEvent({
          type: 'info',
          sessionId,
          message: event.message,
          statusType: isCompactionComplete ? 'compaction_complete' : undefined
        }, workspaceId)
        break
      }

      case 'error':
        // Skip abort errors - these are expected when force-aborting via Query.close()
        if (event.message.includes('aborted') || event.message.includes('AbortError')) {
          sessionLog.info('Skipping abort error event (expected during interrupt)')
          break
        }
        // AgentEvent uses `message` not `error`
        const errorMessage: Message = {
          id: generateMessageId(),
          role: 'error',
          content: event.message,
          timestamp: Date.now()
        }
        managed.messages.push(errorMessage)
        this.sendEvent({ type: 'error', sessionId, error: event.message }, workspaceId)
        break

      case 'typed_error':
        // Skip abort errors - these are expected when force-aborting via Query.close()
        const typedErrorMsg = event.error.message || event.error.title || ''
        if (typedErrorMsg.includes('aborted') || typedErrorMsg.includes('AbortError')) {
          sessionLog.info('Skipping typed abort error event (expected during interrupt)')
          break
        }
        // Typed errors have structured information - send both formats for compatibility
        sessionLog.info('typed_error:', JSON.stringify(event.error, null, 2))

        // Check for auth errors that can be retried by refreshing the token
        // The SDK subprocess caches the token at startup, so if it expires mid-session,
        // we get invalid_api_key errors. We can fix this by:
        // 1. Refreshing the token (reinitializeAuth)
        // 2. Destroying the agent (so it recreates with fresh token)
        // 3. Retrying the message
        const isAuthError = event.error.code === 'invalid_api_key' ||
          event.error.code === 'expired_oauth_token'

        if (isAuthError && !managed.authRetryAttempted && managed.lastSentMessage) {
          sessionLog.info(`Auth error detected, attempting token refresh and retry for session ${sessionId}`)
          managed.authRetryAttempted = true
          managed.authRetryInProgress = true

          // Trigger async retry (don't block the event processing)
          // We use setImmediate to let the current event loop finish
          setImmediate(async () => {
            try {
              // 1. Refresh auth (this will refresh the OAuth token if expired)
              sessionLog.info(`[auth-retry] Refreshing auth for session ${sessionId}`)
              await this.reinitializeAuth()

              // 2. Destroy the agent so it gets recreated with fresh token
              // The SDK subprocess has the old token cached in its env, so we must restart it
              sessionLog.info(`[auth-retry] Destroying agent for session ${sessionId}`)
              managed.agent = null

              // 3. Retry the message
              // Get the stored message/attachments before they're cleared
              const retryMessage = managed.lastSentMessage
              const retryAttachments = managed.lastSentAttachments
              const retryStoredAttachments = managed.lastSentStoredAttachments
              const retryOptions = managed.lastSentOptions

              if (retryMessage) {
                sessionLog.info(`[auth-retry] Retrying message for session ${sessionId}`)
                // Clear processing state so sendMessage can start fresh
                managed.isProcessing = false
                // Note: Don't clear lastSentMessage yet - sendMessage will set new ones

                // Remove the user message that was added for this failed attempt
                // so we don't get duplicate messages when retrying
                // Find and remove the last user message (the one we're retrying)
                const lastUserMsgIndex = managed.messages.findLastIndex(m => m.role === 'user')
                if (lastUserMsgIndex !== -1) {
                  managed.messages.splice(lastUserMsgIndex, 1)
                }

                // Clear authRetryInProgress before calling sendMessage
                // This allows the new request to be processed normally
                managed.authRetryInProgress = false

                await this.sendMessage(
                  sessionId,
                  retryMessage,
                  retryAttachments,
                  retryStoredAttachments,
                  retryOptions,
                  undefined,  // existingMessageId
                  true        // _isAuthRetry - prevents infinite retry loop
                )
                sessionLog.info(`[auth-retry] Retry completed for session ${sessionId}`)
              } else {
                managed.authRetryInProgress = false
              }
            } catch (retryError) {
              managed.authRetryInProgress = false
              sessionLog.error(`[auth-retry] Failed to retry after auth refresh for session ${sessionId}:`, retryError)
              // Report auth retry failures to Sentry — indicates credential/SDK issues
              Sentry.captureException(retryError, {
                tags: { errorSource: 'auth-retry', sessionId },
              })
              // Show the original error to the user since retry failed
              const failedMessage: Message = {
                id: generateMessageId(),
                role: 'error',
                content: 'Authentication failed. Please check your credentials.',
                timestamp: Date.now(),
                errorCode: event.error.code,
              }
              managed.messages.push(failedMessage)
              this.sendEvent({
                type: 'typed_error',
                sessionId,
                error: event.error
              }, workspaceId)
              this.onProcessingStopped(sessionId, 'error')
            }
          })

          // Don't add error message or send to renderer - we're handling it via retry
          break
        }

        // Build rich error message with all diagnostic fields for persistence and UI display
        const typedErrorMessage: Message = {
          id: generateMessageId(),
          role: 'error',
          // Combine title and message for content display (handles undefined gracefully)
          content: [event.error.title, event.error.message].filter(Boolean).join(': ') || 'An error occurred',
          timestamp: Date.now(),
          // Rich error fields for diagnostics and retry functionality
          errorCode: event.error.code,
          errorTitle: event.error.title,
          errorDetails: event.error.details,
          errorOriginal: event.error.originalError,
          errorCanRetry: event.error.canRetry,
        }
        managed.messages.push(typedErrorMessage)
        // Send typed_error event with full structure for renderer to handle
        this.sendEvent({
          type: 'typed_error',
          sessionId,
          error: {
            code: event.error.code,
            title: event.error.title,
            message: event.error.message,
            actions: event.error.actions,
            canRetry: event.error.canRetry,
            details: event.error.details,
            originalError: event.error.originalError,
          }
        }, workspaceId)
        break

      case 'task_backgrounded':
      case 'task_progress':
        // Forward background task events directly to renderer
        this.sendEvent({
          ...event,
          sessionId,
        }, workspaceId)
        break

      case 'shell_backgrounded':
        // Store the command for later process killing
        if (event.command && managed) {
          managed.backgroundShellCommands.set(event.shellId, event.command)
          sessionLog.info(`Stored command for shell ${event.shellId}: ${event.command.slice(0, 50)}...`)
        }
        // Forward to renderer
        this.sendEvent({
          ...event,
          sessionId,
        }, workspaceId)
        break

      case 'source_activated':
        // A source was auto-activated mid-turn, forward to renderer for auto-retry
        sessionLog.info(`Source "${event.sourceSlug}" activated, notifying renderer for auto-retry`)
        this.sendEvent({
          type: 'source_activated',
          sessionId,
          sourceSlug: event.sourceSlug,
          originalMessage: event.originalMessage,
        }, workspaceId)
        break

      case 'complete':
        // Complete event from CraftAgent - accumulate usage from this turn
        // Actual 'complete' sent to renderer comes from the finally block in sendMessage
        if (event.usage) {
          // Initialize tokenUsage if not set
          if (!managed.tokenUsage) {
            managed.tokenUsage = {
              inputTokens: 0,
              outputTokens: 0,
              totalTokens: 0,
              contextTokens: 0,
              costUsd: 0,
            }
          }
          // inputTokens = current context size (full conversation sent this turn), NOT accumulated
          // Each API call sends the full conversation history, so we use the latest value
          managed.tokenUsage.inputTokens = event.usage.inputTokens
          // outputTokens and costUsd are accumulated across all turns (total session usage)
          managed.tokenUsage.outputTokens += event.usage.outputTokens
          managed.tokenUsage.totalTokens = managed.tokenUsage.inputTokens + managed.tokenUsage.outputTokens
          managed.tokenUsage.costUsd += event.usage.costUsd ?? 0
          // Cache tokens reflect current state, not accumulated
          managed.tokenUsage.cacheReadTokens = event.usage.cacheReadTokens ?? 0
          managed.tokenUsage.cacheCreationTokens = event.usage.cacheCreationTokens ?? 0
          // Update context window (use latest value - may change if model switches)
          if (event.usage.contextWindow) {
            managed.tokenUsage.contextWindow = event.usage.contextWindow
          }
        }
        break

      case 'usage_update':
        // Real-time usage update for context display during processing
        // Update managed session's tokenUsage with latest context size
        if (event.usage) {
          if (!managed.tokenUsage) {
            managed.tokenUsage = {
              inputTokens: 0,
              outputTokens: 0,
              totalTokens: 0,
              contextTokens: 0,
              costUsd: 0,
            }
          }
          // Update only inputTokens (current context size) - other fields accumulate on complete
          managed.tokenUsage.inputTokens = event.usage.inputTokens
          if (event.usage.contextWindow) {
            managed.tokenUsage.contextWindow = event.usage.contextWindow
          }

          // Send to renderer for immediate UI update
          this.sendEvent({
            type: 'usage_update',
            sessionId: managed.id,
            tokenUsage: {
              inputTokens: event.usage.inputTokens,
              contextWindow: event.usage.contextWindow,
            },
          }, workspaceId)
        }
        break

      // Note: working_directory_changed is user-initiated only (via updateWorkingDirectory),
      // the agent no longer has a change_working_directory tool
    }
  }

  private sendEvent(event: SessionEvent, workspaceId?: string): void {
    if (!this.windowManager) {
      sessionLog.warn('Cannot send event - no window manager')
      return
    }

    // Broadcast to ALL windows for this workspace (main + tab content windows)
    const windows = workspaceId
      ? this.windowManager.getAllWindowsForWorkspace(workspaceId)
      : []

    if (windows.length === 0) {
      sessionLog.warn(`Cannot send ${event.type} event - no windows for workspace ${workspaceId}`)
      return
    }

    // Send event to all windows for this workspace
    for (const window of windows) {
      // Check mainFrame - it becomes null when render frame is disposed
      // This prevents Electron's internal error logging before our try-catch
      if (!window.isDestroyed() &&
          !window.webContents.isDestroyed() &&
          window.webContents.mainFrame) {
        try {
          window.webContents.send(IPC_CHANNELS.SESSION_EVENT, event)
        } catch {
          // Silently ignore - expected during window closure race conditions
        }
      }
    }
  }

  /**
   * Queue a text delta for batched sending (performance optimization)
   * Instead of sending 50+ IPC events per second, batches deltas and flushes every 50ms
   */
  private queueDelta(sessionId: string, workspaceId: string, delta: string, turnId?: string): void {
    const existing = this.pendingDeltas.get(sessionId)
    if (existing) {
      // Append to existing batch
      existing.delta += delta
      // Keep the latest turnId (should be the same, but just in case)
      if (turnId) existing.turnId = turnId
    } else {
      // Start new batch
      this.pendingDeltas.set(sessionId, { delta, turnId })
    }

    // Schedule flush if not already scheduled
    if (!this.deltaFlushTimers.has(sessionId)) {
      const timer = setTimeout(() => {
        this.flushDelta(sessionId, workspaceId)
      }, DELTA_BATCH_INTERVAL_MS)
      this.deltaFlushTimers.set(sessionId, timer)
    }
  }

  /**
   * Flush any pending deltas for a session (sends batched IPC event)
   * Called on timer or when streaming ends (text_complete)
   */
  private flushDelta(sessionId: string, workspaceId: string): void {
    // Clear the timer
    const timer = this.deltaFlushTimers.get(sessionId)
    if (timer) {
      clearTimeout(timer)
      this.deltaFlushTimers.delete(sessionId)
    }

    // Send batched delta if any
    const pending = this.pendingDeltas.get(sessionId)
    if (pending && pending.delta) {
      this.sendEvent({
        type: 'text_delta',
        sessionId,
        delta: pending.delta,
        turnId: pending.turnId
      }, workspaceId)
      this.pendingDeltas.delete(sessionId)
    }
  }

  /**
   * Clean up all resources held by the SessionManager.
   * Should be called on app shutdown to prevent resource leaks.
   */
  cleanup(): void {
    sessionLog.info('Cleaning up resources...')

    // Stop all ConfigWatchers (file system watchers)
    for (const [path, watcher] of this.configWatchers) {
      watcher.stop()
      sessionLog.info(`Stopped config watcher for ${path}`)
    }
    this.configWatchers.clear()

    // Clear all pending delta flush timers
    for (const [sessionId, timer] of this.deltaFlushTimers) {
      clearTimeout(timer)
    }
    this.deltaFlushTimers.clear()
    this.pendingDeltas.clear()

    // Clear pending credential resolvers (they won't be resolved, but prevents memory leak)
    this.pendingCredentialResolvers.clear()

    // Clean up session-scoped tool callbacks for all sessions
    for (const sessionId of this.sessions.keys()) {
      unregisterSessionScopedToolCallbacks(sessionId)
    }

    sessionLog.info('Cleanup complete')
  }
}
