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
  piAuthProvider?: string   // Pi auth provider (e.g. 'anthropic', 'google', 'openai') — for pi_api_key flow
}

/**
 * Params for unified connection test (spawns a lightweight agent subprocess).
 * Works for all agent types that use simple API key auth.
 */
export interface TestLlmConnectionParams {
  provider: 'anthropic' | 'pi'
  apiKey: string
  baseUrl?: string           // Custom endpoint (anthropic/openai compat)
  model?: string             // Model to test (uses provider default if omitted)
  piAuthProvider?: string    // Pi SDK provider name (e.g. 'anthropic', 'google', 'openai')
}

/**
 * Result of a unified connection test.
 */
export interface TestLlmConnectionResult {
  success: boolean
  error?: string             // User-friendly error message
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

export interface UnreadSummary {
  /** Total unread sessions across all workspaces (hidden/archived excluded) */
  totalUnreadSessions: number
  /** Unread session count by workspace ID */
  byWorkspace: Record<string, number>
  /** Convenience boolean map for workspace selector indicators */
  hasUnreadByWorkspace: Record<string, boolean>
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

/**
 * Optional metadata for permission responses.
 * Used by admin approvals for time-scoped remember windows.
 */
export interface PermissionResponseOptions {
  rememberForMinutes?: number
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
export type SessionStatus = string

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
  // Session status (user-controlled) - determines open vs closed
  sessionStatus?: SessionStatus
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
  /** Whether the backend supports session branching */
  supportsBranching?: boolean
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
  /** Initial session status for the session */
  sessionStatus?: SessionStatus
  /** Initial labels for the session */
  labels?: string[]
  /** Whether the session should be flagged */
  isFlagged?: boolean
  /** Per-session source selection (source slugs) */
  enabledSourceSlugs?: string[]
  /** Message ID to branch from (copies conversation up to and including this message) */
  branchFromMessageId?: string
  /** Session ID to branch from (source session for message copying) */
  branchFromSessionId?: string
}

export interface PermissionModeState {
  permissionMode: PermissionMode
  previousPermissionMode?: PermissionMode
  transitionDisplay?: string
  modeVersion: number
  changedAt: string
  changedBy: 'user' | 'system' | 'restore' | 'automation' | 'unknown'
}

// Events sent from main to renderer
// turnId: Correlation ID from the API's message.id, groups all events in an assistant turn
export type SessionEvent =
  | { type: 'text_delta'; sessionId: string; delta: string; turnId?: string }
  | { type: 'text_complete'; sessionId: string; text: string; isIntermediate?: boolean; turnId?: string; parentToolUseId?: string; timestamp?: number; messageId?: string }
  | { type: 'tool_start'; sessionId: string; toolName: string; toolUseId: string; toolInput: Record<string, unknown>; toolIntent?: string; toolDisplayName?: string; toolDisplayMeta?: import('@craft-agent/core').ToolDisplayMeta; turnId?: string; parentToolUseId?: string; timestamp?: number }
  | { type: 'tool_result'; sessionId: string; toolUseId: string; toolName: string; result: string; turnId?: string; parentToolUseId?: string; isError?: boolean; timestamp?: number }
  | { type: 'error'; sessionId: string; error: string; timestamp?: number }
  | { type: 'typed_error'; sessionId: string; error: TypedError; timestamp?: number }
  | { type: 'complete'; sessionId: string; tokenUsage?: Session['tokenUsage']; hasUnread?: boolean }
  | { type: 'interrupted'; sessionId: string; message?: Message; queuedMessages?: string[] }
  | { type: 'status'; sessionId: string; message: string; statusType?: 'compacting' }
  | { type: 'info'; sessionId: string; message: string; statusType?: 'compaction_complete'; level?: 'info' | 'warning' | 'error' | 'success'; timestamp?: number }
  | { type: 'title_generated'; sessionId: string; title: string }
  | { type: 'title_regenerating'; sessionId: string; isRegenerating: boolean }
  // Generic async operation state (sharing, updating share, revoking, title regeneration)
  | { type: 'async_operation'; sessionId: string; isOngoing: boolean }
  | { type: 'working_directory_changed'; sessionId: string; workingDirectory: string }
  | { type: 'permission_request'; sessionId: string; request: PermissionRequest }
  | { type: 'credential_request'; sessionId: string; request: CredentialRequest }
  // Permission mode events
  | { type: 'permission_mode_changed'; sessionId: string; permissionMode: PermissionMode; previousPermissionMode?: PermissionMode; transitionDisplay?: string; modeVersion?: number; changedAt?: string; changedBy?: PermissionModeState['changedBy'] }
  | { type: 'plan_submitted'; sessionId: string; message: CoreMessage }
  // Source events
  | { type: 'sources_changed'; sessionId: string; enabledSourceSlugs: string[] }
  | { type: 'labels_changed'; sessionId: string; labels: string[] }
  // LLM connection events
  | { type: 'connection_changed'; sessionId: string; connectionSlug: string; supportsBranching?: boolean }
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
  | { type: 'session_status_changed'; sessionId: string; sessionStatus: SessionStatus }
  | { type: 'session_deleted'; sessionId: string }
  | { type: 'session_created'; sessionId: string }
  | { type: 'session_shared'; sessionId: string; sharedUrl: string }
  | { type: 'session_unshared'; sessionId: string }
  // Auth request events (unified auth flow)
  | { type: 'auth_request'; sessionId: string; message: CoreMessage; request: SharedAuthRequest }
  | { type: 'auth_completed'; sessionId: string; requestId: string; success: boolean; cancelled?: boolean; error?: string }
  // Source activation events (for auto-retry on mid-turn activation)
  | { type: 'source_activated'; sessionId: string; sourceSlug: string; originalMessage: string }
  // Real-time usage update during processing (for context display)
  | { type: 'usage_update'; sessionId: string; tokenUsage: { inputTokens: number; contextWindow?: number } }

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
 * Replaces individual IPC calls: flag, unflag, rename, setSessionStatus, etc.
 */
export type SessionCommand =
  | { type: 'flag' }
  | { type: 'unflag' }
  | { type: 'archive' }
  | { type: 'unarchive' }
  | { type: 'rename'; name: string }
  | { type: 'setSessionStatus'; state: SessionStatus }
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
  | { type: 'refreshTitle' }
  // Connection selection (locked after first message)
  | { type: 'setConnection'; connectionSlug: string }
  // Pending plan execution (Accept & Compact flow)
  | { type: 'setPendingPlanExecution'; planPath: string }
  | { type: 'markCompactionComplete' }
  | { type: 'clearPendingPlanExecution' }

/**
 * Parameters for opening a new chat session
 */
export interface NewChatActionParams {
  /** Text to pre-fill in the input (not sent automatically) */
  input?: string
  /** Session name */
  name?: string
}

// IPC channel names — organized by domain namespace.
// Wire-format strings (values) are the stable API contract.
// Key paths are internal and may be reorganized freely.
export const IPC_CHANNELS = {
  sessions: {
    GET: 'sessions:get',
    GET_UNREAD_SUMMARY: 'sessions:getUnreadSummary',
    MARK_ALL_READ: 'sessions:markAllRead',
    UNREAD_SUMMARY_CHANGED: 'sessions:unreadSummaryChanged',
    CREATE: 'sessions:create',
    DELETE: 'sessions:delete',
    GET_MESSAGES: 'sessions:getMessages',
    SEND_MESSAGE: 'sessions:sendMessage',
    CANCEL: 'sessions:cancel',
    KILL_SHELL: 'sessions:killShell',
    RESPOND_TO_PERMISSION: 'sessions:respondToPermission',
    RESPOND_TO_CREDENTIAL: 'sessions:respondToCredential',
    COMMAND: 'sessions:command',
    GET_PENDING_PLAN_EXECUTION: 'sessions:getPendingPlanExecution',
    GET_PERMISSION_MODE_STATE: 'sessions:getPermissionModeState',
    EVENT: 'session:event',               // merged from 'session' prefix
    GET_MODEL: 'session:getModel',         // merged from 'session' prefix
    SET_MODEL: 'session:setModel',         // merged from 'session' prefix
    GET_FILES: 'sessions:getFiles',
    GET_NOTES: 'sessions:getNotes',
    SET_NOTES: 'sessions:setNotes',
    WATCH_FILES: 'sessions:watchFiles',
    UNWATCH_FILES: 'sessions:unwatchFiles',
    FILES_CHANGED: 'sessions:filesChanged',
    SEARCH_CONTENT: 'sessions:searchContent',
  },
  tasks: {
    GET_OUTPUT: 'tasks:getOutput',
  },
  workspaces: {
    GET: 'workspaces:get',
    CREATE: 'workspaces:create',
    CHECK_SLUG: 'workspaces:checkSlug',
  },
  window: {
    GET_WORKSPACE: 'window:getWorkspace',
    GET_MODE: 'window:getMode',
    OPEN_WORKSPACE: 'window:openWorkspace',
    OPEN_SESSION_IN_NEW_WINDOW: 'window:openSessionInNewWindow',
    SWITCH_WORKSPACE: 'window:switchWorkspace',
    CLOSE: 'window:close',
    CLOSE_REQUESTED: 'window:closeRequested',
    CONFIRM_CLOSE: 'window:confirmClose',
    CANCEL_CLOSE: 'window:cancelClose',
    SET_TRAFFIC_LIGHTS: 'window:setTrafficLights',
    FOCUS_STATE: 'window:focusState',
    GET_FOCUS_STATE: 'window:getFocusState',
  },
  file: {
    READ: 'file:read',
    READ_DATA_URL: 'file:readDataUrl',
    READ_BINARY: 'file:readBinary',
    OPEN_DIALOG: 'file:openDialog',
    READ_ATTACHMENT: 'file:readAttachment',
    STORE_ATTACHMENT: 'file:storeAttachment',
    GENERATE_THUMBNAIL: 'file:generateThumbnail',
  },
  fs: {
    SEARCH: 'fs:search',
  },
  debug: {
    LOG: 'debug:log',
  },
  theme: {
    GET_SYSTEM_PREFERENCE: 'theme:getSystemPreference',
    SYSTEM_CHANGED: 'theme:systemChanged',
    APP_CHANGED: 'theme:appChanged',
    GET_APP: 'theme:getApp',
    GET_PRESETS: 'theme:getPresets',
    LOAD_PRESET: 'theme:loadPreset',
    GET_COLOR_THEME: 'theme:getColorTheme',
    SET_COLOR_THEME: 'theme:setColorTheme',
    BROADCAST_PREFERENCES: 'theme:broadcastPreferences',
    PREFERENCES_CHANGED: 'theme:preferencesChanged',
    GET_WORKSPACE_COLOR_THEME: 'theme:getWorkspaceColorTheme',
    SET_WORKSPACE_COLOR_THEME: 'theme:setWorkspaceColorTheme',
    GET_ALL_WORKSPACE_THEMES: 'theme:getAllWorkspaceThemes',
    BROADCAST_WORKSPACE_THEME: 'theme:broadcastWorkspaceTheme',
    WORKSPACE_THEME_CHANGED: 'theme:workspaceThemeChanged',
  },
  system: {
    VERSIONS: 'system:versions',
    HOME_DIR: 'system:homeDir',
    IS_DEBUG_MODE: 'system:isDebugMode',
  },
  update: {
    CHECK: 'update:check',
    GET_INFO: 'update:getInfo',
    INSTALL: 'update:install',
    DISMISS: 'update:dismiss',
    GET_DISMISSED: 'update:getDismissed',
    AVAILABLE: 'update:available',
    DOWNLOAD_PROGRESS: 'update:downloadProgress',
  },
  shell: {
    OPEN_URL: 'shell:openUrl',
    OPEN_FILE: 'shell:openFile',
    SHOW_IN_FOLDER: 'shell:showInFolder',
  },
  menu: {
    NEW_CHAT: 'menu:newChat',
    NEW_WINDOW: 'menu:newWindow',
    OPEN_SETTINGS: 'menu:openSettings',
    KEYBOARD_SHORTCUTS: 'menu:keyboardShortcuts',
    TOGGLE_FOCUS_MODE: 'menu:toggleFocusMode',
    TOGGLE_SIDEBAR: 'menu:toggleSidebar',
    QUIT: 'menu:quit',
    MINIMIZE: 'menu:minimize',
    MAXIMIZE: 'menu:maximize',
    ZOOM_IN: 'menu:zoomIn',
    ZOOM_OUT: 'menu:zoomOut',
    ZOOM_RESET: 'menu:zoomReset',
    TOGGLE_DEV_TOOLS: 'menu:toggleDevTools',
    UNDO: 'menu:undo',
    REDO: 'menu:redo',
    CUT: 'menu:cut',
    COPY: 'menu:copy',
    PASTE: 'menu:paste',
    SELECT_ALL: 'menu:selectAll',
  },
  deeplink: {
    NAVIGATE: 'deeplink:navigate',
  },
  auth: {
    LOGOUT: 'auth:logout',
    SHOW_LOGOUT_CONFIRMATION: 'auth:showLogoutConfirmation',
    SHOW_DELETE_SESSION_CONFIRMATION: 'auth:showDeleteSessionConfirmation',
  },
  credentials: {
    HEALTH_CHECK: 'credentials:healthCheck',
  },
  onboarding: {
    GET_AUTH_STATE: 'onboarding:getAuthState',
    VALIDATE_MCP: 'onboarding:validateMcp',
    START_MCP_OAUTH: 'onboarding:startMcpOAuth',
    START_CLAUDE_OAUTH: 'onboarding:startClaudeOAuth',
    EXCHANGE_CLAUDE_CODE: 'onboarding:exchangeClaudeCode',
    HAS_CLAUDE_OAUTH_STATE: 'onboarding:hasClaudeOAuthState',
    CLEAR_CLAUDE_OAUTH_STATE: 'onboarding:clearClaudeOAuthState',
  },
  llmConnections: {
    LIST: 'LLM_Connection:list',
    LIST_WITH_STATUS: 'LLM_Connection:listWithStatus',
    GET: 'LLM_Connection:get',
    GET_API_KEY: 'LLM_Connection:getApiKey',
    SAVE: 'LLM_Connection:save',
    DELETE: 'LLM_Connection:delete',
    TEST: 'LLM_Connection:test',
    SET_DEFAULT: 'LLM_Connection:setDefault',
    SET_WORKSPACE_DEFAULT: 'LLM_Connection:setWorkspaceDefault',
    REFRESH_MODELS: 'LLM_Connection:refreshModels',
    CHANGED: 'LLM_Connection:changed',
  },
  chatgpt: {
    START_OAUTH: 'chatgpt:startOAuth',
    CANCEL_OAUTH: 'chatgpt:cancelOAuth',
    GET_AUTH_STATUS: 'chatgpt:getAuthStatus',
    LOGOUT: 'chatgpt:logout',
  },
  copilot: {
    START_OAUTH: 'copilot:startOAuth',
    CANCEL_OAUTH: 'copilot:cancelOAuth',
    GET_AUTH_STATUS: 'copilot:getAuthStatus',
    LOGOUT: 'copilot:logout',
    DEVICE_CODE: 'copilot:deviceCode',
  },
  settings: {
    SETUP_LLM_CONNECTION: 'settings:setupLlmConnection',
    TEST_LLM_CONNECTION_SETUP: 'settings:testLlmConnectionSetup',
  },
  pi: {
    GET_API_KEY_PROVIDERS: 'pi:getApiKeyProviders',
    GET_PROVIDER_BASE_URL: 'pi:getProviderBaseUrl',
    GET_PROVIDER_MODELS: 'pi:getProviderModels',
  },
  dialog: {
    OPEN_FOLDER: 'dialog:openFolder',
  },
  preferences: {
    READ: 'preferences:read',
    WRITE: 'preferences:write',
  },
  drafts: {
    GET: 'drafts:get',
    SET: 'drafts:set',
    DELETE: 'drafts:delete',
    GET_ALL: 'drafts:getAll',
  },
  sources: {
    GET: 'sources:get',
    CREATE: 'sources:create',
    DELETE: 'sources:delete',
    START_OAUTH: 'sources:startOAuth',
    SAVE_CREDENTIALS: 'sources:saveCredentials',
    CHANGED: 'sources:changed',
    GET_PERMISSIONS: 'sources:getPermissions',
    GET_MCP_TOOLS: 'sources:getMcpTools',
  },
  oauth: {
    START: 'oauth:start',
    COMPLETE: 'oauth:complete',
    CANCEL: 'oauth:cancel',
    REVOKE: 'oauth:revoke',
  },
  workspace: {
    GET_PERMISSIONS: 'workspace:getPermissions',
    READ_IMAGE: 'workspace:readImage',
    WRITE_IMAGE: 'workspace:writeImage',
    SETTINGS_GET: 'workspaceSettings:get',         // merged from 'workspaceSettings' prefix
    SETTINGS_UPDATE: 'workspaceSettings:update',   // merged from 'workspaceSettings' prefix
  },
  permissions: {
    GET_DEFAULTS: 'permissions:getDefaults',
    DEFAULTS_CHANGED: 'permissions:defaultsChanged',
  },
  skills: {
    GET: 'skills:get',
    GET_FILES: 'skills:getFiles',
    DELETE: 'skills:delete',
    OPEN_EDITOR: 'skills:openEditor',
    OPEN_FINDER: 'skills:openFinder',
    CHANGED: 'skills:changed',
  },
  statuses: {
    LIST: 'statuses:list',
    REORDER: 'statuses:reorder',
    CHANGED: 'statuses:changed',
  },
  labels: {
    LIST: 'labels:list',
    CREATE: 'labels:create',
    DELETE: 'labels:delete',
    CHANGED: 'labels:changed',
  },
  views: {
    LIST: 'views:list',
    SAVE: 'views:save',
  },
  toolIcons: {
    GET_MAPPINGS: 'toolIcons:getMappings',
  },
  logo: {
    GET_URL: 'logo:getUrl',
  },
  notification: {
    SHOW: 'notification:show',
    NAVIGATE: 'notification:navigate',
    GET_ENABLED: 'notification:getEnabled',
    SET_ENABLED: 'notification:setEnabled',
  },
  input: {
    GET_AUTO_CAPITALISATION: 'input:getAutoCapitalisation',
    SET_AUTO_CAPITALISATION: 'input:setAutoCapitalisation',
    GET_SEND_MESSAGE_KEY: 'input:getSendMessageKey',
    SET_SEND_MESSAGE_KEY: 'input:setSendMessageKey',
    GET_SPELL_CHECK: 'input:getSpellCheck',
    SET_SPELL_CHECK: 'input:setSpellCheck',
  },
  power: {
    GET_KEEP_AWAKE: 'power:getKeepAwake',
    SET_KEEP_AWAKE: 'power:setKeepAwake',
  },
  appearance: {
    GET_RICH_TOOL_DESCRIPTIONS: 'appearance:getRichToolDescriptions',
    SET_RICH_TOOL_DESCRIPTIONS: 'appearance:setRichToolDescriptions',
  },
  badge: {
    REFRESH: 'badge:refresh',
    SET_ICON: 'badge:setIcon',
    DRAW: 'badge:draw',
    DRAW_WINDOWS: 'badge:draw-windows',
  },
  releaseNotes: {
    GET: 'releaseNotes:get',
    GET_LATEST_VERSION: 'releaseNotes:getLatestVersion',
  },
  git: {
    GET_BRANCH: 'git:getBranch',
  },
  gitbash: {
    CHECK: 'gitbash:check',
    BROWSE: 'gitbash:browse',
    SET_PATH: 'gitbash:setPath',
  },
  browserPane: {
    CREATE: 'browser-pane:create',
    DESTROY: 'browser-pane:destroy',
    LIST: 'browser-pane:list',
    NAVIGATE: 'browser-pane:navigate',
    GO_BACK: 'browser-pane:go-back',
    GO_FORWARD: 'browser-pane:go-forward',
    RELOAD: 'browser-pane:reload',
    STOP: 'browser-pane:stop',
    FOCUS: 'browser-pane:focus',
    SNAPSHOT: 'browser-pane:snapshot',
    CLICK: 'browser-pane:click',
    FILL: 'browser-pane:fill',
    SELECT: 'browser-pane:select',
    SCREENSHOT: 'browser-pane:screenshot',
    EVALUATE: 'browser-pane:evaluate',
    SCROLL: 'browser-pane:scroll',
    LAUNCH: 'browser-empty-state:launch',  // merged from 'browser-empty-state' prefix
    STATE_CHANGED: 'browser-pane:state-changed',
    REMOVED: 'browser-pane:removed',
    INTERACTED: 'browser-pane:interacted',
  },
  automations: {
    TEST: 'automations:test',
    SET_ENABLED: 'automations:setEnabled',
    DUPLICATE: 'automations:duplicate',
    DELETE: 'automations:delete',
    GET_HISTORY: 'automations:getHistory',
    GET_LAST_EXECUTED: 'automations:getLastExecuted',
    CHANGED: 'automations:changed',
  },
} as const

/**
 * Browser toolbar window IPC channels (preload <-> BrowserPaneManager).
 * Kept separate from IPC_CHANNELS because these are scoped to toolbar windows.
 */
export const BROWSER_TOOLBAR_CHANNELS = {
  NAVIGATE: 'browser-toolbar:navigate',
  GO_BACK: 'browser-toolbar:go-back',
  GO_FORWARD: 'browser-toolbar:go-forward',
  RELOAD: 'browser-toolbar:reload',
  STOP: 'browser-toolbar:stop',
  OPEN_MENU: 'browser-toolbar:open-menu',
  HIDE: 'browser-toolbar:hide',
  DESTROY: 'browser-toolbar:destroy',
  STATE_UPDATE: 'browser-toolbar:state-update',
  THEME_COLOR: 'browser-toolbar:theme-color',
} as const

/**
 * Type map for main → renderer push channels (broadcasts and per-window events).
 * NOT for request/response channels — those are typed at the handler site.
 * Keys are channel string literals, values are argument tuples.
 */
export interface BroadcastEventMap {
  // Session events (workspace-scoped via broadcastToWorkspace)
  [IPC_CHANNELS.sessions.EVENT]: [event: SessionEvent]
  [IPC_CHANNELS.sessions.UNREAD_SUMMARY_CHANGED]: [summary: UnreadSummary]
  [IPC_CHANNELS.sessions.FILES_CHANGED]: [sessionId: string]

  // Domain change broadcasts (global via broadcastToAll)
  [IPC_CHANNELS.sources.CHANGED]: [workspaceId: string, sources: LoadedSource[]]
  [IPC_CHANNELS.labels.CHANGED]: [workspaceId: string]
  [IPC_CHANNELS.statuses.CHANGED]: [workspaceId: string]
  [IPC_CHANNELS.automations.CHANGED]: [workspaceId: string]
  [IPC_CHANNELS.skills.CHANGED]: [workspaceId: string, skills: LoadedSkill[]]
  [IPC_CHANNELS.llmConnections.CHANGED]: []
  [IPC_CHANNELS.permissions.DEFAULTS_CHANGED]: [value: null]

  // Theme broadcasts (global)
  [IPC_CHANNELS.theme.APP_CHANGED]: [theme: import('@craft-agent/shared/config').ThemeOverrides | null]
  [IPC_CHANNELS.theme.SYSTEM_CHANGED]: [isDark: boolean]
  [IPC_CHANNELS.theme.PREFERENCES_CHANGED]: [preferences: { mode: string; colorTheme: string; font: string }]
  [IPC_CHANNELS.theme.WORKSPACE_THEME_CHANGED]: [data: { workspaceId: string; themeId: string | null }]

  // Update broadcasts (global — auto-update.ts already iterates all windows)
  [IPC_CHANNELS.update.AVAILABLE]: [info: UpdateInfo]
  [IPC_CHANNELS.update.DOWNLOAD_PROGRESS]: [progress: number]

  // Badge broadcasts (global)
  [IPC_CHANNELS.badge.DRAW]: [data: { count: number; iconDataUrl: string }]
  [IPC_CHANNELS.badge.DRAW_WINDOWS]: [data: { count: number }]

  // Window events (per-window)
  [IPC_CHANNELS.window.FOCUS_STATE]: [isFocused: boolean]
  [IPC_CHANNELS.window.CLOSE_REQUESTED]: []

  // Browser pane events (global)
  [IPC_CHANNELS.browserPane.STATE_CHANGED]: [info: BrowserInstanceInfo]
  [IPC_CHANNELS.browserPane.REMOVED]: [id: string]
  [IPC_CHANNELS.browserPane.INTERACTED]: [id: string]

  // Navigation events (per-window)
  [IPC_CHANNELS.notification.NAVIGATE]: [data: { workspaceId: string; sessionId: string }]
  [IPC_CHANNELS.deeplink.NAVIGATE]: [navigation: DeepLinkNavigation]

  // Copilot device code event
  [IPC_CHANNELS.copilot.DEVICE_CODE]: [data: { userCode: string; verificationUri: string }]

  // Menu events (per-window, no payload)
  [IPC_CHANNELS.menu.NEW_CHAT]: []
  [IPC_CHANNELS.menu.OPEN_SETTINGS]: []
  [IPC_CHANNELS.menu.KEYBOARD_SHORTCUTS]: []
  [IPC_CHANNELS.menu.TOGGLE_FOCUS_MODE]: []
  [IPC_CHANNELS.menu.TOGGLE_SIDEBAR]: []
}

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

// Automation testing types (manual trigger from UI)
export interface TestAutomationPayload {
  workspaceId: string
  /** Matcher ID for writing history entries */
  automationId?: string
  actions: Array<{ type: 'prompt'; prompt: string; llmConnection?: string; model?: string }>
  permissionMode?: 'safe' | 'ask' | 'allow-all'
  labels?: string[]
}

export interface TestAutomationActionResult {
  type: 'prompt'
  success: boolean
  stderr?: string
  sessionId?: string
  duration: number
}

export interface TestAutomationResult {
  actions: TestAutomationActionResult[]
}

// Type-safe IPC API exposed to renderer
export interface ElectronAPI {
  // Session management
  getSessions(): Promise<Session[]>
  getUnreadSummary(): Promise<UnreadSummary>
  markAllSessionsRead(workspaceId: string): Promise<void>
  getSessionMessages(sessionId: string): Promise<Session | null>
  createSession(workspaceId: string, options?: CreateSessionOptions): Promise<Session>
  deleteSession(sessionId: string): Promise<void>
  sendMessage(sessionId: string, message: string, attachments?: FileAttachment[], storedAttachments?: StoredAttachmentType[], options?: SendMessageOptions): Promise<void>
  cancelProcessing(sessionId: string, silent?: boolean): Promise<void>
  killShell(sessionId: string, shellId: string): Promise<{ success: boolean; error?: string }>
  getTaskOutput(taskId: string): Promise<string | null>
  respondToPermission(sessionId: string, requestId: string, allowed: boolean, alwaysAllow: boolean, options?: PermissionResponseOptions): Promise<boolean>
  respondToCredential(sessionId: string, requestId: string, response: CredentialResponse): Promise<boolean>

  // Consolidated session command handler
  sessionCommand(sessionId: string, command: SessionCommand): Promise<void | ShareResult | RefreshTitleResult | { count: number }>

  // Pending plan execution (for reload recovery)
  getPendingPlanExecution(sessionId: string): Promise<{ planPath: string; awaitingCompaction: boolean } | null>
  // Permission mode reconciliation
  getSessionPermissionModeState(sessionId: string): Promise<PermissionModeState | null>

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
  /** Cancel a pending close request (renderer handled it by closing a modal/panel). */
  cancelCloseWindow(): Promise<void>
  /** Listen for close requests (X button, Cmd+W). Returns cleanup function. */
  onCloseRequested(callback: () => void): () => void
  /** Show/hide macOS traffic light buttons (for fullscreen overlays) */
  setTrafficLightsVisible(visible: boolean): Promise<void>

  // Event listeners
  onSessionEvent(callback: (event: SessionEvent) => void): () => void
  onUnreadSummaryChanged(callback: (summary: UnreadSummary) => void): () => void

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

  // Release notes
  getReleaseNotes(): Promise<string>
  getLatestReleaseVersion(): Promise<string | undefined>

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
  startWorkspaceMcpOAuth(mcpUrl: string): Promise<OAuthResult & { clientId?: string }>
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

  // GitHub Copilot OAuth
  startCopilotOAuth(connectionSlug: string): Promise<{ success: boolean; error?: string }>
  cancelCopilotOAuth(): Promise<{ success: boolean }>
  getCopilotAuthStatus(connectionSlug: string): Promise<{ authenticated: boolean }>
  copilotLogout(connectionSlug: string): Promise<{ success: boolean }>
  onCopilotDeviceCode(callback: (data: { userCode: string; verificationUri: string }) => void): () => void

  /** Unified LLM connection setup */
  setupLlmConnection(setup: LlmConnectionSetup): Promise<{ success: boolean; error?: string }>
  /** Unified connection test — spawns a lightweight agent subprocess to validate credentials */
  testLlmConnectionSetup(params: TestLlmConnectionParams): Promise<TestLlmConnectionResult>

  // Pi provider discovery (main process only — Pi SDK can't run in renderer)
  getPiApiKeyProviders(): Promise<Array<{ key: string; label: string; placeholder: string }>>
  getPiProviderBaseUrl(provider: string): Promise<string | undefined>
  getPiProviderModels(provider: string): Promise<{ models: Array<{ id: string; name: string; costInput: number; costOutput: number; contextWindow: number; reasoning: boolean }>; totalCount: number }>

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
  startSourceOAuth(workspaceId: string, sourceSlug: string): Promise<{ success: boolean; error?: string }>
  saveSourceCredentials(workspaceId: string, sourceSlug: string, credential: string): Promise<void>
  getSourcePermissionsConfig(workspaceId: string, sourceSlug: string): Promise<import('@craft-agent/shared/agent').PermissionsConfigFile | null>
  getWorkspacePermissionsConfig(workspaceId: string): Promise<import('@craft-agent/shared/agent').PermissionsConfigFile | null>
  getDefaultPermissionsConfig(): Promise<{ config: import('@craft-agent/shared/agent').PermissionsConfigFile | null; path: string }>
  getMcpTools(workspaceId: string, sourceSlug: string): Promise<McpToolsResult>

  // OAuth (server-owned credentials, client-orchestrated flow)
  performOAuth(args: { sourceSlug: string; sessionId?: string; authRequestId?: string }): Promise<{ success: boolean; error?: string; email?: string }>
  oauthRevoke(sourceSlug: string): Promise<{ success: boolean }>

  // Session content search (full-text search via ripgrep)
  searchSessionContent(workspaceId: string, query: string, searchId?: string): Promise<SessionSearchResult[]>

  // Sources change listener (live updates when sources are added/removed)
  onSourcesChanged(callback: (workspaceId: string, sources: LoadedSource[]) => void): () => void

  // Default permissions change listener (live updates when default.json changes)
  onDefaultPermissionsChanged(callback: () => void): () => void

  // Skills
  getSkills(workspaceId: string, workingDirectory?: string): Promise<LoadedSkill[]>
  getSkillFiles?(workspaceId: string, skillSlug: string): Promise<SkillFile[]>
  deleteSkill(workspaceId: string, skillSlug: string): Promise<void>
  openSkillInEditor(workspaceId: string, skillSlug: string): Promise<void>
  openSkillInFinder(workspaceId: string, skillSlug: string): Promise<void>

  // Skills change listener (live updates when skills are added/removed/modified)
  onSkillsChanged(callback: (workspaceId: string, skills: LoadedSkill[]) => void): () => void

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

  // LLM connections change listener (live updates when models are fetched or connections are modified)
  onLlmConnectionsChanged(callback: () => void): () => void

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

  // Appearance settings
  getRichToolDescriptions(): Promise<boolean>
  setRichToolDescriptions(enabled: boolean): Promise<void>

  refreshBadge(): Promise<void>
  setDockIconWithBadge(dataUrl: string): Promise<void>
  onBadgeDraw(callback: (data: { count: number; iconDataUrl: string }) => void): () => void
  onBadgeDrawWindows(callback: (data: { count: number }) => void): () => void
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

  // Browser pane management
  browserPane: {
    create(input?: string | BrowserPaneCreateOptions): Promise<string>
    destroy(id: string): Promise<void>
    list(): Promise<BrowserInstanceInfo[]>
    navigate(id: string, url: string): Promise<{ url: string; title: string }>
    goBack(id: string): Promise<void>
    goForward(id: string): Promise<void>
    reload(id: string): Promise<void>
    stop(id: string): Promise<void>
    focus(id: string): Promise<void>
    emptyStateLaunch(payload: BrowserEmptyStateLaunchPayload): Promise<BrowserEmptyStateLaunchResult>
    onStateChanged(callback: (info: BrowserInstanceInfo) => void): () => void
    onRemoved(callback: (id: string) => void): () => void
    onInteracted(callback: (id: string) => void): () => void
  }

  // LLM Connections (provider configurations)
  listLlmConnections(): Promise<LlmConnection[]>
  listLlmConnectionsWithStatus(): Promise<LlmConnectionWithStatus[]>
  getLlmConnection(slug: string): Promise<LlmConnection | null>
  getLlmConnectionApiKey(slug: string): Promise<string | null>
  saveLlmConnection(connection: LlmConnection): Promise<{ success: boolean; error?: string }>
  deleteLlmConnection(slug: string): Promise<{ success: boolean; error?: string }>
  testLlmConnection(slug: string): Promise<{ success: boolean; error?: string }>
  setDefaultLlmConnection(slug: string): Promise<{ success: boolean; error?: string }>
  setWorkspaceDefaultLlmConnection(workspaceId: string, slug: string | null): Promise<{ success: boolean; error?: string }>

  // Automation testing (manual trigger)
  testAutomation(payload: TestAutomationPayload): Promise<TestAutomationResult>

  // Automation state management
  setAutomationEnabled(workspaceId: string, eventName: string, matcherIndex: number, enabled: boolean): Promise<void>
  duplicateAutomation(workspaceId: string, eventName: string, matcherIndex: number): Promise<void>
  deleteAutomation(workspaceId: string, eventName: string, matcherIndex: number): Promise<void>
  getAutomationHistory(workspaceId: string, automationId: string, limit?: number): Promise<Array<{ id: string; ts: number; ok: boolean; sessionId?: string; prompt?: string; error?: string }>>
  getAutomationLastExecuted(workspaceId: string): Promise<Record<string, number>>

  // Automations change listener (live updates when automations.json changes on disk)
  onAutomationsChanged(callback: (workspaceId: string) => void): () => void
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
  /** Source slugs to auto-enable for new sessions */
  enabledSourceSlugs?: string[]
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
 * Automation type filter for automations navigation (e.g., show only Scheduled, Event-based, or Agentic automations)
 */
export interface AutomationFilter {
  kind: 'type'
  automationType: 'scheduled' | 'event' | 'agentic'
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
 * Browser pane creation options
 */
export interface BrowserPaneCreateOptions {
  id?: string
  show?: boolean
  bindToSessionId?: string
}

/**
 * Empty-state launch request from the browser empty-state renderer.
 */
export interface BrowserEmptyStateLaunchPayload {
  route: string
  token?: string
}

/**
 * Result of browser empty-state launch handling.
 */
export interface BrowserEmptyStateLaunchResult {
  ok: boolean
  handled: boolean
  reason?: string
}

/**
 * Browser pane instance info (synced from main process)
 */
export interface BrowserInstanceInfo {
  id: string
  url: string
  title: string
  favicon: string | null
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  boundSessionId: string | null
  ownerType: 'session' | 'manual'
  ownerSessionId: string | null
  isVisible: boolean
  /** Whether agent control overlay is currently active for this window */
  agentControlActive: boolean
  /** Website theme color from <meta name="theme-color"> (null if not set) */
  themeColor: string | null
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
 * Automations navigation state - shows AutomationsListPanel in navigator
 */
export interface AutomationsNavigationState {
  navigator: 'automations'
  /** Optional filter for automation type */
  filter?: AutomationFilter
  /** Selected automation details, or null for empty state */
  details: { type: 'automation'; automationId: string } | null
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
  | AutomationsNavigationState

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
 * Type guard to check if state is automations navigation
 */
export const isAutomationsNavigation = (
  state: NavigationState
): state is AutomationsNavigationState => state.navigator === 'automations'

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
  if (state.navigator === 'automations') {
    if (state.details?.type === 'automation') {
      return `automations/automation/${state.details.automationId}`
    }
    return 'automations'
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

  // Handle automations
  if (key === 'automations') return { navigator: 'automations', details: null }
  if (key.startsWith('automations/automation/')) {
    const automationId = key.slice(22)
    if (automationId) {
      return { navigator: 'automations', details: { type: 'automation', automationId } }
    }
    return { navigator: 'automations', details: null }
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
