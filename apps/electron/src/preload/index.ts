import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type SessionEvent, type ElectronAPI, type FileAttachment, type AgentActivateOptions, type AuthType } from '../shared/types'

const api: ElectronAPI = {
  // Session management
  getSessions: () => ipcRenderer.invoke(IPC_CHANNELS.GET_SESSIONS),
  createSession: (workspaceId: string, agentId?: string, agentName?: string) => ipcRenderer.invoke(IPC_CHANNELS.CREATE_SESSION, workspaceId, agentId, agentName),
  deleteSession: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.DELETE_SESSION, sessionId),
  sendMessage: (sessionId: string, message: string, attachments?: FileAttachment[], storedAttachments?: import('../shared/types').StoredAttachment[], options?: import('../shared/types').SendMessageOptions) => ipcRenderer.invoke(IPC_CHANNELS.SEND_MESSAGE, sessionId, message, attachments, storedAttachments, options),
  cancelProcessing: (sessionId: string, silent?: boolean) => ipcRenderer.invoke(IPC_CHANNELS.CANCEL_PROCESSING, sessionId, silent),
  killShell: (sessionId: string, shellId: string) => ipcRenderer.invoke(IPC_CHANNELS.KILL_SHELL, sessionId, shellId),
  getTaskOutput: (taskId: string) => ipcRenderer.invoke(IPC_CHANNELS.GET_TASK_OUTPUT, taskId),
  respondToPermission: (sessionId: string, requestId: string, allowed: boolean, alwaysAllow: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.RESPOND_TO_PERMISSION, sessionId, requestId, allowed, alwaysAllow),
  respondToCredential: (sessionId: string, requestId: string, response: import('../shared/types').CredentialResponse) =>
    ipcRenderer.invoke(IPC_CHANNELS.RESPOND_TO_CREDENTIAL, sessionId, requestId, response),

  // Consolidated session command handler
  sessionCommand: (sessionId: string, command: import('../shared/types').SessionCommand) =>
    ipcRenderer.invoke(IPC_CHANNELS.SESSION_COMMAND, sessionId, command),

  // Workspace management
  getWorkspaces: () => ipcRenderer.invoke(IPC_CHANNELS.GET_WORKSPACES),
  createWorkspace: (folderPath: string, name: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.CREATE_WORKSPACE, folderPath, name),

  // Window management
  getWindowWorkspace: () => ipcRenderer.invoke(IPC_CHANNELS.GET_WINDOW_WORKSPACE),
  getWindowMode: () => ipcRenderer.invoke(IPC_CHANNELS.GET_WINDOW_MODE),
  openWorkspace: (workspaceId: string) => ipcRenderer.invoke(IPC_CHANNELS.OPEN_WORKSPACE, workspaceId),
  switchWorkspace: (workspaceId: string) => ipcRenderer.invoke(IPC_CHANNELS.SWITCH_WORKSPACE, workspaceId),
  closeWindow: () => ipcRenderer.invoke(IPC_CHANNELS.CLOSE_WINDOW),

  // Agent management
  getAgents: (workspaceId: string) => ipcRenderer.invoke(IPC_CHANNELS.GET_AGENTS, workspaceId),
  refreshAgents: (workspaceId: string) => ipcRenderer.invoke(IPC_CHANNELS.REFRESH_AGENTS, workspaceId),
  checkAgentAuth: (workspaceId: string, agentId: string) => ipcRenderer.invoke(IPC_CHANNELS.CHECK_AGENT_AUTH, workspaceId, agentId),
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
  getHomeDir: () => ipcRenderer.invoke(IPC_CHANNELS.GET_HOME_DIR),

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

  // Workspace Settings (per-workspace configuration)
  getWorkspaceSettings: (workspaceId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_SETTINGS_GET, workspaceId),
  updateWorkspaceSetting: <K extends string>(workspaceId: string, key: K, value: unknown) =>
    ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_SETTINGS_UPDATE, workspaceId, key, value),
  enablePortableCredentials: (workspaceId: string, password: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_SETTINGS_ENABLE_PORTABLE, workspaceId, password),
  disablePortableCredentials: (workspaceId: string, password: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_SETTINGS_DISABLE_PORTABLE, workspaceId, password),

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
  onMarkdownFileSaved: (callback: (data: { filePath: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { filePath: string }) => {
      callback(data)
    }
    ipcRenderer.on(IPC_CHANNELS.MARKDOWN_PREVIEW_FILE_SAVED, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.MARKDOWN_PREVIEW_FILE_SAVED, handler)
  },

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

  // Multi-file diff window (all edits/writes in a turn)
  openMultiFileDiff: (sessionId: string, turnId: string, data: import('../shared/types').MultiFileDiffData) =>
    ipcRenderer.invoke(IPC_CHANNELS.MULTI_FILE_DIFF_OPEN, sessionId, turnId, data),
  getMultiFileDiffData: (sessionId: string, turnId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.MULTI_FILE_DIFF_GET_DATA, sessionId, turnId),
  readFileForDiff: (filePath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.MULTI_FILE_DIFF_READ_FILE, filePath),

  // Session Drafts (persisted input text)
  getDraft: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.DRAFTS_GET, sessionId),
  setDraft: (sessionId: string, text: string) => ipcRenderer.invoke(IPC_CHANNELS.DRAFTS_SET, sessionId, text),
  deleteDraft: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.DRAFTS_DELETE, sessionId),
  getAllDrafts: () => ipcRenderer.invoke(IPC_CHANNELS.DRAFTS_GET_ALL),

  // Sources
  getSources: (workspaceId: string) => ipcRenderer.invoke(IPC_CHANNELS.SOURCES_GET, workspaceId),
  createSource: (workspaceId: string, config: Partial<import('@craft-agent/shared/sources').FolderSourceConfig>) =>
    ipcRenderer.invoke(IPC_CHANNELS.SOURCES_CREATE, workspaceId, config),
  deleteSource: (workspaceId: string, sourceSlug: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SOURCES_DELETE, workspaceId, sourceSlug),
  startSourceOAuth: (workspaceId: string, sourceSlug: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SOURCES_START_OAUTH, workspaceId, sourceSlug),
  saveSourceCredentials: (workspaceId: string, sourceSlug: string, credential: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SOURCES_SAVE_CREDENTIALS, workspaceId, sourceSlug, credential),
  // Agent-scoped sources
  getAgentSources: (workspaceId: string, agentSlug: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SOURCES_GET_AGENT, workspaceId, agentSlug),
  promoteSource: (workspaceId: string, agentSlug: string, sourceSlug: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SOURCES_PROMOTE, workspaceId, agentSlug, sourceSlug),
  getSourcePermissionsConfig: (workspaceId: string, sourceSlug: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SOURCES_GET_PERMISSIONS, workspaceId, sourceSlug),
  getMcpTools: (workspaceId: string, sourceSlug: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SOURCES_GET_MCP_TOOLS, workspaceId, sourceSlug),

  // Status management
  listStatuses: (workspaceId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.STATUSES_LIST, workspaceId),

  // Generic workspace image loading/saving
  readWorkspaceImage: (workspaceId: string, relativePath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_READ_IMAGE, workspaceId, relativePath),
  writeWorkspaceImage: (workspaceId: string, relativePath: string, base64: string, mimeType: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_WRITE_IMAGE, workspaceId, relativePath, base64, mimeType),

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

  // Statuses change listener (live updates when statuses config or icon files change)
  onStatusesChanged: (callback: (workspaceId: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, workspaceId: string) => {
      callback(workspaceId)
    }
    ipcRenderer.on(IPC_CHANNELS.STATUSES_CHANGED, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.STATUSES_CHANGED, handler)
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

  // Theme (cascading: app → workspace → agent)
  getAppTheme: () => ipcRenderer.invoke(IPC_CHANNELS.THEME_GET_APP),
  getWorkspaceTheme: (workspaceId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.THEME_GET_WORKSPACE, workspaceId),
  getAgentTheme: (workspaceId: string, agentSlug: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.THEME_GET_AGENT, workspaceId, agentSlug),

  // Logo URL resolution (uses Node.js filesystem cache for provider domains)
  getLogoUrl: (serviceUrl: string, provider?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.LOGO_GET_URL, serviceUrl, provider),

  // Theme change listeners (live updates when theme.json files change)
  onAppThemeChange: (callback: (theme: import('@craft-agent/shared/config').ThemeOverrides | null) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, theme: import('@craft-agent/shared/config').ThemeOverrides | null) => {
      callback(theme)
    }
    ipcRenderer.on(IPC_CHANNELS.THEME_APP_CHANGED, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.THEME_APP_CHANGED, handler)
    }
  },
  onWorkspaceThemeChange: (callback: (theme: import('@craft-agent/shared/config').ThemeOverrides | null) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, theme: import('@craft-agent/shared/config').ThemeOverrides | null) => {
      callback(theme)
    }
    ipcRenderer.on(IPC_CHANNELS.THEME_WORKSPACE_CHANGED, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.THEME_WORKSPACE_CHANGED, handler)
    }
  },
  onAgentThemeChange: (callback: (agentSlug: string, theme: import('@craft-agent/shared/config').ThemeOverrides | null) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, agentSlug: string, theme: import('@craft-agent/shared/config').ThemeOverrides | null) => {
      callback(agentSlug, theme)
    }
    ipcRenderer.on(IPC_CHANNELS.THEME_AGENT_CHANGED, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.THEME_AGENT_CHANGED, handler)
    }
  },
}

contextBridge.exposeInMainWorld('electronAPI', api)
