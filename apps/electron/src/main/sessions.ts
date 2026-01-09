import { app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { rm, readFile } from 'fs/promises'
import { CraftAgent, type AgentEvent, setPermissionMode, type PermissionMode, unregisterSessionScopedToolCallbacks, AbortReason } from '@craft-agent/shared/agent'
import { sessionLog, isDebugMode, getLogFilePath } from './logger'
import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk'
import type { WindowManager } from './window-manager'
import {
  loadStoredConfig,
  getWorkspaces,
  getWorkspaceByNameOrId,
  getDefaultPermissionMode,
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
  flagSession as flagStoredSession,
  unflagSession as unflagStoredSession,
  setSessionTodoState as setStoredSessionTodoState,
  updateSessionMetadata,
  getSessionAttachmentsPath,
  getSessionPath as getSessionStoragePath,
  sessionPersistenceQueue,
  type StoredSession,
  type StoredMessage,
  type SessionMetadata,
  type TodoState,
} from '@craft-agent/shared/sessions'
import { loadWorkspaceSources, getSourcesBySlugs, type LoadedSource, type McpServerConfig, getSourcesNeedingAuth, getSourceCredentialManager, getSourceServerBuilder, type SourceWithCredential, isApiOAuthProvider } from '@craft-agent/shared/sources'
import { ConfigWatcher, type ConfigWatcherCallbacks } from '@craft-agent/shared/config'
import { getAuthState } from '@craft-agent/shared/auth'
import { setAnthropicOptionsEnv, setPathToClaudeCodeExecutable, setInterceptorPath, setExecutable } from '@craft-agent/shared/agent'
import { getCraftToken } from '@craft-agent/shared/auth'
import { getCredentialManager } from '@craft-agent/shared/credentials'
import { CraftMcpClient } from '@craft-agent/shared/mcp'
import { FolderAgentManager } from '@craft-agent/shared/agents'
import type { SubAgentDefinition, AgentStatus, AgentActivateOptions } from '@craft-agent/shared/agents'
import { AgentStateManager } from '@craft-agent/shared/agents'
import { type Session, type Message, type SessionEvent, type FileAttachment, type StoredAttachment, type SendMessageOptions, IPC_CHANNELS, generateMessageId } from '../shared/types'
import { generateSessionTitle, formatPathsToRelative, formatToolInputPaths, perf } from '@craft-agent/shared/utils'
import { DEFAULT_MODEL } from '@craft-agent/shared/config'

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
 */
async function buildServersFromSources(sources: LoadedSource[]) {
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
  const getTokenForSource = (source: LoadedSource) => {
    const provider = source.config.provider
    if (isApiOAuthProvider(provider)) {
      return async () => {
        const token = await credManager.getToken(source)
        if (!token) throw new Error(`No token for ${source.config.slug}`)
        return token
      }
    }
    return undefined
  }

  const result = await serverBuilder.buildAll(sourcesWithCreds, getTokenForSource)
  span.mark('servers.built')
  span.setMetadata('mcpCount', Object.keys(result.mcpServers).length)
  span.setMetadata('apiCount', Object.keys(result.apiServers).length)
  span.end()
  return result
}

interface ManagedSession {
  id: string
  workspace: Workspace
  agent: CraftAgent | null  // Lazy-loaded - null until first message
  messages: Message[]
  isProcessing: boolean
  lastMessageAt: number
  streamingText: string
  abortController?: AbortController
  // Track tool_use_id -> toolName mapping (since tool_result only has toolUseId)
  pendingTools: Map<string, string>
  // Stack of parent tool IDs for nested tool calls (e.g., Task spawning Read/Grep)
  // Using a stack handles concurrent parent tools correctly - each child tool
  // gets associated with the most recent parent that started before it
  parentToolStack: string[]
  // Map of toolUseId -> parentToolUseId for tracking which parent was active when each tool started
  // This is used to correctly attribute child tools even with concurrent parent tools
  toolToParentMap: Map<string, string>
  // Parent tool ID captured when text started streaming (first text_delta)
  // Used by text_complete to assign correct parent - prevents text from being nested
  // under tools that started after the text began (e.g., "I'll help..." before Task call)
  pendingTextParent?: string
  // Session name (user-defined or AI-generated)
  name?: string
  // Session metadata
  agentId?: string
  agentName?: string
  isFlagged: boolean
  /** Permission mode for this session ('safe', 'ask', 'allow-all') */
  permissionMode?: PermissionMode
  // SDK session ID for conversation continuity
  sdkSessionId?: string
  // Track whether agent was successfully activated via AgentStateManager
  agentActivated?: boolean
  // Token usage for display
  tokenUsage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    contextTokens: number
    costUsd: number
    cacheReadTokens?: number
    cacheCreationTokens?: number
  }
  // Todo state (user-controlled) - determines inbox vs done
  // Dynamic status ID referencing workspace status config
  todoState?: string
  // Read/unread tracking - ID of last message user has read
  lastReadMessageId?: string
  // Per-session source selection (slugs of enabled sources)
  enabledSourceSlugs?: string[]
  // Built source server configs (applied to CraftAgent)
  sourceMcpServers?: Record<string, McpServerConfig>
  // Built API servers (Gmail, etc.) - in-process MCP servers
  sourceApiServers?: Record<string, ReturnType<typeof createSdkMcpServer>>
  // Working directory for this session (used by agent for bash commands)
  workingDirectory?: string
  // Shared viewer URL (if shared via viewer)
  sharedUrl?: string
  // Shared session ID in viewer (for revoke)
  sharedId?: string
  // Sources that need credentials (detected at session creation)
  sourcesNeedingAuth?: LoadedSource[]
  // Whether auto-setup context has been triggered (prevents multiple triggers)
  autoSetupTriggered?: boolean
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
    parentToolUseId: msg.parentToolUseId,
    isError: msg.isError,
    attachments: msg.attachments,
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
    parentToolUseId: stored.parentToolUseId,
    isError: stored.isError,
    attachments: stored.attachments,
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
  // Workspace-scoped FolderAgentManager cache (reads agents from disk)
  private folderAgentManagers: Map<string, FolderAgentManager> = new Map()
  // Cache AgentStateManager per agent (agent-scoped: workspaceId:agentId)
  // This is the single source of truth for agent activation state
  private agentStateManagers: Map<string, AgentStateManager> = new Map()
  // Delta batching for performance - reduces IPC events from 50+/sec to ~20/sec
  private pendingDeltas: Map<string, PendingDelta> = new Map()
  private deltaFlushTimers: Map<string, NodeJS.Timeout> = new Map()
  // Config watchers for live updates (sources, agents, etc.) - one per workspace
  private configWatchers: Map<string, ConfigWatcher> = new Map()
  // Pending credential request resolvers (keyed by requestId)
  private pendingCredentialResolvers: Map<string, (response: import('../shared/types').CredentialResponse) => void> = new Map()

  setWindowManager(wm: WindowManager): void {
    this.windowManager = wm
  }

  /**
   * Set up ConfigWatcher for a workspace to broadcast live updates
   * (sources added/removed, guide.md changes, etc.)
   * Public so ipc.ts can call it when sources are first requested
   * Supports multiple workspaces simultaneously
   */
  setupConfigWatcher(workspaceRootPath: string): void {
    // Check if already watching this workspace
    if (this.configWatchers.has(workspaceRootPath)) {
      return // Already watching this workspace
    }

    sessionLog.info(`Setting up ConfigWatcher for workspace: ${workspaceRootPath}`)

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
      onAgentsListChange: () => {
        sessionLog.info(`Agents list changed in ${workspaceRootPath}`)
        this.broadcastAgentsChanged()
      },
      onAgentChange: () => {
        sessionLog.info(`Agent changed in ${workspaceRootPath}`)
        this.broadcastAgentsChanged()
      },
      onStatusConfigChange: (workspaceId: string) => {
        sessionLog.info(`Status config changed in ${workspaceId}`)
        this.broadcastStatusesChanged(workspaceId)
      },
      onStatusIconChange: (workspaceId: string, iconFilename: string) => {
        sessionLog.info(`Status icon changed: ${iconFilename} in ${workspaceId}`)
        this.broadcastStatusesChanged(workspaceId)
      },
      onAppThemeChange: (theme) => {
        sessionLog.info(`App theme changed`)
        this.broadcastAppThemeChanged(theme)
      },
      onWorkspaceThemeChange: (theme) => {
        sessionLog.info(`Workspace theme changed in ${workspaceRootPath}`)
        this.broadcastWorkspaceThemeChanged(theme)
      },
      onAgentThemeChange: (agentSlug, theme) => {
        sessionLog.info(`Agent theme changed: ${agentSlug}`)
        this.broadcastAgentThemeChanged(agentSlug, theme)
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
   * Broadcast agents changed event to all windows
   */
  private broadcastAgentsChanged(): void {
    if (!this.windowManager) return

    this.windowManager.broadcastToAll(IPC_CHANNELS.AGENTS_CHANGED)
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
   * Broadcast app theme changed event to all windows
   */
  private broadcastAppThemeChanged(theme: import('@craft-agent/shared/config').ThemeOverrides | null): void {
    if (!this.windowManager) return
    sessionLog.info(`Broadcasting app theme changed`)
    this.windowManager.broadcastToAll(IPC_CHANNELS.THEME_APP_CHANGED, theme)
  }

  /**
   * Broadcast workspace theme changed event to all windows
   */
  private broadcastWorkspaceThemeChanged(theme: import('@craft-agent/shared/config').ThemeOverrides | null): void {
    if (!this.windowManager) return
    sessionLog.info(`Broadcasting workspace theme changed`)
    this.windowManager.broadcastToAll(IPC_CHANNELS.THEME_WORKSPACE_CHANGED, theme)
  }

  /**
   * Broadcast agent theme changed event to all windows
   */
  private broadcastAgentThemeChanged(agentSlug: string, theme: import('@craft-agent/shared/config').ThemeOverrides | null): void {
    if (!this.windowManager) return
    sessionLog.info(`Broadcasting agent theme changed for ${agentSlug}`)
    this.windowManager.broadcastToAll(IPC_CHANNELS.THEME_AGENT_CHANGED, agentSlug, theme)
  }

  /**
   * Reload sources for a specific session.
   * Called by ConfigWatcher when source files change on disk.
   */
  private async reloadSessionSources(managed: ManagedSession): Promise<void> {
    if (!managed.agent) return

    const workspaceRootPath = managed.workspace.rootPath
    sessionLog.info(`Reloading sources for session ${managed.id}`)

    // Reload all sources from disk
    const allSources = loadWorkspaceSources(workspaceRootPath)
    managed.agent.setAllSources(allSources)

    // Rebuild MCP and API servers for session's enabled sources
    const enabledSlugs = managed.enabledSourceSlugs || []
    const enabledSources = allSources.filter(s =>
      enabledSlugs.includes(s.config.slug) && s.config.enabled && s.config.isAuthenticated
    )
    const { mcpServers, apiServers } = await buildServersFromSources(enabledSources)
    managed.sourceMcpServers = mcpServers
    managed.sourceApiServers = apiServers
    // Pass intended slugs so agent shows sources as active even if build failed
    const intendedSlugs = enabledSources.map(s => s.config.slug)
    managed.agent.setSourceServers(mcpServers, apiServers, intendedSlugs)

    sessionLog.info(`Sources reloaded for session ${managed.id}: ${Object.keys(mcpServers).length} MCP, ${Object.keys(apiServers).length} API`)
  }

  /**
   * Get the folder-based agent manager for a workspace
   * Agents are loaded from disk on demand
   */
  private getFolderAgentManager(workspaceRootPath: string): FolderAgentManager {
    let manager = this.folderAgentManagers.get(workspaceRootPath)
    if (!manager) {
      manager = new FolderAgentManager(workspaceRootPath)
      this.folderAgentManagers.set(workspaceRootPath, manager)
    }
    return manager
  }

  /**
   * Load agent definition for a given agent ID
   * Used when activating an agent for a session
   */
  private async loadAgentDefinition(agentId: string, workspace: Workspace): Promise<SubAgentDefinition | null> {
    try {
      const workspaceRootPath = workspace.rootPath
      const manager = this.getFolderAgentManager(workspaceRootPath)
      const definition = manager.getAgentDefinition(agentId)
      if (definition) {
        sessionLog.info(`Loaded agent definition: ${definition.name}`)
      }
      return definition
    } catch (error) {
      sessionLog.error(`Failed to load agent definition ${agentId}:`, error)
      return null
    }
  }

  /**
   * Get an AgentStateManager for an agent (agent-scoped)
   * Returns undefined if not yet created
   */
  getAgentStateManager(workspaceId: string, agentId: string): AgentStateManager | undefined {
    const key = `${workspaceId}:${agentId}`
    return this.agentStateManagers.get(key)
  }

  /**
   * Get or create an AgentStateManager for an agent (agent-scoped)
   * The manager is cached per (workspaceId, agentId) and is the single source of truth
   */
  async getOrCreateAgentStateManager(workspaceId: string, agentId: string): Promise<AgentStateManager | null> {
    const key = `${workspaceId}:${agentId}`

    // Check cache first
    if (this.agentStateManagers.has(key)) {
      return this.agentStateManagers.get(key)!
    }

    sessionLog.info(`Creating AgentStateManager for workspace="${workspaceId}", agent="${agentId}"`)

    // Get workspace to get the slug for folder-based agent manager
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      sessionLog.error(`Workspace not found: ${workspaceId}`)
      return null
    }
    const workspaceRootPath = workspace.rootPath
    const folderAgentManager = this.getFolderAgentManager(workspaceRootPath)

    // Create AgentStateManager with folder-based agent manager
    const stateManager = new AgentStateManager(workspaceId, folderAgentManager)

    // Subscribe to status changes and broadcast complete state to all windows
    // Uses broadcastAgentState() to include needsSetup/needsAuth/reason
    stateManager.on('status', async () => {
      await this.broadcastAgentState(workspaceId, agentId)
    })

    // Cache it
    this.agentStateManagers.set(key, stateManager)
    sessionLog.info(`Created AgentStateManager for agent ${agentId} in workspace ${workspaceId}`)

    return stateManager
  }

  /**
   * Broadcast complete agent state to all windows
   * Single source of truth - call this after ANY agent state change
   * Computes full state: status + needsSetup + needsAuth + reason
   */
  async broadcastAgentState(workspaceId: string, agentId: string): Promise<void> {
    if (!this.windowManager) return

    // Get current status from state manager
    const stateManager = this.getAgentStateManager(workspaceId, agentId)
    const status = stateManager?.getStatus() ?? { status: 'idle' as const }

    // Compute setup requirements
    const { agentService } = await import('./agent-service')
    const setupStatus = await agentService.getAgentSetupStatus(workspaceId, agentId)

    // Build complete state
    const completeState = {
      ...status,
      needsSetup: setupStatus.needsSetup,
      needsAuth: setupStatus.needsAuth,
      reason: setupStatus.reason,
    }

    // Broadcast to all windows
    this.windowManager.broadcastToAll(IPC_CHANNELS.AGENT_STATUS_CHANGED, workspaceId, agentId, completeState)
    sessionLog.info(`Broadcast agent state: ${status.status}, needsSetup=${setupStatus.needsSetup}, needsAuth=${setupStatus.needsAuth} for ${agentId}`)
  }


  /**
   * Get current agent status (agent-scoped)
   * For folder-based agents, they're ready immediately (no activation needed)
   */
  async getAgentStatus(workspaceId: string, agentId: string): Promise<AgentStatus> {
    const stateManager = this.getAgentStateManager(workspaceId, agentId)
    if (stateManager) {
      return stateManager.getStatus()
    }

    // Check if sources need authentication
    const { agentService } = await import('./agent-service')
    const setupStatus = await agentService.getAgentSetupStatus(workspaceId, agentId)

    // Return status with auth info (needsSetup is always false for folder agents)
    return {
      status: 'idle',
      needsSetup: false,
      needsAuth: setupStatus.needsAuth,
      reason: setupStatus.reason
    }
  }

  /**
   * Activate an agent (agent-scoped)
   */
  async activateAgent(
    workspaceId: string,
    agentId: string,
    options?: AgentActivateOptions
  ): Promise<AgentStatus> {
    sessionLog.info(`activateAgent called: workspaceId="${workspaceId}", agentId="${agentId}"`)

    const stateManager = await this.getOrCreateAgentStateManager(workspaceId, agentId)
    if (!stateManager) {
      sessionLog.error(`Failed to create state manager for workspace="${workspaceId}", agent="${agentId}"`)
      return { status: 'error', agentId, agentName: agentId || 'unknown', error: 'Could not create state manager' }
    }
    return stateManager.activate(agentId, options)
  }

  /**
   * Continue after MCP auth step (agent-scoped)
   */
  async continueAfterMcpAuth(workspaceId: string, agentId: string): Promise<AgentStatus> {
    const stateManager = this.getAgentStateManager(workspaceId, agentId)
    if (!stateManager) {
      return { status: 'idle' }
    }
    return stateManager.continueAfterMcpAuth()
  }

  /**
   * Continue after API auth step (agent-scoped)
   */
  async continueAfterApiAuth(workspaceId: string, agentId: string): Promise<AgentStatus> {
    const stateManager = this.getAgentStateManager(workspaceId, agentId)
    if (!stateManager) {
      return { status: 'idle' }
    }
    return stateManager.continueAfterApiAuth()
  }

  /**
   * Deactivate agent (agent-scoped)
   */
  deactivateAgent(workspaceId: string, agentId: string): void {
    const stateManager = this.getAgentStateManager(workspaceId, agentId)
    if (stateManager) {
      stateManager.deactivate()
    }
  }

  /**
   * Reload agent (agent-scoped)
   */
  async reloadAgent(workspaceId: string, agentId: string): Promise<AgentStatus> {
    const stateManager = this.getAgentStateManager(workspaceId, agentId)
    if (!stateManager) {
      return { status: 'idle' }
    }
    return stateManager.reload()
  }

  /**
   * Reset agent (clear definition and credentials) (agent-scoped)
   */
  async resetAgent(workspaceId: string, agentId: string): Promise<void> {
    const stateManager = this.getAgentStateManager(workspaceId, agentId)
    if (stateManager) {
      await stateManager.reset()
    }
  }

  /**
   * Mark agent as active (agent-scoped)
   */
  markAgentActive(workspaceId: string, agentId: string): void {
    const stateManager = this.getAgentStateManager(workspaceId, agentId)
    if (stateManager) {
      stateManager.markActive()
    }
  }

  /**
   * Reinitialize authentication environment variables
   * Call this after onboarding or settings changes to pick up new credentials
   */
  async reinitializeAuth(): Promise<void> {
    try {
      const authState = await getAuthState()
      const { billing } = authState

      sessionLog.info('Reinitializing auth with billing type:', billing.type)

      if (billing.type === 'craft_credits') {
        const token = await getCraftToken()
        setAnthropicOptionsEnv({
          USE_CRAFT_AI_GATEWAY: 'true',
          CRAFT_API_GATEWAY_TOKEN: token,
        })
        // Set placeholder API key so SDK starts
        process.env.ANTHROPIC_API_KEY = 'craft-credits-placeholder'
        sessionLog.info('Set Craft API Gateway Token')
      } else if (billing.type === 'oauth_token' && billing.claudeOAuthToken) {
        // Use Claude Max subscription via OAuth token
        process.env.CLAUDE_CODE_OAUTH_TOKEN = billing.claudeOAuthToken
        delete process.env.ANTHROPIC_API_KEY
        delete process.env.USE_CRAFT_AI_GATEWAY
        delete process.env.CRAFT_API_GATEWAY_TOKEN
        sessionLog.info('Set Claude Max OAuth Token')
      } else if (billing.apiKey) {
        // Use API key (pay-as-you-go)
        process.env.ANTHROPIC_API_KEY = billing.apiKey
        delete process.env.CLAUDE_CODE_OAUTH_TOKEN
        delete process.env.USE_CRAFT_AI_GATEWAY
        delete process.env.CRAFT_API_GATEWAY_TOKEN
        sessionLog.info('Set Anthropic API Key')
      } else {
        sessionLog.error('No authentication configured!')
      }
    } catch (error) {
      sessionLog.error('Failed to reinitialize auth:', error)
      throw error
    }
  }

  async initialize(): Promise<void> {
    // Set path to Claude Code executable (cli.js from SDK)
    // In packaged app: use app.getAppPath() (points to app.asar or app folder)
    // In development: use process.cwd()
    const basePath = app.isPackaged ? app.getAppPath() : process.cwd()

    const cliPath = join(basePath, 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'cli.js')
    if (!existsSync(cliPath)) {
      const error = `Claude Code SDK not found at ${cliPath}. The app package may be corrupted.`
      sessionLog.error(error)
      throw new Error(error)
    }
    sessionLog.info('Setting pathToClaudeCodeExecutable:', cliPath)
    setPathToClaudeCodeExecutable(cliPath)

    // Set path to cache-ttl-interceptor for SDK subprocess
    // This interceptor redirects requests to the Craft gateway when using Craft credits
    const interceptorPath = join(basePath, 'packages', 'shared', 'src', 'cache-ttl-interceptor.ts')
    if (!existsSync(interceptorPath)) {
      const error = `Cache TTL interceptor not found at ${interceptorPath}. The app package may be corrupted.`
      sessionLog.error(error)
      throw new Error(error)
    }
    sessionLog.info('Setting interceptorPath:', interceptorPath)
    setInterceptorPath(interceptorPath)

    // In packaged app: use bundled Bun binary
    // In development: use system 'bun' command
    if (app.isPackaged) {
      const bunPath = join(basePath, 'vendor', 'bun', 'bun')
      if (!existsSync(bunPath)) {
        const error = `Bundled Bun runtime not found at ${bunPath}. The app package may be corrupted.`
        sessionLog.error(error)
        throw new Error(error)
      }
      sessionLog.info('Setting executable:', bunPath)
      setExecutable(bunPath)
    }

    // Set up authentication environment variables (critical for SDK to work)
    await this.reinitializeAuth()

    // Load existing sessions from disk
    this.loadSessionsFromDisk()
  }

  // Load all existing sessions from disk into memory
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
          // Load full session data
          const storedSession = loadStoredSession(workspaceRootPath, meta.id)
          if (!storedSession) {
            sessionLog.warn(`Skipping session ${meta.id}: could not load from disk`)
            continue
          }

          // Convert stored messages to runtime messages
          const messages = (storedSession.messages || []).map(storedToMessage)

          // Create managed session (agent is lazy-loaded on first message)
          const managed: ManagedSession = {
            id: storedSession.id,
            workspace,
            agent: null,  // Lazy-load agent when needed
            messages,
            isProcessing: false,
            lastMessageAt: storedSession.lastUsedAt,
            streamingText: '',
            pendingTools: new Map(),
            parentToolStack: [],
            toolToParentMap: new Map(),
            pendingTextParent: undefined,
            name: storedSession.name,
            agentId: storedSession.agentSlug,
            agentName: storedSession.agentName,
            isFlagged: storedSession.isFlagged ?? false,
            permissionMode: storedSession.permissionMode,
            sdkSessionId: storedSession.sdkSessionId,
            tokenUsage: storedSession.tokenUsage,
            todoState: storedSession.todoState,
            lastReadMessageId: storedSession.lastReadMessageId,
            enabledSourceSlugs: storedSession.enabledSourceSlugs,
            workingDirectory: storedSession.workingDirectory ?? wsDefaultWorkingDir,
            messageQueue: [],
            backgroundShellCommands: new Map(),
          }

          this.sessions.set(storedSession.id, managed)
          totalSessions++
        }
      }

      sessionLog.info(`Loaded ${totalSessions} sessions from disk`)
    } catch (error) {
      sessionLog.error('Failed to load sessions from disk:', error)
    }
  }

  /**
   * Build setup context for sources that need authentication.
   * This is prepended to the first user message to prompt the agent to help with source setup.
   */
  private buildSetupContext(sources: LoadedSource[]): string {
    const sourceList = sources.map(s => {
      const authType = s.config.mcp?.authType || s.config.api?.authType || 'unknown'
      return `- ${s.config.name} (${s.config.type}, ${authType} auth)`
    }).join('\n')

    return `<setup_required>
The following sources need authentication before they can be used:
${sourceList}

Please help me set up authentication for these sources first, then proceed with my request.
Use oauth_trigger for OAuth sources, credential_prompt for API key/bearer token sources.
</setup_required>`
  }

  // Persist a session to disk (async with debouncing)
  private persistSession(managed: ManagedSession): void {
    try {
      // Filter out transient messages (error, status, system) that shouldn't be persisted
      const persistableMessages = managed.messages.filter(m =>
        m.role !== 'error' && m.role !== 'status' && m.role !== 'system'
      )

      const workspaceRootPath = managed.workspace.rootPath
      const storedSession: StoredSession = {
        id: managed.id,
        workspaceRootPath,
        name: managed.name,
        createdAt: managed.lastMessageAt,  // Approximate, will be overwritten if already exists
        lastUsedAt: Date.now(),
        sdkSessionId: managed.sdkSessionId,
        agentSlug: managed.agentId,  // agentId in ManagedSession is actually the slug
        agentName: managed.agentName,
        isFlagged: managed.isFlagged,
        permissionMode: managed.permissionMode,
        todoState: managed.todoState,
        enabledSourceSlugs: managed.enabledSourceSlugs,
        workingDirectory: managed.workingDirectory,
        messages: persistableMessages.map(messageToStored),
        tokenUsage: managed.tokenUsage ?? {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          contextTokens: 0,
          costUsd: 0,
        },
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

  getWorkspaces(): Workspace[] {
    return getWorkspaces()
  }

  getSessions(): Session[] {
    return Array.from(this.sessions.values())
      .map(m => ({
        id: m.id,
        workspaceId: m.workspace.id,
        workspaceName: m.workspace.name,
        name: m.name,
        lastMessageAt: m.lastMessageAt,
        messages: m.messages,
        isProcessing: m.isProcessing,
        agentId: m.agentId,
        agentName: m.agentName,
        isFlagged: m.isFlagged,
        permissionMode: m.permissionMode,
        todoState: m.todoState,
        lastReadMessageId: m.lastReadMessageId,
        workingDirectory: m.workingDirectory,
        enabledSourceSlugs: m.enabledSourceSlugs,
      }))
      .sort((a, b) => b.lastMessageAt - a.lastMessageAt)
  }

  /**
   * Get a single session by ID with all messages loaded.
   * Used for lazy loading session messages when session is selected.
   */
  getSession(sessionId: string): Session | null {
    const m = this.sessions.get(sessionId)
    if (!m) return null
    return {
      id: m.id,
      workspaceId: m.workspace.id,
      workspaceName: m.workspace.name,
      name: m.name,
      lastMessageAt: m.lastMessageAt,
      messages: m.messages,
      isProcessing: m.isProcessing,
      agentId: m.agentId,
      agentName: m.agentName,
      isFlagged: m.isFlagged,
      permissionMode: m.permissionMode,
      todoState: m.todoState,
      lastReadMessageId: m.lastReadMessageId,
      workingDirectory: m.workingDirectory,
      enabledSourceSlugs: m.enabledSourceSlugs,
    }
  }

  /**
   * Get the filesystem path to a session's folder
   */
  getSessionPath(sessionId: string): string | null {
    const managed = this.sessions.get(sessionId)
    if (!managed) return null
    return getSessionStoragePath(managed.workspace.rootPath, sessionId)
  }

  async createSession(workspaceId: string, agentId?: string, agentName?: string): Promise<Session> {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`)
    }

    // Get new session defaults from workspace config (with global fallback)
    const defaultPermissionMode = getDefaultPermissionMode()
    const workspaceRootPath = workspace.rootPath
    const wsConfig = loadWorkspaceConfig(workspaceRootPath)
    const defaultWorkingDir = wsConfig?.defaults?.workingDirectory || undefined

    // Check if agent's sources need authentication
    let sourcesNeedingAuth: LoadedSource[] = []
    if (agentId) {
      const folderAgentManager = this.getFolderAgentManager(workspaceRootPath)
      const loadedAgent = folderAgentManager.getAgentBySlug(agentId)
      if (loadedAgent) {
        sourcesNeedingAuth = getSourcesNeedingAuth(loadedAgent.sources)
        if (sourcesNeedingAuth.length > 0) {
          sessionLog.info(`Agent '${agentId}' has ${sourcesNeedingAuth.length} source(s) needing auth:`,
            sourcesNeedingAuth.map(s => s.config.slug).join(', '))
        }
      }
    }

    // Use storage layer to create and persist the session
    const storedSession = createStoredSession(workspaceRootPath, {
      agentSlug: agentId,
      agentName,
      permissionMode: defaultPermissionMode,
      workingDirectory: defaultWorkingDir,
    })

    const managed: ManagedSession = {
      id: storedSession.id,
      workspace,
      agent: null,  // Lazy-load agent on first message
      messages: [],
      isProcessing: false,
      lastMessageAt: storedSession.lastUsedAt,
      streamingText: '',
      pendingTools: new Map(),
      parentToolStack: [],
      toolToParentMap: new Map(),
      pendingTextParent: undefined,
      agentId,
      agentName,
      isFlagged: false,
      permissionMode: defaultPermissionMode,
      workingDirectory: defaultWorkingDir,
      // Auto-setup tracking
      sourcesNeedingAuth: sourcesNeedingAuth.length > 0 ? sourcesNeedingAuth : undefined,
      autoSetupTriggered: false,
      messageQueue: [],
      backgroundShellCommands: new Map(),
    }

    this.sessions.set(storedSession.id, managed)

    // Persist with agent info or if non-default permission mode is set
    if (agentId || agentName || defaultPermissionMode !== 'ask') {
      this.persistSession(managed)
    }

    return {
      id: storedSession.id,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      lastMessageAt: managed.lastMessageAt,
      messages: [],
      isProcessing: false,
      agentId,
      agentName,
      isFlagged: false,
      permissionMode: defaultPermissionMode,
      todoState: undefined,  // User-controlled, defaults to undefined (treated as 'todo')
      workingDirectory: defaultWorkingDir,
    }
  }

  /**
   * Get or create agent for a session (lazy loading)
   * NOTE: Agent definition is applied in sendMessage() via AgentStateManager
   */
  private async getOrCreateAgent(managed: ManagedSession): Promise<CraftAgent> {
    if (!managed.agent) {
      const end = perf.start('agent.create', { sessionId: managed.id })
      const config = loadStoredConfig()
      managed.agent = new CraftAgent({
        workspace: managed.workspace,
        model: config?.model,
        isHeadless: !AGENT_FLAGS.defaultModesEnabled,
        // Always pass session object - id is required for plan mode callbacks
        // sdkSessionId is optional and used for conversation resumption
        session: {
          id: managed.id,
          workspaceRootPath: managed.workspace.rootPath,
          sdkSessionId: managed.sdkSessionId,
          createdAt: managed.lastMessageAt,
          lastUsedAt: managed.lastMessageAt,
          workingDirectory: managed.workingDirectory,
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

      // Set up credential request handler to forward requests to renderer and await response
      managed.agent.onCredentialRequest = (request) => {
        sessionLog.info(`Credential request for session ${managed.id}:`, request.sourceSlug)
        return new Promise<import('../shared/types').CredentialResponse>((resolve) => {
          // Store the resolver to be called when renderer responds
          this.pendingCredentialResolvers.set(request.requestId, resolve)

          // Send event to renderer to show credential input UI
          this.sendEvent({
            type: 'credential_request',
            sessionId: managed.id,
            request: {
              ...request,
              sessionId: managed.id,
            }
          }, managed.workspace.id)
        })
      }

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
            managed.abortController = undefined

            // Clear parent tool tracking (stale entries would corrupt future tracking)
            managed.parentToolStack = []
            managed.toolToParentMap.clear()
            managed.pendingTextParent = undefined

            // Send complete event so renderer knows processing stopped
            this.sendEvent({ type: 'complete', sessionId: managed.id }, managed.workspace.id)

            // Persist session state
            this.persistSession(managed)
          }
        } catch (error) {
          sessionLog.error(`Failed to read plan file:`, error)
        }
      }

      // NOTE: Source and agent reloading is now handled by ConfigWatcher callbacks
      // which detect filesystem changes and update all affected sessions.
      // See setupConfigWatcher() for the full reload logic.

      // NOTE: Agent definition is now applied in sendMessage() via AgentStateManager.activate()
      // This ensures proper state machine flow: extraction → auth checks → activation

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
      const workspaceRootPath = managed.workspace.rootPath
      flagStoredSession(workspaceRootPath, sessionId)
      // Notify all windows for this workspace
      this.sendEvent({ type: 'session_flagged', sessionId }, managed.workspace.id)
    }
  }

  async unflagSession(sessionId: string): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (managed) {
      managed.isFlagged = false
      const workspaceRootPath = managed.workspace.rootPath
      unflagStoredSession(workspaceRootPath, sessionId)
      // Notify all windows for this workspace
      this.sendEvent({ type: 'session_unflagged', sessionId }, managed.workspace.id)
    }
  }

  async setTodoState(sessionId: string, todoState: TodoState): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (managed) {
      managed.todoState = todoState
      const workspaceRootPath = managed.workspace.rootPath
      setStoredSessionTodoState(workspaceRootPath, sessionId, todoState)
      // Notify all windows for this workspace
      this.sendEvent({ type: 'todo_state_changed', sessionId, todoState }, managed.workspace.id)
    }
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
        return { success: false, error: 'Failed to upload session' }
      }

      const data = await response.json() as { id: string; url: string }

      // Store shared info in session
      managed.sharedUrl = data.url
      managed.sharedId = data.id
      const workspaceRootPath = managed.workspace.rootPath
      updateSessionMetadata(workspaceRootPath, sessionId, {
        sharedUrl: data.url,
        sharedId: data.id,
      })

      sessionLog.info(`Session ${sessionId} shared at ${data.url}`)
      return { success: true, url: data.url }
    } catch (error) {
      sessionLog.error('Share error:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
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
      updateSessionMetadata(workspaceRootPath, sessionId, {
        sharedUrl: undefined,
        sharedId: undefined,
      })

      sessionLog.info(`Session ${sessionId} share revoked`)
      return { success: true }
    } catch (error) {
      sessionLog.error('Revoke error:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  // ============================================
  // Session Sources
  // ============================================

  /**
   * Update session's enabled sources
   * Builds MCP server configs from sources and applies to agent
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

    // Build server configs from selected sources
    const sources = getSourcesBySlugs(workspaceRootPath, sourceSlugs)
    const { mcpServers, apiServers, errors } = await buildServersFromSources(sources)

    if (errors.length > 0) {
      sessionLog.warn(`Source build errors:`, errors)
    }

    // Store the built configs
    managed.sourceMcpServers = mcpServers
    managed.sourceApiServers = apiServers

    // IMMEDIATELY update the agent's source servers if agent exists
    // This ensures tool availability is updated mid-conversation
    if (managed.agent) {
      // Set all sources for context (agent sees full list with descriptions)
      const allSources = loadWorkspaceSources(workspaceRootPath)
      managed.agent.setAllSources(allSources)
      // Set active source servers (tools are only available from these)
      // Pass intended slugs so agent shows sources as active even if build failed
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
   * Mark a session as read by setting lastReadMessageId to the last final assistant message
   * Called when user navigates to a session
   */
  markSessionRead(sessionId: string): void {
    const managed = this.sessions.get(sessionId)
    if (managed && managed.messages.length > 0) {
      const lastFinalId = this.getLastFinalAssistantMessageId(managed.messages)
      if (!lastFinalId) return  // No final assistant message yet

      // Only update if actually changed (avoid unnecessary persistence)
      if (managed.lastReadMessageId !== lastFinalId) {
        managed.lastReadMessageId = lastFinalId
        // Persist to disk
        const workspaceRootPath = managed.workspace.rootPath
        updateSessionMetadata(workspaceRootPath, sessionId, { lastReadMessageId: lastFinalId })
      }
    }
  }

  /**
   * Mark a session as unread by clearing the lastReadMessageId
   * Called when user manually marks a session as unread
   */
  markSessionUnread(sessionId: string): void {
    const managed = this.sessions.get(sessionId)
    if (managed) {
      managed.lastReadMessageId = undefined
      // Persist to disk (undefined will clear the field)
      const workspaceRootPath = managed.workspace.rootPath
      updateSessionMetadata(workspaceRootPath, sessionId, { lastReadMessageId: undefined })
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

    // If processing is in progress, abort and wait for cleanup
    if (managed.isProcessing && managed.abortController) {
      managed.abortController.abort()
      // Brief wait for abort to propagate and in-flight operations to settle
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

    this.sessions.delete(sessionId)

    // Note: We don't clean up AgentStateManager here because it's agent-scoped,
    // not session-scoped. It will be reused by other sessions with the same agent.

    // Delete from disk too
    deleteStoredSession(workspaceRootPath, sessionId)

    // Notify all windows for this workspace that the session was deleted
    this.sendEvent({ type: 'session_deleted', sessionId }, managed.workspace.id)

    // Clean up attachments directory (handled by deleteStoredSession for workspace-scoped storage)
    sessionLog.info(`Deleted session ${sessionId}`)
  }

  async sendMessage(sessionId: string, message: string, attachments?: FileAttachment[], storedAttachments?: StoredAttachment[], options?: SendMessageOptions, existingMessageId?: string): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (!managed) {
      throw new Error(`Session ${sessionId} not found`)
    }

    // If currently processing, queue the message and interrupt
    // The SDK will send a 'complete' event which triggers onProcessingStopped
    // onProcessingStopped will then process the queued message
    if (managed.isProcessing) {
      sessionLog.info(`Session ${sessionId} is processing, queueing message and interrupting`)

      // Create user message for queued state (so UI can show it)
      const queuedMessage: Message = {
        id: generateMessageId(),
        role: 'user',
        content: message,
        timestamp: Date.now(),
        attachments: storedAttachments,
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

      // Force-abort via SDK's AbortController - immediately stops processing
      // This sends SIGTERM to subprocess (5s timeout, then SIGKILL)
      // The for-await loop will throw AbortError, caught by our handler
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
      }
      managed.messages.push(userMessage)

      // Emit user_message event so UI can confirm the optimistic message
      this.sendEvent({
        type: 'user_message',
        sessionId,
        message: userMessage,
        status: 'accepted'
      }, managed.workspace.id)
    }

    managed.lastMessageAt = Date.now()
    managed.isProcessing = true
    managed.streamingText = ''
    managed.abortController = new AbortController()

    // Capture the abort controller reference to detect if a new request supersedes this one
    // This prevents the finally block from clobbering state when a follow-up message arrives
    const myAbortController = managed.abortController

    // Start perf span for entire sendMessage flow
    const sendSpan = perf.span('session.sendMessage', { sessionId, hasAgent: !!managed.agentId })

    // Get or create the agent (lazy loading)
    const agent = await this.getOrCreateAgent(managed)
    sendSpan.mark('agent.ready')

    // If session has an agent that hasn't been activated yet, activate via AgentStateManager
    // This is the source of truth for agent state - ensures proper extraction, auth handling, etc.
    if (managed.agentId && !managed.agentActivated) {
      sessionLog.info(`Activating agent ${managed.agentId} for session ${sessionId}`)

      // Emit extracting status so UI knows we're loading
      this.sendEvent({
        type: 'agent_status',
        sessionId,
        status: { status: 'extracting', agentId: managed.agentId, agentName: managed.agentName || managed.agentId, message: 'Loading agent...' }
      }, managed.workspace.id)

      // Get or create agent-scoped state manager
      const stateManager = await this.getOrCreateAgentStateManager(managed.workspace.id, managed.agentId)
      if (stateManager) {
        // Check current status - may already be activated from setup wizard
        let status = stateManager.getStatus()

        // Only activate if not already activated (could be ready/active from setup wizard)
        if (status.status === 'idle') {
          // Activate via state machine (handles registry population, extraction, auth checks)
          status = await stateManager.activate(managed.agentId)
        }
        sessionLog.info(`Agent activation result: ${status.status}`)

        // Emit final status
        this.sendEvent({ type: 'agent_status', sessionId, status }, managed.workspace.id)

        if (status.status === 'error') {
          // Activation failed - emit error and abort message sending
          this.sendEvent({ type: 'error', sessionId, error: `Agent activation failed: ${status.error}` }, managed.workspace.id)
          managed.isProcessing = false
          managed.abortController = undefined
          this.sendEvent({ type: 'complete', sessionId }, managed.workspace.id)
          return
        }

        // If needs auth, abort and let UI handle it
        if (status.status === 'needs_mcp_auth' || status.status === 'needs_api_auth') {
          const authType = status.status === 'needs_mcp_auth' ? 'MCP server' : 'API'
          this.sendEvent({ type: 'error', sessionId, error: `Agent requires ${authType} authentication. Please configure credentials first.` }, managed.workspace.id)
          managed.isProcessing = false
          managed.abortController = undefined
          this.sendEvent({ type: 'complete', sessionId }, managed.workspace.id)
          return
        }

        // Agent activated successfully - apply definition to CraftAgent
        if (status.status === 'active' || status.status === 'ready') {
          const definition = status.definition
          if (definition) {
            try {
              const mcpServers = await stateManager.buildMcpServerConfig()
              const apiServers = await stateManager.buildApiServers()
              // Pass sources needing auth to inject setup instructions into the agent
              agent.setActiveAgentDefinition(definition, mcpServers, apiServers, managed.sourcesNeedingAuth)
              managed.agentActivated = true
              sessionLog.info(`Applied agent definition "${definition.name}" to session ${sessionId}`)
            } catch (error) {
              sessionLog.error(`Failed to build agent configs for ${managed.agentId}:`, error)
              this.sendEvent({ type: 'error', sessionId, error: `Failed to configure agent: ${error instanceof Error ? error.message : String(error)}` }, managed.workspace.id)
            }
          }
        }
      } else {
        sessionLog.warn(`Could not create AgentStateManager for session ${sessionId}`)
      }
      sendSpan.mark('agent.activated')
    }

    // Always set all sources for context (even if none are enabled)
    const workspaceRootPath = managed.workspace.rootPath
    const allSources = loadWorkspaceSources(workspaceRootPath)
    agent.setAllSources(allSources)
    sendSpan.mark('sources.loaded')

    // Apply source servers if any are enabled
    if (managed.enabledSourceSlugs?.length) {
      // Build server configs if not already built
      const sources = getSourcesBySlugs(workspaceRootPath, managed.enabledSourceSlugs)
      if (!managed.sourceMcpServers) {
        const { mcpServers, apiServers, errors } = await buildServersFromSources(sources)
        if (errors.length > 0) {
          sessionLog.warn(`Source build errors:`, errors)
        }
        managed.sourceMcpServers = mcpServers
        managed.sourceApiServers = apiServers
      }

      // Apply source servers to the agent
      const mcpCount = Object.keys(managed.sourceMcpServers || {}).length
      const apiCount = Object.keys(managed.sourceApiServers || {}).length
      if (mcpCount > 0 || apiCount > 0 || managed.enabledSourceSlugs.length > 0) {
        // Pass intended slugs so agent shows sources as active even if build failed
        const intendedSlugs = sources.filter(s => s.config.enabled && s.config.isAuthenticated).map(s => s.config.slug)
        agent.setSourceServers(managed.sourceMcpServers || {}, managed.sourceApiServers || {}, intendedSlugs)
        sessionLog.info(`Applied ${mcpCount} MCP + ${apiCount} API sources to session ${sessionId} (${allSources.length} total)`)
      }
      sendSpan.mark('servers.applied')
    }

    // Auto-setup: prepend setup context on first message if sources need auth
    if (!managed.autoSetupTriggered && managed.sourcesNeedingAuth?.length) {
      managed.autoSetupTriggered = true
      const setupContext = this.buildSetupContext(managed.sourcesNeedingAuth)
      message = setupContext + '\n\n' + message
      sessionLog.info(`Prepended setup context for ${managed.sourcesNeedingAuth.length} source(s) needing auth`)
    }

    try {
      sessionLog.info('Starting chat for session:', sessionId)
      sessionLog.info('Workspace:', JSON.stringify(managed.workspace, null, 2))
      sessionLog.info('Message:', message)
      sessionLog.info('Agent model:', agent.getModel())
      sessionLog.info('process.cwd():', process.cwd())

      // Set ultrathink mode if enabled (single-shot - resets after query)
      if (options?.ultrathinkEnabled) {
        sessionLog.info('Ultrathink mode ENABLED')
        agent.setUltrathinkMode(true)
      }

      // Process the message through the agent
      sessionLog.info('Calling agent.chat()...')
      if (attachments?.length) {
        sessionLog.info('Attachments:', attachments.length)
      }
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

        // Capture SDK session ID after first event (for conversation continuity)
        if (!managed.sdkSessionId) {
          const sdkId = agent.getSessionId()
          if (sdkId) {
            managed.sdkSessionId = sdkId
            sessionLog.info(`Captured SDK session ID: ${sdkId}`)
          }
        }

        // Handle complete event - SDK always sends this (even after interrupt)
        // This is the central place where processing ends
        if (event.type === 'complete') {
          sessionLog.info('Chat completed via complete event')
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
        // Extract abort reason (passed to AbortController.abort())
        const reason = (error as DOMException).cause as AbortReason | undefined

        sessionLog.info(`Chat aborted (reason: ${reason || 'unknown'})`)
        sendSpan.mark('chat.aborted')
        sendSpan.setMetadata('abort_reason', reason || 'unknown')
        sendSpan.end()

        // Only show "Interrupted" for user-initiated stops
        // Plan submissions and redirects handle their own cleanup
        if (reason === AbortReason.UserStop || reason === undefined) {
          this.onProcessingStopped(sessionId, 'interrupted')
        }
      } else {
        sessionLog.error('Error in chat:', error)
        sessionLog.error('Error message:', error instanceof Error ? error.message : String(error))
        sessionLog.error('Error stack:', error instanceof Error ? error.stack : 'No stack')
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
      if (managed.isProcessing && managed.abortController === myAbortController) {
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

    // Force-abort via AbortController - immediately stops processing
    if (managed.agent) {
      managed.agent.forceAbort(AbortReason.UserStop)
    }

    // Set state immediately - the SDK will send a complete event
    // but since we cleared isProcessing, onProcessingStopped won't be called again
    managed.isProcessing = false
    managed.abortController = undefined

    // Clear parent tool tracking (stale entries would corrupt future parent-child tracking)
    managed.parentToolStack = []
    managed.toolToParentMap.clear()
    managed.pendingTextParent = undefined

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

    // Emit complete since we're stopping and queue is cleared
    this.sendEvent({ type: 'complete', sessionId }, managed.workspace.id)

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
  private onProcessingStopped(
    sessionId: string,
    reason: 'complete' | 'interrupted' | 'error'
  ): void {
    const managed = this.sessions.get(sessionId)
    if (!managed) return

    sessionLog.info(`Processing stopped for session ${sessionId}: ${reason}`)

    // 1. Cleanup state
    managed.isProcessing = false
    managed.abortController = undefined
    managed.parentToolStack = []
    managed.toolToParentMap.clear()
    managed.pendingTextParent = undefined

    // 2. Check queue and process or complete
    if (managed.messageQueue.length > 0) {
      // Has queued messages - process next
      this.processNextQueuedMessage(sessionId)
    } else {
      // No queue - emit complete to UI
      this.sendEvent({ type: 'complete', sessionId }, managed.workspace.id)
    }

    // 3. Always persist
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
   */
  respondToCredential(sessionId: string, requestId: string, response: import('../shared/types').CredentialResponse): boolean {
    const resolver = this.pendingCredentialResolvers.get(requestId)
    if (resolver) {
      sessionLog.info(`Credential response for ${requestId}: cancelled=${response.cancelled}`)
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
   * Generate an AI title for a session based on the first exchange
   * Called asynchronously after the first assistant response
   */
  private async generateTitle(managed: ManagedSession, userMessage: string, assistantResponse: string): Promise<void> {
    try {
      const title = await generateSessionTitle(userMessage, assistantResponse)
      if (title) {
        managed.name = title
        this.persistSession(managed)
        // Notify renderer of the generated title
        this.sendEvent({ type: 'title_generated', sessionId: managed.id, title }, managed.workspace.id)
        sessionLog.info(`Generated title for session ${managed.id}: "${title}"`)
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
        // Capture parent on FIRST delta of a text block (when streamingText is empty)
        // This ensures text gets the parent that existed when it started, not when it completed
        if (managed.streamingText === '') {
          managed.pendingTextParent = managed.parentToolStack.length > 0
            ? managed.parentToolStack[managed.parentToolStack.length - 1]
            : undefined
        }
        managed.streamingText += event.text
        // Queue delta for batched sending (performance: reduces IPC from 50+/sec to ~20/sec)
        this.queueDelta(sessionId, workspaceId, event.text, event.turnId)
        break

      case 'text_complete': {
        // Flush any pending deltas before sending complete (ensures renderer has all content)
        this.flushDelta(sessionId, workspaceId)

        // Check if this is the first assistant message and no name exists yet
        const existingAssistantCount = managed.messages.filter(m => m.role === 'assistant').length
        const shouldGenerateTitle = existingAssistantCount === 0 && !managed.name

        // Use the parent that was active when text STARTED streaming (captured in text_delta)
        // This prevents text from being nested under tools that started after the text began
        const textParentToolUseId = event.isIntermediate ? managed.pendingTextParent : undefined

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
        managed.pendingTextParent = undefined // Clear for next text block
        this.sendEvent({ type: 'text_complete', sessionId, text: event.text, isIntermediate: event.isIntermediate, turnId: event.turnId, parentToolUseId: textParentToolUseId }, workspaceId)

        // Generate title asynchronously after first assistant response
        if (shouldGenerateTitle) {
          const firstUserMsg = managed.messages.find(m => m.role === 'user')
          if (firstUserMsg) {
            this.generateTitle(managed, firstUserMsg.content, event.text)
          }
        }

        // Persist session after complete message to prevent data loss on quit
        this.persistSession(managed)
        break
      }

      case 'tool_start': {
        // Track tool_use_id -> toolName mapping for later use in tool_result
        managed.pendingTools.set(event.toolUseId, event.toolName)

        // Format tool input paths to relative for better readability
        const formattedToolInput = formatToolInputPaths(event.input)

        // Check if a message with this toolUseId already exists FIRST
        // SDK sends two events per tool: first from stream_event (empty input),
        // second from assistant message (complete input)
        const existingStartMsg = managed.messages.find(m => m.toolUseId === event.toolUseId)
        const isDuplicateEvent = !!existingStartMsg

        // Track parent-child relationships for nested tool calls
        // Parent tools spawn child tools (e.g., Task runs Read, Grep, etc.)
        // Include Task (subagents) and TaskOutput (retrieves task results)
        const PARENT_TOOLS = ['Task', 'TaskOutput']
        const isParentTool = PARENT_TOOLS.includes(event.toolName)

        // Use parentToolUseId from the event - CraftAgent computes this correctly
        // using the SDK's parent_tool_use_id (authoritative for parallel Tasks)
        // Only fall back to stack heuristic if event doesn't provide parent
        let parentToolUseId: string | undefined
        if (isParentTool) {
          // Parent tools don't have a parent themselves
          parentToolUseId = undefined
        } else if (event.parentToolUseId) {
          // CraftAgent provided the correct parent from SDK - use it
          parentToolUseId = event.parentToolUseId
        } else if (managed.parentToolStack.length > 0) {
          // Fallback: use stack heuristic for edge cases
          parentToolUseId = managed.parentToolStack[managed.parentToolStack.length - 1]
        }

        // If this is a parent tool, push it onto the stack
        // IMPORTANT: Only push on first event, not duplicate events (SDK sends two tool_start per tool)
        if (isParentTool && !isDuplicateEvent) {
          managed.parentToolStack.push(event.toolUseId)
          sessionLog.info(`PARENT STACK PUSH: ${event.toolName} (${event.toolUseId}), stack=${JSON.stringify(managed.parentToolStack)}`)
        }

        // Store the parent assignment for this tool (only on first event)
        // This allows us to look up the correct parent later even with concurrent parent tools
        if (!isDuplicateEvent && parentToolUseId) {
          managed.toolToParentMap.set(event.toolUseId, parentToolUseId)
        }

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
            toolStatus: 'pending',
            toolIntent: event.intent,
            toolDisplayName: event.displayName,
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
            turnId: event.turnId,
            parentToolUseId,
          }, workspaceId)
        }
        break
      }

      case 'tool_result': {
        // AgentEvent tool_result only has toolUseId, look up the toolName
        const toolName = managed.pendingTools.get(event.toolUseId) || 'unknown'
        managed.pendingTools.delete(event.toolUseId)

        // Parent tool names for defensive cleanup
        const PARENT_TOOLS = ['Task', 'TaskOutput']

        // Remove this tool from parent stack if it's there (parent tool completing)
        const stackIndex = managed.parentToolStack.indexOf(event.toolUseId)
        if (stackIndex !== -1) {
          managed.parentToolStack.splice(stackIndex, 1)
          sessionLog.info(`PARENT STACK POP: ${event.toolUseId}, stack=${JSON.stringify(managed.parentToolStack)}`)
        } else if (PARENT_TOOLS.includes(toolName)) {
          // Only log/warn for parent tools that SHOULD have been on the stack
          // Non-parent tools (Read, Grep, Bash, etc.) are never on the stack - that's expected
          sessionLog.warn(`PARENT STACK UNEXPECTED: ${toolName} (${event.toolUseId}) not found, stack=${JSON.stringify(managed.parentToolStack)}`)
          // Defensive cleanup: try to find and remove by matching tool name in messages
          const fallbackIdx = managed.parentToolStack.findIndex(id => {
            const msg = managed.messages.find(m => m.toolUseId === id)
            return msg?.toolName === toolName
          })
          if (fallbackIdx !== -1) {
            const removedId = managed.parentToolStack.splice(fallbackIdx, 1)[0]
            sessionLog.info(`PARENT STACK FALLBACK POP: ${removedId} (matched by toolName=${toolName}), stack=${JSON.stringify(managed.parentToolStack)}`)
          }
        }
        // Non-parent tools: silent (expected behavior - they use toolToParentMap for hierarchy)

        // Get the stored parent mapping before cleaning up (for fallback)
        const storedParentId = managed.toolToParentMap.get(event.toolUseId)

        // Clean up the tool-to-parent mapping for this tool
        managed.toolToParentMap.delete(event.toolUseId)

        // Format absolute paths to relative paths for better readability
        const formattedResult = event.result ? formatPathsToRelative(event.result) : ''

        // Update existing tool message (created on tool_start) instead of creating new one
        const existingToolMsg = managed.messages.find(m => m.toolUseId === event.toolUseId)
        // Track if already completed to avoid sending duplicate events
        const wasAlreadyComplete = existingToolMsg?.toolStatus === 'completed'

        sessionLog.info(`RESULT MATCH: toolUseId=${event.toolUseId}, found=${!!existingToolMsg}, toolName=${existingToolMsg?.toolName || toolName}, wasComplete=${wasAlreadyComplete}`)

        if (existingToolMsg) {
          existingToolMsg.content = formattedResult
          existingToolMsg.toolResult = formattedResult
          existingToolMsg.toolStatus = 'completed'
          existingToolMsg.isError = event.isError
          // If message doesn't have parent set, use stored mapping as fallback
          // Note: SDK's event.parentToolUseId is for result matching, NOT hierarchy
          if (!existingToolMsg.parentToolUseId && storedParentId) {
            existingToolMsg.parentToolUseId = storedParentId
          }
        } else {
          // Fallback: create new message if not found (shouldn't happen normally)
          const toolMessage: Message = {
            id: generateMessageId(),
            role: 'tool',
            content: formattedResult,
            timestamp: Date.now(),
            toolName: toolName,
            toolUseId: event.toolUseId,
            toolResult: formattedResult,
            toolStatus: 'completed',
            parentToolUseId: storedParentId,
            isError: event.isError,
          }
          managed.messages.push(toolMessage)
        }

        // Use stored parent mapping or existing message's parent
        const finalParentToolUseId = existingToolMsg?.parentToolUseId || storedParentId

        // Only send event to renderer if not already marked complete
        if (!wasAlreadyComplete) {
          this.sendEvent({
            type: 'tool_result',
            sessionId,
            toolUseId: event.toolUseId,
            toolName: toolName,
            result: formattedResult,
            turnId: event.turnId,
            parentToolUseId: finalParentToolUseId,
            isError: event.isError,
          }, workspaceId)
        }

        // Persist session after tool completes to prevent data loss on quit
        this.persistSession(managed)
        break
      }

      case 'parent_update': {
        // Deferred parent assignment: tool started without parent (multiple active Tasks),
        // now we know the correct parent from the tool result
        const existingToolMsg = managed.messages.find(m => m.toolUseId === event.toolUseId)
        if (existingToolMsg) {
          sessionLog.info(`PARENT UPDATE: ${event.toolUseId} -> parent ${event.parentToolUseId}`)
          existingToolMsg.parentToolUseId = event.parentToolUseId
          // Also update the toolToParentMap for consistency
          managed.toolToParentMap.set(event.toolUseId, event.parentToolUseId)
        }
        // Send event to renderer so it can update UI grouping
        this.sendEvent({
          type: 'parent_update',
          sessionId,
          toolUseId: event.toolUseId,
          parentToolUseId: event.parentToolUseId,
        }, workspaceId)
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

      case 'info':
        this.sendEvent({
          type: 'info',
          sessionId,
          message: event.message,
          statusType: event.message.startsWith('Compacted') ? 'compaction_complete' : undefined
        }, workspaceId)
        break

      case 'error':
        // Skip abort errors - these are expected when force-aborting via AbortController
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
        // Skip abort errors - these are expected when force-aborting via AbortController
        const typedErrorMsg = event.error.message || event.error.title || ''
        if (typedErrorMsg.includes('aborted') || typedErrorMsg.includes('AbortError')) {
          sessionLog.info('Skipping typed abort error event (expected during interrupt)')
          break
        }
        // Typed errors have structured information - send both formats for compatibility
        sessionLog.info('typed_error:', JSON.stringify(event.error, null, 2))
        const typedErrorMessage: Message = {
          id: generateMessageId(),
          role: 'error',
          content: event.error.message || event.error.title || 'An error occurred',
          timestamp: Date.now()
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

      case 'complete':
        // Complete event from CraftAgent - actual 'complete' sent to renderer
        // comes from the finally block in sendMessage, not here
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
      if (!window.isDestroyed()) {
        try {
          window.webContents.send(IPC_CHANNELS.SESSION_EVENT, event)
        } catch (error) {
          sessionLog.error(`Failed to send ${event.type} event to window:`, error)
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
