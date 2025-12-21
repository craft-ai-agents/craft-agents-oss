import { app } from 'electron'
import { join } from 'path'
import { rm } from 'fs/promises'
import { CraftAgent, type AgentEvent } from '@craft-agent/shared/agent'
import type { WindowManager } from './window-manager'
import {
  loadStoredConfig,
  getWorkspaces,
  getWorkspaceByNameOrId,
  getWorkspaceAccessTokenAsync,
  updateSessionMetadata,
  getSessionAttachmentsPath,
  type Workspace,
  // Session persistence functions
  listSessions as listStoredSessions,
  loadSession as loadStoredSession,
  saveSession as saveStoredSession,
  createSession as createStoredSession,
  deleteSession as deleteStoredSession,
  archiveSession as archiveStoredSession,
  unarchiveSession as unarchiveStoredSession,
  flagSession as flagStoredSession,
  unflagSession as unflagStoredSession,
  type StoredSession,
  type StoredMessage,
  type SessionMetadata,
} from '@craft-agent/shared/config'
import { getAuthState } from '@craft-agent/shared/auth'
import { setAnthropicOptionsEnv, setPathToClaudeCodeExecutable, setInterceptorPath } from '@craft-agent/shared/agent'
import { getCraftToken } from '@craft-agent/shared/auth'
import { CraftMcpClient } from '@craft-agent/shared/mcp'
import { SubAgentManager, type SubAgentManagerConfig } from '@craft-agent/shared/agents'
import type { SubAgentDefinition, AgentStatus, AgentActivateOptions } from '@craft-agent/shared/agents'
import { AgentStateManager, loadRegistry, invalidateDefinition } from '@craft-agent/shared/agents'
import { type Session, type Message, type SessionEvent, type FileAttachment, type StoredAttachment, type SendMessageOptions, IPC_CHANNELS, generateMessageId } from '../shared/types'
import { generateSessionTitle } from '@craft-agent/shared/utils'
import { DEFAULT_MODEL } from '@craft-agent/shared/config'

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
  // Session name (user-defined or AI-generated)
  name?: string
  // Inbox/Archive features
  agentId?: string
  agentName?: string
  isArchived: boolean
  isFlagged: boolean
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
  // Cache SubAgentManager per workspace (reused across sessions)
  private agentManagers: Map<string, SubAgentManager> = new Map()
  // Track in-flight SubAgentManager initialization to prevent duplicate connections
  private pendingAgentManagers: Map<string, Promise<SubAgentManager | null>> = new Map()
  // Cache AgentStateManager per agent (agent-scoped: workspaceId:agentId)
  // This is the single source of truth for agent activation state
  private agentStateManagers: Map<string, AgentStateManager> = new Map()
  // Delta batching for performance - reduces IPC events from 50+/sec to ~20/sec
  private pendingDeltas: Map<string, PendingDelta> = new Map()
  private deltaFlushTimers: Map<string, NodeJS.Timeout> = new Map()

  setWindowManager(wm: WindowManager): void {
    this.windowManager = wm
  }

  /**
   * Get or create a SubAgentManager for a workspace
   * The manager is cached and reused across sessions for the same workspace
   */
  private async getAgentManager(workspace: Workspace): Promise<SubAgentManager | null> {
    // Check cache first
    if (this.agentManagers.has(workspace.id)) {
      return this.agentManagers.get(workspace.id)!
    }

    // Check if initialization is already in progress
    if (this.pendingAgentManagers.has(workspace.id)) {
      return this.pendingAgentManagers.get(workspace.id)!
    }

    // Create and track the initialization promise
    const initPromise = this.initializeAgentManager(workspace)
    this.pendingAgentManagers.set(workspace.id, initPromise)

    try {
      return await initPromise
    } finally {
      this.pendingAgentManagers.delete(workspace.id)
    }
  }

  /**
   * Internal method to initialize a SubAgentManager
   * Separated from getAgentManager to support pending promise tracking
   */
  private async initializeAgentManager(workspace: Workspace): Promise<SubAgentManager | null> {
    try {
      // Get MCP token for the workspace (returns { authType, token })
      const { authType, token: mcpToken } = await getWorkspaceAccessTokenAsync(workspace.id)

      // Public workspaces don't need a token, but OAuth/bearer workspaces do
      if (authType !== 'public' && !mcpToken) {
        console.warn(`[SessionManager] No MCP token for workspace ${workspace.id} (authType: ${authType}), cannot create agent manager`)
        return null
      }

      // Create MCP client for this workspace
      const mcpClient = new CraftMcpClient({
        url: workspace.mcpUrl,
        headers: mcpToken ? { Authorization: `Bearer ${mcpToken}` } : undefined,
      })

      // Connect to MCP server
      await mcpClient.connect()

      // Get config
      const config = loadStoredConfig()
      const managerConfig: SubAgentManagerConfig = {
        model: config?.model || DEFAULT_MODEL,
        mcpUrl: workspace.mcpUrl,
        mcpToken: mcpToken ?? undefined,
      }

      // Create and cache the manager
      const manager = new SubAgentManager(workspace.id, mcpClient, managerConfig)
      this.agentManagers.set(workspace.id, manager)

      console.log(`[SessionManager] Created agent manager for workspace ${workspace.id} (authType: ${authType})`)
      return manager
    } catch (error) {
      console.error(`[SessionManager] Failed to create agent manager for workspace ${workspace.id}:`, error)
      return null
    }
  }

  /**
   * Load agent definition for a given agent ID
   * Used when activating an agent for a session
   */
  private async loadAgentDefinition(agentId: string, workspace: Workspace): Promise<SubAgentDefinition | null> {
    const manager = await this.getAgentManager(workspace)
    if (!manager) {
      console.warn(`[SessionManager] No agent manager for workspace ${workspace.id}`)
      return null
    }

    try {
      const definition = await manager.getDefinition(agentId)
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

    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      // Log available workspaces for debugging
      const allWorkspaces = getWorkspaces()
      console.error(`[SessionManager] Workspace "${workspaceId}" not found. Available workspaces: [${allWorkspaces.map(w => `"${w.id}"`).join(', ')}]`)
      return null
    }

    const subAgentManager = await this.getAgentManager(workspace)
    if (!subAgentManager) {
      console.warn(`[SessionManager] Could not create SubAgentManager for workspace ${workspaceId}`)
      return null
    }

    // Create AgentStateManager
    const stateManager = new AgentStateManager(workspaceId, subAgentManager)

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
   * Auto-activates agents that are already configured (have credentials)
   */
  async getAgentStatus(workspaceId: string, agentId: string): Promise<AgentStatus> {
    const stateManager = this.getAgentStateManager(workspaceId, agentId)
    if (stateManager) {
      return stateManager.getStatus()
    }

    // No state manager yet - check if agent is already configured
    // If credentials exist, auto-activate instead of returning 'idle'
    const { agentService } = await import('./agent-service')
    const setupStatus = await agentService.getAgentSetupStatus(workspaceId, agentId)

    if (!setupStatus.needsSetup && !setupStatus.needsAuth) {
      // Agent is already configured - auto-activate it
      console.log(`[SessionManager] Auto-activating already-configured agent ${agentId}`)
      // Don't await - let it run in background and return 'extracting' state
      this.activateAgent(workspaceId, agentId).catch(err => {
        console.error(`[SessionManager] Auto-activation failed for ${agentId}:`, err)
      })
      return { status: 'extracting', agentId, agentName: agentId, message: 'Activating...' }
    }

    // Agent needs setup or auth - return idle with setup info attached
    return {
      status: 'idle',
      needsSetup: setupStatus.needsSetup,
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
    try {
      const authState = await getAuthState()
      const { billing } = authState

      console.log('[SessionManager] Initializing with billing type:', billing.type)

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
      console.error('[SessionManager] Failed to initialize auth:', error)
    }

    // Load existing sessions from disk
    this.loadSessionsFromDisk()
  }

  // Load all existing sessions from disk into memory
  private loadSessionsFromDisk(): void {
    try {
      const workspaces = getWorkspaces()
      const allSessionMetadata = listStoredSessions()  // Get all sessions across workspaces

      console.log(`[SessionManager] Found ${allSessionMetadata.length} sessions on disk`)

      for (const meta of allSessionMetadata) {
        // Find the workspace for this session
        const workspace = workspaces.find(w => w.id === meta.workspaceId)
        if (!workspace) {
          console.warn(`[SessionManager] Skipping session ${meta.id}: workspace ${meta.workspaceId} not found`)
          continue
        }

        // Load full session data
        const storedSession = loadStoredSession(meta.id)
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
          name: storedSession.name,
          agentId: storedSession.agentId,
          agentName: storedSession.agentName,
          isArchived: storedSession.isArchived ?? false,
          isFlagged: storedSession.isFlagged ?? false,
          sdkSessionId: storedSession.sdkSessionId,
          tokenUsage: storedSession.tokenUsage,
        }

        this.sessions.set(storedSession.id, managed)
        console.log(`[SessionManager] Loaded session ${storedSession.id} with ${messages.length} messages`)
      }
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

      const storedSession: StoredSession = {
        id: managed.id,
        workspaceId: managed.workspace.id,
        name: managed.name,
        createdAt: managed.lastMessageAt,  // Approximate, will be overwritten if already exists
        lastUsedAt: Date.now(),
        sdkSessionId: managed.sdkSessionId,
        agentId: managed.agentId,
        agentName: managed.agentName,
        isArchived: managed.isArchived,
        isFlagged: managed.isFlagged,
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
        isArchived: m.isArchived,
        isFlagged: m.isFlagged
      }))
      .sort((a, b) => b.lastMessageAt - a.lastMessageAt)
  }

  async createSession(workspaceId: string, agentId?: string, agentName?: string): Promise<Session> {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`)
    }

    // Use storage layer to create and persist the session
    const storedSession = createStoredSession(workspaceId)

    const managed: ManagedSession = {
      id: storedSession.id,
      workspace,
      agent: null,  // Lazy-load agent on first message
      messages: [],
      isProcessing: false,
      lastMessageAt: storedSession.lastUsedAt,
      streamingText: '',
      pendingTools: new Map(),
      agentId,
      agentName,
      isArchived: false,
      isFlagged: false
    }

    this.sessions.set(storedSession.id, managed)

    // Persist with agent info if provided
    if (agentId || agentName) {
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
      isArchived: false,
      isFlagged: false
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
        // Pass session object for conversation resumption (SDK uses sdkSessionId to resume)
        session: managed.sdkSessionId ? {
          id: managed.id,
          workspaceId: managed.workspace.id,
          sdkSessionId: managed.sdkSessionId,
          createdAt: managed.lastMessageAt,
          lastUsedAt: managed.lastMessageAt,
        } : undefined,
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

      // NOTE: Agent definition is now applied in sendMessage() via AgentStateManager.activate()
      // This ensures proper state machine flow: extraction → auth checks → activation
    }
    return managed.agent
  }

  async archiveSession(sessionId: string): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (managed) {
      managed.isArchived = true
      archiveStoredSession(sessionId)
    }
  }

  async unarchiveSession(sessionId: string): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (managed) {
      managed.isArchived = false
      unarchiveStoredSession(sessionId)
    }
  }

  async flagSession(sessionId: string): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (managed) {
      managed.isFlagged = true
      flagStoredSession(sessionId)
    }
  }

  async unflagSession(sessionId: string): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (managed) {
      managed.isFlagged = false
      unflagStoredSession(sessionId)
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
    if (managed) {
      // If processing is in progress, abort and wait for cleanup
      if (managed.isProcessing && managed.abortController) {
        managed.abortController.abort()
        // Brief wait for abort to propagate and in-flight operations to settle
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      this.sessions.delete(sessionId)
    }

    // Note: We don't clean up AgentStateManager here because it's agent-scoped,
    // not session-scoped. It will be reused by other sessions with the same agent.

    // Delete from disk too
    deleteStoredSession(sessionId)

    // Clean up attachments directory
    try {
      const attachmentsDir = getSessionAttachmentsPath(sessionId)
      await rm(attachmentsDir, { recursive: true, force: true })
      console.log(`[SessionManager] Cleaned up attachments for session ${sessionId}`)
    } catch (error) {
      // Ignore errors - directory might not exist
      console.log(`[SessionManager] No attachments to clean up for session ${sessionId}`)
    }
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
            const manager = await this.getAgentManager(managed.workspace)
            if (manager) {
              try {
                manager.setActiveAgentId(managed.agentId)
                const mcpServers = await manager.buildMcpServerConfig(definition)
                const apiServers = await manager.buildApiServers(definition)
                agent.setActiveAgentDefinition(definition, mcpServers, apiServers)
                managed.agentActivated = true
                console.log(`[SessionManager] Applied agent definition "${definition.name}" to session ${sessionId}`)
              } catch (error) {
                console.error(`[SessionManager] Failed to build agent configs for ${managed.agentId}:`, error)
                this.sendEvent({ type: 'error', sessionId, error: `Failed to configure agent: ${error instanceof Error ? error.message : String(error)}` }, managed.workspace.id)
              }
            }
          }
        }
      } else {
        console.warn(`[SessionManager] Could not create AgentStateManager for session ${sessionId}`)
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
        console.log('[SessionManager] Got event:', event.type)
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
      managed.isProcessing = false
      managed.abortController = undefined
      this.sendEvent({ type: 'complete', sessionId }, managed.workspace.id)

      // Persist session to disk after each message exchange
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
        // AgentEvent uses `text` not `delta`
        managed.streamingText += event.text
        // Queue delta for batched sending (performance: reduces IPC from 50+/sec to ~20/sec)
        this.queueDelta(sessionId, workspaceId, event.text, event.turnId)
        break

      case 'text_complete':
        // Flush any pending deltas before sending complete (ensures renderer has all content)
        this.flushDelta(sessionId, workspaceId)

        // Check if this is the first assistant message and no name exists yet
        const existingAssistantCount = managed.messages.filter(m => m.role === 'assistant').length
        const shouldGenerateTitle = existingAssistantCount === 0 && !managed.name

        const assistantMessage: Message = {
          id: generateMessageId(),
          role: 'assistant',
          content: event.text,
          timestamp: Date.now(),
          isIntermediate: event.isIntermediate,
          turnId: event.turnId
        }
        managed.messages.push(assistantMessage)
        managed.streamingText = ''
        this.sendEvent({ type: 'text_complete', sessionId, text: event.text, isIntermediate: event.isIntermediate, turnId: event.turnId }, workspaceId)

        // Generate title asynchronously after first assistant response
        if (shouldGenerateTitle) {
          const firstUserMsg = managed.messages.find(m => m.role === 'user')
          if (firstUserMsg) {
            this.generateTitle(managed, firstUserMsg.content, event.text)
          }
        }
        break

      case 'tool_start':
        // Track tool_use_id -> toolName mapping for later use in tool_result
        managed.pendingTools.set(event.toolUseId, event.toolName)

        // Check if a message with this toolUseId already exists
        // SDK sends two events per tool: first from stream_event (empty input),
        // second from assistant message (complete input)
        const existingStartMsg = managed.messages.find(m => m.toolUseId === event.toolUseId)
        if (existingStartMsg) {
          // Update existing message with complete input (second event has full input)
          if (event.input) {
            existingStartMsg.toolInput = event.input
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
            toolInput: event.input,
            toolStatus: 'pending',
            turnId: event.turnId
          }
          managed.messages.push(toolStartMessage)
        }

        this.sendEvent({
          type: 'tool_start',
          sessionId,
          toolName: event.toolName,
          toolUseId: event.toolUseId,
          toolInput: event.input,
          turnId: event.turnId
        }, workspaceId)
        break

      case 'tool_result':
        // AgentEvent tool_result only has toolUseId, look up the toolName
        const toolName = managed.pendingTools.get(event.toolUseId) || 'unknown'
        managed.pendingTools.delete(event.toolUseId)

        // Update existing tool message (created on tool_start) instead of creating new one
        const existingToolMsg = managed.messages.find(m => m.toolUseId === event.toolUseId)
        if (existingToolMsg) {
          existingToolMsg.content = event.result || ''
          existingToolMsg.toolResult = event.result
          existingToolMsg.toolStatus = 'completed'
        } else {
          // Fallback: create new message if not found (shouldn't happen normally)
          const toolMessage: Message = {
            id: generateMessageId(),
            role: 'tool',
            content: event.result || '',
            timestamp: Date.now(),
            toolName: toolName,
            toolUseId: event.toolUseId,
            toolResult: event.result,
            toolStatus: 'completed'
          }
          managed.messages.push(toolMessage)
        }

        this.sendEvent({
          type: 'tool_result',
          sessionId,
          toolUseId: event.toolUseId,
          toolName: toolName,
          result: event.result || '',
          turnId: event.turnId
        }, workspaceId)
        break

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
