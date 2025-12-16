// Types shared between main and renderer processes

export interface Session {
  id: string
  workspaceId: string
  workspaceName: string
  lastMessageAt: number
  messages: Message[]
  isProcessing: boolean
}

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'error' | 'status'
  content: string
  timestamp: number
  toolName?: string
  toolUseId?: string      // Unique identifier for tool calls (for matching results)
  toolInput?: unknown
  toolResult?: string
  isStreaming?: boolean
}

export interface Workspace {
  id: string
  name: string
  mcpUrl: string
}

/**
 * Structured error information from the agent.
 * Provides user-friendly messages and recovery actions.
 */
export interface TypedError {
  code: string
  title: string
  message: string
  canRetry: boolean
}

// Events sent from main to renderer
export type SessionEvent =
  | { type: 'text_delta'; sessionId: string; delta: string }
  | { type: 'text_complete'; sessionId: string; text: string }
  | { type: 'tool_start'; sessionId: string; toolName: string; toolUseId: string; toolInput: unknown }
  | { type: 'tool_result'; sessionId: string; toolUseId: string; toolName: string; result: string }
  | { type: 'error'; sessionId: string; error: string }
  | { type: 'typed_error'; sessionId: string; error: TypedError }
  | { type: 'complete'; sessionId: string }
  | { type: 'status'; sessionId: string; message: string }

/**
 * Generates a unique message ID.
 * Uses timestamp + random string to prevent collisions when multiple
 * messages are created within the same millisecond.
 */
export function generateMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// IPC channel names
export const IPC_CHANNELS = {
  // Session management
  GET_SESSIONS: 'sessions:get',
  CREATE_SESSION: 'sessions:create',
  DELETE_SESSION: 'sessions:delete',
  SEND_MESSAGE: 'sessions:sendMessage',
  CANCEL_PROCESSING: 'sessions:cancel',

  // Workspace management
  GET_WORKSPACES: 'workspaces:get',

  // Events from main to renderer
  SESSION_EVENT: 'session:event',

  // File operations
  READ_FILE: 'file:read',

  // Theme
  GET_SYSTEM_THEME: 'theme:getSystemPreference',
  SYSTEM_THEME_CHANGED: 'theme:systemChanged',

  // System
  GET_VERSIONS: 'system:versions'
} as const

// Type-safe IPC API exposed to renderer
export interface ElectronAPI {
  // Session management
  getSessions(): Promise<Session[]>
  createSession(workspaceId: string): Promise<Session>
  deleteSession(sessionId: string): Promise<void>
  sendMessage(sessionId: string, message: string): Promise<void>
  cancelProcessing(sessionId: string): Promise<void>

  // Workspace management
  getWorkspaces(): Promise<Workspace[]>

  // Event listener
  onSessionEvent(callback: (event: SessionEvent) => void): () => void

  // File operations
  readFile(path: string): Promise<string>

  // Theme
  getSystemTheme(): Promise<boolean>
  onSystemThemeChange(callback: (isDark: boolean) => void): () => void

  // System
  getVersions(): { node: string; chrome: string; electron: string }
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
