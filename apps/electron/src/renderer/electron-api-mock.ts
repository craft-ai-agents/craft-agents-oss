/**
 * electron-api-mock.ts
 *
 * Minimal mock for `window.electronAPI` so the ARCHstudio renderer can run
 * standalone in the browser (Vite dev server on port 5173) without the
 * Electron main process and preload script.
 *
 * Every method returns a sensible default — empty arrays, null, false, or a
 * no-op. Event listeners return a no-op cleanup function.
 *
 * Import this in `main.tsx` before any React rendering to smash the global.
 */

import type { ElectronAPI } from '../shared/types'

// Re-use the same global declaration from types.ts so TS is happy.
// The import above serves as a type-only reference; the actual mock
// is built below and assigned to window.electronAPI.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function noop(): void {}
function noopCleanup(): () => void {
  return noop
}
function emptyArray<T>(): T[] {
  return []
}
function emptyObject(): Record<string, never> {
  return {}
}
function nullResult<T = null>(): T | null {
  return null as T | null
}
function falseResult(): Promise<false> {
  return Promise.resolve(false as false)
}
function trueResult(): Promise<true> {
  return Promise.resolve(true as true)
}
function voidResult(): Promise<void> {
  return Promise.resolve()
}
function okResult<T = { success: true }>(): Promise<T> {
  return Promise.resolve({ success: true } as T)
}

/**
 * Best-effort platform detection for the browser playground.
 *
 * Several APIs (`checkGitBash`, `listServerDirectory`) report the *server*
 * platform. Standalone there is no server, so we report the platform the
 * browser is running on — the honest answer for the machine at hand, and it
 * keeps platform-conditional UI (e.g. the Windows-only Git Bash warning)
 * exercising the same branch a real user on this OS would hit.
 */
function mockPlatform(): 'win32' | 'darwin' | 'linux' {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  if (/Windows/i.test(ua)) return 'win32'
  if (/Mac OS X|Macintosh/i.test(ua)) return 'darwin'
  return 'linux'
}

// ---------------------------------------------------------------------------
// Mock implementation
// ---------------------------------------------------------------------------

const mock: ElectronAPI = {
  // ── Session management ────────────────────────────────────────────────
  getSessions: () => Promise.resolve([]),
  getUnreadSummary: () => Promise.resolve({
    totalUnreadSessions: 0,
    byWorkspace: {},
    hasUnreadByWorkspace: {},
  }),
  markAllSessionsRead: voidResult,
  getSessionMessages: () => Promise.resolve(null),
  createSession: (workspaceId: string) => Promise.resolve({
    id: 'mock-session',
    workspaceId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as any),
  deleteSession: voidResult,
  sendMessage: voidResult,
  cancelProcessing: voidResult,
  killShell: () => Promise.resolve({ success: true, error: undefined }),

  // ── Tasks ─────────────────────────────────────────────────────────────
  validateTask: () => Promise.resolve({ valid: true, errors: [], warnings: [] }),
  createTask: () => Promise.resolve({ ok: true } as any),
  generateTask: () => Promise.resolve({ ok: true } as any),
  onTaskGenerated: () => noop,
  runTask: () => Promise.resolve({} as any),
  pauseTask: voidResult,
  resumeTask: voidResult,
  stopTask: voidResult,
  getTask: () => Promise.resolve({
    slug: '',
    validation: { valid: true, errors: [], warnings: [] },
    run: null,
  }),
  listTasks: () => Promise.resolve([]),
  getTaskResults: () => Promise.resolve({} as any),
  getTaskOutput: () => Promise.resolve(null),

  // ── Permissions & credentials ─────────────────────────────────────────
  respondToPermission: () => Promise.resolve(true),
  respondToCredential: () => Promise.resolve(true),

  // ── Session commands ──────────────────────────────────────────────────
  sessionCommand: () => Promise.resolve(),

  // ── Server info ───────────────────────────────────────────────────────
  getServerHomeDir: () => Promise.resolve('/home/user'),
  getServerConfig: () => Promise.resolve({
    enabled: false,
    port: 3100,
    token: '',
  }),
  setServerConfig: voidResult,
  getServerStatus: () => Promise.resolve({
    running: false,
    host: '127.0.0.1',
    port: 3100,
    tls: false,
    url: 'ws://127.0.0.1:3100',
    token: '',
    needsRestart: false,
    insecureWarning: false,
  }),

  // ── App lifecycle ─────────────────────────────────────────────────────
  relaunchApp: voidResult,
  removeWorkspace: () => Promise.resolve(true),
  invokeOnServer: () => Promise.resolve(null),

  // ── Session transfer ──────────────────────────────────────────────────
  transferSessionToWorkspace: () => Promise.resolve({ sessionId: 'mock' }),
  onTransferProgress: () => noop,
  exportSession: () => Promise.resolve({}),
  importSession: () => Promise.resolve({ sessionId: 'mock' }),
  exportRemoteSessionTransfer: () => Promise.resolve({} as any),
  importRemoteSessionTransfer: () => Promise.resolve({} as any),
  getPendingPlanExecution: () => Promise.resolve(null),
  getSessionPermissionModeState: () => Promise.resolve(null),

  // ── Workspace management ──────────────────────────────────────────────
  getWorkspaces: () => Promise.resolve([]),
  createWorkspace: () => Promise.resolve({} as any),
  checkWorkspaceSlug: () => Promise.resolve({ exists: false, path: '' }),
  updateWorkspaceRemoteServer: () => Promise.resolve({ success: true }),
  getServerWorkspaces: () => Promise.resolve([]),
  createServerWorkspace: () => Promise.resolve({} as any),
  testRemoteConnection: () => Promise.resolve({
    ok: false,
    error: 'Not connected',
  }),

  // ── Window management ─────────────────────────────────────────────────
  getWindowWorkspace: () => Promise.resolve(null),
  getWindowMode: () => Promise.resolve(null),
  openWorkspace: voidResult,
  openSessionInNewWindow: voidResult,
  switchWorkspace: voidResult,
  closeWindow: voidResult,
  confirmCloseWindow: voidResult,
  cancelCloseWindow: voidResult,
  onCloseRequested: () => noop,
  setTrafficLightsVisible: voidResult,

  // ── Event listeners ───────────────────────────────────────────────────
  onSessionEvent: () => noop,
  onUnreadSummaryChanged: () => noop,

  // ── File operations ───────────────────────────────────────────────────
  readFile: () => Promise.resolve(''),
  readFileBinary: () => Promise.resolve(new Uint8Array()),
  readFileDataUrl: () => Promise.resolve(''),
  readFilePreviewDataUrl: () => Promise.resolve(''),
  openFileDialog: () => Promise.resolve([]),
  readFileAttachment: () => Promise.resolve(null),
  readUserAttachment: () => Promise.resolve(null),
  storeAttachment: () => Promise.resolve({} as any),
  generateThumbnail: () => Promise.resolve(null),
  getFilePath: () => null,

  // ── Filesystem search ─────────────────────────────────────────────────
  searchFiles: () => Promise.resolve([]),
  listServerDirectory: () => Promise.resolve({
    currentPath: '/mock',
    parentPath: null,
    breadcrumbs: [],
    platform: mockPlatform(),
    truncated: false,
    totalEntries: 0,
    entries: [],
  }),
  listDirectoryFiles: () => Promise.resolve({
    currentPath: '/mock',
    parentPath: null,
    entries: [
      { name: 'file1.ts', path: '/mock/file1.ts', type: 'file' as const, size: 1024, mtime: Date.now(), ctime: Date.now() - 60_000 /* 1 min older, so the ctime line renders */, isSymlink: false },
      { name: 'src', path: '/mock/src', type: 'directory' as const, isSymlink: false },
    ],
  }),
  debugLog: noop,

  // ── Theme ─────────────────────────────────────────────────────────────
  getSystemTheme: () => Promise.resolve(false), // light mode
  onSystemThemeChange: () => noop,

  // ── System ────────────────────────────────────────────────────────────
  getVersions: () => ({
    node: '22.0.0',
    chrome: '120.0.0',
    electron: '39.0.0',
  }),
  getRuntimeEnvironment: () => 'web' as const,
  getHomeDir: () => Promise.resolve('/home/user'),
  getConfigDir: () => Promise.resolve('/home/user/.archstudio'),
  isDebugMode: () => Promise.resolve(false),

  // ── Transport ─────────────────────────────────────────────────────────
  getTransportConnectionState: () => Promise.resolve({
    mode: 'local',
    status: 'connected',
    url: 'http://localhost:5173',
    attempt: 0,
    updatedAt: Date.now(),
  }),
  onTransportConnectionStateChanged: () => noop,
  reconnectTransport: voidResult,
  onReconnected: () => noop,
  isChannelAvailable: () => false,

  // ── Auto-update ───────────────────────────────────────────────────────
  checkForUpdates: () => Promise.resolve({} as any),
  getUpdateInfo: () => Promise.resolve({} as any),
  installUpdate: voidResult,
  dismissUpdate: voidResult,
  getDismissedUpdateVersion: () => Promise.resolve(null),
  onUpdateAvailable: () => noop,
  onUpdateDownloadProgress: () => noop,

  // ── Release notes ─────────────────────────────────────────────────────
  getReleaseNotes: () => Promise.resolve(''),
  getLatestReleaseVersion: () => Promise.resolve(undefined),

  // ── System warnings ───────────────────────────────────────────────────
  getSystemWarnings: () => Promise.resolve({ vcredistMissing: false }),

  // ── Shell operations ──────────────────────────────────────────────────
  openUrl: voidResult,
  openFile: voidResult,
  showInFolder: voidResult,

  // ── Menu events ───────────────────────────────────────────────────────
  onMenuNewChat: () => noop,
  onMenuOpenSettings: () => noop,
  onMenuKeyboardShortcuts: () => noop,
  onMenuToggleFocusMode: () => noop,
  onMenuToggleSidebar: () => noop,
  onDeepLinkNavigate: () => noop,

  // ── Auth ──────────────────────────────────────────────────────────────
  showLogoutConfirmation: () => Promise.resolve(false),
  showDeleteSessionConfirmation: () => Promise.resolve(false),
  logout: voidResult,
  getCredentialHealth: () => Promise.resolve({
    healthy: true,
    issues: [],
  }),

  // ── Onboarding ────────────────────────────────────────────────────────
  getAuthState: () => Promise.resolve({
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
  }),
  getSetupNeeds: () => Promise.resolve({
    needsBillingConfig: true,
    needsCredentials: false,
    isFullyConfigured: false,
  }),
  startWorkspaceMcpOAuth: () => Promise.resolve({ success: false } as any),
  startClaudeOAuth: () => Promise.resolve({ success: false }),
  exchangeClaudeCode: () => Promise.resolve({ success: false } as any),
  hasClaudeOAuthState: () => Promise.resolve(false),
  clearClaudeOAuthState: () => Promise.resolve({ success: true }),
  deferSetup: () => Promise.resolve({ success: true }),
  getLastConnectedProvider: () => Promise.resolve(null),
  setLastConnectedProvider: () => Promise.resolve({ success: true }),

  // ── ChatGPT OAuth ─────────────────────────────────────────────────────
  startChatGptOAuth: () => Promise.resolve({ success: false, error: 'Mock: not available' }),
  cancelChatGptOAuth: () => Promise.resolve({ success: true }),
  getChatGptAuthStatus: () => Promise.resolve({ authenticated: false }),
  chatGptLogout: () => Promise.resolve({ success: true }),

  // ── Copilot OAuth ─────────────────────────────────────────────────────
  startCopilotOAuth: () => Promise.resolve({ success: false, error: 'Mock: not available' }),
  cancelCopilotOAuth: () => Promise.resolve({ success: true }),
  getCopilotAuthStatus: () => Promise.resolve({ authenticated: false }),
  copilotLogout: () => Promise.resolve({ success: true }),
  onCopilotDeviceCode: () => noop,

  // ── LLM Connection setup ──────────────────────────────────────────────
  setupLlmConnection: () => Promise.resolve({ success: true }),
  testLlmConnectionSetup: () => Promise.resolve({ success: true } as any),
  getPiApiKeyProviders: () => Promise.resolve([
    { key: 'openai', label: 'OpenAI', placeholder: 'sk-...' },
    { key: 'anthropic', label: 'Anthropic', placeholder: 'sk-ant-...' },
  ]),
  getPiProviderBaseUrl: () => Promise.resolve(undefined),
  getPiProviderModels: () => Promise.resolve({ models: [], totalCount: 0 }),

  // ── Session model ─────────────────────────────────────────────────────
  getSessionModel: () => Promise.resolve(null),
  setSessionModel: voidResult,

  // ── Workspace settings ────────────────────────────────────────────────
  getWorkspaceSettings: () => Promise.resolve(null),
  updateWorkspaceSetting: voidResult,

  // ── Folder dialog ─────────────────────────────────────────────────────
  openFolderDialog: () => Promise.resolve(null),

  // ── Preferences ───────────────────────────────────────────────────────
  readPreferences: () => Promise.resolve({
    content: JSON.stringify({ version: '1.0' }),
    exists: true,
    path: '/mock/preferences.json',
  }),
  writePreferences: () => Promise.resolve({ success: true }),

  // ── Drafts ────────────────────────────────────────────────────────────
  getDraft: () => Promise.resolve(null),
  setDraft: voidResult,
  deleteDraft: voidResult,
  getAllDrafts: () => Promise.resolve({}),

  // ── Session files & media ─────────────────────────────────────────────
  getSessionFiles: () => Promise.resolve([]),
  mediaList: () => Promise.resolve({
    items: [],
    hasMore: false,
    nextCursor: null,
  } as any),
  comfyHealth: () => Promise.resolve({ connected: false, baseUrl: 'http://127.0.0.1:8188' }),
  comfyWorkflows: () => Promise.resolve({ workflows: [], rejectedCount: 0 }),
  comfyRun: () => Promise.resolve({ promptId: 'mock-comfy-prompt' }),
  comfyStatus: (request) => Promise.resolve({ promptId: request.promptId, state: 'unknown' as const }),
  comfyCancel: voidResult,
  getSessionNotes: () => Promise.resolve(''),
  setSessionNotes: voidResult,
  watchSessionFiles: voidResult,
  unwatchSessionFiles: voidResult,
  onSessionFilesChanged: () => noop,

  // ── Sources ───────────────────────────────────────────────────────────
  getSources: () => Promise.resolve([]),
  createSource: () => Promise.resolve({} as any),
  deleteSource: voidResult,
  startSourceOAuth: () => Promise.resolve({ success: true }),
  saveSourceCredentials: voidResult,
  getSourcePermissionsConfig: () => Promise.resolve(null),
  getWorkspacePermissionsConfig: () => Promise.resolve(null),
  getDefaultPermissionsConfig: () => Promise.resolve({ config: null, path: '' }),
  getMcpTools: () => Promise.resolve({ success: true, tools: [] }),
  performOAuth: () => Promise.resolve({ success: false, error: 'Mock: not available' }),
  oauthRevoke: () => Promise.resolve({ success: true }),
  searchSessionContent: () => Promise.resolve([]),
  onSourcesChanged: () => noop,
  onDefaultPermissionsChanged: () => noop,

  // ── Skills ────────────────────────────────────────────────────────────
  getSkills: () => Promise.resolve([]),
  getSkillFiles: () => Promise.resolve([]),
  deleteSkill: voidResult,
  openSkillInEditor: voidResult,
  openSkillInFinder: voidResult,
  onSkillsChanged: () => noop,

  // ── Statuses ──────────────────────────────────────────────────────────
  listStatuses: () => Promise.resolve([]),
  reorderStatuses: voidResult,
  onStatusesChanged: () => noop,

  // ── Labels ────────────────────────────────────────────────────────────
  listLabels: () => Promise.resolve([]),
  createLabel: () => Promise.resolve({} as any),
  deleteLabel: () => Promise.resolve({ stripped: 0 }),
  onLabelsChanged: () => noop,

  // ── Connections change listeners ──────────────────────────────────────
  onLlmConnectionsChanged: () => noop,

  // ── Views ─────────────────────────────────────────────────────────────
  listViews: () => Promise.resolve([]),
  saveViews: voidResult,

  // ── Workspace images ──────────────────────────────────────────────────
  readWorkspaceImage: () => Promise.resolve(''),
  writeWorkspaceImage: voidResult,

  // ── Tool icon mappings ────────────────────────────────────────────────
  getToolIconMappings: () => Promise.resolve([]),

  // ── Theme ─────────────────────────────────────────────────────────────
  getAppTheme: () => Promise.resolve(null),
  loadPresetThemes: () => Promise.resolve([]),
  loadPresetTheme: () => Promise.resolve(null),
  getColorTheme: () => Promise.resolve('default'),
  setColorTheme: voidResult,
  getWorkspaceColorTheme: () => Promise.resolve(null),
  setWorkspaceColorTheme: voidResult,
  getAllWorkspaceThemes: () => Promise.resolve({}),
  onAppThemeChange: () => noop,

  // ── Logo ──────────────────────────────────────────────────────────────
  getLogoUrl: () => Promise.resolve(null),

  // ── Notifications ─────────────────────────────────────────────────────
  showNotification: voidResult,
  getNotificationsEnabled: () => Promise.resolve(false),
  setNotificationsEnabled: voidResult,

  // ── Input settings ────────────────────────────────────────────────────
  getAutoCapitalisation: () => Promise.resolve(true),
  setAutoCapitalisation: voidResult,
  getSendMessageKey: () => Promise.resolve('enter' as const),
  setSendMessageKey: voidResult,
  getSpellCheck: () => Promise.resolve(true),
  setSpellCheck: voidResult,

  // ── Power ─────────────────────────────────────────────────────────────
  getKeepAwakeWhileRunning: () => Promise.resolve(false),
  setKeepAwakeWhileRunning: voidResult,

  // ── Tools ─────────────────────────────────────────────────────────────
  getBrowserToolEnabled: () => Promise.resolve(true),
  setBrowserToolEnabled: voidResult,
  getRichToolDescriptions: () => Promise.resolve(true),
  setRichToolDescriptions: voidResult,

  // ── Prompt caching ────────────────────────────────────────────────────
  getExtendedPromptCache: () => Promise.resolve(false),
  setExtendedPromptCache: voidResult,
  getEnable1MContext: () => Promise.resolve(false),
  setEnable1MContext: voidResult,

  // ── RTK ───────────────────────────────────────────────────────────────
  getRtkEnabled: () => Promise.resolve(false),
  setRtkEnabled: voidResult,
  getRtkStatus: () => Promise.resolve({ installed: false, path: null, version: null }),
  getRtkGain: () => Promise.resolve(null),

  // ── Proxy ─────────────────────────────────────────────────────────────
  getNetworkProxySettings: () => Promise.resolve(undefined),
  setNetworkProxySettings: voidResult,

  // ── Badge / dock / focus ──────────────────────────────────────────────
  refreshBadge: voidResult,
  setDockIconWithBadge: voidResult,
  onBadgeDraw: () => noop,
  onBadgeDrawWindows: () => noop,
  getWindowFocusState: () => Promise.resolve(true),
  onWindowFocusChange: () => noop,
  onNotificationNavigate: () => noop,

  // ── Theme sync ────────────────────────────────────────────────────────
  broadcastThemePreferences: voidResult,
  onThemePreferencesChange: () => noop,
  broadcastWorkspaceThemeChange: voidResult,
  onWorkspaceThemeChange: () => noop,

  // ── Git ───────────────────────────────────────────────────────────────
  getGitBranch: () => Promise.resolve(null),
  getGitStatus: () => Promise.resolve({
    branch: null,
    dirPath: '',
    files: [],
  }),
  getFileGitDiff: () => Promise.resolve({
    original: null,
    modified: null,
    additions: 0,
    deletions: 0,
    isBinary: false,
  }),
  checkGitBash: () => Promise.resolve({ found: false, path: null, platform: mockPlatform() }),
  browseForGitBash: () => Promise.resolve(null),
  setGitBashPath: () => Promise.resolve({ success: true }),

  // ── ARCH command panel ────────────────────────────────────────────────
  runArchCommand: () => Promise.resolve({ code: 0, output: '', durationMs: 0, killed: false }),
  killArchCommand: () => Promise.resolve({ success: true }),

  // ── Memory ────────────────────────────────────────────────────────────
  listMemories: () => Promise.resolve([]),
  getMemory: () => Promise.resolve(null),
  createMemory: (m: any) => Promise.resolve(m),
  updateMemory: (_id: string, patch: any) => Promise.resolve(patch),
  archiveMemory: () => Promise.resolve({} as any),
  restoreMemory: () => Promise.resolve({} as any),
  deleteMemory: () => Promise.resolve({ success: true }),
  searchMemories: () => Promise.resolve([]),
  getMemoryGraph: () => Promise.resolve({ memories: [], edges: [] }),
  getMemoryStats: () => Promise.resolve({
    classDistribution: {},
    totalActive: 0,
    totalArchived: 0,
    ftsHealth: { memoriesRows: 0, ftsRows: 0, healthy: true },
    vault: { root: '', filesOnDisk: 0, lastImportAt: null },
    graph: { edgeCount: 0, edgeTypeDistribution: {} },
  }),
  importMemoriesFromVault: () => Promise.resolve({ read: 0, imported: 0, skipped: 0, errors: [] }),
  getVaultInfo: () => Promise.resolve({ path: '', isCustom: false, exists: false }),
  setVaultPath: (_path: string) => Promise.resolve({ success: true, path: '' }),
  openVaultFolder: () => Promise.resolve({ success: true }),
  syncVault: () => Promise.resolve([]),
  getVaultWatcherStatus: () => Promise.resolve({ active: false }),
  createMemoryEdge: (_sourceId: string, _targetId: string, _type: string, _weight?: number) => Promise.resolve({} as any),
  deleteMemoryEdge: (_edgeId: string) => Promise.resolve({ success: true }),
  getMemoryEdges: (_memoryId: string) => Promise.resolve([]),

  // ── Prompt compiler ───────────────────────────────────────────────────
  compilePrompt: () => Promise.resolve({
    id: 'mock-compile',
    prompt: '',
    version: 1,
    compilerVersion: 1,
    timestamp: Date.now(),
    layers: [],
    layerOrder: [],
    tokenEstimates: {},
    stability: {},
  } as any),
  invalidatePromptCache: () => Promise.resolve({ success: true }),
  resolveWorkspaceContext: () => Promise.resolve(null),
  onContextFilesChanged: () => noop,

  // ── Menu actions ──────────────────────────────────────────────────────
  menuQuit: voidResult,
  menuNewWindow: voidResult,
  menuMinimize: voidResult,
  menuMaximize: voidResult,
  menuZoomIn: voidResult,
  menuZoomOut: voidResult,
  menuZoomReset: voidResult,
  menuToggleDevTools: voidResult,
  menuUndo: voidResult,
  menuRedo: voidResult,
  menuCut: voidResult,
  menuCopy: voidResult,
  menuPaste: voidResult,
  menuSelectAll: voidResult,

  // ── Browser panes ─────────────────────────────────────────────────────
  browserPane: {
    create: () => Promise.resolve('mock-browser-id'),
    destroy: voidResult,
    list: () => Promise.resolve([]),
    navigate: () => Promise.resolve({ url: '', title: '' }),
    goBack: voidResult,
    goForward: voidResult,
    reload: voidResult,
    stop: voidResult,
    focus: voidResult,
    emptyStateLaunch: () => Promise.resolve({ ok: true, handled: false }),
    onStateChanged: () => noop,
    onRemoved: () => noop,
    onInteracted: () => noop,
  },

  // ── LLM connections ───────────────────────────────────────────────────
  listLlmConnections: () => Promise.resolve([]),
  listLlmConnectionsWithStatus: () => Promise.resolve([]),
  getLlmConnection: () => Promise.resolve(null),
  getLlmConnectionApiKey: () => Promise.resolve(null),
  saveLlmConnection: () => Promise.resolve({ success: true }),
  deleteLlmConnection: () => Promise.resolve({ success: true }),
  testLlmConnection: () => Promise.resolve({ success: true }),
  setDefaultLlmConnection: () => Promise.resolve({ success: true }),
  getDefaultThinkingLevel: () => Promise.resolve('medium' as any),
  setDefaultThinkingLevel: () => Promise.resolve({ success: true }),
  setWorkspaceDefaultLlmConnection: () => Promise.resolve({ success: true }),

  // ── Inference history ─────────────────────────────────────────────────
  getLlmInferenceHistory: () => Promise.resolve({
    slug: '',
    events: [],
    reliability: 1,
    totalEvents: 0,
    successCount: 0,
    failureCount: 0,
  }),
  getLlmInferenceHistoryAll: () => Promise.resolve({}),
  onLlmInferenceChanged: () => noop,

  // ── Health check ──────────────────────────────────────────────────────
  recordHealthCheck: () => Promise.resolve({ success: true }),
  getHealthHeatmap: () => Promise.resolve([]),
  getHealthHeatmapAll: () => Promise.resolve({}),

  // ── Projects ──────────────────────────────────────────────────────────
  getProjects: () => Promise.resolve([]),
  getProject: () => Promise.resolve(null),
  createProject: () => Promise.resolve({} as any),
  updateProject: () => Promise.resolve({} as any),
  deleteProject: voidResult,
  listProjectAssets: () => Promise.resolve([]),
  uploadProjectAsset: () => Promise.resolve({} as any),
  deleteProjectAsset: voidResult,
  onProjectsChanged: () => noop,

  // ── Automations ───────────────────────────────────────────────────────
  getAutomations: () => Promise.resolve([]),
  testAutomation: () => Promise.resolve({} as any),
  setAutomationEnabled: voidResult,
  duplicateAutomation: voidResult,
  deleteAutomation: voidResult,
  getAutomationHistory: () => Promise.resolve([]),
  getAutomationLastExecuted: () => Promise.resolve({}),
  replayAutomation: () => Promise.resolve({ results: [] }),
  onAutomationsChanged: () => noop,

  // ── App-level preferences ─────────────────────────────────────────────
  getLaunchAtLogin: () => Promise.resolve(false),
  setLaunchAtLogin: voidResult,
  getConfirmBeforeExit: () => Promise.resolve(false),
  setConfirmBeforeExit: voidResult,
  exportSettings: () => Promise.resolve({ success: false, canceled: true }),
  importSettings: () => Promise.resolve({ success: false, canceled: true }),

  // ── Language ──────────────────────────────────────────────────────────
  changeLanguage: voidResult,

  // ── Resources ─────────────────────────────────────────────────────────
  exportResources: () => Promise.resolve({} as any),
  importResources: () => Promise.resolve({} as any),

  // ── Messaging ─────────────────────────────────────────────────────────
  getMessagingConfig: () => Promise.resolve(null),
  updateMessagingConfig: voidResult,
  testTelegramToken: () => Promise.resolve({ success: false, error: 'Mock: not available' }),
  saveTelegramToken: voidResult,
  testLarkCredentials: () => Promise.resolve({ success: false, error: 'Mock: not available' }),
  saveLarkCredentials: voidResult,
  disconnectMessagingPlatform: voidResult,
  forgetMessagingPlatform: voidResult,
  getMessagingBindings: () => Promise.resolve([]),
  generateMessagingPairingCode: () => Promise.resolve({ code: '', expiresAt: 0 }),
  generateMessagingSupergroupCode: () => Promise.resolve({ code: '', expiresAt: 0 }),
  getMessagingSupergroup: () => Promise.resolve(null),
  unbindMessagingSupergroup: () => Promise.resolve({ success: true }),
  unbindMessagingSession: voidResult,
  unbindMessagingBinding: () => Promise.resolve({ success: true }),
  onMessagingBindingChanged: () => noop,
  onMessagingPlatformStatus: () => noop,
  startWhatsAppConnect: () => Promise.resolve({ success: true }),
  submitWhatsAppPhone: () => Promise.resolve({ success: true }),
  onWhatsAppEvent: () => noop,
  getMessagingPlatformOwners: () => Promise.resolve([]),
  setMessagingPlatformOwners: () => Promise.resolve([]),
  getMessagingPlatformAccessMode: () => Promise.resolve('owner-only'),
  setMessagingPlatformAccessMode: () => Promise.resolve({ success: true }),
  getMessagingPendingSenders: () => Promise.resolve([]),
  dismissMessagingPendingSender: () => Promise.resolve({ success: true }),
  allowMessagingPendingSender: () => Promise.resolve({ owners: [] }),
  setMessagingBindingAccess: () => Promise.resolve({ success: true }),
  onMessagingPendingChanged: () => noop,
}

// ---------------------------------------------------------------------------
// Install the mock on the global window object
// ---------------------------------------------------------------------------

if (typeof window !== 'undefined' && !window.electronAPI) {
  window.electronAPI = mock
  console.info('[electron-api-mock] Installed mock window.electronAPI')
}
