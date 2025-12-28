import { app } from 'electron'
import { join } from 'path'
import { rm, readFile } from 'fs/promises'
import { CraftAgent, type AgentEvent, enterMode, exitMode, type Mode, isModeActive } from '@craft-agent/shared/agent'
import type { WindowManager } from './window-manager'
import {
  loadStoredConfig,
  getWorkspaces,
  getWorkspaceByNameOrId,
  getWorkspaceSlug,
  getDefaultModes,
  getDefaultSkipPermissions,
  getDefaultWorkingDirectory,
  type Workspace,
} from '@craft-agent/shared/config'
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
  type StoredSession,
  type StoredMessage,
  type SessionMetadata,
  type TodoState,
} from '@craft-agent/shared/sessions'
import { loadWorkspaceSources, getSourcesBySlugs, type LoadedSource, createSourceService, type McpServerConfig } from '@craft-agent/shared/sources'
import { ConfigWatcher, type ConfigWatcherCallbacks } from '@craft-agent/shared/config'
import { getAuthState } from '@craft-agent/shared/auth'
import { setAnthropicOptionsEnv, setPathToClaudeCodeExecutable, setInterceptorPath } from '@craft-agent/shared/agent'
import { getCraftToken } from '@craft-agent/shared/auth'
import { CraftMcpClient } from '@craft-agent/shared/mcp'
import { FolderAgentManager } from '@craft-agent/shared/agents'
import type { SubAgentDefinition, AgentStatus, AgentActivateOptions } from '@craft-agent/shared/agents'
import { AgentStateManager } from '@craft-agent/shared/agents'
import { type Session, type Message, type SessionEvent, type FileAttachment, type StoredAttachment, type SendMessageOptions, IPC_CHANNELS, generateMessageId } from '../shared/types'
import { generateSessionTitle, formatPathsToRelative, formatToolInputPaths } from '@craft-agent/shared/utils'
import { DEFAULT_MODEL } from '@craft-agent/shared/config'

/**
 * Feature flags for agent behavior
 */
export const AGENT_FLAGS = {
  /** Default modes enabled for new sessions */
  defaultModesEnabled: true,
} as const

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
  // Advanced options (persisted per session)
  skipPermissions: boolean
  /** Active operational modes for this session */
  activeModes: Mode[]
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
  todoState?: 'todo' | 'in-progress' | 'needs-review' | 'done' | 'cancelled'
  // Read/unread tracking - ID of last message user has read
  lastReadMessageId?: string
  // Per-session source selection (slugs of enabled sources)
  enabledSourceSlugs?: string[]
  // Built source server configs (applied to CraftAgent)
  sourceMcpServers?: Record<string, McpServerConfig>
  // Working directory for this session (used by agent for bash commands)
  workingDirectory?: string
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
  // Config watcher for live updates (sources, agents, etc.)
  private configWatcher: ConfigWatcher | null = null
  private currentWatchedWorkspaceSlug: string | null = null
  // Pending credential request resolvers (keyed by requestId)
  private pendingCredentialResolvers: Map<string, (response: import('../shared/types').CredentialResponse) => void> = new Map()

  setWindowManager(wm: WindowManager): void {
    this.windowManager = wm
  }

  /**
   * Set up ConfigWatcher for a workspace to broadcast live updates
   * (sources added/removed, guide.md changes, etc.)
   * Public so ipc.ts can call it when sources are first requested
   */
  setupConfigWatcher(workspaceSlug: string): void {
    // Clean up existing watcher if switching workspaces
    if (this.configWatcher && this.currentWatchedWorkspaceSlug !== workspaceSlug) {
      this.configWatcher.stop()
      this.configWatcher = null
    }

    if (this.configWatcher) {
      return // Already watching this workspace
    }

    console.log(`[SessionManager] Setting up ConfigWatcher for workspace: ${workspaceSlug}`)

    const callbacks: ConfigWatcherCallbacks = {
      onSourcesListChange: (sources: LoadedSource[]) => {
        console.log(`[SessionManager] Sources changed, broadcasting update (${sources.length} sources)`)
        this.broadcastSourcesChanged(sources)
      },
      onSourceChange: (slug: string, source: LoadedSource | null) => {
        console.log(`[SessionManager] Source updated: ${slug}`, source ? source.config.name : '(deleted)')
        // Broadcast updated list when individual source changes
        const sources = loadWorkspaceSources(workspaceSlug)
        this.broadcastSourcesChanged(sources)
      },
      onSourceGuideChange: (sourceSlug: string) => {
        console.log(`[SessionManager] Source guide changed: ${sourceSlug}`)
        // Broadcast the updated sources list so sidebar picks up guide changes
        const sources = loadWorkspaceSources(workspaceSlug)
        this.broadcastSourcesChanged(sources)
      },
    }

    this.configWatcher = new ConfigWatcher(workspaceSlug, callbacks)
    this.configWatcher.start()
    this.currentWatchedWorkspaceSlug = workspaceSlug
  }

  /**
   * Broadcast sources changed event to all windows
   */
  private broadcastSourcesChanged(sources: LoadedSource[]): void {
    if (!this.windowManager) return

    this.windowManager.broadcastToAll(IPC_CHANNELS.SOURCES_CHANGED, sources)
  }

  /**
   * Get the folder-based agent manager for a workspace
   * Agents are loaded from disk on demand
   */
  private getFolderAgentManager(workspaceSlug: string): FolderAgentManager {
    let manager = this.folderAgentManagers.get(workspaceSlug)
    if (!manager) {
      manager = new FolderAgentManager(workspaceSlug)
      this.folderAgentManagers.set(workspaceSlug, manager)
    }
    return manager
  }

  /**
   * Load agent definition for a given agent ID
   * Used when activating an agent for a session
   */
  private async loadAgentDefinition(agentId: string, workspace: Workspace): Promise<SubAgentDefinition | null> {
    try {
      const workspaceSlug = getWorkspaceSlug(workspace)
      const manager = this.getFolderAgentManager(workspaceSlug)
      const definition = manager.getAgentDefinition(agentId)
      if (definition) {
        console.log(`[SessionManager] Loaded agent definition: ${definition.name}`)
      }
      return definition
    } catch (error) {
      console.error(`[SessionManager] Failed to load agent definition ${agentId}:`, error)
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

    console.log(`[SessionManager] Creating AgentStateManager for workspace="${workspaceId}", agent="${agentId}"`)

    // Get workspace to get the slug for folder-based agent manager
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      console.error(`[SessionManager] Workspace not found: ${workspaceId}`)
      return null
    }
    const workspaceSlug = getWorkspaceSlug(workspace)
    const folderAgentManager = this.getFolderAgentManager(workspaceSlug)

    // Create AgentStateManager with folder-based agent manager
    const stateManager = new AgentStateManager(workspaceId, folderAgentManager)

    // Subscribe to status changes and broadcast complete state to all windows
    // Uses broadcastAgentState() to include needsSetup/needsAuth/reason
    stateManager.on('status', async () => {
      await this.broadcastAgentState(workspaceId, agentId)
    })

    // Cache it
    this.agentStateManagers.set(key, stateManager)
    console.log(`[SessionManager] Created AgentStateManager for agent ${agentId} in workspace ${workspaceId}`)

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
    console.log(`[SessionManager] Broadcast agent state: ${status.status}, needsSetup=${setupStatus.needsSetup}, needsAuth=${setupStatus.needsAuth} for ${agentId}`)
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
    console.log(`[SessionManager] activateAgent called: workspaceId="${workspaceId}", agentId="${agentId}"`)

    const stateManager = await this.getOrCreateAgentStateManager(workspaceId, agentId)
    if (!stateManager) {
      console.error(`[SessionManager] Failed to create state manager for workspace="${workspaceId}", agent="${agentId}"`)
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

      console.log('[SessionManager] Reinitializing auth with billing type:', billing.type)

      if (billing.type === 'craft_credits') {
        const token = await getCraftToken()
        setAnthropicOptionsEnv({
          USE_CRAFT_AI_GATEWAY: 'true',
          CRAFT_API_GATEWAY_TOKEN: token,
        })
        // Set placeholder API key so SDK starts
        process.env.ANTHROPIC_API_KEY = 'craft-credits-placeholder'
        console.log('[SessionManager] Set Craft API Gateway Token')
      } else if (billing.type === 'oauth_token' && billing.claudeOAuthToken) {
        // Use Claude Max subscription via OAuth token
        process.env.CLAUDE_CODE_OAUTH_TOKEN = billing.claudeOAuthToken
        delete process.env.ANTHROPIC_API_KEY
        delete process.env.USE_CRAFT_AI_GATEWAY
        delete process.env.CRAFT_API_GATEWAY_TOKEN
        console.log('[SessionManager] Set Claude Max OAuth Token')
      } else if (billing.apiKey) {
        // Use API key (pay-as-you-go)
        process.env.ANTHROPIC_API_KEY = billing.apiKey
        delete process.env.CLAUDE_CODE_OAUTH_TOKEN
        delete process.env.USE_CRAFT_AI_GATEWAY
        delete process.env.CRAFT_API_GATEWAY_TOKEN
        console.log('[SessionManager] Set Anthropic API Key')
      } else {
        console.error('[SessionManager] No authentication configured!')
      }
    } catch (error) {
      console.error('[SessionManager] Failed to reinitialize auth:', error)
      throw error
    }
  }

  async initialize(): Promise<void> {
    // Set path to Claude Code executable (cli.js from SDK)
    // This is critical because the bundled SDK can't auto-detect the path
    const cliPath = join(process.cwd(), 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'cli.js')
    console.log('[SessionManager] Setting pathToClaudeCodeExecutable:', cliPath)
    setPathToClaudeCodeExecutable(cliPath)

    // Set path to cache-ttl-interceptor for SDK subprocess
    // This interceptor redirects requests to the Craft gateway when using Craft credits
    const interceptorPath = join(process.cwd(), 'packages', 'shared', 'src', 'cache-ttl-interceptor.ts')
    console.log('[SessionManager] Setting interceptorPath:', interceptorPath)
    setInterceptorPath(interceptorPath)

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
        const workspaceSlug = getWorkspaceSlug(workspace)
        const sessionMetadata = listStoredSessions(workspaceSlug)

        for (const meta of sessionMetadata) {
          // Load full session data
          const storedSession = loadStoredSession(workspaceSlug, meta.id)
          if (!storedSession) {
            console.warn(`[SessionManager] Skipping session ${meta.id}: could not load from disk`)
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
            skipPermissions: storedSession.skipPermissions ?? false,
            activeModes: storedSession.activeModes ?? [],
            sdkSessionId: storedSession.sdkSessionId,
            tokenUsage: storedSession.tokenUsage,
            todoState: storedSession.todoState,
            lastReadMessageId: storedSession.lastReadMessageId,
            enabledSourceSlugs: storedSession.enabledSourceSlugs,
            workingDirectory: storedSession.workingDirectory ?? getDefaultWorkingDirectory(),
          }

          this.sessions.set(storedSession.id, managed)
          totalSessions++
        }
      }

      console.log(`[SessionManager] Loaded ${totalSessions} sessions from disk`)
    } catch (error) {
      console.error('[SessionManager] Failed to load sessions from disk:', error)
    }
  }

  // Persist a session to disk
  private persistSession(managed: ManagedSession): void {
    try {
      // Filter out transient messages (error, status, system) that shouldn't be persisted
      const persistableMessages = managed.messages.filter(m =>
        m.role !== 'error' && m.role !== 'status' && m.role !== 'system'
      )

      const workspaceSlug = getWorkspaceSlug(managed.workspace)
      const storedSession: StoredSession = {
        id: managed.id,
        workspaceSlug,
        name: managed.name,
        createdAt: managed.lastMessageAt,  // Approximate, will be overwritten if already exists
        lastUsedAt: Date.now(),
        sdkSessionId: managed.sdkSessionId,
        agentSlug: managed.agentId,  // agentId in ManagedSession is actually the slug
        agentName: managed.agentName,
        isFlagged: managed.isFlagged,
        skipPermissions: managed.skipPermissions,
        activeModes: managed.activeModes,
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

      saveStoredSession(storedSession)
      console.log(`[SessionManager] Persisted session ${managed.id}`)
    } catch (error) {
      console.error(`[SessionManager] Failed to persist session ${managed.id}:`, error)
    }
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
        skipPermissions: m.skipPermissions,
        activeModes: m.activeModes,
        todoState: m.todoState,
        lastReadMessageId: m.lastReadMessageId,
        workingDirectory: m.workingDirectory,
        enabledSourceSlugs: m.enabledSourceSlugs,
      }))
      .sort((a, b) => b.lastMessageAt - a.lastMessageAt)
  }

  async createSession(workspaceId: string, agentId?: string, agentName?: string): Promise<Session> {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`)
    }

    // Get new session defaults from settings
    const defaultSkipPerms = getDefaultSkipPermissions()
    const defaultModes = getDefaultModes()
    const defaultWorkingDir = getDefaultWorkingDirectory()
    const workspaceSlug = getWorkspaceSlug(workspace)

    // Use storage layer to create and persist the session
    const storedSession = createStoredSession(workspaceSlug, {
      agentSlug: agentId,
      agentName,
      skipPermissions: defaultSkipPerms,
      activeModes: defaultModes,
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
      skipPermissions: defaultSkipPerms,
      activeModes: defaultModes,
      workingDirectory: defaultWorkingDir,
    }

    this.sessions.set(storedSession.id, managed)

    // Persist with agent info or if defaults are set
    if (agentId || agentName || defaultSkipPerms || defaultModes.length > 0) {
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
      skipPermissions: defaultSkipPerms,
      activeModes: defaultModes,
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
      const config = loadStoredConfig()
      managed.agent = new CraftAgent({
        workspace: managed.workspace,
        model: config?.model,
        isHeadless: !AGENT_FLAGS.defaultModesEnabled,
        // Always pass session object - id is required for plan mode callbacks
        // sdkSessionId is optional and used for conversation resumption
        session: {
          id: managed.id,
          workspaceSlug: getWorkspaceSlug(managed.workspace),
          sdkSessionId: managed.sdkSessionId,
          createdAt: managed.lastMessageAt,
          lastUsedAt: managed.lastMessageAt,
          workingDirectory: managed.workingDirectory,
        },
      })
      console.log(`[SessionManager] Created agent for session ${managed.id}${managed.sdkSessionId ? ' (resuming)' : ''}`)

      // Set up permission handler to forward requests to renderer
      managed.agent.onPermissionRequest = (request) => {
        console.log(`[SessionManager] Permission request for session ${managed.id}:`, request.command)
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
        console.log(`[SessionManager] Credential request for session ${managed.id}:`, request.sourceSlug)
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

      // Set up mode change handlers (safe mode, and future modes)
      managed.agent.onSafeModeChange = (enabled) => {
        console.log(`[SessionManager] Mode 'safe' changed for session ${managed.id}:`, enabled)
        // Update activeModes array
        if (enabled) {
          if (!managed.activeModes.includes('safe')) {
            managed.activeModes = [...managed.activeModes, 'safe']
          }
        } else {
          managed.activeModes = managed.activeModes.filter(m => m !== 'safe')
        }
        this.sendEvent({
          type: 'mode_changed',
          sessionId: managed.id,
          mode: 'safe',
          enabled,
        }, managed.workspace.id)
      }

      // Wire up onPlanSubmitted to add plan message to conversation
      managed.agent.onPlanSubmitted = async (planPath) => {
        console.log(`[SessionManager] Plan submitted for session ${managed.id}:`, planPath)
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

          // Interrupt execution - plan presentation is a stopping point
          // The user needs to review and respond before continuing
          if (managed.isProcessing && managed.agent) {
            console.log(`[SessionManager] Interrupting after plan submission for session ${managed.id}`)
            managed.agent.interrupt()
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
          console.error(`[SessionManager] Failed to read plan file:`, error)
        }
      }

      // Wire up onWorkingDirectoryChange to sync cwd changes (e.g., from Bash cd)
      managed.agent.onWorkingDirectoryChange = (path) => {
        console.log(`[SessionManager] Working directory changed for session ${managed.id}:`, path)
        managed.workingDirectory = path
        this.persistSession(managed)
        this.sendEvent({
          type: 'working_directory_changed',
          sessionId: managed.id,
          workingDirectory: path
        }, managed.workspace.id)
      }

      // NOTE: Agent definition is now applied in sendMessage() via AgentStateManager.activate()
      // This ensures proper state machine flow: extraction → auth checks → activation

      // Apply session-scoped active modes to the newly created agent
      // This ensures the UI toggle state is reflected in the agent before first message
      for (const mode of managed.activeModes) {
        enterMode(managed.id, mode)
        console.log(`[SessionManager] Applied mode '${mode}' to agent for session ${managed.id}`)
      }
    }
    return managed.agent
  }

  async flagSession(sessionId: string): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (managed) {
      managed.isFlagged = true
      const workspaceSlug = getWorkspaceSlug(managed.workspace)
      flagStoredSession(workspaceSlug, sessionId)
    }
  }

  async unflagSession(sessionId: string): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (managed) {
      managed.isFlagged = false
      const workspaceSlug = getWorkspaceSlug(managed.workspace)
      unflagStoredSession(workspaceSlug, sessionId)
    }
  }

  async setTodoState(sessionId: string, todoState: TodoState): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (managed) {
      managed.todoState = todoState
      const workspaceSlug = getWorkspaceSlug(managed.workspace)
      setStoredSessionTodoState(workspaceSlug, sessionId, todoState)
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

    const workspaceSlug = getWorkspaceSlug(managed.workspace)
    console.log(`[SessionManager] Setting sources for session ${sessionId}:`, sourceSlugs)

    // Store the selection
    managed.enabledSourceSlugs = sourceSlugs

    // Build server configs from selected sources
    const sources = getSourcesBySlugs(workspaceSlug, sourceSlugs)
    const sourceService = createSourceService(workspaceSlug)
    const { mcpServers, errors } = await sourceService.buildAllServers(sources)

    if (errors.length > 0) {
      console.warn(`[SessionManager] Source build errors:`, errors)
    }

    // Store the built configs
    managed.sourceMcpServers = mcpServers

    // IMMEDIATELY update the agent's source servers if agent exists
    // This ensures tool availability is updated mid-conversation
    if (managed.agent) {
      // Set all sources for context (agent sees full list with descriptions)
      const allSources = loadWorkspaceSources(workspaceSlug)
      managed.agent.setAllSources(allSources)
      // Set active source servers (tools are only available from these)
      managed.agent.setSourceServers(mcpServers, {})
      console.log(`[SessionManager] Applied ${Object.keys(mcpServers).length} MCP sources to active agent (${allSources.length} total)`)
    }

    // Persist the session with updated sources
    this.persistSession(managed)

    // Notify renderer of the source change
    this.sendEvent({
      type: 'sources_changed',
      sessionId,
      enabledSourceSlugs: sourceSlugs,
    }, managed.workspace.id)

    console.log(`[SessionManager] Session ${sessionId} sources updated: ${sourceSlugs.length} sources`)
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
        const workspaceSlug = getWorkspaceSlug(managed.workspace)
        updateSessionMetadata(workspaceSlug, sessionId, { lastReadMessageId: lastFinalId })
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
      const workspaceSlug = getWorkspaceSlug(managed.workspace)
      updateSessionMetadata(workspaceSlug, sessionId, { lastReadMessageId: undefined })
    }
  }

  setSkipPermissions(sessionId: string, enabled: boolean): void {
    const managed = this.sessions.get(sessionId)
    if (managed) {
      managed.skipPermissions = enabled
      this.persistSession(managed)
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
      console.warn(`[SessionManager] Cannot update message: session ${sessionId} not found`)
      return
    }

    const message = managed.messages.find(m => m.id === messageId)
    if (!message) {
      console.warn(`[SessionManager] Cannot update message: message ${messageId} not found in session ${sessionId}`)
      return
    }

    // Update the message content
    message.content = content
    // Persist the updated session
    this.persistSession(managed)
    console.log(`[SessionManager] Updated message ${messageId} content in session ${sessionId}`)
  }

  async deleteSession(sessionId: string): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (!managed) {
      console.warn(`[SessionManager] Cannot delete session: ${sessionId} not found`)
      return
    }

    // Get workspace slug before deleting
    const workspaceSlug = getWorkspaceSlug(managed.workspace)

    // If processing is in progress, abort and wait for cleanup
    if (managed.isProcessing && managed.abortController) {
      managed.abortController.abort()
      // Brief wait for abort to propagate and in-flight operations to settle
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    this.sessions.delete(sessionId)

    // Note: We don't clean up AgentStateManager here because it's agent-scoped,
    // not session-scoped. It will be reused by other sessions with the same agent.

    // Delete from disk too
    deleteStoredSession(workspaceSlug, sessionId)

    // Clean up attachments directory (handled by deleteStoredSession for workspace-scoped storage)
    console.log(`[SessionManager] Deleted session ${sessionId}`)
  }

  async sendMessage(sessionId: string, message: string, attachments?: FileAttachment[], storedAttachments?: StoredAttachment[], options?: SendMessageOptions): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (!managed) {
      throw new Error(`Session ${sessionId} not found`)
    }

    if (managed.isProcessing) {
      throw new Error('Session is already processing')
    }

    // Add user message with stored attachments for persistence
    const userMessage: Message = {
      id: generateMessageId(),
      role: 'user',
      content: message,
      timestamp: Date.now(),
      attachments: storedAttachments, // Include for persistence (has thumbnailBase64)
    }
    managed.messages.push(userMessage)
    managed.lastMessageAt = Date.now()
    managed.isProcessing = true
    managed.streamingText = ''
    managed.abortController = new AbortController()

    // Capture the abort controller reference to detect if a new request supersedes this one
    // This prevents the finally block from clobbering state when a follow-up message arrives
    const myAbortController = managed.abortController

    // Get or create the agent (lazy loading)
    const agent = await this.getOrCreateAgent(managed)

    // If session has an agent that hasn't been activated yet, activate via AgentStateManager
    // This is the source of truth for agent state - ensures proper extraction, auth handling, etc.
    if (managed.agentId && !managed.agentActivated) {
      console.log(`[SessionManager] Activating agent ${managed.agentId} for session ${sessionId}`)

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
        console.log(`[SessionManager] Agent activation result: ${status.status}`)

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
              agent.setActiveAgentDefinition(definition, mcpServers, apiServers)
              managed.agentActivated = true
              console.log(`[SessionManager] Applied agent definition "${definition.name}" to session ${sessionId}`)
            } catch (error) {
              console.error(`[SessionManager] Failed to build agent configs for ${managed.agentId}:`, error)
              this.sendEvent({ type: 'error', sessionId, error: `Failed to configure agent: ${error instanceof Error ? error.message : String(error)}` }, managed.workspace.id)
            }
          }
        }
      } else {
        console.warn(`[SessionManager] Could not create AgentStateManager for session ${sessionId}`)
      }
    }

    // Always set all sources for context (even if none are enabled)
    const workspaceSlug = getWorkspaceSlug(managed.workspace)
    const allSources = loadWorkspaceSources(workspaceSlug)
    agent.setAllSources(allSources)

    // Apply source servers if any are enabled
    if (managed.enabledSourceSlugs?.length) {
      // Build server configs if not already built
      if (!managed.sourceMcpServers) {
        const sources = getSourcesBySlugs(workspaceSlug, managed.enabledSourceSlugs)
        const sourceService = createSourceService(workspaceSlug)
        const { mcpServers, errors } = await sourceService.buildAllServers(sources)
        if (errors.length > 0) {
          console.warn(`[SessionManager] Source build errors:`, errors)
        }
        managed.sourceMcpServers = mcpServers
      }

      // Apply source servers to the agent
      if (managed.sourceMcpServers && Object.keys(managed.sourceMcpServers).length > 0) {
        agent.setSourceServers(managed.sourceMcpServers, {})
        console.log(`[SessionManager] Applied ${Object.keys(managed.sourceMcpServers).length} MCP sources to session ${sessionId} (${allSources.length} total)`)
      }
    }

    try {
      console.log('[SessionManager] Starting chat for session:', sessionId)
      console.log('[SessionManager] Workspace:', JSON.stringify(managed.workspace, null, 2))
      console.log('[SessionManager] Message:', message)
      console.log('[SessionManager] Agent model:', agent.getModel())
      console.log('[SessionManager] process.cwd():', process.cwd())

      // Set ultrathink mode if enabled (single-shot - resets after query)
      if (options?.ultrathinkEnabled) {
        console.log('[SessionManager] Ultrathink mode ENABLED')
        agent.setUltrathinkMode(true)
      }

      // Process the message through the agent
      console.log('[SessionManager] Calling agent.chat()...')
      if (attachments?.length) {
        console.log('[SessionManager] Attachments:', attachments.length)
      }
      const chatIterator = agent.chat(message, attachments)
      console.log('[SessionManager] Got chat iterator, starting iteration...')

      for await (const event of chatIterator) {
        // Log events (skip noisy text_delta)
        if (event.type !== 'text_delta') {
          if (event.type === 'tool_start') {
            console.log(`[SessionManager] tool_start: ${event.toolName} (${event.toolUseId})`)
          } else if (event.type === 'tool_result') {
            console.log(`[SessionManager] tool_result: ${event.toolUseId} isError=${event.isError}`)
          } else {
            console.log('[SessionManager] Got event:', event.type)
          }
        }
        // Check if cancelled - break immediately (interrupted event already sent by cancelProcessing)
        if (managed.abortController?.signal.aborted || !managed.isProcessing) {
          console.log('[SessionManager] Aborted, breaking out of event loop')
          break
        }
        this.processEvent(managed, event)

        // Capture SDK session ID after first event (for conversation continuity)
        if (!managed.sdkSessionId) {
          const sdkId = agent.getSessionId()
          if (sdkId) {
            managed.sdkSessionId = sdkId
            console.log(`[SessionManager] Captured SDK session ID: ${sdkId}`)
          }
        }
      }

      console.log('[SessionManager] Chat completed')
    } catch (error) {
      console.error('[SessionManager] Error in chat:', error)
      console.error('[SessionManager] Error message:', error instanceof Error ? error.message : String(error))
      console.error('[SessionManager] Error stack:', error instanceof Error ? error.stack : 'No stack')
      this.sendEvent({
        type: 'error',
        sessionId,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, managed.workspace.id)
    } finally {
      // Only clean up state if WE are still the active request
      // This prevents race conditions when a follow-up message supersedes this one
      if (managed.abortController === myAbortController) {
        managed.isProcessing = false
        managed.abortController = undefined
        // Clear parent tool tracking (should be empty after normal completion, but ensures clean state)
        managed.parentToolStack = []
        managed.toolToParentMap.clear()
        managed.pendingTextParent = undefined
        this.sendEvent({ type: 'complete', sessionId }, managed.workspace.id)
      }
      // Always persist (for aborted messages)
      this.persistSession(managed)
    }
  }

  async cancelProcessing(sessionId: string): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (!managed?.isProcessing) {
      return // Not processing, nothing to cancel
    }

    console.log('[SessionManager] Cancelling processing for session:', sessionId)

    // Call agent.interrupt() directly like TUI does - this signals the SDK
    if (managed.agent) {
      managed.agent.interrupt()
    }

    // Also abort the controller as backup
    if (managed.abortController) {
      managed.abortController.abort()
    }

    // Set state immediately (no polling) - just like TUI's interruptedRef pattern
    managed.isProcessing = false
    managed.abortController = undefined

    // Clear parent tool tracking (stale entries would corrupt future parent-child tracking)
    managed.parentToolStack = []
    managed.toolToParentMap.clear()
    managed.pendingTextParent = undefined

    // Add interrupted info message to session (for persistence)
    const interruptedMessage: Message = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      role: 'info',
      content: 'Response interrupted',
      timestamp: Date.now(),
    }
    managed.messages.push(interruptedMessage)

    // Send interrupted event with message for renderer
    this.sendEvent({ type: 'interrupted', sessionId, message: interruptedMessage }, managed.workspace.id)

    // Persist session
    this.persistSession(managed)
  }

  /**
   * Respond to a pending permission request
   * Returns true if the response was delivered, false if agent/session is gone
   */
  respondToPermission(sessionId: string, requestId: string, allowed: boolean, alwaysAllow: boolean): boolean {
    const managed = this.sessions.get(sessionId)
    if (managed?.agent) {
      console.log(`[SessionManager] Permission response for ${requestId}: allowed=${allowed}, alwaysAllow=${alwaysAllow}`)
      managed.agent.respondToPermission(requestId, allowed, alwaysAllow)
      return true
    } else {
      console.warn(`[SessionManager] Cannot respond to permission - no agent for session ${sessionId}`)
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
      console.log(`[SessionManager] Credential response for ${requestId}: cancelled=${response.cancelled}`)
      resolver(response)
      this.pendingCredentialResolvers.delete(requestId)
      return true
    } else {
      console.warn(`[SessionManager] Cannot respond to credential - no pending request for ${requestId}`)
      return false
    }
  }

  /**
   * Set a mode for a session (generic for any mode type)
   */
  setMode(sessionId: string, mode: Mode, enabled: boolean): void {
    const managed = this.sessions.get(sessionId)
    if (managed) {
      // Update activeModes array
      if (enabled) {
        if (!managed.activeModes.includes(mode)) {
          managed.activeModes = [...managed.activeModes, mode]
        }
      } else {
        managed.activeModes = managed.activeModes.filter(m => m !== mode)
      }

      // Update the mode state for this specific session via mode manager
      if (enabled) {
        enterMode(sessionId, mode)
      } else {
        exitMode(sessionId, mode)
      }

      this.sendEvent({
        type: 'mode_changed',
        sessionId: managed.id,
        mode,
        enabled,
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
        console.log(`[SessionManager] Generated title for session ${managed.id}: "${title}"`)
      }
    } catch (error) {
      console.error(`[SessionManager] Failed to generate title for session ${managed.id}:`, error)
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
        // Include Task (subagents) and AgentOutputTool (retrieves subagent results)
        const PARENT_TOOLS = ['Task', 'AgentOutputTool']
        const isParentTool = PARENT_TOOLS.includes(event.toolName)

        // Determine parent BEFORE potentially pushing this tool onto the stack
        // The parent is the most recent parent tool that's still running (top of stack)
        const parentToolUseId = !isParentTool && managed.parentToolStack.length > 0
          ? managed.parentToolStack[managed.parentToolStack.length - 1]
          : undefined

        // If this is a parent tool, push it onto the stack
        // IMPORTANT: Only push on first event, not duplicate events (SDK sends two tool_start per tool)
        if (isParentTool && !isDuplicateEvent) {
          managed.parentToolStack.push(event.toolUseId)
          console.log(`[SessionManager] PARENT STACK PUSH: ${event.toolName} (${event.toolUseId}), stack=${JSON.stringify(managed.parentToolStack)}`)
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
        const PARENT_TOOLS = ['Task', 'AgentOutputTool']

        // Remove this tool from parent stack if it's there (parent tool completing)
        const stackIndex = managed.parentToolStack.indexOf(event.toolUseId)
        if (stackIndex !== -1) {
          managed.parentToolStack.splice(stackIndex, 1)
          console.log(`[SessionManager] PARENT STACK POP: ${event.toolUseId}, stack=${JSON.stringify(managed.parentToolStack)}`)
        } else {
          console.log(`[SessionManager] PARENT STACK NOT FOUND: ${event.toolUseId}, stack=${JSON.stringify(managed.parentToolStack)}`)
          // Defensive cleanup: if this is a parent tool type but ID wasn't found,
          // try to find and remove by matching tool name in messages
          if (PARENT_TOOLS.includes(toolName)) {
            const fallbackIdx = managed.parentToolStack.findIndex(id => {
              const msg = managed.messages.find(m => m.toolUseId === id)
              return msg?.toolName === toolName
            })
            if (fallbackIdx !== -1) {
              const removedId = managed.parentToolStack.splice(fallbackIdx, 1)[0]
              console.log(`[SessionManager] PARENT STACK FALLBACK POP: ${removedId} (matched by toolName=${toolName}), stack=${JSON.stringify(managed.parentToolStack)}`)
            }
          }
        }

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

        console.log(`[SessionManager] RESULT MATCH: toolUseId=${event.toolUseId}, found=${!!existingToolMsg}, toolName=${existingToolMsg?.toolName || toolName}, wasComplete=${wasAlreadyComplete}`)

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
        // Typed errors have structured information - send both formats for compatibility
        console.log('[SessionManager] typed_error:', JSON.stringify(event.error, null, 2))
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

      case 'complete':
        // Complete event from CraftAgent - actual 'complete' sent to renderer
        // comes from the finally block in sendMessage, not here
        break

      // Note: working_directory_changed is handled via onWorkingDirectoryChange callback,
      // not through processEvent, so no case needed here
    }
  }

  private sendEvent(event: SessionEvent, workspaceId?: string): void {
    if (!this.windowManager) {
      console.warn('[SessionManager] Cannot send event - no window manager')
      return
    }

    // Route to the window for this workspace
    const window = workspaceId
      ? this.windowManager.getWindowByWorkspace(workspaceId)
      : null

    if (!window) {
      console.warn(`[SessionManager] Cannot send ${event.type} event - no window for workspace ${workspaceId}`)
      return
    }

    if (window.isDestroyed()) {
      console.warn(`[SessionManager] Cannot send ${event.type} event - window destroyed for workspace ${workspaceId}`)
      return
    }

    try {
      window.webContents.send(IPC_CHANNELS.SESSION_EVENT, event)
    } catch (error) {
      console.error(`[SessionManager] Failed to send ${event.type} event:`, error)
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
}
