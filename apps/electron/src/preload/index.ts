import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type SessionEvent, type ElectronAPI, type FileAttachment, type AgentActivateOptions, type AuthType } from '../shared/types'

const api: ElectronAPI = {
  // Session management
  getSessions: () => ipcRenderer.invoke(IPC_CHANNELS.GET_SESSIONS),
  createSession: (workspaceId: string, agentId?: string, agentName?: string) => ipcRenderer.invoke(IPC_CHANNELS.CREATE_SESSION, workspaceId, agentId, agentName),
  deleteSession: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.DELETE_SESSION, sessionId),
  renameSession: (sessionId: string, name: string) => ipcRenderer.invoke(IPC_CHANNELS.RENAME_SESSION, sessionId, name),
  sendMessage: (sessionId: string, message: string, attachments?: FileAttachment[], storedAttachments?: import('../shared/types').StoredAttachment[]) => ipcRenderer.invoke(IPC_CHANNELS.SEND_MESSAGE, sessionId, message, attachments, storedAttachments),
  cancelProcessing: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.CANCEL_PROCESSING, sessionId),
  archiveSession: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.ARCHIVE_SESSION, sessionId),
  unarchiveSession: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.UNARCHIVE_SESSION, sessionId),
  respondToPermission: (sessionId: string, requestId: string, allowed: boolean, alwaysAllow: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.RESPOND_TO_PERMISSION, sessionId, requestId, allowed, alwaysAllow),

  // Workspace management
  getWorkspaces: () => ipcRenderer.invoke(IPC_CHANNELS.GET_WORKSPACES),

  // Agent management
  getAgents: (workspaceId: string) => ipcRenderer.invoke(IPC_CHANNELS.GET_AGENTS, workspaceId),
  refreshAgents: (workspaceId: string) => ipcRenderer.invoke(IPC_CHANNELS.REFRESH_AGENTS, workspaceId),
  checkAgentAuth: (workspaceId: string, agentId: string) => ipcRenderer.invoke(IPC_CHANNELS.CHECK_AGENT_AUTH, workspaceId, agentId),
  getAgentSetupStatus: (workspaceId: string, agentId: string) => ipcRenderer.invoke(IPC_CHANNELS.GET_AGENT_SETUP_STATUS, workspaceId, agentId),
  getAgentAuthStatus: (workspaceId: string, agentId: string) => ipcRenderer.invoke(IPC_CHANNELS.GET_AGENT_AUTH_STATUS, workspaceId, agentId),
  getAgentDefinition: (workspaceId: string, agentId: string) => ipcRenderer.invoke(IPC_CHANNELS.GET_AGENT_DEFINITION, workspaceId, agentId),
  reloadAgent: (workspaceId: string, agentId: string) => ipcRenderer.invoke(IPC_CHANNELS.RELOAD_AGENT, workspaceId, agentId),
  resetAgent: (workspaceId: string, agentId: string) => ipcRenderer.invoke(IPC_CHANNELS.RESET_AGENT, workspaceId, agentId),

  // Agent authentication
  getAgentAuthRequirements: (workspaceId: string, agentId: string) => ipcRenderer.invoke(IPC_CHANNELS.GET_AGENT_AUTH_REQUIREMENTS, workspaceId, agentId),
  startMcpOAuth: (workspaceId: string, agentId: string, serverUrl: string, serverName: string) => ipcRenderer.invoke(IPC_CHANNELS.START_MCP_OAUTH, workspaceId, agentId, serverUrl, serverName),
  saveMcpBearer: (workspaceId: string, agentId: string, serverName: string, token: string) => ipcRenderer.invoke(IPC_CHANNELS.SAVE_MCP_BEARER, workspaceId, agentId, serverName, token),
  saveApiCredentials: (workspaceId: string, agentId: string, apiName: string, credential: string) => ipcRenderer.invoke(IPC_CHANNELS.SAVE_API_CREDENTIALS, workspaceId, agentId, apiName, credential),
  validateMcpConnection: (serverUrl: string, accessToken?: string) => ipcRenderer.invoke(IPC_CHANNELS.VALIDATE_MCP_CONNECTION, serverUrl, accessToken),

  // Agent state management (unified state machine)
  getAgentStatus: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.AGENT_GET_STATUS, sessionId),
  activateAgent: (sessionId: string, agentId: string, options?: AgentActivateOptions) => ipcRenderer.invoke(IPC_CHANNELS.AGENT_ACTIVATE, sessionId, agentId, options),
  continueAfterReview: (sessionId: string, answers: Record<string, string>) => ipcRenderer.invoke(IPC_CHANNELS.AGENT_CONTINUE_REVIEW, sessionId, answers),
  continueAfterMcpAuth: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.AGENT_CONTINUE_MCP_AUTH, sessionId),
  continueAfterApiAuth: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.AGENT_CONTINUE_API_AUTH, sessionId),
  deactivateAgent: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.AGENT_DEACTIVATE, sessionId),
  reloadAgentState: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.AGENT_RELOAD, sessionId),
  resetAgentState: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.AGENT_RESET, sessionId),
  markAgentActive: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.AGENT_MARK_ACTIVE, sessionId),

  // Event listener
  onSessionEvent: (callback: (event: SessionEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, sessionEvent: SessionEvent) => {
      callback(sessionEvent)
    }
    ipcRenderer.on(IPC_CHANNELS.SESSION_EVENT, handler)
    // Return cleanup function
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.SESSION_EVENT, handler)
    }
  },

  // File operations
  readFile: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.READ_FILE, path),
  openFileDialog: () => ipcRenderer.invoke(IPC_CHANNELS.OPEN_FILE_DIALOG),
  readFileAttachment: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.READ_FILE_ATTACHMENT, path),
  storeAttachment: (sessionId: string, attachment: FileAttachment) => ipcRenderer.invoke(IPC_CHANNELS.STORE_ATTACHMENT, sessionId, attachment),
  generateThumbnail: (base64: string, mimeType: string) => ipcRenderer.invoke(IPC_CHANNELS.GENERATE_THUMBNAIL, base64, mimeType),

  // Theme
  getSystemTheme: () => ipcRenderer.invoke(IPC_CHANNELS.GET_SYSTEM_THEME),
  onSystemThemeChange: (callback: (isDark: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, isDark: boolean) => {
      callback(isDark)
    }
    ipcRenderer.on(IPC_CHANNELS.SYSTEM_THEME_CHANGED, handler)
    // Return cleanup function
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.SYSTEM_THEME_CHANGED, handler)
    }
  },

  // System
  getVersions: () => ({
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron
  }),

  // Shell operations
  openUrl: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.OPEN_URL, url),
  openFile: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.OPEN_FILE, path),

  // Menu event listeners
  onMenuNewChat: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on(IPC_CHANNELS.MENU_NEW_CHAT, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.MENU_NEW_CHAT, handler)
  },
  onMenuOpenSettings: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on(IPC_CHANNELS.MENU_OPEN_SETTINGS, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.MENU_OPEN_SETTINGS, handler)
  },
  onMenuKeyboardShortcuts: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on(IPC_CHANNELS.MENU_KEYBOARD_SHORTCUTS, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.MENU_KEYBOARD_SHORTCUTS, handler)
  },
  onMenuOpenHelp: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on(IPC_CHANNELS.MENU_OPEN_HELP, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.MENU_OPEN_HELP, handler)
  },

  // Auth
  showLogoutConfirmation: () => ipcRenderer.invoke(IPC_CHANNELS.SHOW_LOGOUT_CONFIRMATION),
  logout: () => ipcRenderer.invoke(IPC_CHANNELS.LOGOUT),

  // Onboarding
  getAuthState: () => ipcRenderer.invoke(IPC_CHANNELS.ONBOARDING_GET_AUTH_STATE).then(r => r.authState),
  getSetupNeeds: () => ipcRenderer.invoke(IPC_CHANNELS.ONBOARDING_GET_AUTH_STATE).then(r => r.setupNeeds),
  startCraftOAuth: () => ipcRenderer.invoke(IPC_CHANNELS.ONBOARDING_START_CRAFT_OAUTH),
  getCraftProfile: () => ipcRenderer.invoke(IPC_CHANNELS.ONBOARDING_GET_CRAFT_PROFILE),
  getMcpLinks: (spaceId: string, authToken: string) => ipcRenderer.invoke(IPC_CHANNELS.ONBOARDING_GET_MCP_LINKS, spaceId, authToken),
  createMcpLink: (spaceId: string, authToken: string) => ipcRenderer.invoke(IPC_CHANNELS.ONBOARDING_CREATE_MCP_LINK, spaceId, authToken),
  startWorkspaceMcpOAuth: (mcpUrl: string) => ipcRenderer.invoke(IPC_CHANNELS.ONBOARDING_START_MCP_OAUTH, mcpUrl),
  saveOnboardingConfig: (config: {
    authType: AuthType
    workspace: { name: string; mcpUrl: string }
    credential?: string
    mcpCredentials?: { accessToken: string; clientId?: string }
  }) => ipcRenderer.invoke(IPC_CHANNELS.ONBOARDING_SAVE_CONFIG, config),
  // Claude OAuth
  getExistingClaudeToken: () => ipcRenderer.invoke(IPC_CHANNELS.ONBOARDING_GET_EXISTING_CLAUDE_TOKEN),
  isClaudeCliInstalled: () => ipcRenderer.invoke(IPC_CHANNELS.ONBOARDING_IS_CLAUDE_CLI_INSTALLED),
  runClaudeSetupToken: () => ipcRenderer.invoke(IPC_CHANNELS.ONBOARDING_RUN_CLAUDE_SETUP_TOKEN),

  // Settings - Billing
  getBillingMethod: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET_BILLING_METHOD),
  updateBillingMethod: (authType: AuthType, credential?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_UPDATE_BILLING_METHOD, authType, credential),
}

contextBridge.exposeInMainWorld('electronAPI', api)
