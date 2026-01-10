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
  SubAgentMetadata as CoreSubAgentMetadata,
  StoredAttachment as CoreStoredAttachment,
} from '@craft-agent/core/types';

// Import mode types from dedicated subpath export (avoids pulling in SDK)
import type { PermissionMode } from '@craft-agent/shared/agent/modes';
export type { PermissionMode };
export { PERMISSION_MODE_CONFIG } from '@craft-agent/shared/agent/modes';

export type {
  CoreMessage as Message,
  CoreMessageRole as MessageRole,
  TypedError,
  CoreTokenUsage as TokenUsage,
  CoreWorkspace as Workspace,
  CoreSessionMetadata as SessionMetadata,
  CoreSubAgentMetadata as SubAgentMetadata,
  CoreStoredAttachment as StoredAttachment,
};

// Import and re-export agent types for Info dialog
// Use types-only subpath to avoid pulling in debug.ts (Node.js fs dependency)
import type {
  SubAgentDefinition,
  McpServerConfig,
  ApiConfig,
  AgentStatus,
  AgentActivateOptions,
} from '@craft-agent/shared/agents/types';

export type {
  SubAgentDefinition,
  McpServerConfig,
  ApiConfig,
  AgentStatus,
  AgentActivateOptions,
};

// Import and re-export auth types for onboarding
// Use types-only subpaths to avoid pulling in Node.js dependencies
import type { AuthState, SetupNeeds } from '@craft-agent/shared/auth/types';
import type { AuthType } from '@craft-agent/shared/config/types';
export type { AuthState, SetupNeeds, AuthType };

// Import source types for session source selection
import type { LoadedSource, FolderSourceConfig, SourceConnectionStatus } from '@craft-agent/shared/sources/types';
export type { LoadedSource, FolderSourceConfig, SourceConnectionStatus };
export { generateMessageId } from '@craft-agent/core/types';

/**
 * Auth requirements for an agent - lists MCP servers and APIs needing credentials
 */
export interface AgentAuthRequirements {
  mcpServers: Array<{ name: string; url: string; requiresAuth?: boolean }>
  apis: Array<{ name: string; auth?: { type: string; credentialLabel?: string; secretLabel?: string } }>
}

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
 * Result of sharing or revoking a session
 */
export interface ShareResult {
  success: boolean
  url?: string
  error?: string
}

/**
 * Agent activation status - indicates if agent needs activation or auth
 */
export interface AgentSetupStatus {
  needsSetup: boolean  // Agent definition has never been extracted (needs activation)
  needsAuth: boolean   // Definition exists but credentials are missing
  reason?: string
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

/**
 * Credential input modes for different auth types
 */
export type CredentialInputMode =
  | 'bearer'      // Single token field (Bearer Token, API Key)
  | 'basic'       // Username + Password fields
  | 'header'      // API Key with custom header name
  | 'query'       // API Key for query parameter

/**
 * Credential request from agent - triggers secure input UI
 */
export interface CredentialRequest {
  requestId: string
  sessionId: string
  /** Source slug to associate credentials with */
  sourceSlug: string
  /** Display name for the source/service */
  sourceName: string
  /** What type of credential input to show */
  mode: CredentialInputMode
  /** Custom labels for fields */
  labels?: {
    /** Label for primary credential field (default: "API Key" or "Bearer Token") */
    credential?: string
    /** Label for username field in basic auth (default: "Username") */
    username?: string
    /** Label for password field in basic auth (default: "Password") */
    password?: string
  }
  /** Optional description/instructions */
  description?: string
  /** Optional hint about where to find the credential */
  hint?: string
  /** For header auth - the header name being used */
  headerName?: string
}

/**
 * Credential response from user
 */
export interface CredentialResponse {
  type: 'credential'
  /** Single value for bearer/header/query modes */
  value?: string
  /** Username for basic auth */
  username?: string
  /** Password for basic auth */
  password?: string
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

/**
 * MCP server with auth status for Info dialog
 */
export interface McpServerWithAuthStatus {
  name: string
  url: string
  requiresAuth?: boolean
  hasAuth: boolean  // Whether credentials have been provided
  tools?: string[]
  logo?: string  // Local logo filename (e.g., "craft.png")
}

/**
 * API with auth status for Info dialog
 */
export interface ApiWithAuthStatus {
  name: string
  baseUrl: string
  auth?: { type: string; credentialLabel?: string; secretLabel?: string }
  hasAuth: boolean  // Whether credentials have been provided
  logo?: string  // Local logo filename (e.g., "exa.png")
}

/**
 * Auth status for an agent's MCP servers and APIs
 */
export interface AgentAuthStatus {
  mcpServers: McpServerWithAuthStatus[]
  apis: ApiWithAuthStatus[]
}

// ============================================
// Onboarding Types
// ============================================

/**
 * Craft space from user's profile
 */
export interface CraftSpace {
  id: string
  name: string
  teamId?: string | null
  iconUrl?: string | null
}

/**
 * Craft OAuth result with profile info
 */
export interface CraftOAuthResult {
  success: boolean
  error?: string
  token?: string
  profile?: {
    userId: string
    firstName: string
    lastName: string
    spaces: CraftSpace[]
    teams: Array<{ id: string; name: string; isPrivate: boolean; role: string; tier?: string | null }>
  }
}

/**
 * Result of saving onboarding configuration
 */
export interface OnboardingSaveResult {
  success: boolean
  error?: string
  workspaceId?: string
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
  agentId?: string
  agentName?: string
  isFlagged?: boolean
  // Advanced options (persisted per session)
  /** Permission mode for this session ('safe', 'ask', 'allow-all') */
  permissionMode?: PermissionMode
  // Todo state (user-controlled) - determines inbox vs completed
  todoState?: TodoState
  // Read/unread tracking - ID of last message user has read
  lastReadMessageId?: string
  // Per-session source selection (source slugs)
  enabledSourceSlugs?: string[]
  // Working directory for this session (used by agent for bash commands)
  workingDirectory?: string
  // Shared viewer URL (if shared via viewer)
  sharedUrl?: string
  // Shared session ID in viewer (for revoke)
  sharedId?: string
  // Role/type of the last message (for badge display without loading messages)
  lastMessageRole?: 'user' | 'assistant' | 'plan' | 'tool' | 'error'
  // Current status for ProcessingIndicator (e.g., compacting)
  currentStatus?: {
    message: string
    statusType?: string
  }
  // Agent status (idle, extracting, ready, active, etc.)
  agentStatus?: AgentStatus
}

// AskUserQuestion types (matches shared/agent/craft-agent.ts)
export interface QuestionOption {
  label: string;
  description: string;
}

export interface Question {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

export interface AskQuestionRequest {
  requestId: string;
  questions: Question[];
}

// Events sent from main to renderer
// turnId: Correlation ID from the API's message.id, groups all events in an assistant turn
export type SessionEvent =
  | { type: 'text_delta'; sessionId: string; delta: string; turnId?: string }
  | { type: 'text_complete'; sessionId: string; text: string; isIntermediate?: boolean; turnId?: string; parentToolUseId?: string }
  | { type: 'tool_start'; sessionId: string; toolName: string; toolUseId: string; toolInput: Record<string, unknown>; toolIntent?: string; toolDisplayName?: string; turnId?: string; parentToolUseId?: string }
  | { type: 'tool_result'; sessionId: string; toolUseId: string; toolName: string; result: string; turnId?: string; parentToolUseId?: string; isError?: boolean }
  | { type: 'parent_update'; sessionId: string; toolUseId: string; parentToolUseId: string }
  | { type: 'error'; sessionId: string; error: string }
  | { type: 'typed_error'; sessionId: string; error: TypedError }
  | { type: 'complete'; sessionId: string }
  | { type: 'interrupted'; sessionId: string; message?: Message }
  | { type: 'status'; sessionId: string; message: string; statusType?: 'compacting' }
  | { type: 'info'; sessionId: string; message: string; statusType?: 'compaction_complete'; level?: 'info' | 'warning' | 'error' | 'success' }
  | { type: 'title_generated'; sessionId: string; title: string }
  | { type: 'working_directory_changed'; sessionId: string; workingDirectory: string }
  | { type: 'agent_status'; sessionId: string; status: AgentStatus }
  | { type: 'permission_request'; sessionId: string; request: PermissionRequest }
  | { type: 'credential_request'; sessionId: string; request: CredentialRequest }
  // Permission mode events
  | { type: 'permission_mode_changed'; sessionId: string; permissionMode: PermissionMode }
  | { type: 'plan_submitted'; sessionId: string; message: CoreMessage }
  | { type: 'ask_question_request'; sessionId: string; request: AskQuestionRequest }
  // Source events
  | { type: 'sources_changed'; sessionId: string; enabledSourceSlugs: string[] }
  // Background task/shell events
  | { type: 'task_backgrounded'; sessionId: string; toolUseId: string; taskId: string; intent?: string; turnId?: string }
  | { type: 'shell_backgrounded'; sessionId: string; toolUseId: string; shellId: string; intent?: string; command?: string; turnId?: string }
  | { type: 'task_progress'; sessionId: string; toolUseId: string; elapsedSeconds: number; turnId?: string }
  | { type: 'shell_killed'; sessionId: string; shellId: string }
  // User message events (for optimistic UI with backend as source of truth)
  | { type: 'user_message'; sessionId: string; message: Message; status: 'accepted' | 'queued' | 'processing' }
  // Session metadata events (for multi-window sync)
  | { type: 'session_flagged'; sessionId: string }
  | { type: 'session_unflagged'; sessionId: string }
  | { type: 'todo_state_changed'; sessionId: string; todoState: TodoState }
  | { type: 'session_deleted'; sessionId: string }
  | { type: 'session_shared'; sessionId: string; sharedUrl: string }
  | { type: 'session_unshared'; sessionId: string }

// Options for sendMessage
export interface SendMessageOptions {
  /** Enable ultrathink mode for extended reasoning */
  ultrathinkEnabled?: boolean
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
  | { type: 'rename'; name: string }
  | { type: 'setTodoState'; state: TodoState }
  | { type: 'markRead' }
  | { type: 'markUnread' }
  | { type: 'setPermissionMode'; mode: PermissionMode }
  | { type: 'updateWorkingDirectory'; dir: string }
  | { type: 'setSources'; sourceSlugs: string[] }
  | { type: 'showInFinder' }
  | { type: 'shareToViewer' }
  | { type: 'updateShare' }
  | { type: 'revokeShare' }

/**
 * Parameters for opening a new chat session
 */
export interface NewChatActionParams {
  /** Agent ID to use for the new chat */
  agentId?: string
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

  // Workspace management
  GET_WORKSPACES: 'workspaces:get',
  CREATE_WORKSPACE: 'workspaces:create',

  // Window management
  GET_WINDOW_WORKSPACE: 'window:getWorkspace',
  GET_WINDOW_MODE: 'window:getMode',
  OPEN_WORKSPACE: 'window:openWorkspace',
  OPEN_SESSION_IN_NEW_WINDOW: 'window:openSessionInNewWindow',
  SWITCH_WORKSPACE: 'window:switchWorkspace',
  CLOSE_WINDOW: 'window:close',

  // Agent management
  GET_AGENTS: 'agents:get',
  REFRESH_AGENTS: 'agents:refresh',
  CHECK_AGENT_AUTH: 'agents:checkAuth',
  GET_AGENT_AUTH_STATUS: 'agents:getAuthStatus',
  GET_AGENT_DEFINITION: 'agents:getDefinition',
  RELOAD_AGENT: 'agents:reloadAgent',
  RESET_AGENT: 'agents:resetAgent',
  ENSURE_BUILTIN_AGENT: 'agents:ensureBuiltinAgent',

  // Agent authentication
  GET_AGENT_AUTH_REQUIREMENTS: 'agents:getAuthRequirements',
  START_MCP_OAUTH: 'agents:startMcpOAuth',
  SAVE_MCP_BEARER: 'agents:saveMcpBearer',
  SAVE_API_CREDENTIALS: 'agents:saveApiCredentials',
  VALIDATE_MCP_CONNECTION: 'agents:validateMcpConnection',

  // Agent state management (unified state machine, agent-scoped by workspaceId:agentId)
  AGENT_GET_STATUS: 'agent:getStatus',           // (workspaceId, agentId) → AgentStatus
  AGENT_ACTIVATE: 'agent:activate',               // (workspaceId, agentId, options?) → AgentStatus
  AGENT_CONTINUE_MCP_AUTH: 'agent:continueMcpAuth', // (workspaceId, agentId) → AgentStatus
  AGENT_CONTINUE_API_AUTH: 'agent:continueApiAuth', // (workspaceId, agentId) → AgentStatus
  AGENT_DEACTIVATE: 'agent:deactivate',           // (workspaceId, agentId) → void
  AGENT_RELOAD: 'agent:reload',                   // (workspaceId, agentId) → AgentStatus
  AGENT_RESET: 'agent:reset',                     // (workspaceId, agentId) → void
  AGENT_MARK_ACTIVE: 'agent:markActive',          // (workspaceId, agentId) → void

  // Events from main to renderer
  SESSION_EVENT: 'session:event',
  AGENT_STATUS_CHANGED: 'agent:statusChanged',    // Broadcast: { workspaceId, agentId, status } - complete state including needsSetup/needsAuth
  AGENTS_CHANGED: 'agents:changed',               // Broadcast: agents list changed (created/synced/deleted) - triggers sidebar refresh

  // File operations
  READ_FILE: 'file:read',
  OPEN_FILE_DIALOG: 'file:openDialog',
  READ_FILE_ATTACHMENT: 'file:readAttachment',
  STORE_ATTACHMENT: 'file:storeAttachment',
  GENERATE_THUMBNAIL: 'file:generateThumbnail',

  // Theme
  GET_SYSTEM_THEME: 'theme:getSystemPreference',
  SYSTEM_THEME_CHANGED: 'theme:systemChanged',

  // System
  GET_VERSIONS: 'system:versions',
  GET_HOME_DIR: 'system:homeDir',
  IS_DEBUG_MODE: 'system:isDebugMode',

  // Shell operations (open external URLs/files)
  OPEN_URL: 'shell:openUrl',
  OPEN_FILE: 'shell:openFile',
  SHOW_IN_FOLDER: 'shell:showInFolder',

  // Menu actions (main → renderer)
  MENU_NEW_CHAT: 'menu:newChat',
  MENU_OPEN_SETTINGS: 'menu:openSettings',
  MENU_KEYBOARD_SHORTCUTS: 'menu:keyboardShortcuts',
  MENU_OPEN_HELP: 'menu:openHelp',

  // Deep link navigation (main → renderer, for external craftagents:// URLs)
  DEEP_LINK_NAVIGATE: 'deeplink:navigate',

  // Auth
  LOGOUT: 'auth:logout',
  SHOW_LOGOUT_CONFIRMATION: 'auth:showLogoutConfirmation',
  SHOW_DELETE_SESSION_CONFIRMATION: 'auth:showDeleteSessionConfirmation',

  // Onboarding
  ONBOARDING_GET_AUTH_STATE: 'onboarding:getAuthState',
  ONBOARDING_START_CRAFT_OAUTH: 'onboarding:startCraftOAuth',
  ONBOARDING_GET_CRAFT_PROFILE: 'onboarding:getCraftProfile',
  ONBOARDING_VALIDATE_MCP: 'onboarding:validateMcp',
  ONBOARDING_START_MCP_OAUTH: 'onboarding:startMcpOAuth',
  ONBOARDING_SAVE_CONFIG: 'onboarding:saveConfig',
  // Claude OAuth
  ONBOARDING_GET_EXISTING_CLAUDE_TOKEN: 'onboarding:getExistingClaudeToken',
  ONBOARDING_IS_CLAUDE_CLI_INSTALLED: 'onboarding:isClaudeCliInstalled',
  ONBOARDING_RUN_CLAUDE_SETUP_TOKEN: 'onboarding:runClaudeSetupToken',

  // Settings - Billing
  SETTINGS_GET_BILLING_METHOD: 'settings:getBillingMethod',
  SETTINGS_UPDATE_BILLING_METHOD: 'settings:updateBillingMethod',
  SETTINGS_GET_CREDITS_URL: 'settings:getCreditsUrl',

  // Settings - Model
  SETTINGS_GET_MODEL: 'settings:getModel',
  SETTINGS_SET_MODEL: 'settings:setModel',

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
  // Agent-scoped sources
  SOURCES_GET_AGENT: 'sources:getAgent',
  SOURCES_PROMOTE: 'sources:promote',

  // Source permissions config
  SOURCES_GET_PERMISSIONS: 'sources:getPermissions',
  // MCP tools listing
  SOURCES_GET_MCP_TOOLS: 'sources:getMcpTools',

  // Status management (workspace-scoped)
  STATUSES_LIST: 'statuses:list',
  STATUSES_CHANGED: 'statuses:changed',  // Broadcast event

  // Theme management (cascading: app → workspace → agent)
  THEME_APP_CHANGED: 'theme:appChanged',        // Broadcast event
  THEME_WORKSPACE_CHANGED: 'theme:workspaceChanged',  // Broadcast event
  THEME_AGENT_CHANGED: 'theme:agentChanged',    // Broadcast event

  // Generic workspace image loading/saving (for icons, etc.)
  WORKSPACE_READ_IMAGE: 'workspace:readImage',
  WORKSPACE_WRITE_IMAGE: 'workspace:writeImage',

  // Unified preview window (all modes: markdown, view, diff, multi-diff, terminal)
  PREVIEW_OPEN: 'preview:open',
  PREVIEW_GET_DATA: 'preview:getData',
  PREVIEW_SAVE: 'preview:save',
  PREVIEW_FILE_SAVED: 'preview:fileSaved', // Broadcast: { filePath: string }
  PREVIEW_READ_FILE: 'preview:readFile',

  // Workspace settings (per-workspace configuration)
  WORKSPACE_SETTINGS_GET: 'workspaceSettings:get',
  WORKSPACE_SETTINGS_UPDATE: 'workspaceSettings:update',
  WORKSPACE_SETTINGS_ENABLE_PORTABLE: 'workspaceSettings:enablePortable',
  WORKSPACE_SETTINGS_DISABLE_PORTABLE: 'workspaceSettings:disablePortable',

  // Theme (cascading: app → workspace → agent)
  THEME_GET_APP: 'theme:getApp',
  THEME_GET_WORKSPACE: 'theme:getWorkspace',
  THEME_GET_AGENT: 'theme:getAgent',

  // Logo URL resolution (uses Node.js filesystem cache)
  LOGO_GET_URL: 'logo:getUrl',

  // Notifications
  NOTIFICATION_SHOW: 'notification:show',
  NOTIFICATION_NAVIGATE: 'notification:navigate',  // Broadcast: { workspaceId, sessionId }
  NOTIFICATION_GET_ENABLED: 'notification:getEnabled',
  NOTIFICATION_SET_ENABLED: 'notification:setEnabled',

  // Mode cycling settings
  MODE_CYCLING_GET_ENABLED: 'modeCycling:getEnabled',
  MODE_CYCLING_SET_ENABLED: 'modeCycling:setEnabled',

  BADGE_UPDATE: 'badge:update',
  BADGE_CLEAR: 'badge:clear',
  BADGE_SET_ICON: 'badge:setIcon',
  BADGE_DRAW: 'badge:draw',  // Broadcast: { count: number, iconDataUrl: string }
  WINDOW_FOCUS_STATE: 'window:focusState',  // Broadcast: boolean (isFocused)
  WINDOW_GET_FOCUS_STATE: 'window:getFocusState',
} as const

/**
 * Data for terminal preview (Bash/Grep/Glob tools)
 */
export interface TerminalPreviewData {
  command: string
  output: string
  /** Optional description of what the command does */
  description?: string
  /** Exit status if available */
  exitCode?: number
  /** Tool type for badge display */
  toolType?: 'bash' | 'grep' | 'glob'
}

/**
 * A single file change (Edit or Write) for the session diff view
 */
export interface FileChange {
  /** Unique ID for this change */
  id: string
  /** Absolute file path */
  filePath: string
  /** Tool type: Edit or Write */
  toolType: 'Edit' | 'Write'
  /** For Edit: the old_string; For Write: empty or previous content if available */
  original: string
  /** For Edit: the new_string; For Write: the written content */
  modified: string
  /** Error message if the operation failed */
  error?: string
}

// ============================================
// Unified Preview Types
// ============================================

/**
 * View mode data - for Read/Write tool results
 */
export interface FilePreviewViewData {
  filePath: string
  content: string
  language?: string
  /** 'read' for Read tool, 'write' for Write tool */
  toolType: 'read' | 'write'
  /** File metadata from Read tool */
  startLine?: number
  numLines?: number
  totalLines?: number
  /** Error message if the operation failed */
  error?: string
}

/**
 * Diff mode data - for single Edit tool result
 */
export interface FilePreviewDiffData {
  filePath: string
  original: string
  modified: string
  language?: string
  /** Error message if the edit failed */
  error?: string
}

/**
 * Multi-diff mode data - for multiple edits/writes in a turn
 */
export interface FilePreviewMultiDiffData {
  turnId: string
  changes: FileChange[]
  /** If true (default), group changes by file. If false, show each change separately */
  consolidated?: boolean
  /** ID of the change to auto-focus (only used when consolidated=false) */
  focusedChangeId?: string
}

/**
 * Data for markdown preview window
 * - readOnly mode: view-only, no save button
 * - readWrite mode: editable with save functionality (requires filePath)
 */
export type MarkdownPreviewData =
  | {
      /** Read-only mode - content from memory (no save) */
      mode: 'readOnly'
      /** Raw markdown content to display */
      content: string
      /** Optional title for the window */
      title?: string
    }
  | {
      /** Read-only mode - content from file (no save) */
      mode: 'readOnly'
      /** File path to read content from */
      filePath: string
      /** Optional title for the window */
      title?: string
    }
  | {
      /** Read-write mode - editable with save to file */
      mode: 'readWrite'
      /** File path to read from and save to */
      filePath: string
      /** Optional title for the window */
      title?: string
    }

// ============================================
// Unified Preview Window Types
// ============================================

/**
 * Unified preview data - supports all preview modes in a single window
 * Uses discriminated union for type-safe mode handling
 */
export type PreviewData =
  | {
      /** Markdown preview - view or edit markdown content */
      mode: 'markdown'
      sessionId: string
      previewId: string
      markdown: MarkdownPreviewData
    }
  | {
      /** Code view - Read/Write tool results */
      mode: 'view'
      sessionId: string
      previewId: string
      view: FilePreviewViewData
    }
  | {
      /** Diff view - single Edit tool result */
      mode: 'diff'
      sessionId: string
      previewId: string
      diff: FilePreviewDiffData
    }
  | {
      /** Multi-diff view - multiple edits/writes in a turn */
      mode: 'multi-diff'
      sessionId: string
      previewId: string
      multiDiff: FilePreviewMultiDiffData
    }
  | {
      /** Terminal view - Bash/Grep/Glob tool output */
      mode: 'terminal'
      sessionId: string
      previewId: string
      terminal: TerminalPreviewData
    }

/**
 * Preview mode type for discriminated union
 */
export type PreviewMode = PreviewData['mode']

// Re-import types for ElectronAPI
import type { Workspace, SessionMetadata, StoredAttachment as StoredAttachmentType } from '@craft-agent/core/types';
import type { SubAgentMetadata } from '@craft-agent/core/types';

// Type-safe IPC API exposed to renderer
export interface ElectronAPI {
  // Session management
  getSessions(): Promise<Session[]>
  getSessionMessages(sessionId: string): Promise<Session | null>
  createSession(workspaceId: string, agentId?: string, agentName?: string): Promise<Session>
  deleteSession(sessionId: string): Promise<void>
  sendMessage(sessionId: string, message: string, attachments?: FileAttachment[], storedAttachments?: StoredAttachmentType[], options?: SendMessageOptions): Promise<void>
  cancelProcessing(sessionId: string, silent?: boolean): Promise<void>
  killShell(sessionId: string, shellId: string): Promise<{ success: boolean; error?: string }>
  getTaskOutput(taskId: string): Promise<string | null>
  respondToPermission(sessionId: string, requestId: string, allowed: boolean, alwaysAllow: boolean): Promise<boolean>
  respondToCredential(sessionId: string, requestId: string, response: CredentialResponse): Promise<boolean>

  // Consolidated session command handler
  sessionCommand(sessionId: string, command: SessionCommand): Promise<void | ShareResult>

  // Workspace management
  getWorkspaces(): Promise<Workspace[]>
  createWorkspace(folderPath: string, name: string): Promise<Workspace>

  // Window management
  getWindowWorkspace(): Promise<string | null>
  getWindowMode(): Promise<string | null>
  openWorkspace(workspaceId: string): Promise<void>
  openSessionInNewWindow(workspaceId: string, sessionId: string): Promise<void>
  switchWorkspace(workspaceId: string): Promise<void>
  closeWindow(): Promise<void>

  // Agent management
  getAgents(workspaceId: string): Promise<SubAgentMetadata[]>
  refreshAgents(workspaceId: string): Promise<SubAgentMetadata[]>
  checkAgentAuth(workspaceId: string, agentId: string): Promise<{ needsAuth: boolean; reason?: string }>
  getAgentAuthStatus(workspaceId: string, agentId: string): Promise<AgentAuthStatus>
  getAgentDefinition(workspaceId: string, agentId: string): Promise<SubAgentDefinition | null>
  reloadAgent(workspaceId: string, agentId: string): Promise<boolean>
  resetAgent(workspaceId: string, agentId: string): Promise<boolean>
  ensureBuiltinAgent(workspaceId: string, slug: string): Promise<string | null>

  // Agent authentication
  getAgentAuthRequirements(workspaceId: string, agentId: string): Promise<AgentAuthRequirements>
  startMcpOAuth(workspaceId: string, agentId: string, serverUrl: string, serverName: string): Promise<OAuthResult>
  saveMcpBearer(workspaceId: string, agentId: string, serverName: string, token: string): Promise<void>
  saveApiCredentials(workspaceId: string, agentId: string, apiName: string, credential: string): Promise<void>
  validateMcpConnection(serverUrl: string, accessToken?: string): Promise<McpValidationResult>

  // Agent state management (unified state machine, agent-scoped)
  getAgentStatus(workspaceId: string, agentId: string): Promise<AgentStatus>
  activateAgent(workspaceId: string, agentId: string, options?: AgentActivateOptions): Promise<AgentStatus>
  continueAfterMcpAuth(workspaceId: string, agentId: string): Promise<AgentStatus>
  continueAfterApiAuth(workspaceId: string, agentId: string): Promise<AgentStatus>
  deactivateAgent(workspaceId: string, agentId: string): Promise<void>
  reloadAgentState(workspaceId: string, agentId: string): Promise<AgentStatus>
  resetAgentState(workspaceId: string, agentId: string): Promise<void>
  markAgentActive(workspaceId: string, agentId: string): Promise<void>

  // Event listeners
  onSessionEvent(callback: (event: SessionEvent) => void): () => void
  /** Listens for complete agent state changes (status + needsSetup + needsAuth) */
  onAgentStatusChanged(callback: (workspaceId: string, agentId: string, status: AgentStatus) => void): () => void

  // File operations
  readFile(path: string): Promise<string>
  openFileDialog(): Promise<string[]>
  readFileAttachment(path: string): Promise<FileAttachment | null>
  storeAttachment(sessionId: string, attachment: FileAttachment): Promise<import('../../../../packages/core/src/types/index.ts').StoredAttachment>
  generateThumbnail(base64: string, mimeType: string): Promise<string | null>

  // Theme
  getSystemTheme(): Promise<boolean>
  onSystemThemeChange(callback: (isDark: boolean) => void): () => void

  // System
  getVersions(): { node: string; chrome: string; electron: string }
  getHomeDir(): Promise<string>
  isDebugMode(): Promise<boolean>

  // Shell operations
  openUrl(url: string): Promise<void>
  openFile(path: string): Promise<void>
  showInFolder(path: string): Promise<void>

  // Menu event listeners
  onMenuNewChat(callback: () => void): () => void
  onMenuOpenSettings(callback: () => void): () => void
  onMenuKeyboardShortcuts(callback: () => void): () => void
  onMenuOpenHelp(callback: () => void): () => void

  // Deep link navigation listener (for external craftagents:// URLs)
  onDeepLinkNavigate(callback: (nav: DeepLinkNavigation) => void): () => void

  // Auth
  showLogoutConfirmation(): Promise<boolean>
  showDeleteSessionConfirmation(name: string): Promise<boolean>
  logout(): Promise<void>

  // Onboarding
  getAuthState(): Promise<AuthState>
  getSetupNeeds(): Promise<SetupNeeds>
  startCraftOAuth(): Promise<CraftOAuthResult>
  getCraftProfile(): Promise<CraftOAuthResult>  // Get profile using existing stored token
  startWorkspaceMcpOAuth(mcpUrl: string): Promise<OAuthResult & { accessToken?: string; clientId?: string }>
  saveOnboardingConfig(config: {
    authType?: AuthType  // Optional - if not provided, preserves existing auth type (for add workspace)
    workspace?: { name: string; iconUrl?: string; mcpUrl?: string }  // Optional - if not provided, only updates billing
    credential?: string  // API key or OAuth token based on authType
    mcpCredentials?: { accessToken: string; clientId?: string }  // MCP OAuth credentials
  }): Promise<OnboardingSaveResult>
  // Claude OAuth
  getExistingClaudeToken(): Promise<string | null>
  isClaudeCliInstalled(): Promise<boolean>
  runClaudeSetupToken(): Promise<ClaudeOAuthResult>

  // Settings - Billing
  getBillingMethod(): Promise<BillingMethodInfo>
  updateBillingMethod(authType: AuthType, credential?: string): Promise<void>
  getCreditsUrl(): Promise<string | null>

  // Settings - Model
  getModel(): Promise<string | null>
  setModel(model: string): Promise<void>

  // Workspace Settings (per-workspace configuration)
  getWorkspaceSettings(workspaceId: string): Promise<WorkspaceSettings | null>
  updateWorkspaceSetting<K extends keyof WorkspaceSettings>(workspaceId: string, key: K, value: WorkspaceSettings[K]): Promise<void>
  enablePortableCredentials(workspaceId: string, password: string): Promise<void>
  disablePortableCredentials(workspaceId: string, password: string): Promise<void>

  // Folder dialog
  openFolderDialog(): Promise<string | null>

  // User Preferences
  readPreferences(): Promise<{ content: string; exists: boolean }>
  writePreferences(content: string): Promise<{ success: boolean; error?: string }>

  // Unified preview window (all modes: markdown, view, diff, multi-diff, terminal)
  openPreview(data: PreviewData): Promise<void>
  getPreviewData(sessionId: string, previewId: string): Promise<PreviewData | null>
  savePreview(sessionId: string, previewId: string, content: string): Promise<void>
  onPreviewFileSaved(callback: (data: { filePath: string }) => void): () => void
  readFileForPreview(filePath: string): Promise<string | null>

  // Session Drafts (persisted input text)
  getDraft(sessionId: string): Promise<string | null>
  setDraft(sessionId: string, text: string): Promise<void>
  deleteDraft(sessionId: string): Promise<void>
  getAllDrafts(): Promise<Record<string, string>>

  // Sources
  getSources(workspaceId: string): Promise<LoadedSource[]>
  getAgentSources(workspaceId: string, agentSlug: string): Promise<LoadedSource[]>
  createSource(workspaceId: string, config: Partial<FolderSourceConfig>): Promise<FolderSourceConfig>
  deleteSource(workspaceId: string, sourceSlug: string): Promise<void>
  startSourceOAuth(workspaceId: string, sourceSlug: string): Promise<{ success: boolean; error?: string; accessToken?: string }>
  saveSourceCredentials(workspaceId: string, sourceSlug: string, credential: string): Promise<void>
  promoteSource(workspaceId: string, agentSlug: string, sourceSlug: string): Promise<void>
  getSourcePermissionsConfig(workspaceId: string, sourceSlug: string): Promise<import('@craft-agent/shared/agent').PermissionsConfigFile | null>
  getMcpTools(workspaceId: string, sourceSlug: string): Promise<McpToolsResult>

  // Sources change listener (live updates when sources are added/removed)
  onSourcesChanged(callback: (sources: LoadedSource[]) => void): () => void

  // Statuses (workspace-scoped)
  listStatuses(workspaceId: string): Promise<import('@craft-agent/shared/statuses').StatusConfig[]>
  // Statuses change listener (live updates when statuses config or icon files change)
  onStatusesChanged(callback: (workspaceId: string) => void): () => void

  // Generic workspace image loading/saving (returns data URL for images, raw string for SVG)
  readWorkspaceImage(workspaceId: string, relativePath: string): Promise<string>
  writeWorkspaceImage(workspaceId: string, relativePath: string, base64: string, mimeType: string): Promise<void>

  // Agents change listener (live updates when agents are created/synced/deleted)
  onAgentsChanged(callback: () => void): () => void

  // Theme (cascading: app → workspace → agent)
  getAppTheme(): Promise<import('@config/theme').ThemeOverrides | null>
  getWorkspaceTheme(workspaceId: string): Promise<import('@config/theme').ThemeOverrides | null>
  getAgentTheme(workspaceId: string, agentSlug: string): Promise<import('@config/theme').ThemeOverrides | null>

  // Theme change listeners (live updates when theme.json files change)
  onAppThemeChange(callback: (theme: import('@config/theme').ThemeOverrides | null) => void): () => void
  onWorkspaceThemeChange(callback: (theme: import('@config/theme').ThemeOverrides | null) => void): () => void
  onAgentThemeChange(callback: (agentSlug: string, theme: import('@config/theme').ThemeOverrides | null) => void): () => void

  // Logo URL resolution (uses Node.js filesystem cache for provider domains)
  getLogoUrl(serviceUrl: string, provider?: string): Promise<string | null>

  // Notifications
  showNotification(title: string, body: string, workspaceId: string, sessionId: string): Promise<void>
  getNotificationsEnabled(): Promise<boolean>
  setNotificationsEnabled(enabled: boolean): Promise<void>

  // Mode cycling
  getEnabledPermissionModes(): Promise<PermissionMode[]>
  setEnabledPermissionModes(modes: PermissionMode[]): Promise<void>

  updateBadgeCount(count: number): Promise<void>
  clearBadgeCount(): Promise<void>
  setDockIconWithBadge(dataUrl: string): Promise<void>
  onBadgeDraw(callback: (data: { count: number; iconDataUrl: string }) => void): () => void
  getWindowFocusState(): Promise<boolean>
  onWindowFocusChange(callback: (isFocused: boolean) => void): () => void
  onNotificationNavigate(callback: (data: { workspaceId: string; sessionId: string }) => void): () => void
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
 * Current billing method info for settings
 */
export interface BillingMethodInfo {
  authType: AuthType
  hasCredential: boolean
}

/**
 * Credential storage strategy for workspaces
 */
export type CredentialStrategy = 'local' | 'portable'

/**
 * Per-workspace settings
 */
export interface WorkspaceSettings {
  name?: string
  model?: string
  permissionMode?: PermissionMode
  workingDirectory?: string
  credentialStrategy?: CredentialStrategy
  /** Whether local (stdio) MCP servers are enabled */
  localMcpEnabled?: boolean
}

/**
 * Navigation payload for deep links (main → renderer)
 */
export interface DeepLinkNavigation {
  tabType?: string
  tabParams?: Record<string, string>
  action?: string
  actionParams?: Record<string, string>
  sidebar?: string
  sidebarParams?: Record<string, string>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
