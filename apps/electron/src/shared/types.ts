// Types shared between main and renderer processes
// Core types are re-exported from @craft-agent/core

// Import and re-export core types
import type {
  Message as CoreMessage,
  MessageRole as CoreMessageRole,
  TypedError,
  TokenUsage as CoreTokenUsage,
  Workspace as CoreWorkspace,
  SessionMetadata as CoreSessionMetadata,
  StoredAttachment as CoreStoredAttachment,
  ContentBadge,
  ToolDisplayMeta,
} from '@craft-agent/core/types';

// Import mode types from dedicated subpath export (avoids pulling in SDK)
import type { PermissionMode } from '@craft-agent/shared/agent/modes';
export type { PermissionMode };
export { PERMISSION_MODE_CONFIG } from '@craft-agent/shared/agent/modes';

// Import thinking level types
import type { ThinkingLevel } from '@craft-agent/shared/agent/thinking-levels';
export type { ThinkingLevel };
export { THINKING_LEVELS, DEFAULT_THINKING_LEVEL } from '@craft-agent/shared/agent/thinking-levels';

export type {
  CoreMessage as Message,
  CoreMessageRole as MessageRole,
  TypedError,
  CoreTokenUsage as TokenUsage,
  CoreWorkspace as Workspace,
  CoreSessionMetadata as SessionMetadata,
  CoreStoredAttachment as StoredAttachment,
  ContentBadge,
  ToolDisplayMeta,
};

// Import and re-export auth types for onboarding
// Use types-only subpaths to avoid pulling in Node.js dependencies
import type { AuthState, SetupNeeds } from '@craft-agent/shared/auth/types';
import type { AuthType } from '@craft-agent/shared/config/types';
export type { AuthState, SetupNeeds, AuthType };

// Import and re-export credential health types
import type { CredentialHealthStatus, CredentialHealthIssue, CredentialHealthIssueType } from '@craft-agent/shared/credentials/types';
export type { CredentialHealthStatus, CredentialHealthIssue, CredentialHealthIssueType };

// Import source types for session source selection
import type { LoadedSource, FolderSourceConfig, SourceConnectionStatus } from '@craft-agent/shared/sources/types';
export type { LoadedSource, FolderSourceConfig, SourceConnectionStatus };

// Import skill types
import type { LoadedSkill, SkillMetadata } from '@craft-agent/shared/skills/types';
export type { LoadedSkill, SkillMetadata };

// Import session types from shared (for SessionFamily - different from core SessionMetadata)
import type { SessionMetadata as SharedSessionMetadata } from '@craft-agent/shared/sessions/types';

// Import LLM connection types
import type { LlmConnection, LlmConnectionWithStatus, LlmAuthType, LlmProviderType } from '@craft-agent/shared/config';
export type { LlmConnection, LlmConnectionWithStatus, LlmAuthType, LlmProviderType };

/**
 * Setup data for creating/updating an LLM connection via IPC.
 * Combines connection identity with credential (which isn't stored in config).
 */
export interface LlmConnectionSetup {
  slug: string              // Connection slug: 'anthropic-api', 'claude-max', 'codex', 'codex-api'
  credential?: string       // API key or OAuth token (stored in credential manager, not config)
  baseUrl?: string | null   // Custom API endpoint (null to clear)
  defaultModel?: string | null  // Custom model override (null to clear)
  models?: string[] | null  // Optional model list for compat providers
}


/**
 * File/directory entry in a skill folder
 */
export interface SkillFile {
  name: string
  type: 'file' | 'directory'
  size?: number
  children?: SkillFile[]
}

/**
 * File/directory entry in a session folder
 * Supports recursive tree structure with children for directories
 */
export interface SessionFile {
  name: string
  path: string
  type: 'file' | 'directory'
  size?: number
  children?: SessionFile[]  // Recursive children for directories
}

/**
 * File search result for @ mention file selection.
 * Returned by FS_SEARCH IPC handler when user types @filename in input.
 */
export interface FileSearchResult {
  name: string
  path: string
  type: 'file' | 'directory'
  relativePath: string  // Path relative to search base
}

// Import auth request types for unified auth flow
import type { AuthRequest as SharedAuthRequest, CredentialInputMode as SharedCredentialInputMode, CredentialAuthRequest as SharedCredentialAuthRequest } from '@craft-agent/shared/agent';
export type { SharedAuthRequest as AuthRequest };
export type { SharedCredentialInputMode as CredentialInputMode };
// CredentialRequest is used by UI components for displaying credential input
export type CredentialRequest = SharedCredentialAuthRequest;
export { generateMessageId } from '@craft-agent/core/types';

/**
 * OAuth result from main process
 */
export interface OAuthResult {
  success: boolean
  error?: string
}

/**
 * MCP connection validation result
 */
export interface McpValidationResult {
  success: boolean
  error?: string
  tools?: string[]
}

/**
 * MCP tool with safe mode permission status
 */
export interface McpToolWithPermission {
  name: string
  description?: string
  allowed: boolean  // true if allowed in safe mode, false if requires permission
}

/**
 * Result of fetching MCP tools with permission status
 */
export interface McpToolsResult {
  success: boolean
  error?: string
  tools?: McpToolWithPermission[]
}

/**
 * Search match result for session content search
 */
export interface SessionSearchMatch {
  /** Session ID */
  sessionId: string
  /** Line number in the JSONL file */
  lineNumber: number
  /** The matched text snippet with context */
  snippet: string
}

/**
 * Aggregated search results for a session
 */
export interface SessionSearchResult {
  /** Session ID */
  sessionId: string
  /** Number of matches found in this session */
  matchCount: number
  /** First few matches with context snippets */
  matches: SessionSearchMatch[]
}

/**
 * Result of sharing or revoking a session
 */
export interface ShareResult {
  success: boolean
  url?: string
  error?: string
}

/**
 * Result of refreshing/regenerating a session title
 */
export interface RefreshTitleResult {
  success: boolean
  title?: string
  error?: string
}


// Re-export permission types from core, extended with sessionId for multi-session context
export type { PermissionRequest as BasePermissionRequest } from '@craft-agent/core/types';
import type { PermissionRequest as BasePermissionRequest } from '@craft-agent/core/types';

/**
 * Permission request with session context (for multi-session Electron app)
 */
export interface PermissionRequest extends BasePermissionRequest {
  sessionId: string
}

// ============================================
// Credential Input Types (Secure Auth UI)
// ============================================

// CredentialInputMode is imported from @craft-agent/shared/agent above

/**
 * Credential response from user (for credential auth requests)
 */
export interface CredentialResponse {
  type: 'credential'
  /** Single value for bearer/header/query modes */
  value?: string
  /** Username for basic auth */
  username?: string
  /** Password for basic auth */
  password?: string
  /** Headers for multi-header auth (e.g., { "DD-API-KEY": "...", "DD-APPLICATION-KEY": "..." }) */
  headers?: Record<string, string>
  /** Whether user cancelled */
  cancelled: boolean
}

// ============================================
// Plan Types (SubmitPlan workflow)
// ============================================

/**
 * Step in a plan
 */
export interface PlanStep {
  id: string
  description: string
  tools?: string[]
  status?: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped'
}

/**
 * Plan from the agent
 */
export interface Plan {
  id: string
  title: string
  summary?: string
  steps: PlanStep[]
  questions?: string[]
  state?: 'creating' | 'refining' | 'ready' | 'executing' | 'completed' | 'cancelled'
  createdAt?: number
  updatedAt?: number
}


// ============================================
// Onboarding Types
// ============================================

/**
 * Git Bash detection status (Windows only)
 */
export interface GitBashStatus {
  found: boolean
  path: string | null
  platform: 'win32' | 'darwin' | 'linux'
}

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
  thumbnailBase64?: string  // Quick Look thumbnail (generated by Electron main process)
}

// Import types needed for Session interface
import type { Message } from '@craft-agent/core/types';

/**
 * Electron-specific Session type (includes runtime state)
 * Extends core Session with messages array and processing state
 */
/**
 * Todo state for sessions (user-controlled, never automatic)
 *
 * Dynamic status ID referencing workspace status config.
 * Validated at runtime via validateSessionStatus().
 * Falls back to 'todo' if status doesn't exist.
 *
 * Built-in status IDs (for reference):
 * - 'todo': Not started
 * - 'in-progress': Currently working on
 * - 'needs-review': Awaiting review
 * - 'done': Completed successfully
 * - 'cancelled': Cancelled/abandoned
 */
export type TodoState = string

// Helper type for TypeScript consumers
export type BuiltInStatusId = 'todo' | 'in-progress' | 'needs-review' | 'done' | 'cancelled'

export interface Session {
  id: string
  workspaceId: string
  workspaceName: string
  name?: string  // User-defined or AI-generated session name
  /** Preview of first user message (from JSONL header, for lazy-loaded sessions) */
  preview?: string
  lastMessageAt: number
  messages: Message[]
  isProcessing: boolean
  // Session metadata
  isFlagged?: boolean
  // Advanced options (persisted per session)
  /** Permission mode for this session ('safe', 'ask', 'allow-all') */
  permissionMode?: PermissionMode
  // Todo state (user-controlled) - determines open vs closed
  todoState?: TodoState
  // Labels (additive tags, many-per-session — bare IDs or "id::value" entries)
  labels?: string[]
  // Read/unread tracking - ID of last message user has read
  lastReadMessageId?: string
  /**
   * Explicit unread flag - single source of truth for NEW badge.
   * Set to true when assistant message completes while user is NOT viewing.
   * Set to false when user views the session (and not processing).
   */
  hasUnread?: boolean
  // Per-session source selection (source slugs)
  enabledSourceSlugs?: string[]
  // Working directory for this session (used by agent for bash commands)
  workingDirectory?: string
  // Session folder path (for "Reset to Session Root" option)
  sessionFolderPath?: string
  // Shared viewer URL (if shared via viewer)
  sharedUrl?: string
  // Shared session ID in viewer (for revoke)
  sharedId?: string
  // Model to use for this session (overrides global config if set)
  model?: string
  // LLM connection slug for this session (locked after first message)
  llmConnection?: string
  // Thinking level for this session ('off', 'think', 'max')
  thinkingLevel?: ThinkingLevel
  // Role/type of the last message (for badge display without loading messages)
  lastMessageRole?: 'user' | 'assistant' | 'plan' | 'tool' | 'error'
  // ID of the last final (non-intermediate) assistant message - pre-computed for unread detection
  lastFinalMessageId?: string
  // Whether an async operation is ongoing (sharing, updating share, revoking, title regeneration)
  // Used for shimmer effect on session title in sidebar and panel header
  isAsyncOperationOngoing?: boolean
  /** @deprecated Use isAsyncOperationOngoing instead */
  isRegeneratingTitle?: boolean
  // Current status for ProcessingIndicator (e.g., compacting)
  currentStatus?: {
    message: string
    statusType?: string
  }
  // When the session was first created (ms timestamp)
  createdAt?: number
  // Total message count (pre-computed in JSONL header)
  messageCount?: number
  // Token usage for context tracking
  tokenUsage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    contextTokens: number
    costUsd: number
    cacheReadTokens?: number
    cacheCreationTokens?: number
    /** Model's context window size in tokens (from SDK modelUsage) */
    contextWindow?: number
  }
  /** When true, session is hidden from session list (e.g., mini edit sessions) */
  hidden?: boolean
  /** Whether this session is archived */
  isArchived?: boolean
  /** Timestamp when session was archived (for retention policy) */
  archivedAt?: number
  // Sub-session hierarchy (1 level max)
  /** Parent session ID (if this is a sub-session). Null/undefined = root session. */
  parentSessionId?: string
  /** Explicit sibling order (lazy - only populated when user reorders). */
  siblingOrder?: number
}

/**
 * Options for creating a new session
 * Note: Session creation itself has no options - auto-send is handled by NavigationContext
 */
export interface CreateSessionOptions {
  /** Session name (optional, AI-generated if not provided) */
  name?: string
  /** Initial permission mode for the session (overrides workspace default) */
  permissionMode?: PermissionMode
  /**
   * Working directory for the session:
   * - 'user_default' or undefined: Use workspace's configured default working directory
   * - 'none': No working directory (session folder only)
   * - Absolute path string: Use this specific path
   */
  workingDirectory?: string | 'user_default' | 'none'
  /** Model override for the session (e.g., 'haiku', 'sonnet') */
  model?: string
  /** LLM connection slug for the session (locked after first message) */
  llmConnection?: string
  /** System prompt preset for the session ('default' | 'mini' or custom string) */
  systemPromptPreset?: 'default' | 'mini' | string
  /** When true, session won't appear in session list (e.g., mini edit sessions) */
  hidden?: boolean
  /** Initial todo state (status) for the session */
  todoState?: TodoState
  /** Initial labels for the session */
  labels?: string[]
  /** Whether the session should be flagged */
  isFlagged?: boolean
  /** Per-session source selection (source slugs) */
  enabledSourceSlugs?: string[]
}

// Events sent from main to renderer
// turnId: Correlation ID from the API's message.id, groups all events in an assistant turn
export type SessionEvent =
  | { type: 'text_delta'; sessionId: string; delta: string; turnId?: string }
  | { type: 'text_complete'; sessionId: string; text: string; isIntermediate?: boolean; turnId?: string; parentToolUseId?: string }
  | { type: 'tool_start'; sessionId: string; toolName: string; toolUseId: string; toolInput: Record<string, unknown>; toolIntent?: string; toolDisplayName?: string; toolDisplayMeta?: import('@craft-agent/core').ToolDisplayMeta; turnId?: string; parentToolUseId?: string; timestamp?: number }
  | { type: 'tool_result'; sessionId: string; toolUseId: string; toolName: string; result: string; turnId?: string; parentToolUseId?: string; isError?: boolean }
  | { type: 'error'; sessionId: string; error: string }
  | { type: 'typed_error'; sessionId: string; error: TypedError }
  | { type: 'complete'; sessionId: string; tokenUsage?: Session['tokenUsage']; hasUnread?: boolean }
  | { type: 'interrupted'; sessionId: string; message?: Message }
  | { type: 'status'; sessionId: string; message: string; statusType?: 'compacting' }
  | { type: 'info'; sessionId: string; message: string; statusType?: 'compaction_complete'; level?: 'info' | 'warning' | 'error' | 'success' }
  | { type: 'title_generated'; sessionId: string; title: string }
  | { type: 'title_regenerating'; sessionId: string; isRegenerating: boolean }
  // Generic async operation state (sharing, updating share, revoking, title regeneration)
  | { type: 'async_operation'; sessionId: string; isOngoing: boolean }
  | { type: 'working_directory_changed'; sessionId: string; workingDirectory: string }
  | { type: 'permission_request'; sessionId: string; request: PermissionRequest }
  | { type: 'credential_request'; sessionId: string; request: CredentialRequest }
  // Permission mode events
  | { type: 'permission_mode_changed'; sessionId: string; permissionMode: PermissionMode }
  | { type: 'plan_submitted'; sessionId: string; message: CoreMessage }
  // Source events
  | { type: 'sources_changed'; sessionId: string; enabledSourceSlugs: string[] }
  | { type: 'labels_changed'; sessionId: string; labels: string[] }
  // LLM connection events
  | { type: 'connection_changed'; sessionId: string; connectionSlug: string }
  // Background task/shell events
  | { type: 'task_backgrounded'; sessionId: string; toolUseId: string; taskId: string; intent?: string; turnId?: string }
  | { type: 'shell_backgrounded'; sessionId: string; toolUseId: string; shellId: string; intent?: string; command?: string; turnId?: string }
  | { type: 'task_progress'; sessionId: string; toolUseId: string; elapsedSeconds: number; turnId?: string }
  | { type: 'shell_killed'; sessionId: string; shellId: string }
  // User message events (for optimistic UI with backend as source of truth)
  | { type: 'user_message'; sessionId: string; message: Message; status: 'accepted' | 'queued' | 'processing'; optimisticMessageId?: string }
  // Session metadata events (for multi-window sync)
  | { type: 'session_flagged'; sessionId: string }
  | { type: 'session_unflagged'; sessionId: string }
  | { type: 'session_archived'; sessionId: string }
  | { type: 'session_unarchived'; sessionId: string }
  | { type: 'name_changed'; sessionId: string; name?: string }
  | { type: 'session_model_changed'; sessionId: string; model: string | null }
  | { type: 'todo_state_changed'; sessionId: string; todoState: TodoState }
  | { type: 'session_deleted'; sessionId: string }
  // Sub-session events
  | { type: 'session_created'; sessionId: string; parentSessionId?: string }
  | { type: 'sessions_reordered' }
  | { type: 'session_archived_cascade'; sessionId: string; count: number }
  | { type: 'session_deleted_cascade'; sessionId: string; count: number }
  | { type: 'session_shared'; sessionId: string; sharedUrl: string }
  | { type: 'session_unshared'; sessionId: string }
  // Auth request events (unified auth flow)
  | { type: 'auth_request'; sessionId: string; message: CoreMessage; request: SharedAuthRequest }
  | { type: 'auth_completed'; sessionId: string; requestId: string; success: boolean; cancelled?: boolean; error?: string }
  // Source activation events (for auto-retry on mid-turn activation)
  | { type: 'source_activated'; sessionId: string; sourceSlug: string; originalMessage: string }
  // Real-time usage update during processing (for context display)
  | { type: 'usage_update'; sessionId: string; tokenUsage: { inputTokens: number; contextWindow?: number } }
  // Codex turn plan updates (native task list)
  | {
      type: 'todos_updated'
      sessionId: string
      todos: Array<{
        content: string
        status: 'pending' | 'in_progress' | 'completed'
        activeForm?: string
      }>
      turnId?: string
      explanation?: string | null
    }

// Options for sendMessage
export interface SendMessageOptions {
  /** Enable ultrathink mode for extended reasoning */
  ultrathinkEnabled?: boolean
  /** Skill slugs to activate for this message (from @mentions) */
  skillSlugs?: string[]
  /** Content badges for inline display (sources, skills with embedded icons) */
  badges?: import('@craft-agent/core').ContentBadge[]
  /** Frontend's optimistic message ID for reliable event matching */
  optimisticMessageId?: string
}

// =============================================================================
// IPC Command Pattern Types
// =============================================================================

/**
 * SessionCommand - Consolidated session operations
 * Replaces individual IPC calls: flag, unflag, rename, setTodoState, etc.
 */
export type SessionCommand =
  | { type: 'flag' }
  | { type: 'unflag' }
  | { type: 'archive' }
  | { type: 'unarchive' }
  | { type: 'rename'; name: string }
  | { type: 'setTodoState'; state: TodoState }
  | { type: 'markRead' }
  | { type: 'markUnread' }
  /** Track which session user is actively viewing (for unread state machine) */
  | { type: 'setActiveViewing'; workspaceId: string }
  | { type: 'setPermissionMode'; mode: PermissionMode }
  | { type: 'setThinkingLevel'; level: ThinkingLevel }
  | { type: 'updateWorkingDirectory'; dir: string }
  | { type: 'setSources'; sourceSlugs: string[] }
  | { type: 'setLabels'; labels: string[] }
  | { type: 'showInFinder' }
  | { type: 'copyPath' }
  | { type: 'shareToViewer' }
  | { type: 'updateShare' }
  | { type: 'revokeShare' }
  | { type: 'startOAuth'; requestId: string }
  | { type: 'refreshTitle' }
  // Connection selection (locked after first message)
  | { type: 'setConnection'; connectionSlug: string }
  // Pending plan execution (Accept & Compact flow)
  | { type: 'setPendingPlanExecution'; planPath: string }
  | { type: 'markCompactionComplete' }
  | { type: 'clearPendingPlanExecution' }
  // Sub-session hierarchy
  | { type: 'getSessionFamily' }
  | { type: 'updateSiblingOrder'; orderedSessionIds: string[] }
  | { type: 'archiveCascade' }
  | { type: 'deleteCascade' }

/**
 * Session family information (parent + siblings)
 * Uses SharedSessionMetadata from @craft-agent/shared (not core SessionMetadata)
 */
export interface SessionFamily {
  parent: SharedSessionMetadata
  siblings: SharedSessionMetadata[]
  self: SharedSessionMetadata
}

/**
 * Parameters for opening a new chat session
 */
export interface NewChatActionParams {
  /** Text to pre-fill in the input (not sent automatically) */
  input?: string
  /** Session name */
  name?: string
}

// IPC channel names
export const IPC_CHANNELS = {
  // Session management
  GET_SESSIONS: 'sessions:get',
  CREATE_SESSION: 'sessions:create',
  CREATE_SUB_SESSION: 'sessions:createSubSession',
  DELETE_SESSION: 'sessions:delete',
  GET_SESSION_MESSAGES: 'sessions:getMessages',
  SEND_MESSAGE: 'sessions:sendMessage',
  CANCEL_PROCESSING: 'sessions:cancel',
  KILL_SHELL: 'sessions:killShell',
  GET_TASK_OUTPUT: 'tasks:getOutput',
  RESPOND_TO_PERMISSION: 'sessions:respondToPermission',
  RESPOND_TO_CREDENTIAL: 'sessions:respondToCredential',

  // Consolidated session command
  SESSION_COMMAND: 'sessions:command',

  // Pending plan execution (for reload recovery)
  GET_PENDING_PLAN_EXECUTION: 'sessions:getPendingPlanExecution',

  // Workspace management
  GET_WORKSPACES: 'workspaces:get',
  CREATE_WORKSPACE: 'workspaces:create',
  CHECK_WORKSPACE_SLUG: 'workspaces:checkSlug',

  // Window management
  GET_WINDOW_WORKSPACE: 'window:getWorkspace',
  GET_WINDOW_MODE: 'window:getMode',
  OPEN_WORKSPACE: 'window:openWorkspace',
  OPEN_SESSION_IN_NEW_WINDOW: 'window:openSessionInNewWindow',
  SWITCH_WORKSPACE: 'window:switchWorkspace',
  CLOSE_WINDOW: 'window:close',
  // Close request events (main → renderer, for intercepting X button / Cmd+W)
  WINDOW_CLOSE_REQUESTED: 'window:closeRequested',
  WINDOW_CONFIRM_CLOSE: 'window:confirmClose',
  // Traffic light visibility (macOS only - hide when fullscreen overlays are open)
  WINDOW_SET_TRAFFIC_LIGHTS: 'window:setTrafficLights',

  // Events from main to renderer
  SESSION_EVENT: 'session:event',

  // File operations
  READ_FILE: 'file:read',
  READ_FILE_DATA_URL: 'file:readDataUrl',
  READ_FILE_BINARY: 'file:readBinary',
  OPEN_FILE_DIALOG: 'file:openDialog',
  READ_FILE_ATTACHMENT: 'file:readAttachment',
  STORE_ATTACHMENT: 'file:storeAttachment',
  GENERATE_THUMBNAIL: 'file:generateThumbnail',

  // Filesystem search (for @ mention file selection)
  FS_SEARCH: 'fs:search',
  // Debug logging from renderer → main log file
  DEBUG_LOG: 'debug:log',

  // Session info panel
  GET_SESSION_FILES: 'sessions:getFiles',
  GET_SESSION_NOTES: 'sessions:getNotes',
  SET_SESSION_NOTES: 'sessions:setNotes',
  WATCH_SESSION_FILES: 'sessions:watchFiles',      // Start watching session directory
  UNWATCH_SESSION_FILES: 'sessions:unwatchFiles',  // Stop watching
  SESSION_FILES_CHANGED: 'sessions:filesChanged',  // Event: main → renderer

  // Theme
  GET_SYSTEM_THEME: 'theme:getSystemPreference',
  SYSTEM_THEME_CHANGED: 'theme:systemChanged',

  // System
  GET_VERSIONS: 'system:versions',
  GET_HOME_DIR: 'system:homeDir',
  IS_DEBUG_MODE: 'system:isDebugMode',

  // Auto-update
  UPDATE_CHECK: 'update:check',
  UPDATE_GET_INFO: 'update:getInfo',
  UPDATE_INSTALL: 'update:install',
  UPDATE_DISMISS: 'update:dismiss',  // Dismiss update for this version (persists across restarts)
  UPDATE_GET_DISMISSED: 'update:getDismissed',  // Get dismissed version
  UPDATE_AVAILABLE: 'update:available',  // main → renderer broadcast
  UPDATE_DOWNLOAD_PROGRESS: 'update:downloadProgress',  // main → renderer broadcast

  // Shell operations (open external URLs/files)
  OPEN_URL: 'shell:openUrl',
  OPEN_FILE: 'shell:openFile',
  SHOW_IN_FOLDER: 'shell:showInFolder',

  // Menu actions (main → renderer)
  MENU_NEW_CHAT: 'menu:newChat',
  MENU_NEW_WINDOW: 'menu:newWindow',
  MENU_OPEN_SETTINGS: 'menu:openSettings',
  MENU_KEYBOARD_SHORTCUTS: 'menu:keyboardShortcuts',
  MENU_TOGGLE_FOCUS_MODE: 'menu:toggleFocusMode',
  MENU_TOGGLE_SIDEBAR: 'menu:toggleSidebar',
  // Deep link navigation (main → renderer, for external craftagents:// URLs)
  DEEP_LINK_NAVIGATE: 'deeplink:navigate',

  // Auth
  LOGOUT: 'auth:logout',
  SHOW_LOGOUT_CONFIRMATION: 'auth:showLogoutConfirmation',
  SHOW_DELETE_SESSION_CONFIRMATION: 'auth:showDeleteSessionConfirmation',

  // Credential health check (startup validation)
  CREDENTIAL_HEALTH_CHECK: 'credentials:healthCheck',

  // Onboarding
  ONBOARDING_GET_AUTH_STATE: 'onboarding:getAuthState',
  ONBOARDING_VALIDATE_MCP: 'onboarding:validateMcp',
  ONBOARDING_START_MCP_OAUTH: 'onboarding:startMcpOAuth',
  // Claude OAuth (two-step flow)
  ONBOARDING_START_CLAUDE_OAUTH: 'onboarding:startClaudeOAuth',
  ONBOARDING_EXCHANGE_CLAUDE_CODE: 'onboarding:exchangeClaudeCode',
  ONBOARDING_HAS_CLAUDE_OAUTH_STATE: 'onboarding:hasClaudeOAuthState',
  ONBOARDING_CLEAR_CLAUDE_OAUTH_STATE: 'onboarding:clearClaudeOAuthState',

  // LLM Connections (provider configurations)
  LLM_CONNECTION_LIST: 'LLM_Connection:list',
  LLM_CONNECTION_LIST_WITH_STATUS: 'LLM_Connection:listWithStatus',
  LLM_CONNECTION_GET: 'LLM_Connection:get',
  LLM_CONNECTION_SAVE: 'LLM_Connection:save',
  LLM_CONNECTION_DELETE: 'LLM_Connection:delete',
  LLM_CONNECTION_TEST: 'LLM_Connection:test',
  LLM_CONNECTION_SET_DEFAULT: 'LLM_Connection:setDefault',
  LLM_CONNECTION_SET_WORKSPACE_DEFAULT: 'LLM_Connection:setWorkspaceDefault',

  // ChatGPT OAuth (for Codex chatgptAuthTokens mode)
  CHATGPT_START_OAUTH: 'chatgpt:startOAuth',
  CHATGPT_CANCEL_OAUTH: 'chatgpt:cancelOAuth',
  CHATGPT_GET_AUTH_STATUS: 'chatgpt:getAuthStatus',
  CHATGPT_LOGOUT: 'chatgpt:logout',

  // Settings - API Setup
  SETUP_LLM_CONNECTION: 'settings:setupLlmConnection',
  SETTINGS_TEST_API_CONNECTION: 'settings:testApiConnection',
  SETTINGS_TEST_OPENAI_CONNECTION: 'settings:testOpenAiConnection',

  // Settings - Model
  SESSION_GET_MODEL: 'session:getModel',
  SESSION_SET_MODEL: 'session:setModel',

  // Folder dialog (for selecting working directory)
  OPEN_FOLDER_DIALOG: 'dialog:openFolder',

  // User Preferences
  PREFERENCES_READ: 'preferences:read',
  PREFERENCES_WRITE: 'preferences:write',

  // Session Drafts (input text persisted across app restarts)
  DRAFTS_GET: 'drafts:get',
  DRAFTS_SET: 'drafts:set',
  DRAFTS_DELETE: 'drafts:delete',
  DRAFTS_GET_ALL: 'drafts:getAll',

  // Sources (workspace-scoped)
  SOURCES_GET: 'sources:get',
  SOURCES_CREATE: 'sources:create',
  SOURCES_DELETE: 'sources:delete',
  SOURCES_START_OAUTH: 'sources:startOAuth',
  SOURCES_SAVE_CREDENTIALS: 'sources:saveCredentials',
  SOURCES_CHANGED: 'sources:changed',
  
  // Source permissions config
  SOURCES_GET_PERMISSIONS: 'sources:getPermissions',
  // Workspace permissions config (for Explore mode)
  WORKSPACE_GET_PERMISSIONS: 'workspace:getPermissions',
  // Default permissions from ~/.craft-agent/permissions/default.json
  DEFAULT_PERMISSIONS_GET: 'permissions:getDefaults',
  // Broadcast when default permissions change (file watcher)
  DEFAULT_PERMISSIONS_CHANGED: 'permissions:defaultsChanged',
  // MCP tools listing
  SOURCES_GET_MCP_TOOLS: 'sources:getMcpTools',

  // Session content search (full-text via ripgrep)
  SEARCH_SESSIONS: 'sessions:searchContent',

  // Skills (workspace-scoped)
  SKILLS_GET: 'skills:get',
  SKILLS_GET_FILES: 'skills:getFiles',
  SKILLS_DELETE: 'skills:delete',
  SKILLS_OPEN_EDITOR: 'skills:openEditor',
  SKILLS_OPEN_FINDER: 'skills:openFinder',
  SKILLS_CHANGED: 'skills:changed',

  // Status management (workspace-scoped)
  STATUSES_LIST: 'statuses:list',
  STATUSES_REORDER: 'statuses:reorder',  // Reorder statuses (drag-and-drop)
  STATUSES_CHANGED: 'statuses:changed',  // Broadcast event

  // Label management (workspace-scoped)
  LABELS_LIST: 'labels:list',
  LABELS_CREATE: 'labels:create',
  LABELS_DELETE: 'labels:delete',
  LABELS_CHANGED: 'labels:changed',  // Broadcast event

  // Views management (workspace-scoped, stored in views.json)
  VIEWS_LIST: 'views:list',
  VIEWS_SAVE: 'views:save',

  // Theme management (cascading: app → workspace)
  THEME_APP_CHANGED: 'theme:appChanged',        // Broadcast event

  // Generic workspace image loading/saving (for icons, etc.)
  WORKSPACE_READ_IMAGE: 'workspace:readImage',
  WORKSPACE_WRITE_IMAGE: 'workspace:writeImage',

  // Workspace settings (per-workspace configuration)
  WORKSPACE_SETTINGS_GET: 'workspaceSettings:get',
  WORKSPACE_SETTINGS_UPDATE: 'workspaceSettings:update',

  // Theme (app-level default)
  THEME_GET_APP: 'theme:getApp',
  THEME_GET_PRESETS: 'theme:getPresets',
  THEME_LOAD_PRESET: 'theme:loadPreset',
  THEME_GET_COLOR_THEME: 'theme:getColorTheme',
  THEME_SET_COLOR_THEME: 'theme:setColorTheme',
  THEME_BROADCAST_PREFERENCES: 'theme:broadcastPreferences',  // Send preferences to main for broadcast
  THEME_PREFERENCES_CHANGED: 'theme:preferencesChanged',  // Broadcast: preferences changed in another window

  // Workspace-level theme overrides
  THEME_GET_WORKSPACE_COLOR_THEME: 'theme:getWorkspaceColorTheme',
  THEME_SET_WORKSPACE_COLOR_THEME: 'theme:setWorkspaceColorTheme',
  THEME_GET_ALL_WORKSPACE_THEMES: 'theme:getAllWorkspaceThemes',
  THEME_BROADCAST_WORKSPACE_THEME: 'theme:broadcastWorkspaceTheme',  // Send workspace theme change to main for broadcast
  THEME_WORKSPACE_THEME_CHANGED: 'theme:workspaceThemeChanged',  // Broadcast: workspace theme changed in another window

  // Tool icon mappings (for Appearance settings)
  TOOL_ICONS_GET_MAPPINGS: 'toolIcons:getMappings',

  // Logo URL resolution (uses Node.js filesystem cache)
  LOGO_GET_URL: 'logo:getUrl',

  // Notifications
  NOTIFICATION_SHOW: 'notification:show',
  NOTIFICATION_NAVIGATE: 'notification:navigate',  // Broadcast: { workspaceId, sessionId }
  NOTIFICATION_GET_ENABLED: 'notification:getEnabled',
  NOTIFICATION_SET_ENABLED: 'notification:setEnabled',

  // Input settings
  INPUT_GET_AUTO_CAPITALISATION: 'input:getAutoCapitalisation',
  INPUT_SET_AUTO_CAPITALISATION: 'input:setAutoCapitalisation',
  INPUT_GET_SEND_MESSAGE_KEY: 'input:getSendMessageKey',
  INPUT_SET_SEND_MESSAGE_KEY: 'input:setSendMessageKey',
  INPUT_GET_SPELL_CHECK: 'input:getSpellCheck',
  INPUT_SET_SPELL_CHECK: 'input:setSpellCheck',

  // Power settings
  POWER_GET_KEEP_AWAKE: 'power:getKeepAwake',
  POWER_SET_KEEP_AWAKE: 'power:setKeepAwake',

  BADGE_UPDATE: 'badge:update',
  BADGE_CLEAR: 'badge:clear',
  BADGE_SET_ICON: 'badge:setIcon',
  BADGE_DRAW: 'badge:draw',  // Broadcast: { count: number, iconDataUrl: string }
  WINDOW_FOCUS_STATE: 'window:focusState',  // Broadcast: boolean (isFocused)
  WINDOW_GET_FOCUS_STATE: 'window:getFocusState',

  // Git operations
  GET_GIT_BRANCH: 'git:getBranch',

  // Git Bash (Windows)
  GITBASH_CHECK: 'gitbash:check',
  GITBASH_BROWSE: 'gitbash:browse',
  GITBASH_SET_PATH: 'gitbash:setPath',

  // Menu actions (renderer → main for window/app control)
  MENU_QUIT: 'menu:quit',
  MENU_MINIMIZE: 'menu:minimize',
  MENU_MAXIMIZE: 'menu:maximize',
  MENU_ZOOM_IN: 'menu:zoomIn',
  MENU_ZOOM_OUT: 'menu:zoomOut',
  MENU_ZOOM_RESET: 'menu:zoomReset',
  MENU_TOGGLE_DEVTOOLS: 'menu:toggleDevTools',
  MENU_UNDO: 'menu:undo',
  MENU_REDO: 'menu:redo',
  MENU_CUT: 'menu:cut',
  MENU_COPY: 'menu:copy',
  MENU_PASTE: 'menu:paste',
  MENU_SELECT_ALL: 'menu:selectAll',
} as const

// Re-import types for ElectronAPI
import type { Workspace, SessionMetadata, StoredAttachment as StoredAttachmentType } from '@craft-agent/core/types';

/** Tool icon mapping entry from tool-icons.json (with icon resolved to data URL) */
export interface ToolIconMapping {
  id: string
  displayName: string
  /** Data URL of the icon (e.g., data:image/png;base64,...) */
  iconDataUrl: string
  commands: string[]
}

// Type-safe IPC API exposed to renderer
export interface ElectronAPI {
  // Session management
  getSessions(): Promise<Session[]>
  getSessionMessages(sessionId: string): Promise<Session | null>
  createSession(workspaceId: string, options?: CreateSessionOptions): Promise<Session>
  createSubSession(workspaceId: string, parentSessionId: string, options?: CreateSessionOptions): Promise<Session>
  deleteSession(sessionId: string): Promise<void>
  sendMessage(sessionId: string, message: string, attachments?: FileAttachment[], storedAttachments?: StoredAttachmentType[], options?: SendMessageOptions): Promise<void>
  cancelProcessing(sessionId: string, silent?: boolean): Promise<void>
  killShell(sessionId: string, shellId: string): Promise<{ success: boolean; error?: string }>
  getTaskOutput(taskId: string): Promise<string | null>
  respondToPermission(sessionId: string, requestId: string, allowed: boolean, alwaysAllow: boolean): Promise<boolean>
  respondToCredential(sessionId: string, requestId: string, response: CredentialResponse): Promise<boolean>

  // Consolidated session command handler
  sessionCommand(sessionId: string, command: SessionCommand): Promise<void | ShareResult | RefreshTitleResult | SessionFamily | { count: number }>

  // Pending plan execution (for reload recovery)
  getPendingPlanExecution(sessionId: string): Promise<{ planPath: string; awaitingCompaction: boolean } | null>

  // Workspace management
  getWorkspaces(): Promise<Workspace[]>
  createWorkspace(folderPath: string, name: string): Promise<Workspace>
  checkWorkspaceSlug(slug: string): Promise<{ exists: boolean; path: string }>

  // Window management
  getWindowWorkspace(): Promise<string | null>
  getWindowMode(): Promise<string | null>
  openWorkspace(workspaceId: string): Promise<void>
  openSessionInNewWindow(workspaceId: string, sessionId: string): Promise<void>
  switchWorkspace(workspaceId: string): Promise<void>
  closeWindow(): Promise<void>
  confirmCloseWindow(): Promise<void>
  /** Listen for close requests (X button, Cmd+W). Returns cleanup function. */
  onCloseRequested(callback: () => void): () => void
  /** Show/hide macOS traffic light buttons (for fullscreen overlays) */
  setTrafficLightsVisible(visible: boolean): Promise<void>

  // Event listeners
  onSessionEvent(callback: (event: SessionEvent) => void): () => void

  // File operations
  readFile(path: string): Promise<string>
  /** Read a file as binary data (Uint8Array) */
  readFileBinary(path: string): Promise<Uint8Array>
  /** Read a file as a data URL (data:{mime};base64,...) for binary preview (images, PDFs) */
  readFileDataUrl(path: string): Promise<string>
  openFileDialog(): Promise<string[]>
  readFileAttachment(path: string): Promise<FileAttachment | null>
  storeAttachment(sessionId: string, attachment: FileAttachment): Promise<import('../../../../packages/core/src/types/index.ts').StoredAttachment>
  generateThumbnail(base64: string, mimeType: string): Promise<string | null>

  // Filesystem search (for @ mention file selection)
  searchFiles(basePath: string, query: string): Promise<FileSearchResult[]>
  // Debug: send renderer logs to main process log file
  debugLog(...args: unknown[]): void

  // Theme
  getSystemTheme(): Promise<boolean>
  onSystemThemeChange(callback: (isDark: boolean) => void): () => void

  // System
  getVersions(): { node: string; chrome: string; electron: string }
  getHomeDir(): Promise<string>
  isDebugMode(): Promise<boolean>

  // Auto-update
  checkForUpdates(): Promise<UpdateInfo>
  getUpdateInfo(): Promise<UpdateInfo>
  installUpdate(): Promise<void>
  dismissUpdate(version: string): Promise<void>
  getDismissedUpdateVersion(): Promise<string | null>
  onUpdateAvailable(callback: (info: UpdateInfo) => void): () => void
  onUpdateDownloadProgress(callback: (progress: number) => void): () => void

  // Shell operations
  openUrl(url: string): Promise<void>
  openFile(path: string): Promise<void>
  showInFolder(path: string): Promise<void>

  // Menu event listeners
  onMenuNewChat(callback: () => void): () => void
  onMenuOpenSettings(callback: () => void): () => void
  onMenuKeyboardShortcuts(callback: () => void): () => void
  onMenuToggleFocusMode(callback: () => void): () => void
  onMenuToggleSidebar(callback: () => void): () => void

  // Deep link navigation listener (for external craftagents:// URLs)
  onDeepLinkNavigate(callback: (nav: DeepLinkNavigation) => void): () => void

  // Auth
  showLogoutConfirmation(): Promise<boolean>
  showDeleteSessionConfirmation(name: string): Promise<boolean>
  logout(): Promise<void>

  // Credential health check (startup validation)
  getCredentialHealth(): Promise<CredentialHealthStatus>

  // Onboarding
  getAuthState(): Promise<AuthState>
  getSetupNeeds(): Promise<SetupNeeds>
  startWorkspaceMcpOAuth(mcpUrl: string): Promise<OAuthResult & { accessToken?: string; clientId?: string }>
  // Claude OAuth (two-step flow)
  startClaudeOAuth(): Promise<{ success: boolean; authUrl?: string; error?: string }>
  exchangeClaudeCode(code: string, connectionSlug: string): Promise<ClaudeOAuthResult>
  hasClaudeOAuthState(): Promise<boolean>
  clearClaudeOAuthState(): Promise<{ success: boolean }>

  // ChatGPT OAuth (for Codex chatgptAuthTokens mode)
  // Note: startChatGptOAuth opens browser and completes full OAuth flow internally
  startChatGptOAuth(connectionSlug: string): Promise<{ success: boolean; error?: string }>
  cancelChatGptOAuth(): Promise<{ success: boolean }>
  getChatGptAuthStatus(connectionSlug: string): Promise<{ authenticated: boolean; expiresAt?: number; hasRefreshToken?: boolean }>
  chatGptLogout(connectionSlug: string): Promise<{ success: boolean }>

  /** Unified LLM connection setup */
  setupLlmConnection(setup: LlmConnectionSetup): Promise<{ success: boolean; error?: string }>
  testApiConnection(apiKey: string, baseUrl?: string, models?: string[]): Promise<{ success: boolean; error?: string; modelCount?: number }>
  testOpenAiConnection(apiKey: string, baseUrl?: string, models?: string[]): Promise<{ success: boolean; error?: string }>

  // Session-specific model (overrides global)
  getSessionModel(sessionId: string, workspaceId: string): Promise<string | null>
  setSessionModel(sessionId: string, workspaceId: string, model: string | null, connection?: string): Promise<void>

  // Workspace Settings (per-workspace configuration)
  getWorkspaceSettings(workspaceId: string): Promise<WorkspaceSettings | null>
  updateWorkspaceSetting<K extends keyof WorkspaceSettings>(workspaceId: string, key: K, value: WorkspaceSettings[K]): Promise<void>

  // Folder dialog
  openFolderDialog(): Promise<string | null>

  // User Preferences
  readPreferences(): Promise<{ content: string; exists: boolean; path: string }>
  writePreferences(content: string): Promise<{ success: boolean; error?: string }>

  // Session Drafts (persisted input text)
  getDraft(sessionId: string): Promise<string | null>
  setDraft(sessionId: string, text: string): Promise<void>
  deleteDraft(sessionId: string): Promise<void>
  getAllDrafts(): Promise<Record<string, string>>

  // Session Info Panel
  getSessionFiles(sessionId: string): Promise<SessionFile[]>
  getSessionNotes(sessionId: string): Promise<string>
  setSessionNotes(sessionId: string, content: string): Promise<void>
  watchSessionFiles(sessionId: string): Promise<void>
  unwatchSessionFiles(): Promise<void>
  onSessionFilesChanged(callback: (sessionId: string) => void): () => void

  // Sources
  getSources(workspaceId: string): Promise<LoadedSource[]>
  createSource(workspaceId: string, config: Partial<FolderSourceConfig>): Promise<FolderSourceConfig>
  deleteSource(workspaceId: string, sourceSlug: string): Promise<void>
  startSourceOAuth(workspaceId: string, sourceSlug: string): Promise<{ success: boolean; error?: string; accessToken?: string }>
  saveSourceCredentials(workspaceId: string, sourceSlug: string, credential: string): Promise<void>
  getSourcePermissionsConfig(workspaceId: string, sourceSlug: string): Promise<import('@craft-agent/shared/agent').PermissionsConfigFile | null>
  getWorkspacePermissionsConfig(workspaceId: string): Promise<import('@craft-agent/shared/agent').PermissionsConfigFile | null>
  getDefaultPermissionsConfig(): Promise<{ config: import('@craft-agent/shared/agent').PermissionsConfigFile | null; path: string }>
  getMcpTools(workspaceId: string, sourceSlug: string): Promise<McpToolsResult>

  // Session content search (full-text search via ripgrep)
  searchSessionContent(workspaceId: string, query: string, searchId?: string): Promise<SessionSearchResult[]>

  // Sources change listener (live updates when sources are added/removed)
  onSourcesChanged(callback: (sources: LoadedSource[]) => void): () => void

  // Default permissions change listener (live updates when default.json changes)
  onDefaultPermissionsChanged(callback: () => void): () => void

  // Skills
  getSkills(workspaceId: string): Promise<LoadedSkill[]>
  getSkillFiles?(workspaceId: string, skillSlug: string): Promise<SkillFile[]>
  deleteSkill(workspaceId: string, skillSlug: string): Promise<void>
  openSkillInEditor(workspaceId: string, skillSlug: string): Promise<void>
  openSkillInFinder(workspaceId: string, skillSlug: string): Promise<void>

  // Skills change listener (live updates when skills are added/removed/modified)
  onSkillsChanged(callback: (skills: LoadedSkill[]) => void): () => void

  // Statuses (workspace-scoped)
  listStatuses(workspaceId: string): Promise<import('@craft-agent/shared/statuses').StatusConfig[]>
  reorderStatuses(workspaceId: string, orderedIds: string[]): Promise<void>
  // Statuses change listener (live updates when statuses config or icon files change)
  onStatusesChanged(callback: (workspaceId: string) => void): () => void

  // Labels (workspace-scoped)
  listLabels(workspaceId: string): Promise<import('@craft-agent/shared/labels').LabelConfig[]>
  createLabel(workspaceId: string, input: import('@craft-agent/shared/labels').CreateLabelInput): Promise<import('@craft-agent/shared/labels').LabelConfig>
  deleteLabel(workspaceId: string, labelId: string): Promise<{ stripped: number }>
  // Labels change listener (live updates when labels config changes)
  onLabelsChanged(callback: (workspaceId: string) => void): () => void

  // Views (workspace-scoped, stored in views.json)
  listViews(workspaceId: string): Promise<import('@craft-agent/shared/views').ViewConfig[]>
  saveViews(workspaceId: string, views: import('@craft-agent/shared/views').ViewConfig[]): Promise<void>

  // Generic workspace image loading/saving (returns data URL for images, raw string for SVG)
  readWorkspaceImage(workspaceId: string, relativePath: string): Promise<string>
  writeWorkspaceImage(workspaceId: string, relativePath: string, base64: string, mimeType: string): Promise<void>

  // Tool icon mappings (for Appearance settings page)
  getToolIconMappings(): Promise<ToolIconMapping[]>

  // Theme (app-level default)
  getAppTheme(): Promise<import('@config/theme').ThemeOverrides | null>
  // Preset themes (app-level)
  loadPresetThemes(): Promise<import('@config/theme').PresetTheme[]>
  loadPresetTheme(themeId: string): Promise<import('@config/theme').PresetTheme | null>
  getColorTheme(): Promise<string>
  setColorTheme(themeId: string): Promise<void>
  // Workspace-level theme overrides
  getWorkspaceColorTheme(workspaceId: string): Promise<string | null>
  setWorkspaceColorTheme(workspaceId: string, themeId: string | null): Promise<void>
  getAllWorkspaceThemes(): Promise<Record<string, string | undefined>>

  // Theme change listeners (live updates when theme.json files change)
  onAppThemeChange(callback: (theme: import('@config/theme').ThemeOverrides | null) => void): () => void

  // Logo URL resolution (uses Node.js filesystem cache for provider domains)
  getLogoUrl(serviceUrl: string, provider?: string): Promise<string | null>

  // Notifications
  showNotification(title: string, body: string, workspaceId: string, sessionId: string): Promise<void>
  getNotificationsEnabled(): Promise<boolean>
  setNotificationsEnabled(enabled: boolean): Promise<void>

  // Input settings
  getAutoCapitalisation(): Promise<boolean>
  setAutoCapitalisation(enabled: boolean): Promise<void>
  getSendMessageKey(): Promise<'enter' | 'cmd-enter'>
  setSendMessageKey(key: 'enter' | 'cmd-enter'): Promise<void>
  getSpellCheck(): Promise<boolean>
  setSpellCheck(enabled: boolean): Promise<void>

  // Power settings
  getKeepAwakeWhileRunning(): Promise<boolean>
  setKeepAwakeWhileRunning(enabled: boolean): Promise<void>

  updateBadgeCount(count: number): Promise<void>
  clearBadgeCount(): Promise<void>
  setDockIconWithBadge(dataUrl: string): Promise<void>
  onBadgeDraw(callback: (data: { count: number; iconDataUrl: string }) => void): () => void
  getWindowFocusState(): Promise<boolean>
  onWindowFocusChange(callback: (isFocused: boolean) => void): () => void
  onNotificationNavigate(callback: (data: { workspaceId: string; sessionId: string }) => void): () => void

  // Theme preferences sync across windows (mode, colorTheme, font)
  broadcastThemePreferences(preferences: { mode: string; colorTheme: string; font: string }): Promise<void>
  onThemePreferencesChange(callback: (preferences: { mode: string; colorTheme: string; font: string }) => void): () => void

  // Workspace theme sync across windows
  broadcastWorkspaceThemeChange(workspaceId: string, themeId: string | null): Promise<void>
  onWorkspaceThemeChange(callback: (data: { workspaceId: string; themeId: string | null }) => void): () => void

  // Git operations
  getGitBranch(dirPath: string): Promise<string | null>

  // Git Bash (Windows)
  checkGitBash(): Promise<GitBashStatus>
  browseForGitBash(): Promise<string | null>
  setGitBashPath(path: string): Promise<{ success: boolean; error?: string }>

  // Menu actions (from renderer to main)
  menuQuit(): Promise<void>
  menuNewWindow(): Promise<void>
  menuMinimize(): Promise<void>
  menuMaximize(): Promise<void>
  menuZoomIn(): Promise<void>
  menuZoomOut(): Promise<void>
  menuZoomReset(): Promise<void>
  menuToggleDevTools(): Promise<void>
  menuUndo(): Promise<void>
  menuRedo(): Promise<void>
  menuCut(): Promise<void>
  menuCopy(): Promise<void>
  menuPaste(): Promise<void>
  menuSelectAll(): Promise<void>

  // LLM Connections (provider configurations)
  listLlmConnections(): Promise<LlmConnection[]>
  listLlmConnectionsWithStatus(): Promise<LlmConnectionWithStatus[]>
  getLlmConnection(slug: string): Promise<LlmConnection | null>
  saveLlmConnection(connection: LlmConnection): Promise<{ success: boolean; error?: string }>
  deleteLlmConnection(slug: string): Promise<{ success: boolean; error?: string }>
  testLlmConnection(slug: string): Promise<{ success: boolean; error?: string }>
  setDefaultLlmConnection(slug: string): Promise<{ success: boolean; error?: string }>
  setWorkspaceDefaultLlmConnection(workspaceId: string, slug: string | null): Promise<{ success: boolean; error?: string }>
}

/**
 * Result from Claude OAuth (setup-token) flow
 */
export interface ClaudeOAuthResult {
  success: boolean
  token?: string
  error?: string
}

/**
 * Current API setup info for settings
 */
/**
 * Auto-update information
 */
export interface UpdateInfo {
  /** Whether an update is available */
  available: boolean
  /** Current installed version */
  currentVersion: string
  /** Latest available version (null if check failed) */
  latestVersion: string | null
  /** Download state */
  downloadState: 'idle' | 'downloading' | 'ready' | 'installing' | 'error'
  /** Download progress (0-100) */
  downloadProgress: number
  /** Error message if download/install failed */
  error?: string
}

/**
 * Per-workspace settings
 */
export interface WorkspaceSettings {
  name?: string
  model?: string
  permissionMode?: PermissionMode
  /** Permission modes available for SHIFT+TAB cycling (min 2 modes) */
  cyclablePermissionModes?: PermissionMode[]
  /** Default thinking level for new sessions ('off', 'think', 'max'). Defaults to 'think'. */
  thinkingLevel?: ThinkingLevel
  workingDirectory?: string
  /** Whether local (stdio) MCP servers are enabled */
  localMcpEnabled?: boolean
  /** Default LLM connection slug for new sessions in this workspace */
  defaultLlmConnection?: string
}

/**
 * Navigation payload for deep links (main → renderer)
 */
export interface DeepLinkNavigation {
  /** Compound route format (e.g., 'allSessions/session/abc123', 'settings/shortcuts') */
  view?: string
  /** Tab type */
  tabType?: string
  tabParams?: Record<string, string>
  action?: string
  actionParams?: Record<string, string>
}

// ============================================
// Unified Navigation State Types
// ============================================

/**
 * Right sidebar panel types
 * Defines the content displayed in the right sidebar
 */
export type RightSidebarPanel =
  | { type: 'sessionMetadata' }
  | { type: 'files'; path?: string }
  | { type: 'history' }
  | { type: 'none' }

/**
 * Session filter options - determines which sessions to show
 * - 'allSessions': All sessions regardless of status (excludes archived)
 * - 'flagged': Only flagged sessions
 * - 'state': Sessions with specific status ID
 * - 'label': Sessions with specific label (includes descendants via tree hierarchy)
 * - 'archived': Only archived sessions
 */
export type SessionFilter =
  | { kind: 'allSessions' }
  | { kind: 'flagged' }
  | { kind: 'state'; stateId: string }
  | { kind: 'label'; labelId: string }
  | { kind: 'view'; viewId: string }
  | { kind: 'archived' }

/**
 * Settings subpage options - re-exported from settings-registry (single source of truth)
 */
export type { SettingsSubpage } from './settings-registry'
import { isValidSettingsSubpage, type SettingsSubpage } from './settings-registry'

/**
 * Sessions navigation state - shows SessionList in navigator
 */
export interface SessionsNavigationState {
  navigator: 'sessions'
  filter: SessionFilter
  /** Selected session details, or null for empty state */
  details: { type: 'session'; sessionId: string } | null
  /** Optional right sidebar panel state */
  rightSidebar?: RightSidebarPanel
}

/**
 * Source type filter for sources navigation (e.g., show only APIs, MCPs, or Local sources)
 */
export interface SourceFilter {
  kind: 'type'
  sourceType: 'api' | 'mcp' | 'local'
}

/**
 * Sources navigation state - shows SourcesListPanel in navigator
 */
export interface SourcesNavigationState {
  navigator: 'sources'
  /** Optional filter for source type */
  filter?: SourceFilter
  /** Selected source details, or null for empty state */
  details: { type: 'source'; sourceSlug: string } | null
  /** Optional right sidebar panel state */
  rightSidebar?: RightSidebarPanel
}

/**
 * Settings navigation state - shows SettingsNavigator in navigator
 * Settings subpages are the details themselves (no separate selection)
 */
export interface SettingsNavigationState {
  navigator: 'settings'
  subpage: SettingsSubpage
  /** Optional right sidebar panel state */
  rightSidebar?: RightSidebarPanel
}

/**
 * Skills navigation state - shows SkillsListPanel in navigator
 */
export interface SkillsNavigationState {
  navigator: 'skills'
  /** Selected skill details or null for empty state */
  details: { type: 'skill'; skillSlug: string } | null
  /** Optional right sidebar panel state */
  rightSidebar?: RightSidebarPanel
}

/**
 * Unified navigation state - single source of truth for all 3 panels
 *
 * From this state we can derive:
 * - LeftSidebar: which item is highlighted (from navigator + filter/subpage)
 * - NavigatorPanel: which list/content to show (from navigator)
 * - MainContentPanel: what details to display (from details or subpage)
 */
export type NavigationState =
  | SessionsNavigationState
  | SourcesNavigationState
  | SettingsNavigationState
  | SkillsNavigationState

/**
 * Type guard to check if state is sessions navigation
 */
export const isSessionsNavigation = (
  state: NavigationState
): state is SessionsNavigationState => state.navigator === 'sessions'

/**
 * Type guard to check if state is sources navigation
 */
export const isSourcesNavigation = (
  state: NavigationState
): state is SourcesNavigationState => state.navigator === 'sources'

/**
 * Type guard to check if state is settings navigation
 */
export const isSettingsNavigation = (
  state: NavigationState
): state is SettingsNavigationState => state.navigator === 'settings'

/**
 * Type guard to check if state is skills navigation
 */
export const isSkillsNavigation = (
  state: NavigationState
): state is SkillsNavigationState => state.navigator === 'skills'

/**
 * Default navigation state - allSessions with no selection
 */
export const DEFAULT_NAVIGATION_STATE: NavigationState = {
  navigator: 'sessions',
  filter: { kind: 'allSessions' },
  details: null,
}

/**
 * Get a persistence key for localStorage from NavigationState
 */
export const getNavigationStateKey = (state: NavigationState): string => {
  if (state.navigator === 'sources') {
    if (state.details) {
      return `sources/source/${state.details.sourceSlug}`
    }
    return 'sources'
  }
  if (state.navigator === 'skills') {
    if (state.details?.type === 'skill') {
      return `skills/skill/${state.details.skillSlug}`
    }
    return 'skills'
  }
  if (state.navigator === 'settings') {
    return `settings:${state.subpage}`
  }
  // Chats
  const f = state.filter
  let base: string
  if (f.kind === 'state') base = `state:${f.stateId}`
  else if (f.kind === 'label') base = `label:${f.labelId}`
  else if (f.kind === 'view') base = `view:${f.viewId}`
  else base = f.kind
  if (state.details) {
    return `${base}/chat/${state.details.sessionId}`
  }
  return base
}

/**
 * Parse a persistence key back to NavigationState
 * Returns null if the key is invalid
 */
export const parseNavigationStateKey = (key: string): NavigationState | null => {
  // Handle sources
  if (key === 'sources') return { navigator: 'sources', details: null }
  if (key.startsWith('sources/source/')) {
    const sourceSlug = key.slice(15)
    if (sourceSlug) {
      return { navigator: 'sources', details: { type: 'source', sourceSlug } }
    }
    return { navigator: 'sources', details: null }
  }

  // Handle skills
  if (key === 'skills') return { navigator: 'skills', details: null }
  if (key.startsWith('skills/skill/')) {
    const skillSlug = key.slice(13)
    if (skillSlug) {
      return { navigator: 'skills', details: { type: 'skill', skillSlug } }
    }
    return { navigator: 'skills', details: null }
  }

  // Handle settings
  if (key === 'settings') return { navigator: 'settings', subpage: 'app' }
  if (key.startsWith('settings:')) {
    const subpage = key.slice(9)
    if (isValidSettingsSubpage(subpage)) {
      return { navigator: 'settings', subpage }
    }
  }

  // Handle sessions - parse filter and optional session
  const parseSessionsKey = (filterKey: string, sessionId?: string): NavigationState | null => {
    let filter: SessionFilter
    if (filterKey === 'allSessions') filter = { kind: 'allSessions' }
    else if (filterKey === 'flagged') filter = { kind: 'flagged' }
    else if (filterKey === 'archived') filter = { kind: 'archived' }
    else if (filterKey.startsWith('state:')) {
      const stateId = filterKey.slice(6)
      if (!stateId) return null
      filter = { kind: 'state', stateId }
    } else if (filterKey.startsWith('label:')) {
      const labelId = filterKey.slice(6)
      if (!labelId) return null
      filter = { kind: 'label', labelId }
    } else if (filterKey.startsWith('view:')) {
      const viewId = filterKey.slice(5)
      if (!viewId) return null
      filter = { kind: 'view', viewId }
    } else {
      return null
    }
    return {
      navigator: 'sessions',
      filter,
      details: sessionId ? { type: 'session', sessionId } : null,
    }
  }

  // Check for session details
  if (key.includes('/session/')) {
    const [filterPart, , sessionId] = key.split('/')
    return parseSessionsKey(filterPart, sessionId)
  }

  // Simple filter key
  return parseSessionsKey(key)
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
