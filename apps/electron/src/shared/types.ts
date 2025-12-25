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

// Import Mode type from shared package for generic mode handling
import type { Mode } from '@craft-agent/shared/agent';
export type { Mode };

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
import type {
  SubAgentDefinition,
  McpServerConfig,
  ApiConfig,
  AgentStatus,
  AgentActivateOptions,
} from '@craft-agent/shared/agents';

export type {
  SubAgentDefinition,
  McpServerConfig,
  ApiConfig,
  AgentStatus,
  AgentActivateOptions,
};

// Import and re-export auth types for onboarding
import type { AuthState, SetupNeeds } from '@craft-agent/shared/auth';
import type { AuthType, ConnectionConfig, ConnectionType } from '@craft-agent/shared/config';
export type { AuthState, SetupNeeds, AuthType, ConnectionConfig, ConnectionType };
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
 * MCP link from a Craft space
 */
export interface CraftMcpLink {
  linkId: string
  name: string
  mcpUrl?: string
  scope: string
  enabled: boolean
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
 * - 'todo': Not started
 * - 'in-progress': Currently working on
 * - 'needs-review': Awaiting review
 * - 'done': Completed successfully
 * - 'cancelled': Cancelled/abandoned
 */
export type TodoState = 'todo' | 'in-progress' | 'needs-review' | 'done' | 'cancelled'

export interface Session {
  id: string
  workspaceId: string
  workspaceName: string
  name?: string  // User-defined or AI-generated session name
  lastMessageAt: number
  messages: Message[]
  isProcessing: boolean
  // Session metadata
  agentId?: string
  agentName?: string
  isFlagged?: boolean
  // Advanced options (persisted per session)
  skipPermissions?: boolean
  /** Active operational modes for this session (e.g., 'safe' for read-only exploration) */
  activeModes?: Mode[]
  // Todo state (user-controlled) - determines inbox vs completed
  todoState?: TodoState
  // Read/unread tracking - ID of last message user has read
  lastReadMessageId?: string
  // Per-session connection selection
  selectedConnectionIds?: string[]
  // Working directory for this session (used by agent for bash commands)
  workingDirectory?: string
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
  | { type: 'error'; sessionId: string; error: string }
  | { type: 'typed_error'; sessionId: string; error: TypedError }
  | { type: 'complete'; sessionId: string }
  | { type: 'interrupted'; sessionId: string; message: Message }
  | { type: 'status'; sessionId: string; message: string; statusType?: 'compacting' }
  | { type: 'info'; sessionId: string; message: string; statusType?: 'compaction_complete'; level?: 'info' | 'warning' | 'error' | 'success' }
  | { type: 'title_generated'; sessionId: string; title: string }
  | { type: 'working_directory_changed'; sessionId: string; workingDirectory: string }
  | { type: 'agent_status'; sessionId: string; status: AgentStatus }
  | { type: 'permission_request'; sessionId: string; request: PermissionRequest }
  // Mode events (generic for any mode type)
  | { type: 'mode_changed'; sessionId: string; mode: Mode; enabled: boolean }
  | { type: 'plan_submitted'; sessionId: string; message: CoreMessage }
  | { type: 'ask_question_request'; sessionId: string; request: AskQuestionRequest }
  // Connection events
  | { type: 'session_restarted'; sessionId: string; selectedConnectionIds: string[] }

// Options for sendMessage
export interface SendMessageOptions {
  /** Enable ultrathink mode for extended reasoning */
  ultrathinkEnabled?: boolean
}

// IPC channel names
export const IPC_CHANNELS = {
  // Session management
  GET_SESSIONS: 'sessions:get',
  CREATE_SESSION: 'sessions:create',
  DELETE_SESSION: 'sessions:delete',
  RENAME_SESSION: 'sessions:rename',
  SEND_MESSAGE: 'sessions:sendMessage',
  CANCEL_PROCESSING: 'sessions:cancel',
  FLAG_SESSION: 'sessions:flag',
  UNFLAG_SESSION: 'sessions:unflag',
  SET_SKIP_PERMISSIONS: 'sessions:setSkipPermissions',
  SET_TODO_STATE: 'sessions:setTodoState',
  MARK_SESSION_READ: 'sessions:markRead',
  MARK_SESSION_UNREAD: 'sessions:markUnread',
  RESPOND_TO_PERMISSION: 'sessions:respondToPermission',
  UPDATE_WORKING_DIRECTORY: 'sessions:updateWorkingDirectory',

  // Mode management (generic for any mode type)
  SET_MODE: 'sessions:setMode',

  // Workspace management
  GET_WORKSPACES: 'workspaces:get',

  // Window management
  GET_WINDOW_WORKSPACE: 'window:getWorkspace',
  GET_WINDOW_MODE: 'window:getMode',
  OPEN_WORKSPACE: 'window:openWorkspace',
  OPEN_ADD_WORKSPACE: 'window:openAddWorkspace',
  CLOSE_WINDOW: 'window:close',

  // Agent management
  GET_AGENTS: 'agents:get',
  REFRESH_AGENTS: 'agents:refresh',
  CHECK_AGENT_AUTH: 'agents:checkAuth',
  GET_AGENT_SETUP_STATUS: 'agents:getSetupStatus',
  GET_AGENT_AUTH_STATUS: 'agents:getAuthStatus',
  GET_AGENT_DEFINITION: 'agents:getDefinition',
  RELOAD_AGENT: 'agents:reloadAgent',
  RESET_AGENT: 'agents:resetAgent',

  // Agent authentication
  GET_AGENT_AUTH_REQUIREMENTS: 'agents:getAuthRequirements',
  START_MCP_OAUTH: 'agents:startMcpOAuth',
  SAVE_MCP_BEARER: 'agents:saveMcpBearer',
  SAVE_API_CREDENTIALS: 'agents:saveApiCredentials',
  VALIDATE_MCP_CONNECTION: 'agents:validateMcpConnection',

  // Agent state management (unified state machine, agent-scoped by workspaceId:agentId)
  AGENT_GET_STATUS: 'agent:getStatus',           // (workspaceId, agentId) → AgentStatus
  AGENT_ACTIVATE: 'agent:activate',               // (workspaceId, agentId, options?) → AgentStatus
  AGENT_CONTINUE_REVIEW: 'agent:continueReview',  // (workspaceId, agentId, answers) → AgentStatus
  AGENT_CONTINUE_MCP_AUTH: 'agent:continueMcpAuth', // (workspaceId, agentId) → AgentStatus
  AGENT_CONTINUE_API_AUTH: 'agent:continueApiAuth', // (workspaceId, agentId) → AgentStatus
  AGENT_DEACTIVATE: 'agent:deactivate',           // (workspaceId, agentId) → void
  AGENT_RELOAD: 'agent:reload',                   // (workspaceId, agentId) → AgentStatus
  AGENT_RESET: 'agent:reset',                     // (workspaceId, agentId) → void
  AGENT_MARK_ACTIVE: 'agent:markActive',          // (workspaceId, agentId) → void

  // Events from main to renderer
  SESSION_EVENT: 'session:event',
  AGENT_STATUS_CHANGED: 'agent:statusChanged',    // Broadcast: { workspaceId, agentId, status } - complete state including needsSetup/needsAuth

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

  // Shell operations (open external URLs/files)
  OPEN_URL: 'shell:openUrl',
  OPEN_FILE: 'shell:openFile',
  SHOW_IN_FOLDER: 'shell:showInFolder',

  // Menu actions (main → renderer)
  MENU_NEW_CHAT: 'menu:newChat',
  MENU_NEW_CHAT_TAB: 'menu:newChatTab',
  MENU_OPEN_SETTINGS: 'menu:openSettings',
  MENU_KEYBOARD_SHORTCUTS: 'menu:keyboardShortcuts',
  MENU_OPEN_HELP: 'menu:openHelp',

  // Deep link navigation (main → renderer)
  DEEP_LINK_NAVIGATE: 'deeplink:navigate',

  // Auth
  LOGOUT: 'auth:logout',
  SHOW_LOGOUT_CONFIRMATION: 'auth:showLogoutConfirmation',
  SHOW_DELETE_SESSION_CONFIRMATION: 'auth:showDeleteSessionConfirmation',

  // Onboarding
  ONBOARDING_GET_AUTH_STATE: 'onboarding:getAuthState',
  ONBOARDING_START_CRAFT_OAUTH: 'onboarding:startCraftOAuth',
  ONBOARDING_GET_CRAFT_PROFILE: 'onboarding:getCraftProfile',
  ONBOARDING_GET_MCP_LINKS: 'onboarding:getMcpLinks',
  ONBOARDING_CREATE_MCP_LINK: 'onboarding:createMcpLink',
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

  // Settings - New Session Defaults
  SETTINGS_GET_DEFAULT_MODES: 'settings:getDefaultModes',
  SETTINGS_SET_DEFAULT_MODES: 'settings:setDefaultModes',
  SETTINGS_GET_DEFAULT_SKIP_PERMISSIONS: 'settings:getDefaultSkipPermissions',
  SETTINGS_SET_DEFAULT_SKIP_PERMISSIONS: 'settings:setDefaultSkipPermissions',
  SETTINGS_GET_DEFAULT_WORKING_DIR: 'settings:getDefaultWorkingDir',
  SETTINGS_SET_DEFAULT_WORKING_DIR: 'settings:setDefaultWorkingDir',

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

  // Connections
  CONNECTIONS_START_MCP_OAUTH: 'connections:startMcpOAuth',
  CONNECTIONS_START_GMAIL_OAUTH: 'connections:startGmailOAuth',
  CONNECTIONS_GET: 'connections:get',
  CONNECTIONS_SAVE: 'connections:save',
  CONNECTIONS_DELETE: 'connections:delete',

  // Session connections
  SESSION_SET_CONNECTIONS: 'sessions:setConnections',
  SESSION_GET_CONNECTIONS: 'sessions:getConnections',

  // Markdown preview window
  MARKDOWN_PREVIEW_OPEN: 'markdownPreview:open',
  MARKDOWN_PREVIEW_GET_DATA: 'markdownPreview:getData',
  MARKDOWN_PREVIEW_SAVE: 'markdownPreview:save',

  // Diff preview window
  DIFF_PREVIEW_OPEN: 'diffPreview:open',
  DIFF_PREVIEW_GET_DATA: 'diffPreview:getData',

  // Code preview window (Read/Write tools)
  CODE_PREVIEW_OPEN: 'codePreview:open',
  CODE_PREVIEW_GET_DATA: 'codePreview:getData',

  // Terminal preview window (Bash tools)
  TERMINAL_PREVIEW_OPEN: 'terminalPreview:open',
  TERMINAL_PREVIEW_GET_DATA: 'terminalPreview:getData',
} as const

/**
 * Data for diff preview window
 */
export interface DiffPreviewData {
  filePath: string
  original: string
  modified: string
  language?: string
}

/**
 * Data for code preview window (Read/Write tools)
 */
export interface CodePreviewData {
  filePath: string
  content: string
  language?: string
  /** 'read' for Read tool, 'write' for Write tool */
  mode: 'read' | 'write'
  /** File metadata from Read tool */
  numLines?: number
  startLine?: number
  totalLines?: number
}

/**
 * Data for terminal preview window (Bash/Grep/Glob tools)
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

// Re-import types for ElectronAPI
import type { Workspace, SessionMetadata, StoredAttachment as StoredAttachmentType } from '@craft-agent/core/types';
import type { SubAgentMetadata } from '@craft-agent/core/types';

// Type-safe IPC API exposed to renderer
export interface ElectronAPI {
  // Session management
  getSessions(): Promise<Session[]>
  createSession(workspaceId: string, agentId?: string, agentName?: string): Promise<Session>
  deleteSession(sessionId: string): Promise<void>
  renameSession(sessionId: string, name: string): Promise<void>
  sendMessage(sessionId: string, message: string, attachments?: FileAttachment[], storedAttachments?: StoredAttachmentType[], options?: SendMessageOptions): Promise<void>
  cancelProcessing(sessionId: string): Promise<void>
  flagSession(sessionId: string): Promise<void>
  unflagSession(sessionId: string): Promise<void>
  setTodoState(sessionId: string, state: TodoState): Promise<void>
  markSessionRead(sessionId: string): Promise<void>
  markSessionUnread(sessionId: string): Promise<void>
  respondToPermission(sessionId: string, requestId: string, allowed: boolean, alwaysAllow: boolean): Promise<boolean>
  setSkipPermissions(sessionId: string, enabled: boolean): Promise<void>
  updateSessionWorkingDirectory(sessionId: string, path: string): Promise<void>

  // Mode management (generic for any mode type)
  setMode(sessionId: string, mode: Mode, enabled: boolean): Promise<void>

  // Workspace management
  getWorkspaces(): Promise<Workspace[]>

  // Window management
  getWindowWorkspace(): Promise<string | null>
  getWindowMode(): Promise<string | null>
  openWorkspace(workspaceId: string): Promise<void>
  openAddWorkspaceWindow(): Promise<void>
  closeWindow(): Promise<void>

  // Agent management
  getAgents(workspaceId: string): Promise<SubAgentMetadata[]>
  refreshAgents(workspaceId: string): Promise<SubAgentMetadata[]>
  checkAgentAuth(workspaceId: string, agentId: string): Promise<{ needsAuth: boolean; reason?: string }>
  getAgentSetupStatus(workspaceId: string, agentId: string): Promise<AgentSetupStatus>
  getAgentAuthStatus(workspaceId: string, agentId: string): Promise<AgentAuthStatus>
  getAgentDefinition(workspaceId: string, agentId: string): Promise<SubAgentDefinition | null>
  reloadAgent(workspaceId: string, agentId: string): Promise<boolean>
  resetAgent(workspaceId: string, agentId: string): Promise<boolean>

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

  // Shell operations
  openUrl(url: string): Promise<void>
  openFile(path: string): Promise<void>
  showInFolder(path: string): Promise<void>

  // Menu event listeners
  onMenuNewChat(callback: () => void): () => void
  onMenuNewChatTab(callback: () => void): () => void
  onMenuOpenSettings(callback: () => void): () => void
  onMenuKeyboardShortcuts(callback: () => void): () => void
  onMenuOpenHelp(callback: () => void): () => void

  // Deep link navigation listener
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
  getMcpLinks(spaceId: string, authToken: string): Promise<CraftMcpLink[]>
  createMcpLink(spaceId: string, authToken: string): Promise<CraftMcpLink>
  startWorkspaceMcpOAuth(mcpUrl: string): Promise<OAuthResult & { accessToken?: string; clientId?: string }>
  saveOnboardingConfig(config: {
    authType?: AuthType  // Optional - if not provided, preserves existing auth type (for add workspace)
    workspace?: { name: string; mcpUrl: string; iconUrl?: string }  // Optional - if not provided, only updates billing
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

  // Settings - New Session Defaults
  getDefaultModes(): Promise<Mode[]>
  setDefaultModes(modes: Mode[]): Promise<void>
  getDefaultSkipPermissions(): Promise<boolean>
  setDefaultSkipPermissions(enabled: boolean): Promise<void>
  getDefaultWorkingDirectory(): Promise<string>
  setDefaultWorkingDirectory(path: string): Promise<void>

  // Folder dialog
  openFolderDialog(): Promise<string | null>

  // User Preferences
  readPreferences(): Promise<{ content: string; exists: boolean }>
  writePreferences(content: string): Promise<{ success: boolean; error?: string }>

  // Markdown preview window
  openMarkdownPreview(previewId: string, data: MarkdownPreviewData): Promise<void>
  getMarkdownPreviewData(previewId: string): Promise<{ data: MarkdownPreviewData; content: string } | null>
  saveMarkdownPreview(previewId: string, content: string): Promise<void>

  // Diff preview window
  openDiffPreview(sessionId: string, diffId: string, data: DiffPreviewData): Promise<void>
  getDiffPreviewData(sessionId: string, diffId: string): Promise<DiffPreviewData | null>

  // Code preview window (Read/Write tools)
  openCodePreview(sessionId: string, previewId: string, data: CodePreviewData): Promise<void>
  getCodePreviewData(sessionId: string, previewId: string): Promise<CodePreviewData | null>

  // Terminal preview window (Bash tools)
  openTerminalPreview(sessionId: string, previewId: string, data: TerminalPreviewData): Promise<void>
  getTerminalPreviewData(sessionId: string, previewId: string): Promise<TerminalPreviewData | null>

  // Session Drafts (persisted input text)
  getDraft(sessionId: string): Promise<string | null>
  setDraft(sessionId: string, text: string): Promise<void>
  deleteDraft(sessionId: string): Promise<void>
  getAllDrafts(): Promise<Record<string, string>>

  // Connections
  startConnectionMcpOAuth(config: {
    name: string
    url: string
    clientId?: string
    clientSecret?: string
  }): Promise<{ success: boolean; error?: string; accessToken?: string; refreshToken?: string; expiresAt?: number; clientId?: string }>
  startGmailOAuth(): Promise<{ success: boolean; error?: string; accessToken?: string; refreshToken?: string; expiresAt?: number; email?: string }>
  getConnections(): Promise<ConnectionConfig[]>
  saveConnection(connection: ConnectionConfig): Promise<void>
  deleteConnection(connectionId: string): Promise<void>

  // Session connections
  setSessionConnections(sessionId: string, connectionIds: string[]): Promise<void>
  getSessionConnections(sessionId: string): Promise<string[]>
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
 * Navigation payload for deep links (main → renderer)
 */
export interface DeepLinkNavigation {
  tabType?: string
  tabParams?: Record<string, string>
  action?: string
  actionParams?: Record<string, string>
}

// ============================================
// Connection Types
// ============================================

// Note: ConnectionType and ConnectionConfig are re-exported from @craft-agent/shared/config above

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
