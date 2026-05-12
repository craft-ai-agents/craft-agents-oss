import type {
  FileAttachment,
  LoadedSource,
  PermissionMode,
  MessagingPlatformRuntimeInfo,
  WhatsAppUiEvent,
} from '../../shared/types'
import type { MessagingBinding } from '../atoms/messaging'
import type {
  BindingAccess,
  PendingSender,
  PlatformAccessMode,
  PlatformOwner,
} from '../components/messaging/access/types'

// ============================================================================
// Messaging mock state + control handle
// ============================================================================
//
// The real messaging flow is driven by IPC push events (platform status,
// binding changes, WhatsApp pairing phases). To make the messaging UI
// previewable, we replace those IPC calls with an in-memory event bus and
// expose a `window.__playgroundMessaging` handle so variant/preview wrappers
// can flip state (connected ↔ disconnected, WhatsApp phase, bindings) without
// remounting the component.

type PlatformStatusListener = (
  workspaceId: string,
  platform: string,
  status: MessagingPlatformRuntimeInfo,
) => void
type BindingListener = (workspaceId: string) => void
type WhatsAppEventListener = (payload: { workspaceId: string; event: WhatsAppUiEvent }) => void

const PLAYGROUND_WORKSPACE_ID = 'playground-workspace'

type AllowListPlatform = 'telegram' | 'whatsapp' | 'lark'

interface AllowListState {
  accessMode: PlatformAccessMode
  owners: PlatformOwner[]
  pending: PendingSender[]
  /** Per-binding access. Keyed by bindingId. */
  bindings: Record<string, BindingAccess>
}

interface MessagingMockState {
  runtime: {
    telegram: MessagingPlatformRuntimeInfo
    whatsapp: MessagingPlatformRuntimeInfo
  }
  bindings: MessagingBinding[]
  /** Workspace-level allow-list state per platform (Phase 1 mock surface). */
  allowList: Record<AllowListPlatform, AllowListState>
  platformStatusListeners: Set<PlatformStatusListener>
  bindingListeners: Set<BindingListener>
  waEventListeners: Set<WhatsAppEventListener>
}

function defaultRuntime(platform: 'telegram' | 'whatsapp'): MessagingPlatformRuntimeInfo {
  return {
    platform,
    configured: false,
    connected: false,
    state: 'disconnected',
    updatedAt: Date.now(),
  }
}

function defaultAllowList(): AllowListState {
  return { accessMode: 'open', owners: [], pending: [], bindings: {} }
}

const messagingMockState: MessagingMockState = {
  runtime: {
    telegram: defaultRuntime('telegram'),
    whatsapp: defaultRuntime('whatsapp'),
  },
  bindings: [],
  allowList: {
    telegram: defaultAllowList(),
    whatsapp: defaultAllowList(),
    lark: defaultAllowList(),
  },
  platformStatusListeners: new Set(),
  bindingListeners: new Set(),
  waEventListeners: new Set(),
}

function emitPlatformStatus(platform: 'telegram' | 'whatsapp') {
  const status = messagingMockState.runtime[platform]
  for (const listener of messagingMockState.platformStatusListeners) {
    try { listener(PLAYGROUND_WORKSPACE_ID, platform, status) } catch (err) { console.error(err) }
  }
}

function emitBindingChanged() {
  for (const listener of messagingMockState.bindingListeners) {
    try { listener(PLAYGROUND_WORKSPACE_ID) } catch (err) { console.error(err) }
  }
}

function emitWhatsAppEvent(event: WhatsAppUiEvent) {
  for (const listener of messagingMockState.waEventListeners) {
    try { listener({ workspaceId: PLAYGROUND_WORKSPACE_ID, event }) } catch (err) { console.error(err) }
  }
}

export interface PlaygroundMessagingHandle {
  /** Snapshot of current state (for debugging from DevTools). */
  state: MessagingMockState
  setTelegramConnected: (connected: boolean, identity?: string) => void
  setWhatsAppConnected: (connected: boolean, identity?: string) => void
  setBindings: (bindings: MessagingBinding[]) => void
  fireWAEvent: (event: WhatsAppUiEvent) => void
  reset: () => void
}

/**
 * Allow-list mock control. Lets AllowListPreview drive the workspace-level
 * owners / pending / per-binding-access mock state without going through the
 * IPC mocks. Phase 3 wiring will read the same state via electronAPI.
 */
export interface PlaygroundAllowListHandle {
  setAccessMode: (platform: AllowListPlatform, mode: PlatformAccessMode) => void
  setOwners: (platform: AllowListPlatform, owners: PlatformOwner[]) => void
  setPending: (platform: AllowListPlatform, pending: PendingSender[]) => void
  setBindingAccess: (
    platform: AllowListPlatform,
    bindingId: string,
    access: BindingAccess,
  ) => void
  reset: () => void
}

export const playgroundMessagingHandle: PlaygroundMessagingHandle = {
  state: messagingMockState,
  setTelegramConnected(connected, identity) {
    messagingMockState.runtime.telegram = {
      platform: 'telegram',
      configured: connected,
      connected,
      state: connected ? 'connected' : 'disconnected',
      identity,
      updatedAt: Date.now(),
    }
    emitPlatformStatus('telegram')
  },
  setWhatsAppConnected(connected, identity) {
    messagingMockState.runtime.whatsapp = {
      platform: 'whatsapp',
      configured: connected,
      connected,
      state: connected ? 'connected' : 'disconnected',
      identity,
      updatedAt: Date.now(),
    }
    emitPlatformStatus('whatsapp')
  },
  setBindings(bindings) {
    messagingMockState.bindings = bindings
    emitBindingChanged()
  },
  fireWAEvent(event) {
    emitWhatsAppEvent(event)
  },
  reset() {
    messagingMockState.runtime.telegram = defaultRuntime('telegram')
    messagingMockState.runtime.whatsapp = defaultRuntime('whatsapp')
    messagingMockState.bindings = []
    messagingMockState.allowList.telegram = defaultAllowList()
    messagingMockState.allowList.whatsapp = defaultAllowList()
    messagingMockState.allowList.lark = defaultAllowList()
    emitPlatformStatus('telegram')
    emitPlatformStatus('whatsapp')
    emitBindingChanged()
  },
}

export const playgroundAllowListHandle: PlaygroundAllowListHandle = {
  setAccessMode(platform, mode) {
    messagingMockState.allowList[platform].accessMode = mode
  },
  setOwners(platform, owners) {
    messagingMockState.allowList[platform].owners = owners
  },
  setPending(platform, pending) {
    messagingMockState.allowList[platform].pending = pending
  },
  setBindingAccess(platform, bindingId, access) {
    messagingMockState.allowList[platform].bindings[bindingId] = access
  },
  reset() {
    messagingMockState.allowList.telegram = defaultAllowList()
    messagingMockState.allowList.whatsapp = defaultAllowList()
    messagingMockState.allowList.lark = defaultAllowList()
  },
}

// ============================================================================
// Mock electronAPI
// ============================================================================

export const mockElectronAPI = {
  isDebugMode: async () => true,

  // Called at module-load time by SessionFilesSection.tsx (and others) to
  // branch between Electron and web-UI rendering. Must be synchronous.
  getRuntimeEnvironment: (): 'electron' | 'web' => 'electron',

  openFileDialog: async () => {
    console.log('[Playground] openFileDialog called')
    return [] // Let user use file input or drag-drop
  },

  readFileAttachment: async (path: string) => {
    console.log('[Playground] readFileAttachment called:', path)
    return null // Let FileReader API handle it
  },

  generateThumbnail: async (base64: string, mimeType: string) => {
    console.log('[Playground] generateThumbnail called')
    return null // Skip thumbnails in playground
  },

  openFolderDialog: async () => {
    console.log('[Playground] openFolderDialog called')
    return null
  },

  getTaskOutput: async (taskId: string) => {
    console.log('[Playground] getTaskOutput called:', taskId)
    return `Output for task ${taskId}:\n\nThis is a mock output in the playground.\nIn the real app, this would show the actual task output.`
  },

  // Session files API used by SessionFilesSection (Info popover)
  getSessionFiles: async (sessionId: string) => {
    console.log('[Playground] getSessionFiles called:', sessionId)
    return []
  },

  watchSessionFiles: (sessionId: string) => {
    console.log('[Playground] watchSessionFiles called:', sessionId)
  },

  unwatchSessionFiles: () => {
    console.log('[Playground] unwatchSessionFiles called')
  },

  onSessionFilesChanged: (callback: (sessionId: string) => void) => {
    console.log('[Playground] onSessionFilesChanged subscribed')
    // Keep callback referenced for parity/debugging, but no events emitted in playground
    void callback
    return () => {
      console.log('[Playground] onSessionFilesChanged unsubscribed')
    }
  },

  browserPane: {
    focus: async (instanceId: string) => {
      console.log('[Playground] browserPane.focus called:', instanceId)
    },
  },

  openFile: async (path: string) => {
    console.log('[Playground] openFile called:', path)
    alert(`Would open file in system editor:\n${path}`)
  },

  showInFolder: async (path: string) => {
    console.log('[Playground] showInFolder called:', path)
    alert(`Would reveal in file manager:\n${path}`)
  },

  // NavigationProvider subscribes to deep-link IPC on mount; in the playground
  // there is no main process firing these events, so the listener is a no-op.
  onDeepLinkNavigate: (_callback: unknown) => {
    void _callback
    return () => {}
  },

  // Debug menu actions invoked by the mobile menu's Debug sub-page in dev mode.
  // The real implementations call into the auto-updater; the playground just logs.
  checkForUpdates: () => {
    console.log('[Playground] checkForUpdates called')
  },
  installUpdate: () => {
    console.log('[Playground] installUpdate called')
  },

  // ChatDisplay required mocks
  readPreferences: async () => {
    return { diffViewerSettings: { showFilePath: true, expandedSections: {} } }
  },

  writePreferences: async (prefs: unknown) => {
    console.log('[Playground] writePreferences called:', prefs)
  },

  // FreeFormInput required mocks
  getAutoCapitalisation: async () => false,

  getPendingPlanExecution: async (sessionId: string) => {
    console.log('[Playground] getPendingPlanExecution called:', sessionId)
    return null
  },

  getSendMessageKey: async () => 'enter',
  getSpellCheck: async () => true,

  // Pi provider discovery mocks
  getPiApiKeyProviders: async () => [
    { key: 'anthropic', label: 'Anthropic', placeholder: 'sk-ant-...' },
    { key: 'openai', label: 'OpenAI', placeholder: 'sk-...' },
    { key: 'google', label: 'Google AI Studio', placeholder: 'AIza...' },
    { key: 'deepseek', label: 'DeepSeek', placeholder: 'sk-...' },
  ],
  getPiProviderBaseUrl: async () => '',
  getPiProviderModels: async (provider: string) => {
    const MOCK_MODELS: Record<string, Array<{ id: string; name: string; costInput: number; costOutput: number; contextWindow: number; reasoning: boolean }>> = {
      'openrouter': [
        // Top 10 expensive
        { id: 'anthropic/claude-opus-4.7', name: 'Claude Opus 4.7', costInput: 5, costOutput: 25, contextWindow: 200000, reasoning: true },
        { id: 'xai/grok-4', name: 'Grok 4', costInput: 6, costOutput: 18, contextWindow: 256000, reasoning: true },
        { id: 'anthropic/claude-sonnet-4.6', name: 'Claude Sonnet 4.6', costInput: 3, costOutput: 15, contextWindow: 200000, reasoning: true },
        { id: 'openai/gpt-5.2-codex', name: 'GPT-5.2 Codex', costInput: 1.75, costOutput: 14, contextWindow: 400000, reasoning: false },
        { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro', costInput: 1.25, costOutput: 10, contextWindow: 1048576, reasoning: true },
        { id: 'openai/o3', name: 'OpenAI o3', costInput: 2, costOutput: 8, contextWindow: 200000, reasoning: true },
        { id: 'mistralai/mistral-large', name: 'Mistral Large', costInput: 2, costOutput: 6, contextWindow: 131072, reasoning: false },
        { id: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5', costInput: 1, costOutput: 5, contextWindow: 200000, reasoning: false },
        { id: 'cohere/command-r-plus', name: 'Command R+', costInput: 2.5, costOutput: 5, contextWindow: 128000, reasoning: false },
        { id: 'openai/o4-mini', name: 'OpenAI o4-mini', costInput: 1.1, costOutput: 4.4, contextWindow: 200000, reasoning: true },
        // Bottom 10 cheap
        { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', costInput: 0.3, costOutput: 2.5, contextWindow: 1048576, reasoning: false },
        { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1', costInput: 0.55, costOutput: 2.19, contextWindow: 128000, reasoning: true },
        { id: 'openai/gpt-5-mini', name: 'GPT-5 Mini', costInput: 0.25, costOutput: 2, contextWindow: 400000, reasoning: false },
        { id: 'meta-llama/llama-4-maverick', name: 'Llama 4 Maverick', costInput: 0.2, costOutput: 0.6, contextWindow: 1000000, reasoning: false },
        { id: 'mistralai/mistral-small', name: 'Mistral Small', costInput: 0.1, costOutput: 0.3, contextWindow: 131072, reasoning: false },
        { id: 'google/gemma-3-27b', name: 'Gemma 3 27B', costInput: 0.1, costOutput: 0.2, contextWindow: 96000, reasoning: false },
        { id: 'qwen/qwen3-32b', name: 'Qwen3 32B', costInput: 0.08, costOutput: 0.18, contextWindow: 131072, reasoning: false },
        { id: 'deepseek/deepseek-chat-v3', name: 'DeepSeek V3', costInput: 0.07, costOutput: 0.14, contextWindow: 128000, reasoning: false },
        { id: 'meta-llama/llama-4-scout', name: 'Llama 4 Scout', costInput: 0.05, costOutput: 0.1, contextWindow: 512000, reasoning: false },
        { id: 'microsoft/phi-4', name: 'Phi-4', costInput: 0.03, costOutput: 0.05, contextWindow: 16384, reasoning: false },
      ],
      'groq': [
        { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', costInput: 0.59, costOutput: 0.79, contextWindow: 131072, reasoning: false },
        { id: 'llama3-8b-8192', name: 'Llama 3 8B', costInput: 0.05, costOutput: 0.08, contextWindow: 8192, reasoning: false },
        { id: 'gemma2-9b-it', name: 'Gemma 2 9B', costInput: 0.2, costOutput: 0.2, contextWindow: 8192, reasoning: false },
      ],
      'mistral': [
        { id: 'mistral-large-2512', name: 'Mistral Large', costInput: 2, costOutput: 6, contextWindow: 131072, reasoning: false },
        { id: 'mistral-medium-3.1', name: 'Mistral Medium 3.1', costInput: 1, costOutput: 3, contextWindow: 131072, reasoning: false },
        { id: 'mistral-small-3.2-24b-instruct', name: 'Mistral Small 3.2', costInput: 0.1, costOutput: 0.3, contextWindow: 131072, reasoning: false },
      ],
      'deepseek': [
        { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', costInput: 0.56, costOutput: 1.68, contextWindow: 128000, reasoning: true },
        { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', costInput: 0.14, costOutput: 0.42, contextWindow: 128000, reasoning: true },
      ],
      'xai': [
        { id: 'grok-4', name: 'Grok 4', costInput: 6, costOutput: 18, contextWindow: 256000, reasoning: true },
        { id: 'grok-4-fast', name: 'Grok 4 Fast', costInput: 3, costOutput: 9, contextWindow: 256000, reasoning: false },
        { id: 'grok-3-mini-beta', name: 'Grok 3 Mini', costInput: 0.3, costOutput: 0.5, contextWindow: 131072, reasoning: false },
      ],
      'cerebras': [
        { id: 'llama-3.3-70b', name: 'Llama 3.3 70B', costInput: 0.85, costOutput: 1.2, contextWindow: 8192, reasoning: false },
      ],
      'huggingface': [
        { id: 'meta-llama/Llama-3.3-70B-Instruct', name: 'Llama 3.3 70B', costInput: 0.5, costOutput: 0.7, contextWindow: 131072, reasoning: false },
      ],
      'azure-openai-responses': [
        { id: 'gpt-5.2', name: 'GPT-5.2', costInput: 1.75, costOutput: 14, contextWindow: 400000, reasoning: false },
        { id: 'gpt-4o', name: 'GPT-4o', costInput: 2.5, costOutput: 10, contextWindow: 128000, reasoning: false },
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini', costInput: 0.15, costOutput: 0.6, contextWindow: 128000, reasoning: false },
      ],
      'amazon-bedrock': [
        { id: 'anthropic.claude-opus-4.7', name: 'Claude Opus 4.7', costInput: 5, costOutput: 25, contextWindow: 200000, reasoning: true },
        { id: 'anthropic.claude-sonnet-4.6', name: 'Claude Sonnet 4.6', costInput: 3, costOutput: 15, contextWindow: 200000, reasoning: true },
        { id: 'anthropic.claude-haiku-4.5', name: 'Claude Haiku 4.5', costInput: 1, costOutput: 5, contextWindow: 200000, reasoning: false },
      ],
      'zai': [
        { id: 'glm-5', name: 'GLM-5', costInput: 1, costOutput: 3.2, contextWindow: 128000, reasoning: true },
        { id: 'glm-4.7', name: 'GLM-4.7', costInput: 0.6, costOutput: 2.2, contextWindow: 128000, reasoning: false },
        { id: 'glm-4.7-flash', name: 'GLM-4.7 Flash', costInput: 0, costOutput: 0, contextWindow: 128000, reasoning: false },
      ],
      'vercel-ai-gateway': [
        { id: 'anthropic/claude-opus-4.7', name: 'Claude Opus 4.7', costInput: 5, costOutput: 25, contextWindow: 200000, reasoning: true },
        { id: 'anthropic/claude-sonnet-4.6', name: 'Claude Sonnet 4.6', costInput: 3, costOutput: 15, contextWindow: 200000, reasoning: true },
        { id: 'openai/gpt-5.2-codex', name: 'GPT-5.2 Codex', costInput: 1.75, costOutput: 14, contextWindow: 400000, reasoning: false },
      ],
    }
    const models = MOCK_MODELS[provider] ?? []
    // Simulate the IPC handler's totalCount — openrouter and vercel have many more in reality
    const MOCK_TOTAL_COUNTS: Record<string, number> = { 'openrouter': 233, 'vercel-ai-gateway': 129, 'amazon-bedrock': 79 }
    return { models, totalCount: MOCK_TOTAL_COUNTS[provider] ?? models.length }
  },

  // ------------------------------------------------------------------
  // Messaging Gateway (Telegram + WhatsApp)
  // ------------------------------------------------------------------

  getMessagingConfig: async () => {
    console.log('[Playground] getMessagingConfig called')
    return {
      enabled: true,
      platforms: {
        telegram: { enabled: true },
        whatsapp: { enabled: true },
      },
      runtime: {
        telegram: messagingMockState.runtime.telegram,
        whatsapp: messagingMockState.runtime.whatsapp,
      },
    }
  },

  updateMessagingConfig: async (config: Record<string, unknown>) => {
    console.log('[Playground] updateMessagingConfig called:', config)
  },

  testTelegramToken: async (token: string) => {
    console.log('[Playground] testTelegramToken called')
    if (token.includes(':') && token.length > 10) {
      return { success: true, botName: 'Playground Bot', botUsername: 'playground_bot' }
    }
    return { success: false, error: 'Invalid token format (expected 1234567:ABC...)' }
  },

  saveTelegramToken: async (token: string) => {
    console.log('[Playground] saveTelegramToken called')
    void token
    playgroundMessagingHandle.setTelegramConnected(true, 'Playground Bot')
  },

  disconnectMessagingPlatform: async (platform: string) => {
    console.log('[Playground] disconnectMessagingPlatform called:', platform)
    if (platform === 'telegram') playgroundMessagingHandle.setTelegramConnected(false)
    if (platform === 'whatsapp') playgroundMessagingHandle.setWhatsAppConnected(false)
  },

  forgetMessagingPlatform: async (platform: string) => {
    console.log('[Playground] forgetMessagingPlatform called:', platform)
    if (platform === 'telegram') playgroundMessagingHandle.setTelegramConnected(false)
    if (platform === 'whatsapp') playgroundMessagingHandle.setWhatsAppConnected(false)
    // Drop bindings for that platform
    playgroundMessagingHandle.setBindings(
      messagingMockState.bindings.filter((b) => b.platform !== platform),
    )
  },

  getMessagingBindings: async () => {
    console.log('[Playground] getMessagingBindings called')
    return messagingMockState.bindings
  },

  generateMessagingPairingCode: async (sessionId: string, platform: string) => {
    console.log('[Playground] generateMessagingPairingCode called:', { sessionId, platform })
    return {
      code: '482193',
      expiresAt: Date.now() + 5 * 60_000,
      botUsername: platform === 'telegram' ? 'playground_bot' : undefined,
    }
  },

  unbindMessagingSession: async (sessionId: string, platform?: string) => {
    console.log('[Playground] unbindMessagingSession called:', { sessionId, platform })
    playgroundMessagingHandle.setBindings(
      messagingMockState.bindings.filter((b) => {
        if (b.sessionId !== sessionId) return true
        if (platform && b.platform !== platform) return true
        return false
      }),
    )
  },

  unbindMessagingBinding: async (bindingId: string) => {
    console.log('[Playground] unbindMessagingBinding called:', bindingId)
    playgroundMessagingHandle.setBindings(
      messagingMockState.bindings.filter((b) => b.id !== bindingId),
    )
    return { success: true }
  },

  // ------------------------------------------------------------------
  // Messaging access control (mirrors the production ElectronAPI surface)
  // ------------------------------------------------------------------

  getMessagingPlatformOwners: async (platform: AllowListPlatform): Promise<PlatformOwner[]> => {
    console.log('[Playground] getMessagingPlatformOwners called:', platform)
    return [...messagingMockState.allowList[platform].owners]
  },

  setMessagingPlatformOwners: async (
    platform: AllowListPlatform,
    owners: PlatformOwner[],
  ): Promise<PlatformOwner[]> => {
    console.log('[Playground] setMessagingPlatformOwners called:', platform, owners.length)
    playgroundAllowListHandle.setOwners(platform, owners)
    return [...owners]
  },

  getMessagingPlatformAccessMode: async (platform: AllowListPlatform): Promise<PlatformAccessMode> => {
    console.log('[Playground] getMessagingPlatformAccessMode called:', platform)
    return messagingMockState.allowList[platform].accessMode
  },

  setMessagingPlatformAccessMode: async (
    platform: AllowListPlatform,
    mode: PlatformAccessMode,
  ) => {
    console.log('[Playground] setMessagingPlatformAccessMode called:', platform, mode)
    playgroundAllowListHandle.setAccessMode(platform, mode)
    return { success: true }
  },

  getMessagingPendingSenders: async (platform?: AllowListPlatform): Promise<PendingSender[]> => {
    console.log('[Playground] getMessagingPendingSenders called:', platform)
    if (!platform) {
      return [
        ...messagingMockState.allowList.telegram.pending,
        ...messagingMockState.allowList.whatsapp.pending,
        ...messagingMockState.allowList.lark.pending,
      ]
    }
    return [...messagingMockState.allowList[platform].pending]
  },

  dismissMessagingPendingSender: async (
    platform: AllowListPlatform,
    userId: string,
    opts?: { reason?: string; bindingId?: string },
  ) => {
    console.log('[Playground] dismissMessagingPendingSender called:', platform, userId, opts)
    const next = messagingMockState.allowList[platform].pending.filter((s) => {
      if (s.userId !== userId) return true
      if (opts?.reason !== undefined && (s.reason ?? 'not-owner') !== opts.reason) return true
      if (opts?.bindingId !== undefined && s.bindingId !== opts.bindingId) return true
      return false
    })
    playgroundAllowListHandle.setPending(platform, next)
    return { success: true }
  },

  allowMessagingPendingSender: async (
    platform: AllowListPlatform,
    userId: string,
    entryKey?: { reason?: string; bindingId?: string },
  ): Promise<{ owners: PlatformOwner[]; bindingId?: string }> => {
    console.log('[Playground] allowMessagingPendingSender called:', platform, userId, entryKey)
    const state = messagingMockState.allowList[platform]
    const match = state.pending.find((p) =>
      p.userId === userId &&
      (entryKey?.reason === undefined || (p.reason ?? 'not-owner') === entryKey.reason) &&
      (entryKey?.bindingId === undefined || p.bindingId === entryKey.bindingId),
    )
    if (!match) throw new Error('Pending sender not found')

    const reason = match.reason ?? 'not-owner'
    if (reason === 'not-on-binding-allowlist' && match.bindingId) {
      // Binding-scoped allow — don't promote to workspace owner.
      const access = state.bindings[match.bindingId] ?? {
        mode: 'allow-list' as const,
        allowedSenderIds: [],
      }
      const next = {
        mode: 'allow-list' as const,
        allowedSenderIds: Array.from(new Set([...access.allowedSenderIds, userId])),
      }
      playgroundAllowListHandle.setBindingAccess(platform, match.bindingId, next)
      playgroundAllowListHandle.setPending(
        platform,
        state.pending.filter(
          (p) => !(p.userId === userId && p.bindingId === match.bindingId),
        ),
      )
      return { owners: [...state.owners], bindingId: match.bindingId }
    }

    // 'not-owner' branch: promote to workspace owner.
    const owner: PlatformOwner = {
      userId: match.userId,
      ...(match.displayName ? { displayName: match.displayName } : {}),
      ...(match.username ? { username: match.username } : {}),
      addedAt: Date.now(),
    }
    const nextOwners = [...state.owners.filter((o) => o.userId !== userId), owner]
    playgroundAllowListHandle.setOwners(platform, nextOwners)
    playgroundAllowListHandle.setPending(
      platform,
      state.pending.filter((p) => p.userId !== userId),
    )
    return { owners: nextOwners }
  },

  setMessagingBindingAccess: async (
    bindingId: string,
    access: BindingAccess,
  ) => {
    console.log('[Playground] setMessagingBindingAccess called:', bindingId)
    // Playground stores binding access keyed under telegram by default —
    // production records the binding's platform server-side, so the mock
    // doesn't need to be platform-aware to exercise the UI.
    playgroundAllowListHandle.setBindingAccess('telegram', bindingId, access)
    return { success: true }
  },

  onMessagingPendingChanged: (_callback: (workspaceId: string) => void) => {
    // No-op listener; Phase 3 binding-changed events refresh state already.
    return () => {}
  },

  onMessagingBindingChanged: (callback: (workspaceId: string) => void) => {
    messagingMockState.bindingListeners.add(callback)
    return () => {
      messagingMockState.bindingListeners.delete(callback)
    }
  },

  onMessagingPlatformStatus: (
    callback: (
      workspaceId: string,
      platform: string,
      status: MessagingPlatformRuntimeInfo,
    ) => void,
  ) => {
    messagingMockState.platformStatusListeners.add(callback)
    return () => {
      messagingMockState.platformStatusListeners.delete(callback)
    }
  },

  // WhatsApp subprocess-based pairing — we fire a synthetic QR after a short
  // delay so the "show_qr" phase is visible by default, but variants can
  // override this by calling __playgroundMessaging.fireWAEvent().
  startWhatsAppConnect: async () => {
    console.log('[Playground] startWhatsAppConnect called')
    setTimeout(() => {
      emitWhatsAppEvent({
        type: 'qr',
        qr: 'playground://whatsapp/qr/' + Math.random().toString(36).slice(2),
      })
    }, 400)
    return { success: true }
  },

  submitWhatsAppPhone: async (phoneNumber: string) => {
    console.log('[Playground] submitWhatsAppPhone called:', phoneNumber)
    return { success: true }
  },

  onWhatsAppEvent: (
    callback: (payload: { workspaceId: string; event: WhatsAppUiEvent }) => void,
  ) => {
    messagingMockState.waEventListeners.add(callback)
    return () => {
      messagingMockState.waEventListeners.delete(callback)
    }
  },
}

/**
 * Inject mock electronAPI into window if not already present.
 * Call this in playground component wrappers before rendering components
 * that depend on electronAPI.
 *
 * IMPORTANT: this also runs as a top-level side effect when this module is
 * imported (see below), so that consumers relying on a synchronous
 * `window.electronAPI.*` read at module-load time (e.g.
 * `SessionFilesSection.tsx`'s top-level `getRuntimeEnvironment()` call) see
 * the mock before their module is evaluated. The entry `playground.tsx`
 * must import this module before any component chain that touches
 * `window.electronAPI` at import time.
 */
export function ensureMockElectronAPI() {
  if (!window.electronAPI) {
    ;(window as any).electronAPI = mockElectronAPI
    console.log('[Playground] Injected mock electronAPI')
  }
  if (!(window as any).__playgroundMessaging) {
    ;(window as any).__playgroundMessaging = playgroundMessagingHandle
    console.log('[Playground] Exposed __playgroundMessaging handle')
  }
  if (!(window as any).__playgroundAllowList) {
    ;(window as any).__playgroundAllowList = playgroundAllowListHandle
    console.log('[Playground] Exposed __playgroundAllowList handle')
  }
}

// Install on import so any later module that reads `window.electronAPI` at
// top level finds the mock in place. Safe: only runs once (idempotent).
ensureMockElectronAPI()

// ============================================================================
// Sample Data
// ============================================================================

export const mockSources: LoadedSource[] = [
  {
    config: {
      id: 'github-api-1',
      slug: 'github-api',
      name: 'GitHub API',
      provider: 'github',
      type: 'api',
      enabled: true,
      api: {
        baseUrl: 'https://api.github.com',
        authType: 'bearer',
      },
      icon: 'https://www.google.com/s2/favicons?domain=github.com&sz=128',
      tagline: 'Access repositories, issues, and pull requests',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    guide: null,
    folderPath: '/mock/sources/github-api',
    workspaceRootPath: '/mock/workspaces/playground-workspace',
    workspaceId: 'playground-workspace',
  },
  {
    config: {
      id: 'linear-api-1',
      slug: 'linear-api',
      name: 'Linear',
      provider: 'linear',
      type: 'api',
      enabled: true,
      api: {
        baseUrl: 'https://api.linear.app',
        authType: 'bearer',
      },
      icon: 'https://www.google.com/s2/favicons?domain=linear.app&sz=128',
      tagline: 'Issue tracking and project management',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    guide: null,
    folderPath: '/mock/sources/linear-api',
    workspaceRootPath: '/mock/workspaces/playground-workspace',
    workspaceId: 'playground-workspace',
  },
  {
    config: {
      id: 'local-files-1',
      slug: 'local-files',
      name: 'Local Files',
      provider: 'filesystem',
      type: 'local',
      enabled: true,
      local: {
        path: '/Users/demo/projects',
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    guide: null,
    folderPath: '/mock/sources/local-files',
    workspaceRootPath: '/mock/workspaces/playground-workspace',
    workspaceId: 'playground-workspace',
  },
]

export const sampleImageAttachment: FileAttachment = {
  type: 'image',
  path: '/Users/demo/screenshot.png',
  name: 'screenshot.png',
  mimeType: 'image/png',
  size: 245000,
  base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
}

export const samplePdfAttachment: FileAttachment = {
  type: 'pdf',
  path: '/Users/demo/design.pdf',
  name: 'design.pdf',
  mimeType: 'application/pdf',
  size: 1024000,
}

// ============================================================================
// Mock Callbacks
// ============================================================================

export const mockInputCallbacks = {
  onSubmit: (message: string, attachments?: FileAttachment[]) => {
    console.log('[Playground] Message submitted:', { message, attachments })
  },

  onModelChange: (model: string) => {
    console.log('[Playground] Model changed to:', model)
  },

  onInputChange: (value: string) => {
    console.log('[Playground] Input changed:', value.substring(0, 50) + (value.length > 50 ? '...' : ''))
  },

  onHeightChange: (height: number) => {
    console.log('[Playground] Height changed:', height)
  },

  onFocusChange: (focused: boolean) => {
    console.log('[Playground] Focus changed:', focused)
  },

  onPermissionModeChange: (mode: PermissionMode) => {
    console.log('[Playground] Permission mode changed:', mode)
  },

  onSourcesChange: (slugs: string[]) => {
    console.log('[Playground] Sources changed:', slugs)
  },

  onWorkingDirectoryChange: (path: string) => {
    console.log('[Playground] Working directory changed:', path)
  },

  onStop: () => {
    console.log('[Playground] Stop requested')
  },
}

export const mockAttachmentCallbacks = {
  onRemove: (index: number) => {
    console.log('[Playground] Remove attachment at index:', index)
  },

  onOpenFile: (path: string) => {
    console.log('[Playground] Open file:', path)
  },
}

export const mockBackgroundTaskCallbacks = {
  onKillTask: (taskId: string) => {
    console.log('[Playground] Kill task:', taskId)
  },
}
