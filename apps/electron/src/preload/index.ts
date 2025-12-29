import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type SessionEvent, type ElectronAPI, type FileAttachment, type AgentActivateOptions, type AuthType } from '../shared/types'

const api: ElectronAPI = {
  // Session management
  getSessions: () => ipcRenderer.invoke(IPC_CHANNELS.GET_SESSIONS),
  createSession: (workspaceId: string, agentId?: string, agentName?: string) => ipcRenderer.invoke(IPC_CHANNELS.CREATE_SESSION, workspaceId, agentId, agentName),
  deleteSession: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.DELETE_SESSION, sessionId),
  renameSession: (sessionId: string, name: string) => ipcRenderer.invoke(IPC_CHANNELS.RENAME_SESSION, sessionId, name),
  sendMessage: (sessionId: string, message: string, attachments?: FileAttachment[], storedAttachments?: import('../shared/types').StoredAttachment[], options?: import('../shared/types').SendMessageOptions) => ipcRenderer.invoke(IPC_CHANNELS.SEND_MESSAGE, sessionId, message, attachments, storedAttachments, options),
  cancelProcessing: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.CANCEL_PROCESSING, sessionId),
  flagSession: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.FLAG_SESSION, sessionId),
  unflagSession: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.UNFLAG_SESSION, sessionId),
  setTodoState: (sessionId: string, state: import('../shared/types').TodoState) => ipcRenderer.invoke(IPC_CHANNELS.SET_TODO_STATE, sessionId, state),
  markSessionRead: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.MARK_SESSION_READ, sessionId),
  markSessionUnread: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.MARK_SESSION_UNREAD, sessionId),
  setSkipPermissions: (sessionId: string, enabled: boolean) => ipcRenderer.invoke(IPC_CHANNELS.SET_SKIP_PERMISSIONS, sessionId, enabled),
  respondToPermission: (sessionId: string, requestId: string, allowed: boolean, alwaysAllow: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.RESPOND_TO_PERMISSION, sessionId, requestId, allowed, alwaysAllow),
  respondToCredential: (sessionId: string, requestId: string, response: import('../shared/types').CredentialResponse) =>
    ipcRenderer.invoke(IPC_CHANNELS.RESPOND_TO_CREDENTIAL, sessionId, requestId, response),
  updateSessionWorkingDirectory: (sessionId: string, path: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.UPDATE_WORKING_DIRECTORY, sessionId, path),

  // Mode management (generic for any mode type)
  setMode: (sessionId: string, mode: import('../shared/types').Mode, enabled: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.SET_MODE, sessionId, mode, enabled),

  // Workspace management
  getWorkspaces: () => ipcRenderer.invoke(IPC_CHANNELS.GET_WORKSPACES),

  // Window management
  getWindowWorkspace: () => ipcRenderer.invoke(IPC_CHANNELS.GET_WINDOW_WORKSPACE),
  getWindowMode: () => ipcRenderer.invoke(IPC_CHANNELS.GET_WINDOW_MODE),
  openWorkspace: (workspaceId: string) => ipcRenderer.invoke(IPC_CHANNELS.OPEN_WORKSPACE, workspaceId),
  openAddWorkspaceWindow: () => ipcRenderer.invoke(IPC_CHANNELS.OPEN_ADD_WORKSPACE),
  closeWindow: () => ipcRenderer.invoke(IPC_CHANNELS.CLOSE_WINDOW),

  // Agent management
  getAgents: (workspaceId: string) => ipcRenderer.invoke(IPC_CHANNELS.GET_AGENTS, workspaceId),
  refreshAgents: (workspaceId: string) => ipcRenderer.invoke(IPC_CHANNELS.REFRESH_AGENTS, workspaceId),
  checkAgentAuth: (workspaceId: string, agentId: string) => ipcRenderer.invoke(IPC_CHANNELS.CHECK_AGENT_AUTH, workspaceId, agentId),
  getAgentSetupStatus: (workspaceId: string, agentId: string) => ipcRenderer.invoke(IPC_CHANNELS.GET_AGENT_SETUP_STATUS, workspaceId, agentId),
  getAgentAuthStatus: (workspaceId: string, agentId: string) => ipcRenderer.invoke(IPC_CHANNELS.GET_AGENT_AUTH_STATUS, workspaceId, agentId),
  getAgentDefinition: (workspaceId: string, agentId: string) => ipcRenderer.invoke(IPC_CHANNELS.GET_AGENT_DEFINITION, workspaceId, agentId),
  reloadAgent: (workspaceId: string, agentId: string) => ipcRenderer.invoke(IPC_CHANNELS.RELOAD_AGENT, workspaceId, agentId),
  resetAgent: (workspaceId: string, agentId: string) => ipcRenderer.invoke(IPC_CHANNELS.RESET_AGENT, workspaceId, agentId),
  ensureBuiltinAgent: (workspaceId: string, slug: string) => ipcRenderer.invoke(IPC_CHANNELS.ENSURE_BUILTIN_AGENT, workspaceId, slug),

  // Agent authentication
  getAgentAuthRequirements: (workspaceId: string, agentId: string) => ipcRenderer.invoke(IPC_CHANNELS.GET_AGENT_AUTH_REQUIREMENTS, workspaceId, agentId),
  startMcpOAuth: (workspaceId: string, agentId: string, serverUrl: string, serverName: string) => ipcRenderer.invoke(IPC_CHANNELS.START_MCP_OAUTH, workspaceId, agentId, serverUrl, serverName),
  saveMcpBearer: (workspaceId: string, agentId: string, serverName: string, token: string) => ipcRenderer.invoke(IPC_CHANNELS.SAVE_MCP_BEARER, workspaceId, agentId, serverName, token),
  saveApiCredentials: (workspaceId: string, agentId: string, apiName: string, credential: string) => ipcRenderer.invoke(IPC_CHANNELS.SAVE_API_CREDENTIALS, workspaceId, agentId, apiName, credential),
  validateMcpConnection: (serverUrl: string, accessToken?: string) => ipcRenderer.invoke(IPC_CHANNELS.VALIDATE_MCP_CONNECTION, serverUrl, accessToken),

  // Agent sync (Craft discovery)
  syncAgentsFromCraft: (workspaceId: string, options?: { documentIds?: string[]; forceUpdate?: boolean }) => ipcRenderer.invoke(IPC_CHANNELS.SYNC_AGENTS_FROM_CRAFT, workspaceId, options),
  discoverAllAgents: (workspaceId: string) => ipcRenderer.invoke(IPC_CHANNELS.DISCOVER_ALL_AGENTS, workspaceId),
  getAgentsSyncStatus: (workspaceId: string) => ipcRenderer.invoke(IPC_CHANNELS.GET_AGENTS_SYNC_STATUS, workspaceId),

  // Agent state management (unified state machine, agent-scoped)
  getAgentStatus: (workspaceId: string, agentId: string) => ipcRenderer.invoke(IPC_CHANNELS.AGENT_GET_STATUS, workspaceId, agentId),
  activateAgent: (workspaceId: string, agentId: string, options?: AgentActivateOptions) => ipcRenderer.invoke(IPC_CHANNELS.AGENT_ACTIVATE, workspaceId, agentId, options),
  continueAfterMcpAuth: (workspaceId: string, agentId: string) => ipcRenderer.invoke(IPC_CHANNELS.AGENT_CONTINUE_MCP_AUTH, workspaceId, agentId),
  continueAfterApiAuth: (workspaceId: string, agentId: string) => ipcRenderer.invoke(IPC_CHANNELS.AGENT_CONTINUE_API_AUTH, workspaceId, agentId),
  deactivateAgent: (workspaceId: string, agentId: string) => ipcRenderer.invoke(IPC_CHANNELS.AGENT_DEACTIVATE, workspaceId, agentId),
  reloadAgentState: (workspaceId: string, agentId: string) => ipcRenderer.invoke(IPC_CHANNELS.AGENT_RELOAD, workspaceId, agentId),
  resetAgentState: (workspaceId: string, agentId: string) => ipcRenderer.invoke(IPC_CHANNELS.AGENT_RESET, workspaceId, agentId),
  markAgentActive: (workspaceId: string, agentId: string) => ipcRenderer.invoke(IPC_CHANNELS.AGENT_MARK_ACTIVE, workspaceId, agentId),

  // Event listeners
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
  onAgentStatusChanged: (callback: (workspaceId: string, agentId: string, status: import('../shared/types').AgentStatus) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, workspaceId: string, agentId: string, status: import('../shared/types').AgentStatus) => {
      callback(workspaceId, agentId, status)
    }
    ipcRenderer.on(IPC_CHANNELS.AGENT_STATUS_CHANGED, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.AGENT_STATUS_CHANGED, handler)
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
  showInFolder: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.SHOW_IN_FOLDER, path),

  // Menu event listeners
  onMenuNewChat: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on(IPC_CHANNELS.MENU_NEW_CHAT, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.MENU_NEW_CHAT, handler)
  },
  onMenuNewChatTab: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on(IPC_CHANNELS.MENU_NEW_CHAT_TAB, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.MENU_NEW_CHAT_TAB, handler)
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

  // Deep link navigation listener
  onDeepLinkNavigate: (callback: (nav: import('../shared/types').DeepLinkNavigation) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, nav: import('../shared/types').DeepLinkNavigation) => {
      callback(nav)
    }
    ipcRenderer.on(IPC_CHANNELS.DEEP_LINK_NAVIGATE, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.DEEP_LINK_NAVIGATE, handler)
  },

  // Auth
  showLogoutConfirmation: () => ipcRenderer.invoke(IPC_CHANNELS.SHOW_LOGOUT_CONFIRMATION),
  showDeleteSessionConfirmation: (name: string) => ipcRenderer.invoke(IPC_CHANNELS.SHOW_DELETE_SESSION_CONFIRMATION, name),
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
    authType?: AuthType
    workspace?: { name: string; iconUrl?: string; mcpUrl?: string }
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
  getCreditsUrl: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET_CREDITS_URL),

  // Settings - Model
  getModel: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET_MODEL),
  setModel: (model: string) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET_MODEL, model),

  // Settings - New Session Defaults
  getDefaultModes: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET_DEFAULT_MODES),
  setDefaultModes: (modes: import('../shared/types').Mode[]) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET_DEFAULT_MODES, modes),
  getDefaultSkipPermissions: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET_DEFAULT_SKIP_PERMISSIONS),
  setDefaultSkipPermissions: (enabled: boolean) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET_DEFAULT_SKIP_PERMISSIONS, enabled),
  getDefaultWorkingDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET_DEFAULT_WORKING_DIR),
  setDefaultWorkingDirectory: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET_DEFAULT_WORKING_DIR, path),

  // Folder dialog
  openFolderDialog: () => ipcRenderer.invoke(IPC_CHANNELS.OPEN_FOLDER_DIALOG),

  // User Preferences
  readPreferences: () => ipcRenderer.invoke(IPC_CHANNELS.PREFERENCES_READ),
  writePreferences: (content: string) => ipcRenderer.invoke(IPC_CHANNELS.PREFERENCES_WRITE, content),

  // Markdown preview window
  openMarkdownPreview: (previewId: string, data: import('../shared/types').MarkdownPreviewData) =>
    ipcRenderer.invoke(IPC_CHANNELS.MARKDOWN_PREVIEW_OPEN, previewId, data),
  getMarkdownPreviewData: (previewId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.MARKDOWN_PREVIEW_GET_DATA, previewId),
  saveMarkdownPreview: (previewId: string, content: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.MARKDOWN_PREVIEW_SAVE, previewId, content),

  // Diff preview window
  openDiffPreview: (sessionId: string, diffId: string, data: import('../shared/types').DiffPreviewData) =>
    ipcRenderer.invoke(IPC_CHANNELS.DIFF_PREVIEW_OPEN, sessionId, diffId, data),
  getDiffPreviewData: (sessionId: string, diffId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.DIFF_PREVIEW_GET_DATA, sessionId, diffId),

  // Code preview window (Read/Write tools)
  openCodePreview: (sessionId: string, previewId: string, data: import('../shared/types').CodePreviewData) =>
    ipcRenderer.invoke(IPC_CHANNELS.CODE_PREVIEW_OPEN, sessionId, previewId, data),
  getCodePreviewData: (sessionId: string, previewId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.CODE_PREVIEW_GET_DATA, sessionId, previewId),

  // Terminal preview window (Bash tools)
  openTerminalPreview: (sessionId: string, previewId: string, data: import('../shared/types').TerminalPreviewData) =>
    ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_PREVIEW_OPEN, sessionId, previewId, data),
  getTerminalPreviewData: (sessionId: string, previewId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_PREVIEW_GET_DATA, sessionId, previewId),

  // Session Drafts (persisted input text)
  getDraft: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.DRAFTS_GET, sessionId),
  setDraft: (sessionId: string, text: string) => ipcRenderer.invoke(IPC_CHANNELS.DRAFTS_SET, sessionId, text),
  deleteDraft: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.DRAFTS_DELETE, sessionId),
  getAllDrafts: () => ipcRenderer.invoke(IPC_CHANNELS.DRAFTS_GET_ALL),

  // Sources
  getSources: (workspaceSlug: string) => ipcRenderer.invoke(IPC_CHANNELS.SOURCES_GET, workspaceSlug),
  createSource: (workspaceSlug: string, config: Partial<import('@craft-agent/shared/sources').FolderSourceConfig>) =>
    ipcRenderer.invoke(IPC_CHANNELS.SOURCES_CREATE, workspaceSlug, config),
  deleteSource: (workspaceSlug: string, sourceSlug: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SOURCES_DELETE, workspaceSlug, sourceSlug),
  startSourceOAuth: (workspaceSlug: string, sourceSlug: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SOURCES_START_OAUTH, workspaceSlug, sourceSlug),
  saveSourceCredentials: (workspaceSlug: string, sourceSlug: string, credential: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SOURCES_SAVE_CREDENTIALS, workspaceSlug, sourceSlug, credential),
  // Agent-scoped sources
  getAgentSources: (workspaceSlug: string, agentSlug: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SOURCES_GET_AGENT, workspaceSlug, agentSlug),
  promoteSource: (workspaceSlug: string, agentSlug: string, sourceSlug: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SOURCES_PROMOTE, workspaceSlug, agentSlug, sourceSlug),

  // Session sources
  setSessionSources: (sessionId: string, sourceSlugs: string[]) =>
    ipcRenderer.invoke(IPC_CHANNELS.SESSION_SET_SOURCES, sessionId, sourceSlugs),
  getSessionSources: (sessionId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SESSION_GET_SOURCES, sessionId),

  // Sources change listener (live updates when sources are added/removed)
  onSourcesChanged: (callback: (sources: import('@craft-agent/shared/sources').LoadedSource[]) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, sources: import('@craft-agent/shared/sources').LoadedSource[]) => {
      callback(sources)
    }
    ipcRenderer.on(IPC_CHANNELS.SOURCES_CHANGED, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.SOURCES_CHANGED, handler)
    }
  },

  // Agents change listener (live updates when agents are created/synced/deleted)
  onAgentsChanged: (callback: () => void) => {
    const handler = () => {
      callback()
    }
    ipcRenderer.on(IPC_CHANNELS.AGENTS_CHANGED, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.AGENTS_CHANGED, handler)
    }
  },
}

contextBridge.exposeInMainWorld('electronAPI', api)
