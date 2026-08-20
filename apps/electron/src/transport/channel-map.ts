/**
 * Channel map — maps ElectronAPI method names to IPC channels.
 *
 * Derived from preload/index.ts. This is the single source of truth for
 * the method→channel mapping used by buildClientApi().
 */

import { RPC_CHANNELS } from '../shared/types'
import type { ChannelMap } from './build-api'

function invoke(channel: string, transform?: (result: any) => any) {
  return { type: 'invoke' as const, channel, ...(transform && { transform }) }
}

function listener(channel: string) {
  return { type: 'listener' as const, channel }
}

export const CHANNEL_MAP = {
  // Cloud Runs (PRD docs/cloud-runs-prd.md, phase G3)
  getCloudRunsConfig: invoke(RPC_CHANNELS.cloudRuns.GET_CONFIG),
  setCloudRunsConfig: invoke(RPC_CHANNELS.cloudRuns.SET_CONFIG),
  submitCloudRun: invoke(RPC_CHANNELS.cloudRuns.SUBMIT),
  resumeCloudRun: invoke(RPC_CHANNELS.cloudRuns.RESUME),
  sessionTopicCloudRun: invoke(RPC_CHANNELS.cloudRuns.SESSION_TOPIC),
  listCloudRunSchedules: invoke(RPC_CHANNELS.cloudRuns.LIST_SCHEDULES),
  saveCloudRunSchedule: invoke(RPC_CHANNELS.cloudRuns.SAVE_SCHEDULE),
  deleteCloudRunSchedule: invoke(RPC_CHANNELS.cloudRuns.DELETE_SCHEDULE),
  readCloudRunArtifact: invoke(RPC_CHANNELS.cloudRuns.READ_ARTIFACT),
  getCloudRunEvents: invoke(RPC_CHANNELS.cloudRuns.GET_EVENTS),
  shareCloudRun: invoke(RPC_CHANNELS.cloudRuns.SHARE),
  revokeCloudRunShare: invoke(RPC_CHANNELS.cloudRuns.REVOKE_SHARE),
  listCloudRuns: invoke(RPC_CHANNELS.cloudRuns.LIST),
  getCloudRunStatus: invoke(RPC_CHANNELS.cloudRuns.GET_STATUS),
  cancelCloudRun: invoke(RPC_CHANNELS.cloudRuns.CANCEL),
  listCloudRunArtifacts: invoke(RPC_CHANNELS.cloudRuns.LIST_ARTIFACTS),
  importCloudRun: invoke(RPC_CHANNELS.cloudRuns.IMPORT),
  aggregateCloudRun: invoke(RPC_CHANNELS.cloudRuns.AGGREGATE),
  // Session management
  getSessions: invoke(RPC_CHANNELS.sessions.GET),
  getUnreadSummary: invoke(RPC_CHANNELS.sessions.GET_UNREAD_SUMMARY),
  markAllSessionsRead: invoke(RPC_CHANNELS.sessions.MARK_ALL_READ),
  getSessionMessages: invoke(RPC_CHANNELS.sessions.GET_MESSAGES),
  createSession: invoke(RPC_CHANNELS.sessions.CREATE),
  deleteSession: invoke(RPC_CHANNELS.sessions.DELETE),
  sendMessage: invoke(RPC_CHANNELS.sessions.SEND_MESSAGE),
  cancelProcessing: invoke(RPC_CHANNELS.sessions.CANCEL),
  killShell: invoke(RPC_CHANNELS.sessions.KILL_SHELL),
  getTaskOutput: invoke(RPC_CHANNELS.tasks.GET_OUTPUT),

  // Tasks (Conductor)
  validateTask: invoke(RPC_CHANNELS.tasks.VALIDATE),
  createTask: invoke(RPC_CHANNELS.tasks.CREATE),
  generateTask: invoke(RPC_CHANNELS.tasks.GENERATE),
  runTask: invoke(RPC_CHANNELS.tasks.RUN),
  pauseTask: invoke(RPC_CHANNELS.tasks.PAUSE),
  resumeTask: invoke(RPC_CHANNELS.tasks.RESUME),
  stopTask: invoke(RPC_CHANNELS.tasks.STOP),
  getTask: invoke(RPC_CHANNELS.tasks.GET),
  listTasks: invoke(RPC_CHANNELS.tasks.LIST),
  getTaskResults: invoke(RPC_CHANNELS.tasks.GET_RESULTS),
  onTaskGenerated: listener(RPC_CHANNELS.tasks.GENERATED),
  respondToPermission: invoke(RPC_CHANNELS.sessions.RESPOND_TO_PERMISSION),
  respondToCredential: invoke(RPC_CHANNELS.sessions.RESPOND_TO_CREDENTIAL),
  sessionCommand: invoke(RPC_CHANNELS.sessions.COMMAND),
  exportSession: invoke(RPC_CHANNELS.sessions.EXPORT),
  importSession: invoke(RPC_CHANNELS.sessions.IMPORT),
  exportRemoteSessionTransfer: invoke(RPC_CHANNELS.sessions.EXPORT_REMOTE_TRANSFER),
  importRemoteSessionTransfer: invoke(RPC_CHANNELS.sessions.IMPORT_REMOTE_TRANSFER),
  getPendingPlanExecution: invoke(RPC_CHANNELS.sessions.GET_PENDING_PLAN_EXECUTION),
  getSessionPermissionModeState: invoke(RPC_CHANNELS.sessions.GET_PERMISSION_MODE_STATE),
  setMemoryMode: invoke(RPC_CHANNELS.sessions.SET_MEMORY_MODE),
  getSessionProvenance: invoke(RPC_CHANNELS.sessions.GET_PROVENANCE),

  // Event listeners
  onSessionEvent: listener(RPC_CHANNELS.sessions.EVENT),
  onUnreadSummaryChanged: listener(RPC_CHANNELS.sessions.UNREAD_SUMMARY_CHANGED),

  // Transport reliability
  onReconnected: listener('__transport:reconnected'),

  // Workspace management
  getWorkspaces: invoke(RPC_CHANNELS.workspaces.GET),
  createWorkspace: invoke(RPC_CHANNELS.workspaces.CREATE),
  checkWorkspaceSlug: invoke(RPC_CHANNELS.workspaces.CHECK_SLUG),
  updateWorkspaceRemoteServer: invoke(RPC_CHANNELS.workspaces.UPDATE_REMOTE),
  testRemoteConnection: invoke(RPC_CHANNELS.remote.TEST_CONNECTION),

  // Server-level workspace operations (REMOTE_ELIGIBLE)
  getServerWorkspaces: invoke(RPC_CHANNELS.server.GET_WORKSPACES),
  createServerWorkspace: invoke(RPC_CHANNELS.server.CREATE_WORKSPACE),

  // Window management
  getWindowWorkspace: invoke(RPC_CHANNELS.window.GET_WORKSPACE),
  getWindowMode: invoke(RPC_CHANNELS.window.GET_MODE),
  openWorkspace: invoke(RPC_CHANNELS.window.OPEN_WORKSPACE),
  openSessionInNewWindow: invoke(RPC_CHANNELS.window.OPEN_SESSION_IN_NEW_WINDOW),
  switchWorkspace: invoke(RPC_CHANNELS.window.SWITCH_WORKSPACE),
  closeWindow: invoke(RPC_CHANNELS.window.CLOSE),
  confirmCloseWindow: invoke(RPC_CHANNELS.window.CONFIRM_CLOSE),
  cancelCloseWindow: invoke(RPC_CHANNELS.window.CANCEL_CLOSE),
  onCloseRequested: listener(RPC_CHANNELS.window.CLOSE_REQUESTED),
  setTrafficLightsVisible: invoke(RPC_CHANNELS.window.SET_TRAFFIC_LIGHTS),

  // File operations
  readFile: invoke(RPC_CHANNELS.file.READ),
  readFileDataUrl: invoke(RPC_CHANNELS.file.READ_DATA_URL),
  readFilePreviewDataUrl: invoke(RPC_CHANNELS.file.READ_PREVIEW_DATA_URL),
  readFileBinary: invoke(RPC_CHANNELS.file.READ_BINARY),
  openFileDialog: invoke(RPC_CHANNELS.file.OPEN_DIALOG),
  readFileAttachment: invoke(RPC_CHANNELS.file.READ_ATTACHMENT),
  readUserAttachment: invoke(RPC_CHANNELS.file.READ_USER_ATTACHMENT),
  storeAttachment: invoke(RPC_CHANNELS.file.STORE_ATTACHMENT),
  generateThumbnail: invoke(RPC_CHANNELS.file.GENERATE_THUMBNAIL),

  // Theme
  getSystemTheme: invoke(RPC_CHANNELS.theme.GET_SYSTEM_PREFERENCE),
  onSystemThemeChange: listener(RPC_CHANNELS.theme.SYSTEM_CHANGED),

  // System
  getVersions: invoke(RPC_CHANNELS.system.VERSIONS),
  getHomeDir: invoke(RPC_CHANNELS.system.HOME_DIR),
  isDebugMode: invoke(RPC_CHANNELS.system.IS_DEBUG_MODE),

  // Auto-update
  checkForUpdates: invoke(RPC_CHANNELS.update.CHECK),
  getUpdateInfo: invoke(RPC_CHANNELS.update.GET_INFO),
  installUpdate: invoke(RPC_CHANNELS.update.INSTALL),
  dismissUpdate: invoke(RPC_CHANNELS.update.DISMISS),
  getDismissedUpdateVersion: invoke(RPC_CHANNELS.update.GET_DISMISSED),
  onUpdateAvailable: listener(RPC_CHANNELS.update.AVAILABLE),
  onUpdateDownloadProgress: listener(RPC_CHANNELS.update.DOWNLOAD_PROGRESS),

  // Toolchain manager
  getToolchainStatus: invoke(RPC_CHANNELS.toolchain.STATUS),
  onToolchainStatusChanged: listener(RPC_CHANNELS.toolchain.STATUS_CHANGED),
  updateToolchainTool: invoke(RPC_CHANNELS.toolchain.UPDATE),
  getToolchainDisabled: invoke(RPC_CHANNELS.toolchain.GET_DISABLED),
  setToolchainDisabled: invoke(RPC_CHANNELS.toolchain.SET_DISABLED),

  // Session env overrides (config runtime.envOverrides)
  getEnvOverrides: invoke(RPC_CHANNELS.settings.GET_ENV_OVERRIDES),
  setEnvOverrides: invoke(RPC_CHANNELS.settings.SET_ENV_OVERRIDES),

  // Release notes
  getReleaseNotes: invoke(RPC_CHANNELS.releaseNotes.GET),
  getLatestReleaseVersion: invoke(RPC_CHANNELS.releaseNotes.GET_LATEST_VERSION),

  // Shell operations
  openUrl: invoke(RPC_CHANNELS.shell.OPEN_URL),
  openFile: invoke(RPC_CHANNELS.shell.OPEN_FILE),
  showInFolder: invoke(RPC_CHANNELS.shell.SHOW_IN_FOLDER),

  // Menu event listeners
  onMenuNewChat: listener(RPC_CHANNELS.menu.NEW_CHAT),
  onMenuOpenSettings: listener(RPC_CHANNELS.menu.OPEN_SETTINGS),
  onMenuKeyboardShortcuts: listener(RPC_CHANNELS.menu.KEYBOARD_SHORTCUTS),
  onMenuToggleFocusMode: listener(RPC_CHANNELS.menu.TOGGLE_FOCUS_MODE),
  onMenuToggleSidebar: listener(RPC_CHANNELS.menu.TOGGLE_SIDEBAR),

  // Deep link
  onDeepLinkNavigate: listener(RPC_CHANNELS.deeplink.NAVIGATE),

  // Auth
  showLogoutConfirmation: invoke(RPC_CHANNELS.auth.SHOW_LOGOUT_CONFIRMATION),
  showDeleteSessionConfirmation: invoke(RPC_CHANNELS.auth.SHOW_DELETE_SESSION_CONFIRMATION),
  showDeleteWorkspaceConfirmation: invoke(RPC_CHANNELS.auth.SHOW_DELETE_WORKSPACE_CONFIRMATION),
  logout: invoke(RPC_CHANNELS.auth.LOGOUT),
  getCredentialHealth: invoke(RPC_CHANNELS.credentials.HEALTH_CHECK),

  // Identity Center (S-07)
  identityGetState: invoke(RPC_CHANNELS.identity.GET_STATE),
  identityUpdateProfile: invoke(RPC_CHANNELS.identity.UPDATE_PROFILE),
  identityConnect: invoke(RPC_CHANNELS.identity.CONNECT),
  identityDisconnect: invoke(RPC_CHANNELS.identity.DISCONNECT),
  identityRefreshStatus: invoke(RPC_CHANNELS.identity.REFRESH_STATUS),
  onIdentityChanged: listener(RPC_CHANNELS.identity.CHANGED),

  // Extension Center (S-05)
  extensionsListCatalog: invoke(RPC_CHANNELS.extensions.LIST_CATALOG),
  extensionsListInstalled: invoke(RPC_CHANNELS.extensions.LIST_INSTALLED),
  extensionsSetEnabled: invoke(RPC_CHANNELS.extensions.SET_ENABLED),
  extensionsGetState: invoke(RPC_CHANNELS.extensions.GET_STATE),
  onExtensionsChanged: listener(RPC_CHANNELS.extensions.CHANGED),

  // SiYuan plugin bridge (W6)
  pluginBridgeListPlugins: invoke(RPC_CHANNELS.pluginBridge.LIST_PLUGINS),
  pluginBridgeGetProjections: invoke(RPC_CHANNELS.pluginBridge.GET_PROJECTIONS),
  pluginBridgeSetEnabled: invoke(RPC_CHANNELS.pluginBridge.SET_ENABLED),
  pluginBridgeOpenCompat: invoke(RPC_CHANNELS.pluginBridge.OPEN_COMPAT),
  pluginBridgeInstallBazaar: invoke(RPC_CHANNELS.pluginBridge.INSTALL_BAZAAR),
  pluginBridgeUninstallBazaar: invoke(RPC_CHANNELS.pluginBridge.UNINSTALL_BAZAAR),

  // Extension Host lifecycle (S-05 §3.5) — craft-sandbox only; does not execute SiYuan plugins
  extensionHostStatus: invoke(RPC_CHANNELS.extensionHost.STATUS),
  extensionHostStatusAll: invoke(RPC_CHANNELS.extensionHost.STATUS_ALL),
  extensionHostStart: invoke(RPC_CHANNELS.extensionHost.START),
  extensionHostStop: invoke(RPC_CHANNELS.extensionHost.STOP),
  extensionHostRestart: invoke(RPC_CHANNELS.extensionHost.RESTART),
  extensionHostLoad: invoke(RPC_CHANNELS.extensionHost.LOAD),
  extensionHostCall: invoke(RPC_CHANNELS.extensionHost.CALL),
  extensionHostListCommands: invoke(RPC_CHANNELS.extensionHost.LIST_COMMANDS),
  extensionHostMintCapability: invoke(RPC_CHANNELS.extensionHost.MINT_CAPABILITY),
  extensionHostRevokeCapability: invoke(RPC_CHANNELS.extensionHost.REVOKE_CAPABILITY),
  extensionHostProxyFetch: invoke(RPC_CHANNELS.extensionHost.PROXY_FETCH),
  extensionHostGetUrlAllowlist: invoke(RPC_CHANNELS.extensionHost.GET_URL_ALLOWLIST),
  extensionHostSetUrlAllowlist: invoke(RPC_CHANNELS.extensionHost.SET_URL_ALLOWLIST),

  // Onboarding
  getAuthState: invoke(RPC_CHANNELS.onboarding.GET_AUTH_STATE),
  getSetupNeeds: invoke(RPC_CHANNELS.onboarding.GET_AUTH_STATE, r => r.setupNeeds),
  startWorkspaceMcpOAuth: invoke(RPC_CHANNELS.onboarding.START_MCP_OAUTH),
  startClaudeOAuth: invoke(RPC_CHANNELS.onboarding.START_CLAUDE_OAUTH),
  exchangeClaudeCode: invoke(RPC_CHANNELS.onboarding.EXCHANGE_CLAUDE_CODE),
  hasClaudeOAuthState: invoke(RPC_CHANNELS.onboarding.HAS_CLAUDE_OAUTH_STATE),
  clearClaudeOAuthState: invoke(RPC_CHANNELS.onboarding.CLEAR_CLAUDE_OAUTH_STATE),
  deferSetup: invoke(RPC_CHANNELS.onboarding.DEFER_SETUP),
  startRoxConnect: invoke(RPC_CHANNELS.onboarding.START_ROX_CONNECT),
  getRoxCloudState: invoke(RPC_CHANNELS.onboarding.GET_ROX_CLOUD_STATE),
  clearRoxCloud: invoke(RPC_CHANNELS.onboarding.CLEAR_ROX_CLOUD),

  // ChatGPT OAuth
  startChatGptOAuth: invoke(RPC_CHANNELS.chatgpt.START_OAUTH),
  cancelChatGptOAuth: invoke(RPC_CHANNELS.chatgpt.CANCEL_OAUTH),
  getChatGptAuthStatus: invoke(RPC_CHANNELS.chatgpt.GET_AUTH_STATUS),
  chatGptLogout: invoke(RPC_CHANNELS.chatgpt.LOGOUT),

  // GitHub Copilot OAuth
  startCopilotOAuth: invoke(RPC_CHANNELS.copilot.START_OAUTH),
  cancelCopilotOAuth: invoke(RPC_CHANNELS.copilot.CANCEL_OAUTH),
  getCopilotAuthStatus: invoke(RPC_CHANNELS.copilot.GET_AUTH_STATUS),
  copilotLogout: invoke(RPC_CHANNELS.copilot.LOGOUT),
  onCopilotDeviceCode: listener(RPC_CHANNELS.copilot.DEVICE_CODE),

  // Server info (REMOTE_ELIGIBLE)
  getServerHomeDir: invoke(RPC_CHANNELS.server.HOME_DIR),

  // Server mode configuration
  getServerConfig: invoke(RPC_CHANNELS.settings.GET_SERVER_CONFIG),
  setServerConfig: invoke(RPC_CHANNELS.settings.SET_SERVER_CONFIG),
  getServerStatus: invoke(RPC_CHANNELS.settings.GET_SERVER_STATUS),

  // Settings - API Setup
  setupLlmConnection: invoke(RPC_CHANNELS.settings.SETUP_LLM_CONNECTION),
  testLlmConnectionSetup: invoke(RPC_CHANNELS.settings.TEST_LLM_CONNECTION_SETUP),
  getDefaultThinkingLevel: invoke(RPC_CHANNELS.settings.GET_DEFAULT_THINKING_LEVEL),
  setDefaultThinkingLevel: invoke(RPC_CHANNELS.settings.SET_DEFAULT_THINKING_LEVEL),
  getNetworkProxySettings: invoke(RPC_CHANNELS.settings.GET_NETWORK_PROXY),
  setNetworkProxySettings: invoke(RPC_CHANNELS.settings.SET_NETWORK_PROXY),

  // Pi provider discovery
  getPiApiKeyProviders: invoke(RPC_CHANNELS.pi.GET_API_KEY_PROVIDERS),
  getPiProviderBaseUrl: invoke(RPC_CHANNELS.pi.GET_PROVIDER_BASE_URL),
  getPiProviderModels: invoke(RPC_CHANNELS.pi.GET_PROVIDER_MODELS),

  // Session-specific model
  getSessionModel: invoke(RPC_CHANNELS.sessions.GET_MODEL),
  setSessionModel: invoke(RPC_CHANNELS.sessions.SET_MODEL),

  // Workspace Settings
  getWorkspaceSettings: invoke(RPC_CHANNELS.workspace.SETTINGS_GET),
  updateWorkspaceSetting: invoke(RPC_CHANNELS.workspace.SETTINGS_UPDATE),

  // Folder dialog
  openFolderDialog: invoke(RPC_CHANNELS.dialog.OPEN_FOLDER),

  // Filesystem search
  searchFiles: invoke(RPC_CHANNELS.fs.SEARCH),

  // Server filesystem browsing (remote mode)
  listServerDirectory: invoke(RPC_CHANNELS.fs.LIST_DIRECTORY),

  // Notes
  listNotes: invoke(RPC_CHANNELS.notes.LIST),
  readNote: invoke(RPC_CHANNELS.notes.READ),
  saveNote: invoke(RPC_CHANNELS.notes.SAVE),
  createNote: invoke(RPC_CHANNELS.notes.CREATE),
  renameNote: invoke(RPC_CHANNELS.notes.RENAME),
  deleteNote: invoke(RPC_CHANNELS.notes.DELETE),
  renameFolderNote: invoke(RPC_CHANNELS.notes.RENAME_FOLDER),
  deleteFolderNote: invoke(RPC_CHANNELS.notes.DELETE_FOLDER),
  searchNotes: invoke(RPC_CHANNELS.notes.SEARCH),
  getNoteBacklinks: invoke(RPC_CHANNELS.notes.GET_BACKLINKS),
  getNoteRenameImpact: invoke(RPC_CHANNELS.notes.GET_RENAME_IMPACT),
  getDailyNote: invoke(RPC_CHANNELS.notes.GET_DAILY_NOTE),
  importNoteAsset: invoke(RPC_CHANNELS.notes.IMPORT_ASSET),
  listNoteAssets: invoke(RPC_CHANNELS.notes.LIST_ASSETS),
  deleteNoteAsset: invoke(RPC_CHANNELS.notes.DELETE_ASSET),
  renameNoteAsset: invoke(RPC_CHANNELS.notes.RENAME_ASSET),
  updateNoteProperties: invoke(RPC_CHANNELS.notes.UPDATE_PROPERTIES),
  watchNotes: invoke(RPC_CHANNELS.notes.WATCH),
  unwatchNotes: invoke(RPC_CHANNELS.notes.UNWATCH),
  onNotesChanged: listener(RPC_CHANNELS.notes.CHANGED),

  // Knowledge — 9 P1 reads (spec 2026-08-07-siyuan-integration/03) plus the
  // 7 P3 write-back proposal channels (spec 05) plus 8 P4 publication channels
  // (spec 06), all REMOTE_ELIGIBLE except engineStatus (LOCAL_ONLY).
  // Dotted keys nest into api.knowledge.*, mirroring the browserPane surface.
  'workgraph.listConnections': invoke(RPC_CHANNELS.workgraph.LIST_CONNECTIONS),
  'workgraph.listConnectionAudit': invoke(RPC_CHANNELS.workgraph.LIST_CONNECTION_AUDIT),
  'workgraph.listConnectionBindings': invoke(RPC_CHANNELS.workgraph.LIST_CONNECTION_BINDINGS),
  'workgraph.convertConnection': invoke(RPC_CHANNELS.workgraph.CONVERT_CONNECTION),
  'workgraph.revokeConnectionBinding': invoke(RPC_CHANNELS.workgraph.REVOKE_CONNECTION_BINDING),
  'workgraph.getConnection': invoke(RPC_CHANNELS.workgraph.GET_CONNECTION),
  'workgraph.createConnection': invoke(RPC_CHANNELS.workgraph.CREATE_CONNECTION),
  'workgraph.grantConnection': invoke(RPC_CHANNELS.workgraph.GRANT_CONNECTION),
  'workgraph.previewGithubEnv': invoke(RPC_CHANNELS.workgraph.PREVIEW_GITHUB_ENV),
  'workgraph.importGithubEnv': invoke(RPC_CHANNELS.workgraph.IMPORT_GITHUB_ENV),
  'workgraph.previewGitHelper': invoke(RPC_CHANNELS.workgraph.PREVIEW_GIT_HELPER),
  'workgraph.importGitHelper': invoke(RPC_CHANNELS.workgraph.IMPORT_GIT_HELPER),
  'workgraph.revokeConnection': invoke(RPC_CHANNELS.workgraph.REVOKE_CONNECTION),
  'workgraph.repairConnection': invoke(RPC_CHANNELS.workgraph.REPAIR_CONNECTION),
  'workgraph.rotateConnection': invoke(RPC_CHANNELS.workgraph.ROTATE_CONNECTION),
  'workgraph.testConnection': invoke(RPC_CHANNELS.workgraph.TEST_CONNECTION),
  'workgraph.previewDockerHelper': invoke(RPC_CHANNELS.workgraph.PREVIEW_DOCKER_HELPER),
  'workgraph.importDockerHelper': invoke(RPC_CHANNELS.workgraph.IMPORT_DOCKER_HELPER),
  'workgraph.previewAwsProfiles': invoke(RPC_CHANNELS.workgraph.PREVIEW_AWS_PROFILES),
  'workgraph.importAwsProfile': invoke(RPC_CHANNELS.workgraph.IMPORT_AWS_PROFILE),
  'workgraph.previewKeychain': invoke(RPC_CHANNELS.workgraph.PREVIEW_KEYCHAIN),
  'workgraph.importKeychain': invoke(RPC_CHANNELS.workgraph.IMPORT_KEYCHAIN),
  'workgraph.previewAdc': invoke(RPC_CHANNELS.workgraph.PREVIEW_ADC),
  'workgraph.importAdc': invoke(RPC_CHANNELS.workgraph.IMPORT_ADC),
  'workgraph.previewSshAgent': invoke(RPC_CHANNELS.workgraph.PREVIEW_SSH_AGENT),
  'workgraph.importSshAgent': invoke(RPC_CHANNELS.workgraph.IMPORT_SSH_AGENT),
  'knowledge.listConnections': invoke(RPC_CHANNELS.knowledge.LIST_CONNECTIONS),
  'knowledge.capabilities': invoke(RPC_CHANNELS.knowledge.CAPABILITIES),
  'knowledge.search': invoke(RPC_CHANNELS.knowledge.SEARCH),
  'knowledge.get': invoke(RPC_CHANNELS.knowledge.GET),
  'knowledge.getContext': invoke(RPC_CHANNELS.knowledge.GET_CONTEXT),
  'knowledge.getBacklinks': invoke(RPC_CHANNELS.knowledge.GET_BACKLINKS),
  'knowledge.getExportPayload': invoke(RPC_CHANNELS.knowledge.GET_EXPORT_PAYLOAD),
  'knowledge.createSnapshot': invoke(RPC_CHANNELS.knowledge.SNAPSHOT_CREATE),
  'knowledge.getSnapshot': invoke(RPC_CHANNELS.knowledge.SNAPSHOT_GET),
  'knowledge.engineStatus': invoke(RPC_CHANNELS.knowledge.ENGINE_STATUS),
  'knowledge.engineStart': invoke(RPC_CHANNELS.knowledge.ENGINE_START),
  // P3 write-back (spec 05): mutation-proposal lifecycle.
  'knowledge.proposeMutation': invoke(RPC_CHANNELS.knowledge.PROPOSE_MUTATION),
  'knowledge.approveProposal': invoke(RPC_CHANNELS.knowledge.APPROVE_PROPOSAL),
  'knowledge.rejectProposal': invoke(RPC_CHANNELS.knowledge.REJECT_PROPOSAL),
  'knowledge.applyProposal': invoke(RPC_CHANNELS.knowledge.APPLY_PROPOSAL),
  'knowledge.rollbackProposal': invoke(RPC_CHANNELS.knowledge.ROLLBACK_PROPOSAL),
  'knowledge.getProposal': invoke(RPC_CHANNELS.knowledge.GET_PROPOSAL),
  'knowledge.listProposals': invoke(RPC_CHANNELS.knowledge.LIST_PROPOSALS),
  // P4 publication pipeline (spec 06): Session→Knowledge distill/prepare/apply.
  'knowledge.publishDistill': invoke(RPC_CHANNELS.knowledge.PUBLISH_DISTILL),
  'knowledge.publishGetDraft': invoke(RPC_CHANNELS.knowledge.PUBLISH_GET_DRAFT),
  'knowledge.publishUpdateDraft': invoke(RPC_CHANNELS.knowledge.PUBLISH_UPDATE_DRAFT),
  'knowledge.publishPrepare': invoke(RPC_CHANNELS.knowledge.PUBLISH_PREPARE),
  'knowledge.publishApply': invoke(RPC_CHANNELS.knowledge.PUBLISH_APPLY),
  'knowledge.publishFinalize': invoke(RPC_CHANNELS.knowledge.PUBLISH_FINALIZE),
  'knowledge.publishList': invoke(RPC_CHANNELS.knowledge.PUBLISH_LIST),
  'knowledge.listLinks': invoke(RPC_CHANNELS.knowledge.LIST_LINKS),
  // P5 saved knowledge views + work envelopes (K-09 / S-08).
  'knowledge.viewsList': invoke(RPC_CHANNELS.knowledge.VIEWS_LIST),
  'knowledge.viewRun': invoke(RPC_CHANNELS.knowledge.VIEW_RUN),
  'knowledge.viewSetAttribute': invoke(RPC_CHANNELS.knowledge.VIEW_SET_ATTRIBUTE),
  'knowledge.envelopeGet': invoke(RPC_CHANNELS.knowledge.ENVELOPE_GET),
  'knowledge.envelopeUpsert': invoke(RPC_CHANNELS.knowledge.ENVELOPE_UPSERT),
  'knowledge.envelopeList': invoke(RPC_CHANNELS.knowledge.ENVELOPE_LIST),
  'knowledge.watch': invoke(RPC_CHANNELS.knowledge.WATCH),
  'knowledge.unwatch': invoke(RPC_CHANNELS.knowledge.UNWATCH),
  'knowledge.migrateNotes': invoke(RPC_CHANNELS.knowledge.MIGRATE_NOTES),
  'knowledge.metricsGet': invoke(RPC_CHANNELS.knowledge.METRICS_GET),
  'knowledge.detectEngine': invoke(RPC_CHANNELS.knowledge.DETECT_ENGINE),
  'knowledge.onChanged': listener(RPC_CHANNELS.knowledge.CHANGED),

  // OpenClaw safe workspace data. Host-control direct IPC is intentionally
  // absent so the same surface routes through local Electron and remote WebUI.
  'openclawRuntime.getStatus': invoke(RPC_CHANNELS.openclawRuntime.GET_STATUS),
  'openclawRuntime.install': invoke(RPC_CHANNELS.openclawRuntime.INSTALL),
  'openclawRuntime.provision': invoke(RPC_CHANNELS.openclawRuntime.PROVISION),
  'openclawRuntime.start': invoke(RPC_CHANNELS.openclawRuntime.START),
  'openclawRuntime.stop': invoke(RPC_CHANNELS.openclawRuntime.STOP),
  'securityAudit.run': invoke(RPC_CHANNELS.securityAudit.RUN),
  'securityAudit.getLatest': invoke(RPC_CHANNELS.securityAudit.GET_LATEST),
  'securityAudit.acceptRisk': invoke(RPC_CHANNELS.securityAudit.ACCEPT_RISK),
  'securityAudit.revokeRiskAcceptance': invoke(RPC_CHANNELS.securityAudit.REVOKE_RISK_ACCEPTANCE),

  // SiYuan engine surfaces (P2 native knowledge mode). Embedded SiYuan desktop
  // panes keyed by durable document keys (`siyuan:{kind}:{id}`); the main-side
  // registry/delegation lives in main/handlers/siyuan.ts over BrowserPaneManager.
  'siyuanEngine.createEmbedded': invoke(RPC_CHANNELS.siyuan.CREATE_EMBEDDED),
  'siyuanEngine.destroy': invoke(RPC_CHANNELS.siyuan.DESTROY),
  'siyuanEngine.list': invoke(RPC_CHANNELS.siyuan.LIST),
  'siyuanEngine.syncBounds': invoke(RPC_CHANNELS.siyuan.SYNC_BOUNDS),
  'siyuanEngine.focus': invoke(RPC_CHANNELS.siyuan.FOCUS),
  'siyuanEngine.evaluate': invoke(RPC_CHANNELS.siyuan.EVALUATE),
  'siyuanEngine.onStateChanged': listener(RPC_CHANNELS.siyuan.STATE_CHANGED),
  'siyuanEngine.onRemoved': listener(RPC_CHANNELS.siyuan.REMOVED),

  // Extension UI surfaces (S-05) — sandboxed BrowserView partition persist:ext-*
  'extensionSurface.createEmbedded': invoke(RPC_CHANNELS.extensionSurface.CREATE_EMBEDDED),
  'extensionSurface.destroy': invoke(RPC_CHANNELS.extensionSurface.DESTROY),
  'extensionSurface.list': invoke(RPC_CHANNELS.extensionSurface.LIST),
  'extensionSurface.syncBounds': invoke(RPC_CHANNELS.extensionSurface.SYNC_BOUNDS),
  'extensionSurface.focus': invoke(RPC_CHANNELS.extensionSurface.FOCUS),
  'extensionSurface.onStateChanged': listener(RPC_CHANNELS.extensionSurface.STATE_CHANGED),
  'extensionSurface.onRemoved': listener(RPC_CHANNELS.extensionSurface.REMOVED),

  // Debug logging
  debugLog: invoke(RPC_CHANNELS.debug.LOG),

  // User Preferences
  readPreferences: invoke(RPC_CHANNELS.preferences.READ),
  writePreferences: invoke(RPC_CHANNELS.preferences.WRITE),

  // Gamification profile
  getGamificationProfile: invoke(RPC_CHANNELS.gamification.GET),
  awardGamificationXp: invoke(RPC_CHANNELS.gamification.AWARD),
  onGamificationChanged: listener(RPC_CHANNELS.gamification.CHANGED),

  // Session Drafts
  getDraft: invoke(RPC_CHANNELS.drafts.GET),
  setDraft: invoke(RPC_CHANNELS.drafts.SET),
  deleteDraft: invoke(RPC_CHANNELS.drafts.DELETE),
  getAllDrafts: invoke(RPC_CHANNELS.drafts.GET_ALL),

  // Session Info Panel
  getSessionFiles: invoke(RPC_CHANNELS.sessions.GET_FILES),
  getSessionNotes: invoke(RPC_CHANNELS.sessions.GET_NOTES),
  setSessionNotes: invoke(RPC_CHANNELS.sessions.SET_NOTES),
  watchSessionFiles: invoke(RPC_CHANNELS.sessions.WATCH_FILES),
  unwatchSessionFiles: invoke(RPC_CHANNELS.sessions.UNWATCH_FILES),
  onSessionFilesChanged: listener(RPC_CHANNELS.sessions.FILES_CHANGED),

  // Sources
  getSources: invoke(RPC_CHANNELS.sources.GET),
  createSource: invoke(RPC_CHANNELS.sources.CREATE),
  updateSource: invoke(RPC_CHANNELS.sources.UPDATE),
  deleteSource: invoke(RPC_CHANNELS.sources.DELETE),
  startSourceOAuth: invoke(RPC_CHANNELS.sources.START_OAUTH),
  saveSourceCredentials: invoke(RPC_CHANNELS.sources.SAVE_CREDENTIALS),
  getSourcePermissionsConfig: invoke(RPC_CHANNELS.sources.GET_PERMISSIONS),
  getWorkspacePermissionsConfig: invoke(RPC_CHANNELS.workspace.GET_PERMISSIONS),
  getDefaultPermissionsConfig: invoke(RPC_CHANNELS.permissions.GET_DEFAULTS),
  onDefaultPermissionsChanged: listener(RPC_CHANNELS.permissions.DEFAULTS_CHANGED),
  getMcpTools: invoke(RPC_CHANNELS.sources.GET_MCP_TOOLS),
  reindexSources: invoke(RPC_CHANNELS.sources.REINDEX),
  searchSourcesIndex: invoke(RPC_CHANNELS.sources.SEARCH),

  // Session content search
  searchSessionContent: invoke(RPC_CHANNELS.sessions.SEARCH_CONTENT),

  // OAuth (server-owned credentials)
  oauthRevoke: invoke(RPC_CHANNELS.oauth.REVOKE),

  // Sources change listener
  onSourcesChanged: listener(RPC_CHANNELS.sources.CHANGED),

  // Skills
  getSkills: invoke(RPC_CHANNELS.skills.GET),
  getSkillFiles: invoke(RPC_CHANNELS.skills.GET_FILES),
  updateSkill: invoke(RPC_CHANNELS.skills.UPDATE),
  deleteSkill: invoke(RPC_CHANNELS.skills.DELETE),
  importOmpSkill: invoke(RPC_CHANNELS.skills.IMPORT_OMP),
  getSkillUsage: invoke(RPC_CHANNELS.skills.GET_USAGE),
  pruneSkills: invoke(RPC_CHANNELS.skills.PRUNE_UNUSED),
  exportSkillToProject: invoke(RPC_CHANNELS.skills.EXPORT_TO_PROJECT),
  openSkillInEditor: invoke(RPC_CHANNELS.skills.OPEN_EDITOR),
  openSkillInFinder: invoke(RPC_CHANNELS.skills.OPEN_FINDER),
  onSkillsChanged: listener(RPC_CHANNELS.skills.CHANGED),

  // Pending skills (self-learning candidates queue)
  listPendingSkills: invoke(RPC_CHANNELS.skillsPending.LIST),
  approvePendingSkill: invoke(RPC_CHANNELS.skillsPending.APPROVE),
  dismissPendingSkill: invoke(RPC_CHANNELS.skillsPending.DISMISS),
  diffPendingSkill: invoke(RPC_CHANNELS.skillsPending.DIFF),
  onSkillsPendingChanged: listener(RPC_CHANNELS.skillsPending.CHANGED),

  // Memory (self-learning)
  listMemoryLessons: invoke(RPC_CHANNELS.memory.LIST_LESSONS),
  addMemoryLesson: invoke(RPC_CHANNELS.memory.ADD_LESSON),
  updateMemoryLesson: invoke(RPC_CHANNELS.memory.UPDATE_LESSON),
  deleteMemoryLesson: invoke(RPC_CHANNELS.memory.DELETE_LESSON),
  getMemoryContext: invoke(RPC_CHANNELS.memory.GET_CONTEXT),
  getProjectMemory: invoke(RPC_CHANNELS.memory.GET_PROJECT_MEMORY),
  updateMemoryContext: invoke(RPC_CHANNELS.memory.UPDATE_CONTEXT),
  listMemoryHistory: invoke(RPC_CHANNELS.memory.LIST_HISTORY),
  listPromotionCandidates: invoke(RPC_CHANNELS.memory.PROMOTION_CANDIDATES),
  promoteLesson: invoke(RPC_CHANNELS.memory.PROMOTE_LESSON),
  listInsights: invoke(RPC_CHANNELS.memory.INSIGHTS),
  markMemoryOnboarded: invoke(RPC_CHANNELS.memory.MARK_ONBOARDED),
  onMemoryChanged: listener(RPC_CHANNELS.memory.CHANGED),

  // Statuses
  listStatuses: invoke(RPC_CHANNELS.statuses.LIST),
  reorderStatuses: invoke(RPC_CHANNELS.statuses.REORDER),
  onStatusesChanged: listener(RPC_CHANNELS.statuses.CHANGED),

  // Labels
  listLabels: invoke(RPC_CHANNELS.labels.LIST),
  createLabel: invoke(RPC_CHANNELS.labels.CREATE),
  updateLabel: invoke(RPC_CHANNELS.labels.UPDATE),
  deleteLabel: invoke(RPC_CHANNELS.labels.DELETE),
  onLabelsChanged: listener(RPC_CHANNELS.labels.CHANGED),

  // Organizations (P3.1)
  listOrganizations: invoke(RPC_CHANNELS.orgs.LIST),
  createOrganization: invoke(RPC_CHANNELS.orgs.CREATE),
  inviteToOrganization: invoke(RPC_CHANNELS.orgs.INVITE),
  acceptOrganizationInvite: invoke(RPC_CHANNELS.orgs.ACCEPT),
  listOrganizationMembers: invoke(RPC_CHANNELS.orgs.LIST_MEMBERS),
  getOrgIdentity: invoke(RPC_CHANNELS.orgs.GET_IDENTITY),
  updateOrgIdentity: invoke(RPC_CHANNELS.orgs.UPDATE_IDENTITY),

  // LLM connections change listener
  onLlmConnectionsChanged: listener(RPC_CHANNELS.llmConnections.CHANGED),

  // Views
  listViews: invoke(RPC_CHANNELS.views.LIST),
  saveViews: invoke(RPC_CHANNELS.views.SAVE),

  // Tool icon mappings
  getToolIconMappings: invoke(RPC_CHANNELS.toolIcons.GET_MAPPINGS),

  // Workspace images
  readWorkspaceImage: invoke(RPC_CHANNELS.workspace.READ_IMAGE),
  writeWorkspaceImage: invoke(RPC_CHANNELS.workspace.WRITE_IMAGE),

  // Theme
  getAppTheme: invoke(RPC_CHANNELS.theme.GET_APP),
  loadPresetThemes: invoke(RPC_CHANNELS.theme.GET_PRESETS),
  loadPresetTheme: invoke(RPC_CHANNELS.theme.LOAD_PRESET),
  getColorTheme: invoke(RPC_CHANNELS.theme.GET_COLOR_THEME),
  setColorTheme: invoke(RPC_CHANNELS.theme.SET_COLOR_THEME),
  getWorkspaceColorTheme: invoke(RPC_CHANNELS.theme.GET_WORKSPACE_COLOR_THEME),
  setWorkspaceColorTheme: invoke(RPC_CHANNELS.theme.SET_WORKSPACE_COLOR_THEME),
  getAllWorkspaceThemes: invoke(RPC_CHANNELS.theme.GET_ALL_WORKSPACE_THEMES),
  getLogoUrl: invoke(RPC_CHANNELS.logo.GET_URL),
  onAppThemeChange: listener(RPC_CHANNELS.theme.APP_CHANGED),
  broadcastThemePreferences: invoke(RPC_CHANNELS.theme.BROADCAST_PREFERENCES),
  onThemePreferencesChange: listener(RPC_CHANNELS.theme.PREFERENCES_CHANGED),
  broadcastWorkspaceThemeChange: invoke(RPC_CHANNELS.theme.BROADCAST_WORKSPACE_THEME),
  onWorkspaceThemeChange: listener(RPC_CHANNELS.theme.WORKSPACE_THEME_CHANGED),

  // Notifications
  showNotification: invoke(RPC_CHANNELS.notification.SHOW),
  getNotificationsEnabled: invoke(RPC_CHANNELS.notification.GET_ENABLED),
  setNotificationsEnabled: invoke(RPC_CHANNELS.notification.SET_ENABLED),

  // Input settings
  getAutoCapitalisation: invoke(RPC_CHANNELS.input.GET_AUTO_CAPITALISATION),
  setAutoCapitalisation: invoke(RPC_CHANNELS.input.SET_AUTO_CAPITALISATION),
  getSendMessageKey: invoke(RPC_CHANNELS.input.GET_SEND_MESSAGE_KEY),
  setSendMessageKey: invoke(RPC_CHANNELS.input.SET_SEND_MESSAGE_KEY),
  getSpellCheck: invoke(RPC_CHANNELS.input.GET_SPELL_CHECK),
  setSpellCheck: invoke(RPC_CHANNELS.input.SET_SPELL_CHECK),

  // Power settings
  getKeepAwakeWhileRunning: invoke(RPC_CHANNELS.power.GET_KEEP_AWAKE),
  setKeepAwakeWhileRunning: invoke(RPC_CHANNELS.power.SET_KEEP_AWAKE),

  // Appearance settings
  getRichToolDescriptions: invoke(RPC_CHANNELS.appearance.GET_RICH_TOOL_DESCRIPTIONS),
  setRichToolDescriptions: invoke(RPC_CHANNELS.appearance.SET_RICH_TOOL_DESCRIPTIONS),
  getDefaultZoomLevel: invoke(RPC_CHANNELS.appearance.GET_DEFAULT_ZOOM_LEVEL),
  setDefaultZoomLevel: invoke(RPC_CHANNELS.appearance.SET_DEFAULT_ZOOM_LEVEL),

  // Tools settings
  getBrowserToolEnabled: invoke(RPC_CHANNELS.tools.GET_BROWSER_TOOL_ENABLED),
  setBrowserToolEnabled: invoke(RPC_CHANNELS.tools.SET_BROWSER_TOOL_ENABLED),

  // Prompt caching & context
  getExtendedPromptCache: invoke(RPC_CHANNELS.caching.GET_EXTENDED_PROMPT_CACHE),
  setExtendedPromptCache: invoke(RPC_CHANNELS.caching.SET_EXTENDED_PROMPT_CACHE),
  getEnable1MContext: invoke(RPC_CHANNELS.caching.GET_ENABLE_1M_CONTEXT),
  setEnable1MContext: invoke(RPC_CHANNELS.caching.SET_ENABLE_1M_CONTEXT),

  // RTK token optimization
  getRtkEnabled: invoke(RPC_CHANNELS.rtk.GET_ENABLED),
  setRtkEnabled: invoke(RPC_CHANNELS.rtk.SET_ENABLED),
  getRtkStatus: invoke(RPC_CHANNELS.rtk.GET_STATUS),
  getRtkGain: invoke(RPC_CHANNELS.rtk.GET_GAIN),

  // Badge
  refreshBadge: invoke(RPC_CHANNELS.badge.REFRESH),
  setDockIconWithBadge: invoke(RPC_CHANNELS.badge.SET_ICON),
  onBadgeDraw: listener(RPC_CHANNELS.badge.DRAW),
  onBadgeDrawWindows: listener(RPC_CHANNELS.badge.DRAW_WINDOWS),

  // Window focus
  getWindowFocusState: invoke(RPC_CHANNELS.window.GET_FOCUS_STATE),
  onWindowFocusChange: listener(RPC_CHANNELS.window.FOCUS_STATE),
  onNotificationNavigate: listener(RPC_CHANNELS.notification.NAVIGATE),

  // Git
  getGitBranch: invoke(RPC_CHANNELS.git.GET_BRANCH),
  checkGitBash: invoke(RPC_CHANNELS.gitbash.CHECK),
  browseForGitBash: invoke(RPC_CHANNELS.gitbash.BROWSE),
  setGitBashPath: invoke(RPC_CHANNELS.gitbash.SET_PATH),

  // Menu actions
  menuQuit: invoke(RPC_CHANNELS.menu.QUIT),
  menuNewWindow: invoke(RPC_CHANNELS.menu.NEW_WINDOW),
  menuMinimize: invoke(RPC_CHANNELS.menu.MINIMIZE),
  menuMaximize: invoke(RPC_CHANNELS.menu.MAXIMIZE),
  menuZoomIn: invoke(RPC_CHANNELS.menu.ZOOM_IN),
  menuZoomOut: invoke(RPC_CHANNELS.menu.ZOOM_OUT),
  menuZoomReset: invoke(RPC_CHANNELS.menu.ZOOM_RESET),
  menuToggleDevTools: invoke(RPC_CHANNELS.menu.TOGGLE_DEV_TOOLS),
  menuUndo: invoke(RPC_CHANNELS.menu.UNDO),
  menuRedo: invoke(RPC_CHANNELS.menu.REDO),
  menuCut: invoke(RPC_CHANNELS.menu.CUT),
  menuCopy: invoke(RPC_CHANNELS.menu.COPY),
  menuPaste: invoke(RPC_CHANNELS.menu.PASTE),
  menuSelectAll: invoke(RPC_CHANNELS.menu.SELECT_ALL),

  // Browser pane management
  'browserPane.create': invoke(RPC_CHANNELS.browserPane.CREATE),
  'browserPane.createEmbedded': invoke(RPC_CHANNELS.browserPane.CREATE_EMBEDDED),
  'browserPane.syncBounds': invoke(RPC_CHANNELS.browserPane.SYNC_BOUNDS),
  'browserPane.destroy': invoke(RPC_CHANNELS.browserPane.DESTROY),
  'browserPane.list': invoke(RPC_CHANNELS.browserPane.LIST),
  'browserPane.navigate': invoke(RPC_CHANNELS.browserPane.NAVIGATE),
  'browserPane.goBack': invoke(RPC_CHANNELS.browserPane.GO_BACK),
  'browserPane.goForward': invoke(RPC_CHANNELS.browserPane.GO_FORWARD),
  'browserPane.reload': invoke(RPC_CHANNELS.browserPane.RELOAD),
  'browserPane.stop': invoke(RPC_CHANNELS.browserPane.STOP),
  'browserPane.focus': invoke(RPC_CHANNELS.browserPane.FOCUS),
  'browserPane.resize': invoke(RPC_CHANNELS.browserPane.RESIZE),
  'browserPane.snapshot': invoke(RPC_CHANNELS.browserPane.SNAPSHOT),
  'browserPane.click': invoke(RPC_CHANNELS.browserPane.CLICK),
  'browserPane.clickAt': invoke(RPC_CHANNELS.browserPane.CLICK_AT),
  'browserPane.fill': invoke(RPC_CHANNELS.browserPane.FILL),
  'browserPane.typeText': invoke(RPC_CHANNELS.browserPane.TYPE),
  'browserPane.sendKey': invoke(RPC_CHANNELS.browserPane.KEY),
  'browserPane.select': invoke(RPC_CHANNELS.browserPane.SELECT),
  'browserPane.screenshotImage': invoke(RPC_CHANNELS.browserPane.SCREENSHOT),
  'browserPane.scroll': invoke(RPC_CHANNELS.browserPane.SCROLL),
  'browserPane.evaluate': invoke(RPC_CHANNELS.browserPane.EVALUATE),
  'browserPane.emptyStateLaunch': invoke(RPC_CHANNELS.browserPane.LAUNCH),
  'browserPane.onStateChanged': listener(RPC_CHANNELS.browserPane.STATE_CHANGED),
  'browserPane.onRemoved': listener(RPC_CHANNELS.browserPane.REMOVED),
  'browserPane.onInteracted': listener(RPC_CHANNELS.browserPane.INTERACTED),

  // LLM Connections
  listLlmConnections: invoke(RPC_CHANNELS.llmConnections.LIST),
  listLlmConnectionsWithStatus: invoke(RPC_CHANNELS.llmConnections.LIST_WITH_STATUS),
  getLlmConnection: invoke(RPC_CHANNELS.llmConnections.GET),
  getLlmConnectionApiKey: invoke(RPC_CHANNELS.llmConnections.GET_API_KEY),
  saveLlmConnection: invoke(RPC_CHANNELS.llmConnections.SAVE),
  deleteLlmConnection: invoke(RPC_CHANNELS.llmConnections.DELETE),
  testLlmConnection: invoke(RPC_CHANNELS.llmConnections.TEST),
  setDefaultLlmConnection: invoke(RPC_CHANNELS.llmConnections.SET_DEFAULT),
  setWorkspaceDefaultLlmConnection: invoke(RPC_CHANNELS.llmConnections.SET_WORKSPACE_DEFAULT),

  // Projects
  getProjects: invoke(RPC_CHANNELS.projects.GET),
  getProject: invoke(RPC_CHANNELS.projects.GET_ONE),
  createProject: invoke(RPC_CHANNELS.projects.CREATE),
  updateProject: invoke(RPC_CHANNELS.projects.UPDATE),
  deleteProject: invoke(RPC_CHANNELS.projects.DELETE),
  listProjectAssets: invoke(RPC_CHANNELS.projects.LIST_ASSETS),
  uploadProjectAsset: invoke(RPC_CHANNELS.projects.UPLOAD_ASSET),
  deleteProjectAsset: invoke(RPC_CHANNELS.projects.DELETE_ASSET),
  onProjectsChanged: listener(RPC_CHANNELS.projects.CHANGED),

  // Kanban board config
  getKanbanConfig: invoke(RPC_CHANNELS.kanban.GET_CONFIG),
  enrichMindMap: invoke(RPC_CHANNELS.mindmap.ENRICH),
  mindmapPinLoad: invoke(RPC_CHANNELS.mindmap.PIN_LOAD),
  mindmapPinSave: invoke(RPC_CHANNELS.mindmap.PIN_SAVE),
  mindmapPinClear: invoke(RPC_CHANNELS.mindmap.PIN_CLEAR),
  setKanbanConfig: invoke(RPC_CHANNELS.kanban.SET_CONFIG),
  onKanbanConfigChanged: listener(RPC_CHANNELS.kanban.CHANGED),

  // Sessions collection display
  getCollectionDisplay: invoke(RPC_CHANNELS.collection.GET_DISPLAY),
  setCollectionDisplay: invoke(RPC_CHANNELS.collection.SET_DISPLAY),
  onCollectionDisplayChanged: listener(RPC_CHANNELS.collection.CHANGED),

  // B4 bulk sessions
  bulkUpdateSessions: invoke(RPC_CHANNELS.sessions.BULK_UPDATE),
  onSessionsBulkChanged: listener(RPC_CHANNELS.sessions.BULK_CHANGED),


  // Automations
  getAutomations: invoke(RPC_CHANNELS.automations.GET),
  getAutomationGraph: invoke(RPC_CHANNELS.automations.GET_GRAPH),
  saveAutomationGraph: invoke(RPC_CHANNELS.automations.SAVE_GRAPH),
  testAutomation: invoke(RPC_CHANNELS.automations.TEST),
  setAutomationEnabled: invoke(RPC_CHANNELS.automations.SET_ENABLED),
  duplicateAutomation: invoke(RPC_CHANNELS.automations.DUPLICATE),
  deleteAutomation: invoke(RPC_CHANNELS.automations.DELETE),
  getAutomationHistory: invoke(RPC_CHANNELS.automations.GET_HISTORY),
  getAutomationLastExecuted: invoke(RPC_CHANNELS.automations.GET_LAST_EXECUTED),
  replayAutomation: invoke(RPC_CHANNELS.automations.REPLAY),
  onAutomationsChanged: listener(RPC_CHANNELS.automations.CHANGED),

  // Resources (cross-workspace export/import)
  exportResources: invoke(RPC_CHANNELS.resources.EXPORT),
  importResources: invoke(RPC_CHANNELS.resources.IMPORT),

  // Messaging gateway
  getMessagingConfig: invoke(RPC_CHANNELS.messaging.GET_CONFIG),
  updateMessagingConfig: invoke(RPC_CHANNELS.messaging.UPDATE_CONFIG),
  testTelegramToken: invoke(RPC_CHANNELS.messaging.TEST_TELEGRAM),
  saveTelegramToken: invoke(RPC_CHANNELS.messaging.SAVE_TELEGRAM),
  testLarkCredentials: invoke(RPC_CHANNELS.messaging.TEST_LARK),
  saveLarkCredentials: invoke(RPC_CHANNELS.messaging.SAVE_LARK),
  testDiscordCredentials: invoke(RPC_CHANNELS.messaging.TEST_DISCORD),
  saveDiscordCredentials: invoke(RPC_CHANNELS.messaging.SAVE_DISCORD),
  disconnectMessagingPlatform: invoke(RPC_CHANNELS.messaging.DISCONNECT),
  forgetMessagingPlatform: invoke(RPC_CHANNELS.messaging.FORGET),
  getMessagingBindings: invoke(RPC_CHANNELS.messaging.GET_BINDINGS),
  generateMessagingPairingCode: invoke(RPC_CHANNELS.messaging.GENERATE_CODE),
  generateMessagingSupergroupCode: invoke(RPC_CHANNELS.messaging.GENERATE_SUPERGROUP_CODE),
  getMessagingSupergroup: invoke(RPC_CHANNELS.messaging.GET_SUPERGROUP),
  unbindMessagingSupergroup: invoke(RPC_CHANNELS.messaging.UNBIND_SUPERGROUP),
  unbindMessagingSession: invoke(RPC_CHANNELS.messaging.UNBIND),
  unbindMessagingBinding: invoke(RPC_CHANNELS.messaging.UNBIND_BINDING),
  onMessagingBindingChanged: listener(RPC_CHANNELS.messaging.BINDING_CHANGED),
  onMessagingPlatformStatus: listener(RPC_CHANNELS.messaging.PLATFORM_STATUS),
  startWhatsAppConnect: invoke(RPC_CHANNELS.messaging.WA_START_CONNECT),
  submitWhatsAppPhone: invoke(RPC_CHANNELS.messaging.WA_SUBMIT_PHONE),
  onWhatsAppEvent: listener(RPC_CHANNELS.messaging.WA_UI_EVENT),
  startWeChatConnect: invoke(RPC_CHANNELS.messaging.WECHAT_START_CONNECT),
  submitWeChatVerifyCode: invoke(RPC_CHANNELS.messaging.WECHAT_SUBMIT_CODE),
  onWeChatEvent: listener(RPC_CHANNELS.messaging.WECHAT_UI_EVENT),



  // Messaging access control (Phase 3)
  getMessagingPlatformOwners: invoke(RPC_CHANNELS.messaging.GET_PLATFORM_OWNERS),
  setMessagingPlatformOwners: invoke(RPC_CHANNELS.messaging.SET_PLATFORM_OWNERS),
  getMessagingPlatformAccessMode: invoke(RPC_CHANNELS.messaging.GET_PLATFORM_ACCESS_MODE),
  setMessagingPlatformAccessMode: invoke(RPC_CHANNELS.messaging.SET_PLATFORM_ACCESS_MODE),
  getMessagingPendingSenders: invoke(RPC_CHANNELS.messaging.GET_PENDING_SENDERS),
  dismissMessagingPendingSender: invoke(RPC_CHANNELS.messaging.DISMISS_PENDING_SENDER),
  allowMessagingPendingSender: invoke(RPC_CHANNELS.messaging.ALLOW_PENDING_SENDER),
  setMessagingBindingAccess: invoke(RPC_CHANNELS.messaging.SET_BINDING_ACCESS),
  onMessagingPendingChanged: listener(RPC_CHANNELS.messaging.PENDING_CHANGED),
  // Context documents (runtime context/*.md)
  listContextDocs: invoke(RPC_CHANNELS.contextDocs.LIST),
  readContextDoc: invoke(RPC_CHANNELS.contextDocs.READ),
  writeContextDoc: invoke(RPC_CHANNELS.contextDocs.WRITE),
  deleteContextDoc: invoke(RPC_CHANNELS.contextDocs.DELETE),
  readContextDocTemplate: invoke(RPC_CHANNELS.contextDocs.READ_TEMPLATE),
  acceptContextDocTemplate: invoke(RPC_CHANNELS.contextDocs.ACCEPT_TEMPLATE),
  keepMineContextDocTemplate: invoke(RPC_CHANNELS.contextDocs.KEEP_MINE_TEMPLATE),
  onContextDocsChanged: listener(RPC_CHANNELS.contextDocs.CHANGED),

  // Bundled skill packs (preset skills enable/disable)
  listBundledSkillPacks: invoke(RPC_CHANNELS.bundledSkills.LIST),
  getBundledSkillsDisabled: invoke(RPC_CHANNELS.bundledSkills.GET_DISABLED),
  setBundledSkillsDisabled: invoke(RPC_CHANNELS.bundledSkills.SET_DISABLED),
  onBundledSkillsChanged: listener(RPC_CHANNELS.bundledSkills.CHANGED),

  // Marketplace (curated skills/tools/context-docs)
  getMarketplaceCatalog: invoke(RPC_CHANNELS.marketplace.CATALOG),
  getMarketplaceStats: invoke(RPC_CHANNELS.marketplace.STATS),
  installMarketplaceEntry: invoke(RPC_CHANNELS.marketplace.INSTALL),
  removeMarketplaceEntry: invoke(RPC_CHANNELS.marketplace.REMOVE),
  updateMarketplaceEntry: invoke(RPC_CHANNELS.marketplace.UPDATE),
  refreshMarketplaceCatalog: invoke(RPC_CHANNELS.marketplace.REFRESH),
  onMarketplaceProgress: listener(RPC_CHANNELS.marketplace.PROGRESS),
  onMarketplaceChanged: listener(RPC_CHANNELS.marketplace.CHANGED),
} satisfies ChannelMap
