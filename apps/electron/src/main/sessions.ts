import { BrowserWindow, app } from 'electron'
import { join } from 'path'
import { rm } from 'fs/promises'
import { CraftAgent, type AgentEvent } from '../../../../src/agent/craft-agent'
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
  type StoredSession,
  type StoredMessage,
  type SessionMetadata,
} from '../../../../src/config/storage'
import { getAuthState } from '../../../../src/auth/state'
import { setAnthropicOptionsEnv, setPathToClaudeCodeExecutable } from '../../../../src/agent/options'
import { getCraftToken } from '../../../../src/auth/craft-token'
import { CraftMcpClient } from '../../../../src/mcp/client'
import { SubAgentManager, type SubAgentManagerConfig } from '../../../../src/agents/manager'
import type { SubAgentDefinition } from '../../../../src/agents/types'
import { type Session, type Message, type SessionEvent, type FileAttachment, IPC_CHANNELS, generateMessageId } from '../shared/types'
import { generateSessionTitle } from '../../../../src/utils/title-generator'
import { DEFAULT_MODEL } from '../../../../src/config/models'

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
  }
}

// Convert runtime Message to StoredMessage for persistence
// Note: For tool messages, result is stored in `content` (not duplicated in toolResult)
function messageToStored(msg: Message): StoredMessage {
  return {
    id: msg.id,
    type: msg.role,  // Message uses 'role', StoredMessage uses 'type'
    content: msg.content,
    timestamp: msg.timestamp,
    toolName: msg.toolName,
    toolInput: msg.toolInput,
    toolStatus: msg.toolStatus,
    toolDuration: msg.toolDuration,
    isError: msg.isError,
    attachments: msg.attachments,
  }
}

// Convert StoredMessage to runtime Message
function storedToMessage(stored: StoredMessage): Message {
  return {
    id: stored.id,
    role: stored.type,  // StoredMessage uses 'type', Message uses 'role'
    content: stored.content,
    timestamp: stored.timestamp ?? Date.now(),
    toolName: stored.toolName,
    toolInput: stored.toolInput,
    toolStatus: stored.toolStatus,
    toolDuration: stored.toolDuration,
    isError: stored.isError,
    attachments: stored.attachments,
  }
}

export class SessionManager {
  private sessions: Map<string, ManagedSession> = new Map()
  private mainWindow: BrowserWindow | null = null
  // Cache SubAgentManager per workspace (reused across sessions)
  private agentManagers: Map<string, SubAgentManager> = new Map()

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
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

    try {
      // Get MCP token for the workspace (returns { authType, token })
      const { token: mcpToken } = await getWorkspaceAccessTokenAsync(workspace.id)

      if (!mcpToken) {
        console.warn(`[SessionManager] No MCP token for workspace ${workspace.id}, cannot create agent manager`)
        return null
      }

      // Create MCP client for this workspace
      const mcpClient = new CraftMcpClient({
        url: workspace.mcpUrl,
        headers: { Authorization: `Bearer ${mcpToken}` },
      })

      // Connect to MCP server
      await mcpClient.connect()

      // Get config
      const config = loadStoredConfig()
      const managerConfig: SubAgentManagerConfig = {
        model: config?.model || DEFAULT_MODEL,
        mcpUrl: workspace.mcpUrl,
        mcpToken,
      }

      // Create and cache the manager
      const manager = new SubAgentManager(workspace.id, mcpClient, managerConfig)
      this.agentManagers.set(workspace.id, manager)

      console.log(`[SessionManager] Created agent manager for workspace ${workspace.id}`)
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

  async initialize(): Promise<void> {
    // Set path to Claude Code executable (cli.js from SDK)
    // This is critical because the bundled SDK can't auto-detect the path
    const cliPath = join(process.cwd(), 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'cli.js')
    console.log('[SessionManager] Setting pathToClaudeCodeExecutable:', cliPath)
    setPathToClaudeCodeExecutable(cliPath)

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
        isArchived: m.isArchived
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
      isArchived: false
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
      isArchived: false
    }
  }

  /**
   * Get or create agent for a session (lazy loading)
   * If session has an agentId, loads and applies the agent definition
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

      // If session has an agent, load and apply the definition
      if (managed.agentId) {
        const definition = await this.loadAgentDefinition(managed.agentId, managed.workspace)
        if (definition) {
          // Get the agent manager to build server configs
          const manager = await this.getAgentManager(managed.workspace)
          if (manager) {
            try {
              // Build MCP server configs with auth
              const mcpServers = await manager.buildMcpServerConfig(definition)
              // Build API servers (in-process MCP servers for REST APIs)
              const apiServers = await manager.buildApiServers(definition)

              // Apply definition to the agent
              managed.agent.setActiveAgentDefinition(definition, mcpServers, apiServers)
              console.log(`[SessionManager] Applied agent definition "${definition.name}" to session ${managed.id}`)
            } catch (error) {
              console.error(`[SessionManager] Failed to build agent configs for ${managed.agentId}:`, error)
              // Continue without agent configs - will use base agent
            }
          }
        }
      }
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

  async renameSession(sessionId: string, name: string): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (managed) {
      managed.name = name
      this.persistSession(managed)
      // Notify renderer of the name change
      this.sendEvent({ type: 'title_generated', sessionId, title: name })
    }
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

  async sendMessage(sessionId: string, message: string, attachments?: FileAttachment[]): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (!managed) {
      throw new Error(`Session ${sessionId} not found`)
    }

    if (managed.isProcessing) {
      throw new Error('Session is already processing')
    }

    // Add user message
    const userMessage: Message = {
      id: generateMessageId(),
      role: 'user',
      content: message,
      timestamp: Date.now()
    }
    managed.messages.push(userMessage)
    managed.lastMessageAt = Date.now()
    managed.isProcessing = true
    managed.streamingText = ''
    managed.abortController = new AbortController()

    // Get or create the agent (lazy loading, applies agent definition if present)
    const agent = await this.getOrCreateAgent(managed)

    try {
      console.log('[SessionManager] Starting chat for session:', sessionId)
      console.log('[SessionManager] Workspace:', JSON.stringify(managed.workspace, null, 2))
      console.log('[SessionManager] Message:', message)
      console.log('[SessionManager] Agent model:', agent.getModel())
      console.log('[SessionManager] process.cwd():', process.cwd())

      // Process the message through the agent
      console.log('[SessionManager] Calling agent.chat()...')
      if (attachments?.length) {
        console.log('[SessionManager] Attachments:', attachments.length)
      }
      const chatIterator = agent.chat(message, attachments)
      console.log('[SessionManager] Got chat iterator, starting iteration...')

      for await (const event of chatIterator) {
        console.log('[SessionManager] Got event:', event.type)
        if (managed.abortController?.signal.aborted) {
          console.log('[SessionManager] Aborted')
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
      })
    } finally {
      managed.isProcessing = false
      managed.abortController = undefined
      this.sendEvent({ type: 'complete', sessionId })

      // Persist session to disk after each message exchange
      this.persistSession(managed)
    }
  }

  async cancelProcessing(sessionId: string): Promise<void> {
    const managed = this.sessions.get(sessionId)
    if (managed?.abortController) {
      managed.abortController.abort()
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
        this.sendEvent({ type: 'title_generated', sessionId: managed.id, title })
        console.log(`[SessionManager] Generated title for session ${managed.id}: "${title}"`)
      }
    } catch (error) {
      console.error(`[SessionManager] Failed to generate title for session ${managed.id}:`, error)
    }
  }

  private processEvent(managed: ManagedSession, event: AgentEvent): void {
    const sessionId = managed.id

    switch (event.type) {
      case 'text_delta':
        // AgentEvent uses `text` not `delta`
        managed.streamingText += event.text
        this.sendEvent({ type: 'text_delta', sessionId, delta: event.text })
        break

      case 'text_complete':
        // Check if this is the first assistant message and no name exists yet
        const existingAssistantCount = managed.messages.filter(m => m.role === 'assistant').length
        const shouldGenerateTitle = existingAssistantCount === 0 && !managed.name

        const assistantMessage: Message = {
          id: generateMessageId(),
          role: 'assistant',
          content: event.text,
          timestamp: Date.now()
        }
        managed.messages.push(assistantMessage)
        managed.streamingText = ''
        this.sendEvent({ type: 'text_complete', sessionId, text: event.text })

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
        this.sendEvent({
          type: 'tool_start',
          sessionId,
          toolName: event.toolName,
          toolUseId: event.toolUseId,
          toolInput: event.input
        })
        break

      case 'tool_result':
        // AgentEvent tool_result only has toolUseId, look up the toolName
        const toolName = managed.pendingTools.get(event.toolUseId) || 'unknown'
        managed.pendingTools.delete(event.toolUseId)

        const toolMessage: Message = {
          id: generateMessageId(),
          role: 'tool',
          content: event.result || '',
          timestamp: Date.now(),
          toolName: toolName,
          toolUseId: event.toolUseId,
          toolResult: event.result
        }
        managed.messages.push(toolMessage)
        this.sendEvent({
          type: 'tool_result',
          sessionId,
          toolUseId: event.toolUseId,
          toolName: toolName,
          result: event.result || ''
        })
        break

      case 'status':
        this.sendEvent({ type: 'status', sessionId, message: event.message })
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
        this.sendEvent({ type: 'error', sessionId, error: event.message })
        break

      case 'typed_error':
        // Typed errors have structured information - send both formats for compatibility
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
            canRetry: event.error.canRetry
          }
        })
        break
    }
  }

  private sendEvent(event: SessionEvent): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(IPC_CHANNELS.SESSION_EVENT, event)
    }
  }
}
