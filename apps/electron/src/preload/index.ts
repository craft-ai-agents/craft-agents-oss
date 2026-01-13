import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type SessionEvent, type ElectronAPI, type FileAttachment, type AuthType } from '../shared/types'

const api: ElectronAPI = {
  // Session management
  getSessions: () => ipcRenderer.invoke(IPC_CHANNELS.GET_SESSIONS),
  getSessionMessages: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.GET_SESSION_MESSAGES, sessionId),
  createSession: (workspaceId: string, options?: import('../shared/types').CreateSessionOptions) => ipcRenderer.invoke(IPC_CHANNELS.CREATE_SESSION, workspaceId, options),
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
  openSessionInNewWindow: (workspaceId: string, sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.OPEN_SESSION_IN_NEW_WINDOW, workspaceId, sessionId),
  switchWorkspace: (workspaceId: string) => ipcRenderer.invoke(IPC_CHANNELS.SWITCH_WORKSPACE, workspaceId),
  closeWindow: () => ipcRenderer.invoke(IPC_CHANNELS.CLOSE_WINDOW),

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
  isDebugMode: () => ipcRenderer.invoke(IPC_CHANNELS.IS_DEBUG_MODE),

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

  // Deep link navigation listener (for external craftagents:// URLs)
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

  // Folder dialog
  openFolderDialog: () => ipcRenderer.invoke(IPC_CHANNELS.OPEN_FOLDER_DIALOG),

  // User Preferences
  readPreferences: () => ipcRenderer.invoke(IPC_CHANNELS.PREFERENCES_READ),
  writePreferences: (content: string) => ipcRenderer.invoke(IPC_CHANNELS.PREFERENCES_WRITE, content),

  // Unified preview window (all modes: markdown, view, diff, multi-diff, terminal)
  openPreview: (data: import('../shared/types').PreviewData) =>
    ipcRenderer.invoke(IPC_CHANNELS.PREVIEW_OPEN, data),
  getPreviewData: (sessionId: string, previewId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.PREVIEW_GET_DATA, sessionId, previewId),
  savePreview: (sessionId: string, previewId: string, content: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.PREVIEW_SAVE, sessionId, previewId, content),
  onPreviewFileSaved: (callback: (data: { filePath: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { filePath: string }) => {
      callback(data)
    }
    ipcRenderer.on(IPC_CHANNELS.PREVIEW_FILE_SAVED, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.PREVIEW_FILE_SAVED, handler)
  },
  readFileForPreview: (filePath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.PREVIEW_READ_FILE, filePath),

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

  // Skills
  getSkills: (workspaceId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SKILLS_GET, workspaceId),
  getSkillFiles: (workspaceId: string, skillSlug: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SKILLS_GET_FILES, workspaceId, skillSlug),
  deleteSkill: (workspaceId: string, skillSlug: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SKILLS_DELETE, workspaceId, skillSlug),
  openSkillInEditor: (workspaceId: string, skillSlug: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SKILLS_OPEN_EDITOR, workspaceId, skillSlug),
  openSkillInFinder: (workspaceId: string, skillSlug: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SKILLS_OPEN_FINDER, workspaceId, skillSlug),

  // Skills change listener (live updates when skills are added/removed/modified)
  onSkillsChanged: (callback: (skills: import('@craft-agent/shared/skills').LoadedSkill[]) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, skills: import('@craft-agent/shared/skills').LoadedSkill[]) => {
      callback(skills)
    }
    ipcRenderer.on(IPC_CHANNELS.SKILLS_CHANGED, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.SKILLS_CHANGED, handler)
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

  // Theme (cascading: app → workspace)
  getAppTheme: () => ipcRenderer.invoke(IPC_CHANNELS.THEME_GET_APP),
  getWorkspaceTheme: (workspaceId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.THEME_GET_WORKSPACE, workspaceId),
  // Preset themes
  loadPresetThemes: () => ipcRenderer.invoke(IPC_CHANNELS.THEME_GET_PRESETS),
  loadPresetTheme: (themeId: string) => ipcRenderer.invoke(IPC_CHANNELS.THEME_LOAD_PRESET, themeId),
  getColorTheme: () => ipcRenderer.invoke(IPC_CHANNELS.THEME_GET_COLOR_THEME),
  setColorTheme: (themeId: string) => ipcRenderer.invoke(IPC_CHANNELS.THEME_SET_COLOR_THEME, themeId),

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
  // Theme preferences sync across windows (mode, colorTheme, font)
  broadcastThemePreferences: (preferences: { mode: string; colorTheme: string; font: string }) =>
    ipcRenderer.invoke(IPC_CHANNELS.THEME_BROADCAST_PREFERENCES, preferences),
  onThemePreferencesChange: (callback: (preferences: { mode: string; colorTheme: string; font: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, preferences: { mode: string; colorTheme: string; font: string }) => {
      callback(preferences)
    }
    ipcRenderer.on(IPC_CHANNELS.THEME_PREFERENCES_CHANGED, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.THEME_PREFERENCES_CHANGED, handler)
    }
  },

  // Notifications
  showNotification: (title: string, body: string, workspaceId: string, sessionId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.NOTIFICATION_SHOW, title, body, workspaceId, sessionId),
  getNotificationsEnabled: () =>
    ipcRenderer.invoke(IPC_CHANNELS.NOTIFICATION_GET_ENABLED) as Promise<boolean>,
  setNotificationsEnabled: (enabled: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.NOTIFICATION_SET_ENABLED, enabled),
  // Mode cycling
  getEnabledPermissionModes: () =>
    ipcRenderer.invoke(IPC_CHANNELS.MODE_CYCLING_GET_ENABLED) as Promise<('safe' | 'ask' | 'allow-all')[]>,
  setEnabledPermissionModes: (modes: ('safe' | 'ask' | 'allow-all')[]) =>
    ipcRenderer.invoke(IPC_CHANNELS.MODE_CYCLING_SET_ENABLED, modes),
  updateBadgeCount: (count: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.BADGE_UPDATE, count),
  clearBadgeCount: () =>
    ipcRenderer.invoke(IPC_CHANNELS.BADGE_CLEAR),
  setDockIconWithBadge: (dataUrl: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.BADGE_SET_ICON, dataUrl),
  onBadgeDraw: (callback: (data: { count: number; iconDataUrl: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { count: number; iconDataUrl: string }) => {
      callback(data)
    }
    ipcRenderer.on(IPC_CHANNELS.BADGE_DRAW, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.BADGE_DRAW, handler)
    }
  },
  getWindowFocusState: () =>
    ipcRenderer.invoke(IPC_CHANNELS.WINDOW_GET_FOCUS_STATE),
  onWindowFocusChange: (callback: (isFocused: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, isFocused: boolean) => {
      callback(isFocused)
    }
    ipcRenderer.on(IPC_CHANNELS.WINDOW_FOCUS_STATE, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.WINDOW_FOCUS_STATE, handler)
    }
  },
  onNotificationNavigate: (callback: (data: { workspaceId: string; sessionId: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { workspaceId: string; sessionId: string }) => {
      callback(data)
    }
    ipcRenderer.on(IPC_CHANNELS.NOTIFICATION_NAVIGATE, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.NOTIFICATION_NAVIGATE, handler)
    }
  },
}

contextBridge.exposeInMainWorld('electronAPI', api)
