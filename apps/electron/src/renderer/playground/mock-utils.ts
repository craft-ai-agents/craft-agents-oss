import type { FileAttachment, LoadedSource, PermissionMode } from '../../shared/types'

// ============================================================================
// Mock electronAPI
// ============================================================================

export const mockElectronAPI = {
  isDebugMode: async () => true,

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
  ],
  getPiProviderBaseUrl: async () => '',
  getPiProviderModels: async (provider: string) => {
    const MOCK_MODELS: Record<string, Array<{ id: string; name: string; costInput: number; costOutput: number; contextWindow: number; reasoning: boolean }>> = {
      'openrouter': [
        // Top 10 expensive
        { id: 'anthropic/claude-opus-4.6', name: 'Claude Opus 4.6', costInput: 5, costOutput: 25, contextWindow: 200000, reasoning: true },
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
        { id: 'anthropic.claude-opus-4.6', name: 'Claude Opus 4.6', costInput: 5, costOutput: 25, contextWindow: 200000, reasoning: true },
        { id: 'anthropic.claude-sonnet-4.6', name: 'Claude Sonnet 4.6', costInput: 3, costOutput: 15, contextWindow: 200000, reasoning: true },
        { id: 'anthropic.claude-haiku-4.5', name: 'Claude Haiku 4.5', costInput: 1, costOutput: 5, contextWindow: 200000, reasoning: false },
      ],
      'zai': [
        { id: 'glm-5', name: 'GLM-5', costInput: 1, costOutput: 3.2, contextWindow: 128000, reasoning: true },
        { id: 'glm-4.7', name: 'GLM-4.7', costInput: 0.6, costOutput: 2.2, contextWindow: 128000, reasoning: false },
        { id: 'glm-4.7-flash', name: 'GLM-4.7 Flash', costInput: 0, costOutput: 0, contextWindow: 128000, reasoning: false },
      ],
      'vercel-ai-gateway': [
        { id: 'anthropic/claude-opus-4.6', name: 'Claude Opus 4.6', costInput: 5, costOutput: 25, contextWindow: 200000, reasoning: true },
        { id: 'anthropic/claude-sonnet-4.6', name: 'Claude Sonnet 4.6', costInput: 3, costOutput: 15, contextWindow: 200000, reasoning: true },
        { id: 'openai/gpt-5.2-codex', name: 'GPT-5.2 Codex', costInput: 1.75, costOutput: 14, contextWindow: 400000, reasoning: false },
      ],
    }
    const models = MOCK_MODELS[provider] ?? []
    // Simulate the IPC handler's totalCount — openrouter and vercel have many more in reality
    const MOCK_TOTAL_COUNTS: Record<string, number> = { 'openrouter': 233, 'vercel-ai-gateway': 129, 'amazon-bedrock': 79 }
    return { models, totalCount: MOCK_TOTAL_COUNTS[provider] ?? models.length }
  },
}

/**
 * Inject mock electronAPI into window if not already present.
 * Call this in playground component wrappers before rendering components
 * that depend on electronAPI.
 */
export function ensureMockElectronAPI() {
  if (!window.electronAPI) {
    ;(window as any).electronAPI = mockElectronAPI
    console.log('[Playground] Injected mock electronAPI')
  }
}

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
