// Types shared between main and renderer processes
// Core types are re-exported from @craft-agent/core

// Re-export core types
export type {
  Message,
  MessageRole,
  TypedError,
  TokenUsage,
  Workspace,
  SessionMetadata,
  SubAgentMetadata,
  StoredAttachment,
} from '../../../../packages/core/src/types/index.ts';
export { generateMessageId } from '../../../../packages/core/src/types/index.ts';

/**
 * File attachment for sending with messages
 * Matches the FileAttachment interface from src/utils/files.ts
 */
export interface FileAttachment {
  type: 'image' | 'text' | 'pdf' | 'office' | 'unknown'
  path: string
  name: string
  mimeType: string
  base64?: string  // For images, PDFs, and Office files
  text?: string    // For text files
  size: number
}

// Import types needed for Session interface
import type { Message } from '../../../../packages/core/src/types/index.ts';

/**
 * Electron-specific Session type (includes runtime state)
 * Extends core Session with messages array and processing state
 */
export interface Session {
  id: string
  workspaceId: string
  workspaceName: string
  name?: string  // User-defined or AI-generated session name
  lastMessageAt: number
  messages: Message[]
  isProcessing: boolean
  // Inbox/Archive features (from core SessionMetadata)
  agentId?: string
  agentName?: string
  isArchived?: boolean
}

// Events sent from main to renderer
export type SessionEvent =
  | { type: 'text_delta'; sessionId: string; delta: string }
  | { type: 'text_complete'; sessionId: string; text: string }
  | { type: 'tool_start'; sessionId: string; toolName: string; toolUseId: string; toolInput: Record<string, unknown> }
  | { type: 'tool_result'; sessionId: string; toolUseId: string; toolName: string; result: string }
  | { type: 'error'; sessionId: string; error: string }
  | { type: 'typed_error'; sessionId: string; error: import('../../../../packages/core/src/types/index.ts').TypedError }
  | { type: 'complete'; sessionId: string }
  | { type: 'status'; sessionId: string; message: string }
  | { type: 'title_generated'; sessionId: string; title: string }

// IPC channel names
export const IPC_CHANNELS = {
  // Session management
  GET_SESSIONS: 'sessions:get',
  CREATE_SESSION: 'sessions:create',
  DELETE_SESSION: 'sessions:delete',
  RENAME_SESSION: 'sessions:rename',
  SEND_MESSAGE: 'sessions:sendMessage',
  CANCEL_PROCESSING: 'sessions:cancel',
  ARCHIVE_SESSION: 'sessions:archive',
  UNARCHIVE_SESSION: 'sessions:unarchive',

  // Workspace management
  GET_WORKSPACES: 'workspaces:get',

  // Agent management (new for Phase 6)
  GET_AGENTS: 'agents:get',
  REFRESH_AGENTS: 'agents:refresh',
  CHECK_AGENT_AUTH: 'agents:checkAuth',

  // Events from main to renderer
  SESSION_EVENT: 'session:event',

  // File operations
  READ_FILE: 'file:read',
  OPEN_FILE_DIALOG: 'file:openDialog',
  READ_FILE_ATTACHMENT: 'file:readAttachment',
  STORE_ATTACHMENT: 'file:storeAttachment',

  // Theme
  GET_SYSTEM_THEME: 'theme:getSystemPreference',
  SYSTEM_THEME_CHANGED: 'theme:systemChanged',

  // System
  GET_VERSIONS: 'system:versions',

  // Shell operations (open external URLs/files)
  OPEN_URL: 'shell:openUrl',
  OPEN_FILE: 'shell:openFile',
} as const

// Re-import Workspace for ElectronAPI
import type { Workspace, SessionMetadata } from '../../../../packages/core/src/types/index.ts';
import type { SubAgentMetadata } from '../../../../packages/core/src/types/index.ts';

// Type-safe IPC API exposed to renderer
export interface ElectronAPI {
  // Session management
  getSessions(): Promise<Session[]>
  createSession(workspaceId: string, agentId?: string, agentName?: string): Promise<Session>
  deleteSession(sessionId: string): Promise<void>
  renameSession(sessionId: string, name: string): Promise<void>
  sendMessage(sessionId: string, message: string, attachments?: FileAttachment[]): Promise<void>
  cancelProcessing(sessionId: string): Promise<void>
  archiveSession(sessionId: string): Promise<void>
  unarchiveSession(sessionId: string): Promise<void>

  // Workspace management
  getWorkspaces(): Promise<Workspace[]>

  // Agent management
  getAgents(workspaceId: string): Promise<SubAgentMetadata[]>
  refreshAgents(workspaceId: string): Promise<SubAgentMetadata[]>
  checkAgentAuth(workspaceId: string, agentId: string): Promise<{ needsAuth: boolean; reason?: string }>

  // Event listener
  onSessionEvent(callback: (event: SessionEvent) => void): () => void

  // File operations
  readFile(path: string): Promise<string>
  openFileDialog(): Promise<string[]>
  readFileAttachment(path: string): Promise<FileAttachment | null>
  storeAttachment(sessionId: string, attachment: FileAttachment): Promise<import('../../../../packages/core/src/types/index.ts').StoredAttachment>

  // Theme
  getSystemTheme(): Promise<boolean>
  onSystemThemeChange(callback: (isDark: boolean) => void): () => void

  // System
  getVersions(): { node: string; chrome: string; electron: string }

  // Shell operations
  openUrl(url: string): Promise<void>
  openFile(path: string): Promise<void>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
