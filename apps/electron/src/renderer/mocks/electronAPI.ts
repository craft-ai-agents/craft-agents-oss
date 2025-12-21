import type { ElectronAPI, Session, SessionEvent, FileAttachment, StoredAttachment, SendMessageOptions } from '../../shared/types'
import { generateMessageId } from '../../shared/types'
import { mockWorkspaces, mockSessions, mockStreamingResponses } from './dummyData'

// Mutable copy of sessions for the mock
let sessions = [...mockSessions]

// Store event callback for streaming simulation
let eventCallback: ((event: SessionEvent) => void) | null = null

// Track which streaming response to use next (cycles through them)
let responseIndex = 0

/**
 * Simulates streaming text character by character with realistic delays
 */
async function simulateStreaming(
  sessionId: string,
  text: string,
  chunkSize = 3,
  delayMs = 20
): Promise<void> {
  for (let i = 0; i < text.length; i += chunkSize) {
    const chunk = text.slice(i, i + chunkSize)
    eventCallback?.({ type: 'text_delta', sessionId, delta: chunk })
    await sleep(delayMs)
  }
  eventCallback?.({ type: 'text_complete', sessionId, text })
}

/**
 * Simulates a tool call with start and result events
 */
async function simulateToolCall(
  sessionId: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  toolResult: string
): Promise<void> {
  const toolUseId = `tool-${Date.now()}`

  eventCallback?.({
    type: 'tool_start',
    sessionId,
    toolName,
    toolUseId,
    toolInput,
  })

  // Simulate tool execution time
  await sleep(800)

  eventCallback?.({
    type: 'tool_result',
    sessionId,
    toolUseId,
    toolName,
    result: toolResult,
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Mock agent data
const mockAgents: import('../../shared/types').SubAgentMetadata[] = [
  { id: 'agent-writer', name: 'Writer', documentId: 'doc-writer', workspaceId: 'ws-personal', createdAt: Date.now() - 86400000 },
  { id: 'agent-coder', name: 'Coder', documentId: 'doc-coder', workspaceId: 'ws-work', createdAt: Date.now() - 86400000 * 2, folderPath: ['work'] },
  { id: 'agent-reviewer', name: 'Reviewer', documentId: 'doc-reviewer', workspaceId: 'ws-work', createdAt: Date.now() - 86400000 * 3, folderPath: ['work'] },
]

export const mockElectronAPI: ElectronAPI = {
  // ===== Session Management =====

  async getSessions(): Promise<Session[]> {
    await sleep(100) // Simulate network delay
    return [...sessions].sort((a, b) => b.lastMessageAt - a.lastMessageAt)
  },

  async createSession(workspaceId: string, agentId?: string): Promise<Session> {
    await sleep(150)

    const workspace = mockWorkspaces.find(w => w.id === workspaceId)
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`)
    }

    const agent = agentId ? mockAgents.find(a => a.id === agentId) : undefined

    const newSession: Session = {
      id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      lastMessageAt: Date.now(),
      messages: [],
      isProcessing: false,
      agentId: agent?.id,
      agentName: agent?.name,
      isArchived: false,
    }

    sessions = [newSession, ...sessions]
    return newSession
  },

  async deleteSession(sessionId: string): Promise<void> {
    await sleep(100)
    sessions = sessions.filter(s => s.id !== sessionId)
  },

  async renameSession(sessionId: string, name: string): Promise<void> {
    await sleep(100)
    const session = sessions.find(s => s.id === sessionId)
    if (session) {
      session.name = name
    }
  },

  async archiveSession(sessionId: string): Promise<void> {
    await sleep(100)
    const session = sessions.find(s => s.id === sessionId)
    if (session) {
      session.isArchived = true
    }
  },

  async unarchiveSession(sessionId: string): Promise<void> {
    await sleep(100)
    const session = sessions.find(s => s.id === sessionId)
    if (session) {
      session.isArchived = false
    }
  },

  async flagSession(sessionId: string): Promise<void> {
    await sleep(100)
    const session = sessions.find(s => s.id === sessionId)
    if (session) {
      session.isFlagged = true
    }
  },

  async unflagSession(sessionId: string): Promise<void> {
    await sleep(100)
    const session = sessions.find(s => s.id === sessionId)
    if (session) {
      session.isFlagged = false
    }
  },

  async sendMessage(sessionId: string, message: string, _attachments?: FileAttachment[], _storedAttachments?: StoredAttachment[], _options?: SendMessageOptions): Promise<void> {
    // This returns immediately - results stream via events
    const session = sessions.find(s => s.id === sessionId)
    if (!session) {
      eventCallback?.({ type: 'error', sessionId, error: 'Session not found' })
      return
    }

    // Get next mock response (cycles through available responses)
    const mockResponse = mockStreamingResponses[responseIndex % mockStreamingResponses.length]
    responseIndex++

    // Start async streaming (don't await - returns immediately like real IPC)
    ;(async () => {
      try {
        // Small delay before starting
        await sleep(300)

        // Optionally simulate a tool call first
        if (mockResponse.includeToolCall && mockResponse.toolName) {
          await simulateToolCall(
            sessionId,
            mockResponse.toolName,
            mockResponse.toolInput,
            mockResponse.toolResult || 'Success'
          )
          await sleep(200)
        }

        // Stream the response text
        await simulateStreaming(sessionId, mockResponse.text)

        // Mark complete
        eventCallback?.({ type: 'complete', sessionId })
      } catch (error) {
        eventCallback?.({
          type: 'error',
          sessionId,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
        eventCallback?.({ type: 'complete', sessionId })
      }
    })()
  },

  async cancelProcessing(sessionId: string): Promise<void> {
    // In a real implementation, this would abort the stream
    // For mock, we just send complete
    eventCallback?.({ type: 'complete', sessionId })
  },

  // ===== Workspace Management =====

  async getWorkspaces() {
    await sleep(100)
    return [...mockWorkspaces]
  },

  // ===== Window Management =====

  async getWindowWorkspace(): Promise<string | null> {
    // Read workspaceId from URL query params (same as Electron)
    const params = new URLSearchParams(window.location.search)
    const workspaceId = params.get('workspaceId')
    console.log('[Mock] getWindowWorkspace:', workspaceId)
    return workspaceId
  },

  async openWorkspace(workspaceId: string): Promise<void> {
    console.log('[Mock] openWorkspace called:', workspaceId)
    // In browser dev mode, we can't open a new Electron window
    // Just update the URL and reload (simulates opening a new window)
    window.location.href = `${window.location.pathname}?workspaceId=${encodeURIComponent(workspaceId)}`
  },

  async getWindowMode(): Promise<string | null> {
    // Read mode from URL query params
    const params = new URLSearchParams(window.location.search)
    const mode = params.get('mode')
    console.log('[Mock] getWindowMode:', mode)
    return mode
  },

  async openAddWorkspaceWindow(): Promise<void> {
    console.log('[Mock] openAddWorkspaceWindow called')
    // In browser dev mode, simulate opening add workspace by updating URL
    window.location.href = `${window.location.pathname}?mode=add-workspace`
  },

  async closeWindow(): Promise<void> {
    console.log('[Mock] closeWindow called')
    // In browser dev mode, we can't close the window
    // Navigate back to the main view
    window.location.href = `${window.location.pathname}?workspaceId=ws-personal`
  },

  // ===== Agent Management =====

  async getAgents(_workspaceId: string) {
    await sleep(150)
    return [...mockAgents]
  },

  async refreshAgents(_workspaceId: string) {
    await sleep(300) // Longer delay for "refresh"
    return [...mockAgents]
  },

  async checkAgentAuth(_workspaceId: string, _agentId: string) {
    await sleep(100)
    // Mock: assume agents don't need auth for testing
    return { needsAuth: false }
  },

  async getAgentSetupStatus(_workspaceId: string, _agentId: string) {
    await sleep(100)
    // Mock: assume agents are already set up
    return { needsSetup: false, needsAuth: false }
  },

  async getAgentAuthStatus(_workspaceId: string, _agentId: string) {
    await sleep(100)
    // Mock: return mock auth status
    return {
      mcpServers: [
        { name: 'Mock MCP', url: 'https://mcp.example.com', requiresAuth: true, hasAuth: true }
      ],
      apis: []
    }
  },

  async getAgentDefinition(_workspaceId: string, agentId: string) {
    await sleep(300)
    // Mock: return a fake agent definition
    const agent = mockAgents.find(a => a.id === agentId)
    if (!agent) return null
    return {
      name: agent.name,
      instructions: `This is a mock agent for ${agent.name}`,
      mcpServers: [],
      apis: [],
      capabilities: ['Mock capability 1', 'Mock capability 2'],
      info: ['This is a mock agent for testing purposes'],
      rawContent: '',
      parsedAt: Date.now(),
    }
  },

  async reloadAgent(_workspaceId: string, _agentId: string) {
    await sleep(500)
    console.log('[Mock] Reload agent called')
    return true
  },

  async resetAgent(_workspaceId: string, _agentId: string) {
    await sleep(500)
    console.log('[Mock] Reset agent called')
    return true
  },

  // ===== Agent Authentication =====

  async getAgentAuthRequirements(_workspaceId: string, _agentId: string) {
    await sleep(200)
    console.log('[Mock] getAgentAuthRequirements called')
    // Mock: return empty arrays (no auth needed)
    return { mcpServers: [], apis: [] }
  },

  async startMcpOAuth(_workspaceId: string, _agentId: string, _serverUrl: string, serverName: string) {
    await sleep(1000)
    console.log('[Mock] startMcpOAuth called for:', serverName)
    // Mock: simulate successful OAuth
    return { success: true }
  },

  async saveMcpBearer(_workspaceId: string, _agentId: string, serverName: string, _token: string) {
    await sleep(200)
    console.log('[Mock] saveMcpBearer called for:', serverName)
  },

  async saveApiCredentials(_workspaceId: string, _agentId: string, apiName: string, _credential: string) {
    await sleep(200)
    console.log('[Mock] saveApiCredentials called for:', apiName)
  },

  async validateMcpConnection(_serverUrl: string, _accessToken?: string) {
    await sleep(300)
    console.log('[Mock] validateMcpConnection called')
    // Mock: return success
    return { success: true, tools: ['mock_tool_1', 'mock_tool_2'] }
  },

  // ===== Event Listeners =====

  onSessionEvent(callback: (event: SessionEvent) => void): () => void {
    eventCallback = callback

    // Return cleanup function
    return () => {
      eventCallback = null
    }
  },

  onAgentAuthChanged(_callback: (workspaceId: string, agentId: string) => void): () => void {
    // Mock: no-op - auth changes won't happen in browser mock mode
    return () => {}
  },

  onAgentStatusChanged(_callback: (workspaceId: string, agentId: string, status: import('../../shared/types').AgentStatus) => void): () => void {
    // Mock: no-op - status changes won't happen in browser mock mode
    return () => {}
  },

  // ===== File Operations =====

  async openFileDialog(): Promise<string[]> {
    // Mock: return empty array (user cancelled) - can't open real file dialog in browser
    console.log('[Mock] openFileDialog called - returning empty array (browser mode)')
    return []
  },

  async readFileAttachment(path: string): Promise<FileAttachment | null> {
    await sleep(100)
    // Mock: return a fake text file attachment
    console.log('[Mock] readFileAttachment called for:', path)
    return {
      type: 'text',
      path,
      name: path.split('/').pop() || 'mock-file.txt',
      mimeType: 'text/plain',
      text: 'Mock file content for browser development mode.',
      size: 50,
    }
  },

  async readFile(path: string): Promise<string> {
    await sleep(200)

    // Return mock markdown content
    return `# Mock File Content

**Path:** \`${path}\`

This is placeholder content for the file viewer. In browser development mode, actual file reading is not available.

## Sample Content

- Item one
- Item two
- Item three

\`\`\`typescript
const example = "code block";
console.log(example);
\`\`\`

> This is a blockquote to test markdown rendering.
`
  },

  async storeAttachment(_sessionId: string, attachment: FileAttachment): Promise<StoredAttachment> {
    await sleep(100)
    // Mock: return a fake StoredAttachment without actually storing anything
    console.log('[Mock] storeAttachment called for:', attachment.name)
    const mockId = `mock-${Date.now()}`
    return {
      id: mockId,
      type: attachment.type,
      name: attachment.name,
      mimeType: attachment.mimeType,
      size: attachment.size,
      storedPath: `/mock/attachments/${mockId}_${attachment.name}`,
      thumbnailPath: attachment.type === 'image' ? `/mock/attachments/${mockId}_thumb.png` : undefined,
      markdownPath: attachment.type === 'office' ? `/mock/attachments/${mockId}_${attachment.name}.md` : undefined,
    }
  },

  async generateThumbnail(_base64: string, _mimeType: string): Promise<string | null> {
    await sleep(100)
    // Mock: return null (no thumbnail generated in browser mode)
    console.log('[Mock] generateThumbnail called - returning null (browser mode)')
    return null
  },

  // ===== Theme =====

  async getSystemTheme(): Promise<boolean> {
    // Use browser's media query to detect system preference
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  },

  onSystemThemeChange(callback: (isDark: boolean) => void): () => void {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => callback(e.matches)

    mediaQuery.addEventListener('change', handler)
    return () => mediaQuery.removeEventListener('change', handler)
  },

  // ===== System =====

  getVersions() {
    return {
      node: '20.0.0',
      chrome: '120.0.0',
      electron: 'browser-mock',
    }
  },

  // ===== Shell Operations =====

  async openUrl(url: string): Promise<void> {
    console.log('[Mock] Opening URL:', url)
    // In browser dev mode, open in new tab
    window.open(url, '_blank', 'noopener,noreferrer')
  },

  async openFile(path: string): Promise<void> {
    console.log('[Mock] Opening file:', path)
    // In browser dev mode, we can't open local files
    // Just log a message
    alert(`[Dev Mode] Would open file:\n${path}`)
  },

  async showInFolder(path: string): Promise<void> {
    console.log('[Mock] Show in folder:', path)
    // In browser dev mode, we can't open local folders
    // Just log a message
    alert(`[Dev Mode] Would show in Finder:\n${path}`)
  },

  // ===== Permission Response =====

  async respondToPermission(_sessionId: string, _requestId: string, _allowed: boolean, _alwaysAllow: boolean): Promise<boolean> {
    console.log('[Mock] respondToPermission called')
    return true
  },

  // ===== Agent State Management (agent-scoped) =====

  async getAgentStatus(_workspaceId: string, _agentId: string): Promise<import('../../shared/types').AgentStatus> {
    await sleep(100)
    return { status: 'idle' }
  },

  async activateAgent(_workspaceId: string, agentId: string, _options?: import('../../shared/types').AgentActivateOptions): Promise<import('../../shared/types').AgentStatus> {
    await sleep(300)
    console.log('[Mock] activateAgent called for:', agentId)
    // Return a mock 'active' status with required fields
    return {
      status: 'active',
      agentId,
      agentName: 'Mock Agent',
      definition: {
        name: 'Mock Agent',
        instructions: 'Mock instructions',
        mcpServers: [],
        apis: [],
        capabilities: [],
        info: [],
        rawContent: '',
        parsedAt: Date.now(),
      }
    }
  },

  async continueAfterMcpAuth(_workspaceId: string, _agentId: string): Promise<import('../../shared/types').AgentStatus> {
    await sleep(200)
    console.log('[Mock] continueAfterMcpAuth called')
    return { status: 'idle' }
  },

  async continueAfterApiAuth(_workspaceId: string, _agentId: string): Promise<import('../../shared/types').AgentStatus> {
    await sleep(200)
    console.log('[Mock] continueAfterApiAuth called')
    return { status: 'idle' }
  },

  async deactivateAgent(_workspaceId: string, _agentId: string): Promise<void> {
    console.log('[Mock] deactivateAgent called')
  },

  async reloadAgentState(_workspaceId: string, _agentId: string): Promise<import('../../shared/types').AgentStatus> {
    await sleep(300)
    console.log('[Mock] reloadAgentState called')
    return { status: 'idle' }
  },

  async resetAgentState(_workspaceId: string, _agentId: string): Promise<void> {
    console.log('[Mock] resetAgentState called')
  },

  async markAgentActive(_workspaceId: string, _agentId: string): Promise<void> {
    console.log('[Mock] markAgentActive called')
  },

  // ===== Menu Event Listeners =====

  onMenuNewChat(callback: () => void): () => void {
    // Mock: no-op in browser mode
    console.log('[Mock] onMenuNewChat registered')
    return () => {}
  },

  onMenuOpenSettings(callback: () => void): () => void {
    console.log('[Mock] onMenuOpenSettings registered')
    return () => {}
  },

  onMenuKeyboardShortcuts(callback: () => void): () => void {
    console.log('[Mock] onMenuKeyboardShortcuts registered')
    return () => {}
  },

  onMenuOpenHelp(callback: () => void): () => void {
    console.log('[Mock] onMenuOpenHelp registered')
    return () => {}
  },

  // ===== Deep Link Navigation =====

  onDeepLinkNavigate(callback: (nav: import('../../shared/types').DeepLinkNavigation) => void): () => void {
    console.log('[Mock] onDeepLinkNavigate registered')
    return () => {}
  },

  // ===== Auth =====

  async showLogoutConfirmation() {
    await sleep(100)
    console.log('[Mock] showLogoutConfirmation called')
    // In mock mode, always confirm
    return true
  },

  async logout() {
    await sleep(100)
    console.log('[Mock] logout called')
    // In mock mode, just log - no actual cleanup needed
  },

  // ===== Onboarding =====

  async getAuthState() {
    await sleep(100)
    console.log('[Mock] getAuthState called')
    // Mock: return a state that requires setup
    return {
      craft: {
        hasToken: false,
        token: null,
      },
      billing: {
        type: null,
        hasCredentials: false,
        apiKey: null,
        claudeOAuthToken: null,
      },
      workspace: {
        hasWorkspace: false,
        active: null,
      },
    }
  },

  async getSetupNeeds() {
    await sleep(100)
    console.log('[Mock] getSetupNeeds called')
    // Mock: return needs that trigger onboarding
    return {
      needsCraftAuth: true,
      needsReauth: false,
      needsBillingConfig: true,
      needsCredentials: true,
      isFullyConfigured: false,
    }
  },

  async startCraftOAuth() {
    await sleep(2000) // Simulate OAuth flow
    console.log('[Mock] startCraftOAuth called')
    // Mock: return successful OAuth result
    return {
      success: true,
      token: 'mock-craft-token-12345',
      profile: {
        userId: 'mock-user-id',
        firstName: 'Test',
        lastName: 'User',
        spaces: [
          { id: 'mock-user-id', name: 'Personal Space', teamId: null, iconUrl: 'https://picsum.photos/seed/personal/200' },
          { id: 'space-work-1', name: 'Work Space', teamId: 'team-1', iconUrl: 'https://picsum.photos/seed/work/200' },
          { id: 'space-shared-1', name: 'Shared Projects', teamId: null, iconUrl: null },
        ],
        teams: [
          { id: 'team-1', name: 'Work Team', isPrivate: false, role: 'admin', tier: 'pro' },
        ],
      },
    }
  },

  async getMcpLinks(spaceId: string, _authToken: string) {
    await sleep(300)
    console.log('[Mock] getMcpLinks called for space:', spaceId)
    // Mock: return existing MCP links for the space
    return [
      {
        linkId: 'mock-link-1',
        name: 'Craft Agents MCP',
        mcpUrl: 'https://mcp.craft.do/mock-link-1',
        scope: 'fullSpace',
        enabled: true,
      },
    ]
  },

  async createMcpLink(spaceId: string, _authToken: string) {
    await sleep(500)
    console.log('[Mock] createMcpLink called for space:', spaceId)
    // Mock: return a newly created MCP link
    return {
      linkId: `mock-link-${Date.now()}`,
      name: 'Craft Agents MCP',
      mcpUrl: `https://mcp.craft.do/mock-link-${Date.now()}`,
      scope: 'fullSpace',
      enabled: true,
    }
  },

  async startWorkspaceMcpOAuth(mcpUrl: string) {
    await sleep(1500) // Simulate OAuth flow
    console.log('[Mock] startWorkspaceMcpOAuth called for:', mcpUrl)
    // Mock: return successful MCP OAuth result
    return {
      success: true,
      accessToken: 'mock-mcp-access-token-12345',
      clientId: 'mock-client-id',
    }
  },

  async saveOnboardingConfig(config: {
    authType?: import('../../shared/types').AuthType
    workspace?: { name: string; mcpUrl: string; iconUrl?: string }
    credential?: string
    mcpCredentials?: { accessToken: string; clientId?: string }
  }) {
    await sleep(300)
    console.log('[Mock] saveOnboardingConfig called:', config)
    // Mock: return successful save result
    return {
      success: true,
      workspaceId: `ws-${Date.now()}`,
    }
  },

  // Claude OAuth
  async getExistingClaudeToken() {
    await sleep(100)
    console.log('[Mock] getExistingClaudeToken called')
    // Mock: return a fake existing token (simulates finding one in keychain)
    return 'mock-claude-oauth-token-12345'
  },

  async isClaudeCliInstalled() {
    await sleep(100)
    console.log('[Mock] isClaudeCliInstalled called')
    // Mock: simulate Claude CLI being installed
    return true
  },

  async runClaudeSetupToken() {
    await sleep(2000) // Simulate OAuth flow
    console.log('[Mock] runClaudeSetupToken called')
    // Mock: return successful OAuth result
    return {
      success: true,
      token: 'mock-claude-oauth-token-from-setup-12345',
    }
  },

  async getCraftProfile() {
    await sleep(200)
    console.log('[Mock] getCraftProfile called')
    // Mock: return profile using "stored" token
    return {
      success: true,
      token: 'mock-craft-token-12345',
      profile: {
        userId: 'mock-user-id',
        firstName: 'Test',
        lastName: 'User',
        spaces: [
          { id: 'mock-user-id', name: 'Personal Space', teamId: null, iconUrl: 'https://picsum.photos/seed/personal/200' },
          { id: 'space-work-1', name: 'Work Space', teamId: 'team-1', iconUrl: 'https://picsum.photos/seed/work/200' },
          { id: 'space-shared-1', name: 'Shared Projects', teamId: null, iconUrl: null },
        ],
        teams: [
          { id: 'team-1', name: 'Work Team', isPrivate: false, role: 'admin', tier: 'pro' },
        ],
      },
    }
  },

  async getBillingMethod() {
    await sleep(100)
    console.log('[Mock] getBillingMethod called')
    // Mock: return current billing method
    return {
      authType: 'craft_credits' as const,
      hasCredential: true,
    }
  },

  async updateBillingMethod(authType: import('../../shared/types').AuthType, credential?: string) {
    await sleep(200)
    console.log('[Mock] updateBillingMethod called:', authType, credential ? '(with credential)' : '(no credential)')
    // Mock: just log, no actual update
  },

  async getCreditsUrl() {
    await sleep(300)
    console.log('[Mock] getCreditsUrl called')
    // Mock: return a fake URL
    return 'https://docs.craft.do/assistant-topup?token=mock-token'
  },

  // ===== Model Settings =====

  async getModel() {
    await sleep(50)
    console.log('[Mock] getModel called')
    // Mock: return stored model from localStorage or null
    return localStorage.getItem('craft-agent-model')
  },

  async setModel(model: string) {
    await sleep(50)
    console.log('[Mock] setModel called:', model)
    // Mock: store in localStorage for persistence in browser dev mode
    localStorage.setItem('craft-agent-model', model)
  },

  // ===== User Preferences =====

  async readPreferences() {
    await sleep(100)
    console.log('[Mock] readPreferences called')
    // Mock: return default empty preferences
    return { content: '{}', exists: false }
  },

  async writePreferences(content: string) {
    await sleep(100)
    console.log('[Mock] writePreferences called:', content.slice(0, 100))
    // Mock: just log, no actual write
    return { success: true }
  },

  // ===== Preview Window =====

  async openPreview(sessionId: string, messageId: string, content: string): Promise<void> {
    console.log('[Mock] openPreview called:', { sessionId, messageId, contentLength: content.length })
    // In browser dev mode, open in a new tab/window with content stored in sessionStorage
    const key = `preview:${sessionId}:${messageId}`
    sessionStorage.setItem(key, content)
    window.open(`/preview.html?sessionId=${encodeURIComponent(sessionId)}&messageId=${encodeURIComponent(messageId)}`, '_blank')
  },

  async getPreviewContent(sessionId: string, messageId: string): Promise<string> {
    await sleep(100)
    console.log('[Mock] getPreviewContent called:', { sessionId, messageId })
    // In browser dev mode, get from sessionStorage
    const key = `preview:${sessionId}:${messageId}`
    const content = sessionStorage.getItem(key)
    if (content) {
      return content
    }
    // Return mock content if not found
    return `# Preview Content\n\nThis is mock preview content for message **${messageId}** in session **${sessionId}**.\n\n## Features\n\n- Table of Contents\n- Markdown editing\n- Syntax highlighting\n\n\`\`\`typescript\nconst hello = "world";\nconsole.log(hello);\n\`\`\`\n`
  },

  async savePreview(sessionId: string, messageId: string, content: string): Promise<void> {
    await sleep(200)
    console.log('[Mock] savePreview called:', { sessionId, messageId, contentLength: content.length })
    // In browser dev mode, update sessionStorage and find the original message
    const key = `preview:${sessionId}:${messageId}`
    sessionStorage.setItem(key, content)
    // Also update the mock session message if it exists
    const session = sessions.find(s => s.id === sessionId)
    if (session) {
      const message = session.messages.find(m => m.id === messageId)
      if (message) {
        message.content = content
      }
    }
  },

  onMessageUpdated(callback: (sessionId: string, messageId: string, content: string) => void): () => void {
    console.log('[Mock] onMessageUpdated registered')
    // Mock: no-op in browser mode - we could implement a BroadcastChannel for cross-tab sync
    return () => {}
  },

  // ===== Session Drafts =====

  async getDraft(sessionId: string): Promise<string | null> {
    // Mock: get from localStorage
    return localStorage.getItem(`draft:${sessionId}`)
  },

  async setDraft(sessionId: string, text: string): Promise<void> {
    // Mock: save to localStorage
    if (text) {
      localStorage.setItem(`draft:${sessionId}`, text)
    } else {
      localStorage.removeItem(`draft:${sessionId}`)
    }
  },

  async deleteDraft(sessionId: string): Promise<void> {
    localStorage.removeItem(`draft:${sessionId}`)
  },

  async getAllDrafts(): Promise<Record<string, string>> {
    // Mock: get all drafts from localStorage
    const drafts: Record<string, string> = {}
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith('draft:')) {
        const sessionId = key.replace('draft:', '')
        const value = localStorage.getItem(key)
        if (value) {
          drafts[sessionId] = value
        }
      }
    }
    return drafts
  },
}
