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

  openFile: async (path: string) => {
    console.log('[Playground] openFile called:', path)
    alert(`Would open file in system editor:\n${path}`)
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

  onUltrathinkChange: (enabled: boolean) => {
    console.log('[Playground] Ultrathink changed:', enabled)
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
