/**
 * Channel map — maps ElectronAPI method names to IPC channels.
 *
 * Derived from preload/index.ts. This is the single source of truth for
 * the method→channel mapping used by buildClientApi().
 */

import { IPC_CHANNELS } from '../shared/types'
import type { ChannelMap } from './build-api'

function invoke(channel: string, transform?: (result: any) => any) {
  return { type: 'invoke' as const, channel, ...(transform && { transform }) }
}

function listener(channel: string) {
  return { type: 'listener' as const, channel }
}

export const CHANNEL_MAP = {
  // Session management
  getSessions: invoke(IPC_CHANNELS.sessions.GET),
  getUnreadSummary: invoke(IPC_CHANNELS.sessions.GET_UNREAD_SUMMARY),
  markAllSessionsRead: invoke(IPC_CHANNELS.sessions.MARK_ALL_READ),
  getSessionMessages: invoke(IPC_CHANNELS.sessions.GET_MESSAGES),
  createSession: invoke(IPC_CHANNELS.sessions.CREATE),
  deleteSession: invoke(IPC_CHANNELS.sessions.DELETE),
  sendMessage: invoke(IPC_CHANNELS.sessions.SEND_MESSAGE),
  cancelProcessing: invoke(IPC_CHANNELS.sessions.CANCEL),
  killShell: invoke(IPC_CHANNELS.sessions.KILL_SHELL),
  getTaskOutput: invoke(IPC_CHANNELS.tasks.GET_OUTPUT),
  respondToPermission: invoke(IPC_CHANNELS.sessions.RESPOND_TO_PERMISSION),
  respondToCredential: invoke(IPC_CHANNELS.sessions.RESPOND_TO_CREDENTIAL),
  sessionCommand: invoke(IPC_CHANNELS.sessions.COMMAND),
  getPendingPlanExecution: invoke(IPC_CHANNELS.sessions.GET_PENDING_PLAN_EXECUTION),
  getSessionPermissionModeState: invoke(IPC_CHANNELS.sessions.GET_PERMISSION_MODE_STATE),

  // Event listeners
  onSessionEvent: listener(IPC_CHANNELS.sessions.EVENT),
  onUnreadSummaryChanged: listener(IPC_CHANNELS.sessions.UNREAD_SUMMARY_CHANGED),

  // Workspace management
  getWorkspaces: invoke(IPC_CHANNELS.workspaces.GET),
  createWorkspace: invoke(IPC_CHANNELS.workspaces.CREATE),
  checkWorkspaceSlug: invoke(IPC_CHANNELS.workspaces.CHECK_SLUG),

  // Window management
  getWindowWorkspace: invoke(IPC_CHANNELS.window.GET_WORKSPACE),
  getWindowMode: invoke(IPC_CHANNELS.window.GET_MODE),
  openWorkspace: invoke(IPC_CHANNELS.window.OPEN_WORKSPACE),
  openSessionInNewWindow: invoke(IPC_CHANNELS.window.OPEN_SESSION_IN_NEW_WINDOW),
  switchWorkspace: invoke(IPC_CHANNELS.window.SWITCH_WORKSPACE),
  closeWindow: invoke(IPC_CHANNELS.window.CLOSE),
  confirmCloseWindow: invoke(IPC_CHANNELS.window.CONFIRM_CLOSE),
  cancelCloseWindow: invoke(IPC_CHANNELS.window.CANCEL_CLOSE),
  onCloseRequested: listener(IPC_CHANNELS.window.CLOSE_REQUESTED),
  setTrafficLightsVisible: invoke(IPC_CHANNELS.window.SET_TRAFFIC_LIGHTS),

  // File operations
  readFile: invoke(IPC_CHANNELS.file.READ),
  readFileDataUrl: invoke(IPC_CHANNELS.file.READ_DATA_URL),
  readFileBinary: invoke(IPC_CHANNELS.file.READ_BINARY),
  openFileDialog: invoke(IPC_CHANNELS.file.OPEN_DIALOG),
  readFileAttachment: invoke(IPC_CHANNELS.file.READ_ATTACHMENT),
  storeAttachment: invoke(IPC_CHANNELS.file.STORE_ATTACHMENT),
  generateThumbnail: invoke(IPC_CHANNELS.file.GENERATE_THUMBNAIL),

  // Theme
  getSystemTheme: invoke(IPC_CHANNELS.theme.GET_SYSTEM_PREFERENCE),
  onSystemThemeChange: listener(IPC_CHANNELS.theme.SYSTEM_CHANGED),

  // System
  getVersions: invoke(IPC_CHANNELS.system.VERSIONS),
  getHomeDir: invoke(IPC_CHANNELS.system.HOME_DIR),
  isDebugMode: invoke(IPC_CHANNELS.system.IS_DEBUG_MODE),

  // Auto-update
  checkForUpdates: invoke(IPC_CHANNELS.update.CHECK),
  getUpdateInfo: invoke(IPC_CHANNELS.update.GET_INFO),
  installUpdate: invoke(IPC_CHANNELS.update.INSTALL),
  dismissUpdate: invoke(IPC_CHANNELS.update.DISMISS),
  getDismissedUpdateVersion: invoke(IPC_CHANNELS.update.GET_DISMISSED),
  onUpdateAvailable: listener(IPC_CHANNELS.update.AVAILABLE),
  onUpdateDownloadProgress: listener(IPC_CHANNELS.update.DOWNLOAD_PROGRESS),

  // Release notes
  getReleaseNotes: invoke(IPC_CHANNELS.releaseNotes.GET),
  getLatestReleaseVersion: invoke(IPC_CHANNELS.releaseNotes.GET_LATEST_VERSION),

  // Shell operations
  openUrl: invoke(IPC_CHANNELS.shell.OPEN_URL),
  openFile: invoke(IPC_CHANNELS.shell.OPEN_FILE),
  showInFolder: invoke(IPC_CHANNELS.shell.SHOW_IN_FOLDER),

  // Menu event listeners
  onMenuNewChat: listener(IPC_CHANNELS.menu.NEW_CHAT),
  onMenuOpenSettings: listener(IPC_CHANNELS.menu.OPEN_SETTINGS),
  onMenuKeyboardShortcuts: listener(IPC_CHANNELS.menu.KEYBOARD_SHORTCUTS),
  onMenuToggleFocusMode: listener(IPC_CHANNELS.menu.TOGGLE_FOCUS_MODE),
  onMenuToggleSidebar: listener(IPC_CHANNELS.menu.TOGGLE_SIDEBAR),

  // Deep link
  onDeepLinkNavigate: listener(IPC_CHANNELS.deeplink.NAVIGATE),

  // Auth
  showLogoutConfirmation: invoke(IPC_CHANNELS.auth.SHOW_LOGOUT_CONFIRMATION),
  showDeleteSessionConfirmation: invoke(IPC_CHANNELS.auth.SHOW_DELETE_SESSION_CONFIRMATION),
  logout: invoke(IPC_CHANNELS.auth.LOGOUT),
  getCredentialHealth: invoke(IPC_CHANNELS.credentials.HEALTH_CHECK),

  // Onboarding
  getAuthState: invoke(IPC_CHANNELS.onboarding.GET_AUTH_STATE),
  getSetupNeeds: invoke(IPC_CHANNELS.onboarding.GET_AUTH_STATE, r => r.setupNeeds),
  startWorkspaceMcpOAuth: invoke(IPC_CHANNELS.onboarding.START_MCP_OAUTH),
  startClaudeOAuth: invoke(IPC_CHANNELS.onboarding.START_CLAUDE_OAUTH),
  exchangeClaudeCode: invoke(IPC_CHANNELS.onboarding.EXCHANGE_CLAUDE_CODE),
  hasClaudeOAuthState: invoke(IPC_CHANNELS.onboarding.HAS_CLAUDE_OAUTH_STATE),
  clearClaudeOAuthState: invoke(IPC_CHANNELS.onboarding.CLEAR_CLAUDE_OAUTH_STATE),

  // ChatGPT OAuth
  startChatGptOAuth: invoke(IPC_CHANNELS.chatgpt.START_OAUTH),
  cancelChatGptOAuth: invoke(IPC_CHANNELS.chatgpt.CANCEL_OAUTH),
  getChatGptAuthStatus: invoke(IPC_CHANNELS.chatgpt.GET_AUTH_STATUS),
  chatGptLogout: invoke(IPC_CHANNELS.chatgpt.LOGOUT),

  // GitHub Copilot OAuth
  startCopilotOAuth: invoke(IPC_CHANNELS.copilot.START_OAUTH),
  cancelCopilotOAuth: invoke(IPC_CHANNELS.copilot.CANCEL_OAUTH),
  getCopilotAuthStatus: invoke(IPC_CHANNELS.copilot.GET_AUTH_STATUS),
  copilotLogout: invoke(IPC_CHANNELS.copilot.LOGOUT),
  onCopilotDeviceCode: listener(IPC_CHANNELS.copilot.DEVICE_CODE),

  // Settings - API Setup
  setupLlmConnection: invoke(IPC_CHANNELS.settings.SETUP_LLM_CONNECTION),
  testLlmConnectionSetup: invoke(IPC_CHANNELS.settings.TEST_LLM_CONNECTION_SETUP),

  // Pi provider discovery
  getPiApiKeyProviders: invoke(IPC_CHANNELS.pi.GET_API_KEY_PROVIDERS),
  getPiProviderBaseUrl: invoke(IPC_CHANNELS.pi.GET_PROVIDER_BASE_URL),
  getPiProviderModels: invoke(IPC_CHANNELS.pi.GET_PROVIDER_MODELS),

  // Session-specific model
  getSessionModel: invoke(IPC_CHANNELS.sessions.GET_MODEL),
  setSessionModel: invoke(IPC_CHANNELS.sessions.SET_MODEL),

  // Workspace Settings
  getWorkspaceSettings: invoke(IPC_CHANNELS.workspace.SETTINGS_GET),
  updateWorkspaceSetting: invoke(IPC_CHANNELS.workspace.SETTINGS_UPDATE),

  // Folder dialog
  openFolderDialog: invoke(IPC_CHANNELS.dialog.OPEN_FOLDER),

  // Filesystem search
  searchFiles: invoke(IPC_CHANNELS.fs.SEARCH),

  // Debug logging
  debugLog: invoke(IPC_CHANNELS.debug.LOG),

  // User Preferences
  readPreferences: invoke(IPC_CHANNELS.preferences.READ),
  writePreferences: invoke(IPC_CHANNELS.preferences.WRITE),

  // Session Drafts
  getDraft: invoke(IPC_CHANNELS.drafts.GET),
  setDraft: invoke(IPC_CHANNELS.drafts.SET),
  deleteDraft: invoke(IPC_CHANNELS.drafts.DELETE),
  getAllDrafts: invoke(IPC_CHANNELS.drafts.GET_ALL),

  // Session Info Panel
  getSessionFiles: invoke(IPC_CHANNELS.sessions.GET_FILES),
  getSessionNotes: invoke(IPC_CHANNELS.sessions.GET_NOTES),
  setSessionNotes: invoke(IPC_CHANNELS.sessions.SET_NOTES),
  watchSessionFiles: invoke(IPC_CHANNELS.sessions.WATCH_FILES),
  unwatchSessionFiles: invoke(IPC_CHANNELS.sessions.UNWATCH_FILES),
  onSessionFilesChanged: listener(IPC_CHANNELS.sessions.FILES_CHANGED),

  // Sources
  getSources: invoke(IPC_CHANNELS.sources.GET),
  createSource: invoke(IPC_CHANNELS.sources.CREATE),
  deleteSource: invoke(IPC_CHANNELS.sources.DELETE),
  startSourceOAuth: invoke(IPC_CHANNELS.sources.START_OAUTH),
  saveSourceCredentials: invoke(IPC_CHANNELS.sources.SAVE_CREDENTIALS),
  getSourcePermissionsConfig: invoke(IPC_CHANNELS.sources.GET_PERMISSIONS),
  getWorkspacePermissionsConfig: invoke(IPC_CHANNELS.workspace.GET_PERMISSIONS),
  getDefaultPermissionsConfig: invoke(IPC_CHANNELS.permissions.GET_DEFAULTS),
  onDefaultPermissionsChanged: listener(IPC_CHANNELS.permissions.DEFAULTS_CHANGED),
  getMcpTools: invoke(IPC_CHANNELS.sources.GET_MCP_TOOLS),

  // Session content search
  searchSessionContent: invoke(IPC_CHANNELS.sessions.SEARCH_CONTENT),

  // OAuth (server-owned credentials)
  oauthRevoke: invoke(IPC_CHANNELS.oauth.REVOKE),

  // Sources change listener
  onSourcesChanged: listener(IPC_CHANNELS.sources.CHANGED),

  // Skills
  getSkills: invoke(IPC_CHANNELS.skills.GET),
  getSkillFiles: invoke(IPC_CHANNELS.skills.GET_FILES),
  deleteSkill: invoke(IPC_CHANNELS.skills.DELETE),
  openSkillInEditor: invoke(IPC_CHANNELS.skills.OPEN_EDITOR),
  openSkillInFinder: invoke(IPC_CHANNELS.skills.OPEN_FINDER),
  onSkillsChanged: listener(IPC_CHANNELS.skills.CHANGED),

  // Statuses
  listStatuses: invoke(IPC_CHANNELS.statuses.LIST),
  reorderStatuses: invoke(IPC_CHANNELS.statuses.REORDER),
  onStatusesChanged: listener(IPC_CHANNELS.statuses.CHANGED),

  // Labels
  listLabels: invoke(IPC_CHANNELS.labels.LIST),
  createLabel: invoke(IPC_CHANNELS.labels.CREATE),
  deleteLabel: invoke(IPC_CHANNELS.labels.DELETE),
  onLabelsChanged: listener(IPC_CHANNELS.labels.CHANGED),

  // LLM connections change listener
  onLlmConnectionsChanged: listener(IPC_CHANNELS.llmConnections.CHANGED),

  // Views
  listViews: invoke(IPC_CHANNELS.views.LIST),
  saveViews: invoke(IPC_CHANNELS.views.SAVE),

  // Tool icon mappings
  getToolIconMappings: invoke(IPC_CHANNELS.toolIcons.GET_MAPPINGS),

  // Workspace images
  readWorkspaceImage: invoke(IPC_CHANNELS.workspace.READ_IMAGE),
  writeWorkspaceImage: invoke(IPC_CHANNELS.workspace.WRITE_IMAGE),

  // Theme
  getAppTheme: invoke(IPC_CHANNELS.theme.GET_APP),
  loadPresetThemes: invoke(IPC_CHANNELS.theme.GET_PRESETS),
  loadPresetTheme: invoke(IPC_CHANNELS.theme.LOAD_PRESET),
  getColorTheme: invoke(IPC_CHANNELS.theme.GET_COLOR_THEME),
  setColorTheme: invoke(IPC_CHANNELS.theme.SET_COLOR_THEME),
  getWorkspaceColorTheme: invoke(IPC_CHANNELS.theme.GET_WORKSPACE_COLOR_THEME),
  setWorkspaceColorTheme: invoke(IPC_CHANNELS.theme.SET_WORKSPACE_COLOR_THEME),
  getAllWorkspaceThemes: invoke(IPC_CHANNELS.theme.GET_ALL_WORKSPACE_THEMES),
  getLogoUrl: invoke(IPC_CHANNELS.logo.GET_URL),
  onAppThemeChange: listener(IPC_CHANNELS.theme.APP_CHANGED),
  broadcastThemePreferences: invoke(IPC_CHANNELS.theme.BROADCAST_PREFERENCES),
  onThemePreferencesChange: listener(IPC_CHANNELS.theme.PREFERENCES_CHANGED),
  broadcastWorkspaceThemeChange: invoke(IPC_CHANNELS.theme.BROADCAST_WORKSPACE_THEME),
  onWorkspaceThemeChange: listener(IPC_CHANNELS.theme.WORKSPACE_THEME_CHANGED),

  // Notifications
  showNotification: invoke(IPC_CHANNELS.notification.SHOW),
  getNotificationsEnabled: invoke(IPC_CHANNELS.notification.GET_ENABLED),
  setNotificationsEnabled: invoke(IPC_CHANNELS.notification.SET_ENABLED),

  // Input settings
  getAutoCapitalisation: invoke(IPC_CHANNELS.input.GET_AUTO_CAPITALISATION),
  setAutoCapitalisation: invoke(IPC_CHANNELS.input.SET_AUTO_CAPITALISATION),
  getSendMessageKey: invoke(IPC_CHANNELS.input.GET_SEND_MESSAGE_KEY),
  setSendMessageKey: invoke(IPC_CHANNELS.input.SET_SEND_MESSAGE_KEY),
  getSpellCheck: invoke(IPC_CHANNELS.input.GET_SPELL_CHECK),
  setSpellCheck: invoke(IPC_CHANNELS.input.SET_SPELL_CHECK),

  // Power settings
  getKeepAwakeWhileRunning: invoke(IPC_CHANNELS.power.GET_KEEP_AWAKE),
  setKeepAwakeWhileRunning: invoke(IPC_CHANNELS.power.SET_KEEP_AWAKE),

  // Appearance settings
  getRichToolDescriptions: invoke(IPC_CHANNELS.appearance.GET_RICH_TOOL_DESCRIPTIONS),
  setRichToolDescriptions: invoke(IPC_CHANNELS.appearance.SET_RICH_TOOL_DESCRIPTIONS),

  // Badge
  refreshBadge: invoke(IPC_CHANNELS.badge.REFRESH),
  setDockIconWithBadge: invoke(IPC_CHANNELS.badge.SET_ICON),
  onBadgeDraw: listener(IPC_CHANNELS.badge.DRAW),
  onBadgeDrawWindows: listener(IPC_CHANNELS.badge.DRAW_WINDOWS),

  // Window focus
  getWindowFocusState: invoke(IPC_CHANNELS.window.GET_FOCUS_STATE),
  onWindowFocusChange: listener(IPC_CHANNELS.window.FOCUS_STATE),
  onNotificationNavigate: listener(IPC_CHANNELS.notification.NAVIGATE),

  // Git
  getGitBranch: invoke(IPC_CHANNELS.git.GET_BRANCH),
  checkGitBash: invoke(IPC_CHANNELS.gitbash.CHECK),
  browseForGitBash: invoke(IPC_CHANNELS.gitbash.BROWSE),
  setGitBashPath: invoke(IPC_CHANNELS.gitbash.SET_PATH),

  // Menu actions
  menuQuit: invoke(IPC_CHANNELS.menu.QUIT),
  menuNewWindow: invoke(IPC_CHANNELS.menu.NEW_WINDOW),
  menuMinimize: invoke(IPC_CHANNELS.menu.MINIMIZE),
  menuMaximize: invoke(IPC_CHANNELS.menu.MAXIMIZE),
  menuZoomIn: invoke(IPC_CHANNELS.menu.ZOOM_IN),
  menuZoomOut: invoke(IPC_CHANNELS.menu.ZOOM_OUT),
  menuZoomReset: invoke(IPC_CHANNELS.menu.ZOOM_RESET),
  menuToggleDevTools: invoke(IPC_CHANNELS.menu.TOGGLE_DEV_TOOLS),
  menuUndo: invoke(IPC_CHANNELS.menu.UNDO),
  menuRedo: invoke(IPC_CHANNELS.menu.REDO),
  menuCut: invoke(IPC_CHANNELS.menu.CUT),
  menuCopy: invoke(IPC_CHANNELS.menu.COPY),
  menuPaste: invoke(IPC_CHANNELS.menu.PASTE),
  menuSelectAll: invoke(IPC_CHANNELS.menu.SELECT_ALL),

  // Browser pane management
  'browserPane.create': invoke(IPC_CHANNELS.browserPane.CREATE),
  'browserPane.destroy': invoke(IPC_CHANNELS.browserPane.DESTROY),
  'browserPane.list': invoke(IPC_CHANNELS.browserPane.LIST),
  'browserPane.navigate': invoke(IPC_CHANNELS.browserPane.NAVIGATE),
  'browserPane.goBack': invoke(IPC_CHANNELS.browserPane.GO_BACK),
  'browserPane.goForward': invoke(IPC_CHANNELS.browserPane.GO_FORWARD),
  'browserPane.reload': invoke(IPC_CHANNELS.browserPane.RELOAD),
  'browserPane.stop': invoke(IPC_CHANNELS.browserPane.STOP),
  'browserPane.focus': invoke(IPC_CHANNELS.browserPane.FOCUS),
  'browserPane.emptyStateLaunch': invoke(IPC_CHANNELS.browserPane.LAUNCH),
  'browserPane.onStateChanged': listener(IPC_CHANNELS.browserPane.STATE_CHANGED),
  'browserPane.onRemoved': listener(IPC_CHANNELS.browserPane.REMOVED),
  'browserPane.onInteracted': listener(IPC_CHANNELS.browserPane.INTERACTED),

  // LLM Connections
  listLlmConnections: invoke(IPC_CHANNELS.llmConnections.LIST),
  listLlmConnectionsWithStatus: invoke(IPC_CHANNELS.llmConnections.LIST_WITH_STATUS),
  getLlmConnection: invoke(IPC_CHANNELS.llmConnections.GET),
  getLlmConnectionApiKey: invoke(IPC_CHANNELS.llmConnections.GET_API_KEY),
  saveLlmConnection: invoke(IPC_CHANNELS.llmConnections.SAVE),
  deleteLlmConnection: invoke(IPC_CHANNELS.llmConnections.DELETE),
  testLlmConnection: invoke(IPC_CHANNELS.llmConnections.TEST),
  setDefaultLlmConnection: invoke(IPC_CHANNELS.llmConnections.SET_DEFAULT),
  setWorkspaceDefaultLlmConnection: invoke(IPC_CHANNELS.llmConnections.SET_WORKSPACE_DEFAULT),

  // Automations
  testAutomation: invoke(IPC_CHANNELS.automations.TEST),
  setAutomationEnabled: invoke(IPC_CHANNELS.automations.SET_ENABLED),
  duplicateAutomation: invoke(IPC_CHANNELS.automations.DUPLICATE),
  deleteAutomation: invoke(IPC_CHANNELS.automations.DELETE),
  getAutomationHistory: invoke(IPC_CHANNELS.automations.GET_HISTORY),
  getAutomationLastExecuted: invoke(IPC_CHANNELS.automations.GET_LAST_EXECUTED),
  onAutomationsChanged: listener(IPC_CHANNELS.automations.CHANGED),
} satisfies ChannelMap
