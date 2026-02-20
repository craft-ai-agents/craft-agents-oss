/**
 * Web client API implementation.
 * Implements the ElectronAPI interface using HTTP fetch and WebSocket,
 * replacing the Electron IPC mechanism for the web app.
 */

// ============================================================
// HTTP Client
// ============================================================

const API_BASE = '/api'

async function apiGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${API_BASE}${path}`, window.location.origin)
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  }
  const res = await fetch(url.toString())
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}

async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}

async function apiPut<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}

async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { method: 'DELETE' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}

async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}

// ============================================================
// WebSocket Event System
// ============================================================

type EventCallback = (payload: unknown) => void

class WebSocketClient {
  private ws: WebSocket | null = null
  private listeners: Map<string, Set<EventCallback>> = new Map()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectDelay = 1000

  connect(): void {
    const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`

    try {
      this.ws = new WebSocket(wsUrl)

      this.ws.onopen = () => {
        console.log('[WS] Connected to Craft Agents server')
        this.reconnectDelay = 1000 // Reset backoff on success
      }

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          const { type, payload } = msg
          const channelListeners = this.listeners.get(type)
          if (channelListeners) {
            for (const cb of channelListeners) {
              try { cb(payload) } catch (err) {
                console.error('[WS] Listener error:', err)
              }
            }
          }
        } catch (err) {
          console.error('[WS] Parse error:', err)
        }
      }

      this.ws.onclose = () => {
        console.log('[WS] Connection closed, reconnecting...')
        this.scheduleReconnect()
      }

      this.ws.onerror = (err) => {
        console.error('[WS] Error:', err)
      }
    } catch (err) {
      console.error('[WS] Connect error:', err)
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000)
      this.connect()
    }, this.reconnectDelay)
  }

  on(channel: string, callback: EventCallback): () => void {
    if (!this.listeners.has(channel)) {
      this.listeners.set(channel, new Set())
    }
    this.listeners.get(channel)!.add(callback)
    return () => {
      this.listeners.get(channel)?.delete(callback)
    }
  }
}

const wsClient = new WebSocketClient()
wsClient.connect()

// ============================================================
// ElectronAPI Implementation
// ============================================================

// IPC channel constants (mirrored from shared/types.ts)
const IPC = {
  SESSION_EVENT: 'session:event',
  SYSTEM_THEME_CHANGED: 'theme:systemChanged',
  SOURCES_CHANGED: 'sources:changed',
  SKILLS_CHANGED: 'skills:changed',
  STATUSES_CHANGED: 'statuses:changed',
  LABELS_CHANGED: 'labels:changed',
  LLM_CONNECTIONS_CHANGED: 'LLM_Connection:changed',
  THEME_APP_CHANGED: 'theme:appChanged',
  DEFAULT_PERMISSIONS_CHANGED: 'permissions:defaultsChanged',
  THEME_PREFERENCES_CHANGED: 'theme:preferencesChanged',
  THEME_WORKSPACE_THEME_CHANGED: 'theme:workspaceThemeChanged',
  SESSION_FILES_CHANGED: 'sessions:filesChanged',
  COPILOT_DEVICE_CODE: 'copilot:deviceCode',
  UPDATE_AVAILABLE: 'update:available',
  UPDATE_DOWNLOAD_PROGRESS: 'update:downloadProgress',
  DEEP_LINK_NAVIGATE: 'deeplink:navigate',
  NOTIFICATION_NAVIGATE: 'notification:navigate',
  WINDOW_CLOSE_REQUESTED: 'window:closeRequested',
  MENU_NEW_CHAT: 'menu:newChat',
  MENU_OPEN_SETTINGS: 'menu:openSettings',
  MENU_KEYBOARD_SHORTCUTS: 'menu:keyboardShortcuts',
  MENU_TOGGLE_FOCUS_MODE: 'menu:toggleFocusMode',
  MENU_TOGGLE_SIDEBAR: 'menu:toggleSidebar',
}

export const webElectronAPI = {
  // ============================================================
  // Session Management
  // ============================================================

  getSessions: () => apiGet<any[]>('/sessions'),

  getSessionMessages: (sessionId: string) =>
    apiGet<any | null>(`/sessions/${sessionId}`),

  createSession: (workspaceId: string, options?: any) =>
    apiPost<any>('/sessions', { workspaceId, options }),

  createSubSession: (workspaceId: string, parentSessionId: string, options?: any) =>
    apiPost<any>(`/sessions/${parentSessionId}/sub-sessions`, { workspaceId, options }),

  deleteSession: (sessionId: string) =>
    apiDelete<void>(`/sessions/${sessionId}`).then(() => undefined),

  sendMessage: async (sessionId: string, message: string, attachments?: any[], storedAttachments?: any[], options?: any) => {
    await apiPost(`/sessions/${sessionId}/messages`, { message, attachments, storedAttachments, options })
  },

  cancelProcessing: (sessionId: string, silent?: boolean) =>
    apiPost<void>(`/sessions/${sessionId}/cancel`, { silent }).then(() => undefined),

  killShell: (sessionId: string, shellId: string) =>
    apiPost<{ success: boolean; error?: string }>(`/sessions/${sessionId}/kill-shell`, { shellId }),

  getTaskOutput: (taskId: string) =>
    apiGet<any>(`/tasks/${taskId}/output`).then((r: any) => r.output),

  respondToPermission: (sessionId: string, requestId: string, allowed: boolean, alwaysAllow: boolean) =>
    apiPost<{ success: boolean }>(`/sessions/${sessionId}/permission`, { requestId, allowed, alwaysAllow })
      .then((r: any) => r.success),

  respondToCredential: (sessionId: string, requestId: string, response: any) =>
    apiPost<{ success: boolean }>(`/sessions/${sessionId}/credential`, { requestId, response })
      .then((r: any) => r.success),

  sessionCommand: (sessionId: string, command: any) =>
    apiPost<any>(`/sessions/${sessionId}/command`, { command }),

  getPendingPlanExecution: (sessionId: string) =>
    apiGet<any>(`/sessions/${sessionId}/pending-plan`),

  // ============================================================
  // Workspace Management
  // ============================================================

  getWorkspaces: () => apiGet<any[]>('/workspaces'),

  createWorkspace: (folderPath: string, name: string) =>
    apiPost<any>('/workspaces', { folderPath, name }),

  checkWorkspaceSlug: (slug: string) =>
    apiGet<{ exists: boolean; path: string }>('/workspaces/check-slug', { slug }),

  // ============================================================
  // Window Management (web-adapted)
  // ============================================================

  getWindowWorkspace: async () => {
    const r = await apiGet<{ workspaceId: string | null }>('/workspaces/window')
    return r.workspaceId
  },

  getWindowMode: async () => {
    const r = await apiGet<{ mode: string }>('/window/mode')
    return r.mode
  },

  openWorkspace: (workspaceId: string) =>
    apiPost<void>('/window/open-workspace', { workspaceId }).then(() => undefined),

  openSessionInNewWindow: (_workspaceId: string, _sessionId: string) =>
    Promise.resolve(), // No multi-window in web

  switchWorkspace: (workspaceId: string) =>
    apiPost<void>('/workspaces/switch', { workspaceId }).then(() => undefined),

  closeWindow: () =>
    apiPost<void>('/window/close').then(() => undefined),

  confirmCloseWindow: () =>
    apiPost<void>('/window/close').then(() => undefined),

  onCloseRequested: (callback: () => void): (() => void) => {
    return wsClient.on(IPC.WINDOW_CLOSE_REQUESTED, () => callback())
  },

  setTrafficLightsVisible: (_visible: boolean) =>
    apiPost<void>('/window/traffic-lights').then(() => undefined),

  // ============================================================
  // Event Listeners
  // ============================================================

  onSessionEvent: (callback: (event: any) => void): (() => void) => {
    return wsClient.on(IPC.SESSION_EVENT, (payload) => callback(payload as any))
  },

  // ============================================================
  // File Operations
  // ============================================================

  readFile: (path: string) =>
    apiGet<{ content: string }>('/files/read', { path }).then((r: any) => r.content),

  readFileBinary: async (path: string): Promise<Uint8Array> => {
    const r = await apiGet<{ base64: string }>('/files/read-binary', { path })
    const binary = atob(r.base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  },

  readFileDataUrl: (path: string) =>
    apiGet<{ dataUrl: string }>('/files/read-data-url', { path }).then((r: any) => r.dataUrl),

  openFileDialog: async (): Promise<string[]> => {
    // Web: use HTML file input (handled client-side)
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.multiple = true
      input.onchange = () => {
        // We can't get real paths in web, return empty (caller handles actual files)
        resolve([])
      }
      input.click()
    })
  },

  readFileAttachment: (path: string) =>
    apiPost<any | null>('/files/attachment', { path }),

  storeAttachment: (sessionId: string, attachment: any) =>
    apiPost<any>('/files/store-attachment', { sessionId, attachment }),

  generateThumbnail: async (_base64: string, _mimeType: string): Promise<string | null> => {
    return null // Not available in web
  },

  searchFiles: (basePath: string, query: string) =>
    apiGet<any[]>('/files/search', { basePath, query }),

  debugLog: (...args: unknown[]) => {
    apiPost('/debug/log', { args }).catch(() => {})
  },

  // ============================================================
  // Theme
  // ============================================================

  getSystemTheme: async (): Promise<boolean> => {
    // Use browser media query instead of server
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  },

  onSystemThemeChange: (callback: (isDark: boolean) => void): (() => void) => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => callback(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  },

  // ============================================================
  // System
  // ============================================================

  getVersions: () => ({
    node: 'web',
    chrome: navigator.userAgent,
    electron: 'n/a',
  }),

  getHomeDir: () =>
    apiGet<{ homeDir: string }>('/system/home-dir').then((r: any) => r.homeDir),

  isDebugMode: () =>
    apiGet<{ isDebugMode: boolean }>('/system/debug-mode').then((r: any) => r.isDebugMode),

  // ============================================================
  // Auto-update (stubs for web)
  // ============================================================

  checkForUpdates: () =>
    apiPost<any>('/update/check'),

  getUpdateInfo: () =>
    apiGet<any>('/update/info'),

  installUpdate: () =>
    apiPost<void>('/update/install').then(() => undefined),

  dismissUpdate: (_version: string) =>
    apiPost<void>('/update/dismiss', { version: _version }).then(() => undefined),

  getDismissedUpdateVersion: () =>
    apiGet<{ version: string | null }>('/update/dismissed').then((r: any) => r.version),

  onUpdateAvailable: (callback: (info: any) => void): (() => void) => {
    return wsClient.on(IPC.UPDATE_AVAILABLE, (payload) => callback(payload as any))
  },

  onUpdateDownloadProgress: (callback: (progress: number) => void): (() => void) => {
    return wsClient.on(IPC.UPDATE_DOWNLOAD_PROGRESS, (payload) => callback(payload as number))
  },

  // ============================================================
  // Release Notes
  // ============================================================

  getReleaseNotes: () =>
    apiGet<{ notes: string }>('/release-notes').then((r: any) => r.notes),

  getLatestReleaseVersion: () =>
    apiGet<{ version: string | undefined }>('/release-notes/latest-version').then((r: any) => r.version),

  // ============================================================
  // Shell Operations (web-adapted)
  // ============================================================

  openUrl: async (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer')
  },

  openFile: async (path: string) => {
    // Can't open native files in web
    console.warn('openFile not supported in web mode:', path)
  },

  showInFolder: async (path: string) => {
    // Can't show in folder in web
    console.warn('showInFolder not supported in web mode:', path)
  },

  // ============================================================
  // Menu Event Listeners (web: keyboard shortcuts only)
  // ============================================================

  onMenuNewChat: (callback: () => void): (() => void) => {
    return wsClient.on(IPC.MENU_NEW_CHAT, () => callback())
  },

  onMenuOpenSettings: (callback: () => void): (() => void) => {
    return wsClient.on(IPC.MENU_OPEN_SETTINGS, () => callback())
  },

  onMenuKeyboardShortcuts: (callback: () => void): (() => void) => {
    return wsClient.on(IPC.MENU_KEYBOARD_SHORTCUTS, () => callback())
  },

  onMenuToggleFocusMode: (callback: () => void): (() => void) => {
    return wsClient.on(IPC.MENU_TOGGLE_FOCUS_MODE, () => callback())
  },

  onMenuToggleSidebar: (callback: () => void): (() => void) => {
    return wsClient.on(IPC.MENU_TOGGLE_SIDEBAR, () => callback())
  },

  // ============================================================
  // Deep Link (web: not applicable)
  // ============================================================

  onDeepLinkNavigate: (callback: (nav: any) => void): (() => void) => {
    return wsClient.on(IPC.DEEP_LINK_NAVIGATE, (payload) => callback(payload as any))
  },

  // ============================================================
  // Auth
  // ============================================================

  showLogoutConfirmation: async (): Promise<boolean> => {
    return window.confirm('Are you sure you want to log out?')
  },

  showDeleteSessionConfirmation: async (name: string): Promise<boolean> => {
    return window.confirm(`Are you sure you want to delete "${name}"?`)
  },

  logout: () =>
    apiPost<void>('/auth/logout').then(() => undefined),

  getCredentialHealth: () =>
    apiGet<any>('/auth/credential-health'),

  // ============================================================
  // Onboarding
  // ============================================================

  getAuthState: () =>
    apiGet<any>('/auth/state').then((r: any) => r.authState),

  getSetupNeeds: () =>
    apiGet<any>('/auth/state').then((r: any) => r.setupNeeds),

  startWorkspaceMcpOAuth: (mcpUrl: string) =>
    apiPost<any>('/auth/mcp/start', { mcpUrl }),

  startClaudeOAuth: () =>
    apiPost<{ success: boolean; authUrl?: string; error?: string }>('/auth/claude/start'),

  exchangeClaudeCode: (code: string, connectionSlug: string) =>
    apiPost<any>('/auth/claude/exchange', { code, connectionSlug }),

  hasClaudeOAuthState: () =>
    apiGet<{ hasState: boolean }>('/auth/claude/has-state').then((r: any) => r.hasState),

  clearClaudeOAuthState: () =>
    apiPost<{ success: boolean }>('/auth/claude/clear-state'),

  // ChatGPT OAuth (stubs - web redirect flow needed)
  startChatGptOAuth: (_connectionSlug: string) =>
    Promise.resolve({ success: false, error: 'ChatGPT OAuth not available in web mode' }),

  cancelChatGptOAuth: () =>
    Promise.resolve({ success: true }),

  getChatGptAuthStatus: (_connectionSlug: string) =>
    Promise.resolve({ authenticated: false }),

  chatGptLogout: (_connectionSlug: string) =>
    Promise.resolve({ success: true }),

  // GitHub Copilot OAuth
  startCopilotOAuth: (_connectionSlug: string) =>
    Promise.resolve({ success: false, error: 'Copilot OAuth not available in web mode' }),

  cancelCopilotOAuth: () =>
    Promise.resolve({ success: true }),

  getCopilotAuthStatus: (_connectionSlug: string) =>
    Promise.resolve({ authenticated: false }),

  copilotLogout: (_connectionSlug: string) =>
    Promise.resolve({ success: true }),

  onCopilotDeviceCode: (callback: (data: { userCode: string; verificationUri: string }) => void): (() => void) => {
    return wsClient.on(IPC.COPILOT_DEVICE_CODE, (payload) => callback(payload as any))
  },

  // ============================================================
  // Settings - LLM Connection Setup
  // ============================================================

  setupLlmConnection: (setup: any) =>
    apiPost<{ success: boolean; error?: string }>('/settings/setup-llm-connection', setup),

  testApiConnection: (apiKey: string, baseUrl?: string, models?: string[]) =>
    apiPost<{ success: boolean; error?: string; modelCount?: number }>('/settings/test-api-connection', { apiKey, baseUrl, models }),

  testOpenAiConnection: (apiKey: string, baseUrl?: string, models?: string[]) =>
    apiPost<{ success: boolean; error?: string }>('/settings/test-openai-connection', { apiKey, baseUrl, models }),

  // ============================================================
  // Session Model
  // ============================================================

  getSessionModel: (sessionId: string, workspaceId: string) =>
    apiGet<{ model: string | null }>(`/sessions/${sessionId}/model`, { workspaceId })
      .then((r: any) => r.model),

  setSessionModel: (sessionId: string, workspaceId: string, model: string | null, connection?: string) =>
    apiPost<void>(`/sessions/${sessionId}/model`, { workspaceId, model, connection }).then(() => undefined),

  // ============================================================
  // Workspace Settings
  // ============================================================

  getWorkspaceSettings: (workspaceId: string) =>
    apiGet<any | null>(`/workspaces/${workspaceId}/settings`),

  updateWorkspaceSetting: (workspaceId: string, key: string, value: any) =>
    apiPatch<void>(`/workspaces/${workspaceId}/settings`, { key, value }).then(() => undefined),

  // ============================================================
  // Folder Dialog (web-adapted)
  // ============================================================

  openFolderDialog: async (): Promise<string | null> => {
    // Web: can't open folder picker dialog natively
    // Return null - the UI should handle this gracefully
    return null
  },

  // ============================================================
  // Preferences
  // ============================================================

  readPreferences: () =>
    apiGet<{ content: string; exists: boolean; path: string }>('/preferences'),

  writePreferences: (content: string) =>
    apiPut<{ success: boolean; error?: string }>('/preferences', { content }),

  // ============================================================
  // Session Drafts
  // ============================================================

  getDraft: (sessionId: string) =>
    apiGet<{ draft: string | null }>(`/drafts/${sessionId}`).then((r: any) => r.draft),

  setDraft: (sessionId: string, text: string) =>
    apiPut<void>(`/drafts/${sessionId}`, { text }).then(() => undefined),

  deleteDraft: (sessionId: string) =>
    apiDelete<void>(`/drafts/${sessionId}`).then(() => undefined),

  getAllDrafts: () =>
    apiGet<Record<string, string>>('/drafts'),

  // ============================================================
  // Session Files
  // ============================================================

  getSessionFiles: (sessionId: string) =>
    apiGet<any[]>(`/sessions/${sessionId}/files`),

  getSessionNotes: (sessionId: string) =>
    apiGet<{ content: string }>(`/sessions/${sessionId}/notes`).then((r: any) => r.content),

  setSessionNotes: (sessionId: string, content: string) =>
    apiPut<void>(`/sessions/${sessionId}/notes`, { content }).then(() => undefined),

  watchSessionFiles: (_sessionId: string) =>
    Promise.resolve(),

  unwatchSessionFiles: () =>
    Promise.resolve(),

  onSessionFilesChanged: (callback: (sessionId: string) => void): (() => void) => {
    return wsClient.on(IPC.SESSION_FILES_CHANGED, (payload) => callback(payload as string))
  },

  // ============================================================
  // Sources
  // ============================================================

  getSources: (workspaceId: string) =>
    apiGet<any[]>(`/workspaces/${workspaceId}/sources`),

  createSource: (workspaceId: string, config: any) =>
    apiPost<any>(`/workspaces/${workspaceId}/sources`, config),

  deleteSource: (workspaceId: string, sourceSlug: string) =>
    apiDelete<void>(`/workspaces/${workspaceId}/sources/${sourceSlug}`).then(() => undefined),

  startSourceOAuth: (_workspaceId: string, _sourceSlug: string) =>
    Promise.resolve({ success: false, error: 'OAuth not available in web mode' }),

  saveSourceCredentials: (workspaceId: string, sourceSlug: string, credential: string) =>
    apiPost<void>(`/workspaces/${workspaceId}/sources/${sourceSlug}/save-credentials`, { credential })
      .then(() => undefined),

  getSourcePermissionsConfig: (workspaceId: string, sourceSlug: string) =>
    apiGet<any | null>(`/workspaces/${workspaceId}/sources/${sourceSlug}/permissions`),

  getWorkspacePermissionsConfig: (workspaceId: string) =>
    apiGet<any | null>(`/workspaces/${workspaceId}/permissions`),

  getDefaultPermissionsConfig: () =>
    apiGet<any>('/permissions/defaults'),

  getMcpTools: (workspaceId: string, sourceSlug: string) =>
    apiGet<any>(`/workspaces/${workspaceId}/sources/${sourceSlug}/mcp-tools`),

  // ============================================================
  // Session Content Search
  // ============================================================

  searchSessionContent: (workspaceId: string, query: string, searchId?: string) =>
    apiPost<any[]>('/sessions/search', { workspaceId, query, searchId }),

  // ============================================================
  // Sources Change Listener
  // ============================================================

  onSourcesChanged: (callback: (sources: any[]) => void): (() => void) => {
    return wsClient.on(IPC.SOURCES_CHANGED, (payload) => callback(payload as any[]))
  },

  onDefaultPermissionsChanged: (callback: () => void): (() => void) => {
    return wsClient.on(IPC.DEFAULT_PERMISSIONS_CHANGED, () => callback())
  },

  // ============================================================
  // Skills
  // ============================================================

  getSkills: (workspaceId: string, workingDirectory?: string) => {
    const params: Record<string, string> = {}
    if (workingDirectory) params.workingDirectory = workingDirectory
    return apiGet<any[]>(`/workspaces/${workspaceId}/skills`, params)
  },

  getSkillFiles: (workspaceId: string, skillSlug: string) =>
    apiGet<any[]>(`/workspaces/${workspaceId}/skills/${skillSlug}/files`),

  deleteSkill: (workspaceId: string, skillSlug: string) =>
    apiDelete<void>(`/workspaces/${workspaceId}/skills/${skillSlug}`).then(() => undefined),

  openSkillInEditor: (_workspaceId: string, _skillSlug: string) =>
    Promise.resolve(), // Not available in web

  openSkillInFinder: (_workspaceId: string, _skillSlug: string) =>
    Promise.resolve(), // Not available in web

  onSkillsChanged: (callback: (skills: any[]) => void): (() => void) => {
    return wsClient.on(IPC.SKILLS_CHANGED, (payload) => callback(payload as any[]))
  },

  // ============================================================
  // Statuses
  // ============================================================

  listStatuses: (workspaceId: string) =>
    apiGet<any[]>(`/workspaces/${workspaceId}/statuses`),

  reorderStatuses: (workspaceId: string, orderedIds: string[]) =>
    apiPost<void>(`/workspaces/${workspaceId}/statuses/reorder`, { orderedIds }).then(() => undefined),

  onStatusesChanged: (callback: (workspaceId: string) => void): (() => void) => {
    return wsClient.on(IPC.STATUSES_CHANGED, (payload) => callback(payload as string))
  },

  // ============================================================
  // Labels
  // ============================================================

  listLabels: (workspaceId: string) =>
    apiGet<any[]>(`/workspaces/${workspaceId}/labels`),

  createLabel: (workspaceId: string, input: any) =>
    apiPost<any>(`/workspaces/${workspaceId}/labels`, input),

  deleteLabel: (workspaceId: string, labelId: string) =>
    apiDelete<{ stripped: number }>(`/workspaces/${workspaceId}/labels/${labelId}`),

  onLabelsChanged: (callback: (workspaceId: string) => void): (() => void) => {
    return wsClient.on(IPC.LABELS_CHANGED, (payload) => callback(payload as string))
  },

  onLlmConnectionsChanged: (callback: () => void): (() => void) => {
    return wsClient.on(IPC.LLM_CONNECTIONS_CHANGED, () => callback())
  },

  // ============================================================
  // Views
  // ============================================================

  listViews: (workspaceId: string) =>
    apiGet<any[]>(`/workspaces/${workspaceId}/views`),

  saveViews: (workspaceId: string, views: any[]) =>
    apiPut<void>(`/workspaces/${workspaceId}/views`, views).then(() => undefined),

  // ============================================================
  // Workspace Image
  // ============================================================

  readWorkspaceImage: (workspaceId: string, relativePath: string) =>
    apiGet<{ data: string }>(`/workspaces/${workspaceId}/image`, { path: relativePath })
      .then((r: any) => r.data),

  writeWorkspaceImage: (workspaceId: string, relativePath: string, base64: string, mimeType: string) =>
    apiPost<void>(`/workspaces/${workspaceId}/image`, { relativePath, base64, mimeType })
      .then(() => undefined),

  // ============================================================
  // Tool Icon Mappings
  // ============================================================

  getToolIconMappings: () =>
    apiGet<any[]>('/tool-icons'),

  // ============================================================
  // Theme
  // ============================================================

  getAppTheme: () =>
    apiGet<any | null>('/theme/app'),

  loadPresetThemes: () =>
    apiGet<any[]>('/theme/presets'),

  loadPresetTheme: (themeId: string) =>
    apiGet<any | null>(`/theme/presets/${themeId}`),

  getColorTheme: () =>
    apiGet<{ theme: string }>('/theme/color').then((r: any) => r.theme),

  setColorTheme: (themeId: string) =>
    apiPost<void>('/theme/color', { themeId }).then(() => undefined),

  getWorkspaceColorTheme: (workspaceId: string) =>
    apiGet<{ theme: string | null }>(`/theme/workspace/${workspaceId}`).then((r: any) => r.theme),

  setWorkspaceColorTheme: (workspaceId: string, themeId: string | null) =>
    apiPost<void>(`/theme/workspace/${workspaceId}`, { themeId }).then(() => undefined),

  getAllWorkspaceThemes: () =>
    apiGet<Record<string, string | undefined>>('/theme/all-workspace-themes'),

  onAppThemeChange: (callback: (theme: any) => void): (() => void) => {
    return wsClient.on(IPC.THEME_APP_CHANGED, (payload) => callback(payload as any))
  },

  // ============================================================
  // Logo URL
  // ============================================================

  getLogoUrl: (_serviceUrl: string, _provider?: string) =>
    Promise.resolve<string | null>(null),

  // ============================================================
  // Notifications
  // ============================================================

  showNotification: (title: string, body: string, workspaceId: string, sessionId: string) =>
    apiPost<void>('/notifications/show', { title, body, workspaceId, sessionId }).then(() => undefined),

  getNotificationsEnabled: () =>
    apiGet<{ value: boolean }>('/settings/notifications-enabled').then((r: any) => r.value),

  setNotificationsEnabled: (enabled: boolean) =>
    apiPost<void>('/settings/notifications-enabled', { enabled }).then(() => undefined),

  // ============================================================
  // Input Settings
  // ============================================================

  getAutoCapitalisation: () =>
    apiGet<{ value: boolean }>('/settings/auto-capitalisation').then((r: any) => r.value),

  setAutoCapitalisation: (enabled: boolean) =>
    apiPost<void>('/settings/auto-capitalisation', { enabled }).then(() => undefined),

  getSendMessageKey: () =>
    apiGet<{ value: 'enter' | 'cmd-enter' }>('/settings/send-message-key').then((r: any) => r.value),

  setSendMessageKey: (key: 'enter' | 'cmd-enter') =>
    apiPost<void>('/settings/send-message-key', { key }).then(() => undefined),

  getSpellCheck: () =>
    apiGet<{ value: boolean }>('/settings/spell-check').then((r: any) => r.value),

  setSpellCheck: (enabled: boolean) =>
    apiPost<void>('/settings/spell-check', { enabled }).then(() => undefined),

  // ============================================================
  // Power Settings
  // ============================================================

  getKeepAwakeWhileRunning: () =>
    apiGet<{ value: boolean }>('/settings/keep-awake').then((r: any) => r.value),

  setKeepAwakeWhileRunning: (enabled: boolean) =>
    apiPost<void>('/settings/keep-awake', { enabled }).then(() => undefined),

  // ============================================================
  // Appearance Settings
  // ============================================================

  getRichToolDescriptions: () =>
    apiGet<{ value: boolean }>('/settings/rich-tool-descriptions').then((r: any) => r.value),

  setRichToolDescriptions: (enabled: boolean) =>
    apiPost<void>('/settings/rich-tool-descriptions', { enabled }).then(() => undefined),

  // ============================================================
  // Badge/Dock (web: no-ops)
  // ============================================================

  updateBadgeCount: (_count: number) => Promise.resolve(),
  clearBadgeCount: () => Promise.resolve(),
  setDockIconWithBadge: (_dataUrl: string) => Promise.resolve(),
  onBadgeDraw: (_callback: (data: { count: number; iconDataUrl: string }) => void): (() => void) => () => {},

  // ============================================================
  // Window Focus
  // ============================================================

  getWindowFocusState: async (): Promise<boolean> => !document.hidden,

  onWindowFocusChange: (callback: (isFocused: boolean) => void): (() => void) => {
    const handler = () => callback(!document.hidden)
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  },

  onNotificationNavigate: (callback: (data: { workspaceId: string; sessionId: string }) => void): (() => void) => {
    return wsClient.on(IPC.NOTIFICATION_NAVIGATE, (payload) => callback(payload as any))
  },

  // ============================================================
  // Theme Preferences Sync
  // ============================================================

  broadcastThemePreferences: (preferences: { mode: string; colorTheme: string; font: string }) =>
    apiPost<void>('/theme/broadcast-preferences', preferences).then(() => undefined),

  onThemePreferencesChange: (callback: (preferences: { mode: string; colorTheme: string; font: string }) => void): (() => void) => {
    return wsClient.on(IPC.THEME_PREFERENCES_CHANGED, (payload) => callback(payload as any))
  },

  broadcastWorkspaceThemeChange: (workspaceId: string, themeId: string | null) =>
    apiPost<void>('/theme/broadcast-workspace', { workspaceId, themeId }).then(() => undefined),

  onWorkspaceThemeChange: (callback: (data: { workspaceId: string; themeId: string | null }) => void): (() => void) => {
    return wsClient.on(IPC.THEME_WORKSPACE_THEME_CHANGED, (payload) => callback(payload as any))
  },

  // ============================================================
  // Git Operations
  // ============================================================

  getGitBranch: (dirPath: string) =>
    apiGet<{ branch: string | null }>('/git/branch', { dirPath }).then((r: any) => r.branch),

  // ============================================================
  // Git Bash (Windows only - stubs for web)
  // ============================================================

  checkGitBash: async () => ({
    found: false,
    path: null,
    platform: 'linux' as const,
  }),

  browseForGitBash: async () => null,
  setGitBashPath: async (_path: string) => ({ success: false, error: 'Not applicable in web mode' }),

  // ============================================================
  // Menu Actions (web: keyboard shortcuts instead)
  // ============================================================

  menuQuit: () => Promise.resolve(),
  menuNewWindow: () => Promise.resolve(),
  menuMinimize: () => { window.blur() },
  menuMaximize: () => Promise.resolve(),
  menuZoomIn: () => Promise.resolve(),
  menuZoomOut: () => Promise.resolve(),
  menuZoomReset: () => Promise.resolve(),
  menuToggleDevTools: () => Promise.resolve(),
  menuUndo: () => { document.execCommand('undo') },
  menuRedo: () => { document.execCommand('redo') },
  menuCut: () => { document.execCommand('cut') },
  menuCopy: () => { document.execCommand('copy') },
  menuPaste: () => { document.execCommand('paste') },
  menuSelectAll: () => { document.execCommand('selectAll') },

  // ============================================================
  // LLM Connections
  // ============================================================

  listLlmConnections: () =>
    apiGet<any[]>('/llm-connections'),

  listLlmConnectionsWithStatus: () =>
    apiGet<any[]>('/llm-connections/with-status'),

  getLlmConnection: (slug: string) =>
    apiGet<any | null>(`/llm-connections/${slug}`),

  saveLlmConnection: (connection: any) =>
    apiPost<{ success: boolean; error?: string }>('/llm-connections', connection),

  deleteLlmConnection: (slug: string) =>
    apiDelete<{ success: boolean; error?: string }>(`/llm-connections/${slug}`),

  testLlmConnection: (slug: string) =>
    apiPost<{ success: boolean; error?: string }>(`/llm-connections/${slug}/test`),

  setDefaultLlmConnection: (slug: string) =>
    apiPost<{ success: boolean; error?: string }>('/llm-connections/default', { slug }),

  setWorkspaceDefaultLlmConnection: (workspaceId: string, slug: string | null) =>
    apiPost<{ success: boolean; error?: string }>('/llm-connections/workspace-default', { workspaceId, slug }),
}

// Make API available globally as window.electronAPI
;(window as any).electronAPI = webElectronAPI
