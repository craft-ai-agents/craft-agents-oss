/**
 * Message types for conversations
 */

/**
 * Message roles for display (runtime)
 */
export type MessageRole =
  | 'user'
  | 'assistant'
  | 'tool'
  | 'error'
  | 'status'
  | 'info'
  | 'warning'
  | 'plan'
  | 'auth-request';

/**
 * Credential input modes for different auth types
 */
export type CredentialInputMode =
  | 'bearer'      // Single token field (Bearer Token, API Key)
  | 'basic'       // Username + Password fields
  | 'header'      // API Key with custom header name
  | 'query';      // API Key for query parameter

/**
 * Auth request types
 */
export type AuthRequestType =
  | 'credential'
  | 'oauth'
  | 'oauth-google'
  | 'oauth-slack'
  | 'oauth-microsoft';

/**
 * Auth request status
 */
export type AuthStatus = 'pending' | 'completed' | 'cancelled' | 'failed';

/**
 * Tool execution status
 */
export type ToolStatus = 'pending' | 'executing' | 'completed' | 'error' | 'backgrounded';

/**
 * Tool display metadata - embedded at storage time for viewer compatibility
 * Icons are base64-encoded to work in both Electron and web viewer
 */
export interface ToolDisplayMeta {
  /** Display name for the tool (e.g., "Commit", "Linear") */
  displayName: string;
  /** Base64-encoded icon as data URL (e.g., "data:image/png;base64,...") - 32x32px */
  iconDataUrl?: string;
  /** Description of what this tool does */
  description?: string;
  /** Category for grouping/styling */
  category?: 'skill' | 'source' | 'native' | 'mcp';
}

/**
 * Attachment type categories
 */
export type AttachmentType = 'image' | 'text' | 'pdf' | 'office' | 'unknown';

/**
 * Attachment preview for display in user messages (runtime, before storage)
 */
export interface MessageAttachment {
  type: AttachmentType;
  name: string;
  mimeType: string;
  size: number;
  base64?: string;  // For images - enables thumbnail rendering
}

/**
 * Content badge for inline display in user messages
 * Badges are self-contained with all display data (label, icon)
 */
export interface ContentBadge {
  /** Badge type - used for fallback icon if iconBase64 not available */
  type: 'source' | 'skill' | 'context' | 'command' | 'file' | 'folder';
  /** Display label (e.g., "Linear", "Commit") */
  label: string;
  /** Original text pattern (e.g., "@linear", "@commit") */
  rawText: string;
  /** Icon as data URL (e.g., "data:image/png;base64,...") - preserves mime type */
  iconDataUrl?: string;
  /** Start position in content string */
  start: number;
  /** End position in content string */
  end: number;
  /**
   * Collapsed label for context badges (e.g., "Edit: Permissions")
   * When set, the badge replaces the entire marked range with this label
   * and hides the original content
   */
  collapsedLabel?: string;
  /**
   * File path for file badges - stores the full path for click handler
   * Used when the badge represents a clickable file reference
   */
  filePath?: string;
}

/**
 * Stored attachment metadata (persisted to disk, no base64)
 * Created when user sends a message with attachments
 */
export interface StoredAttachment {
  id: string;                    // Unique identifier
  type: AttachmentType;
  name: string;                  // Original filename
  mimeType: string;
  size: number;                  // Final size (after any resize)
  originalSize?: number;         // Original size before resize (if applicable)
  storedPath: string;            // Full path to copied file on disk
  thumbnailPath?: string;        // Path to OS-generated thumbnail (images/PDFs/Office)
  thumbnailBase64?: string;      // Base64-encoded thumbnail PNG (for renderer display)
  markdownPath?: string;         // For Office files: converted markdown for Claude
  wasResized?: boolean;          // True if image was auto-resized for Claude API limits
  resizedBase64?: string;        // Base64 of resized image (only when wasResized=true, for Claude API)
}

/**
 * Runtime message type (includes transient fields like isStreaming)
 */
export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  // Tool-specific fields
  toolName?: string;
  toolUseId?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: string;
  toolStatus?: ToolStatus;
  toolDuration?: number;
  toolIntent?: string;
  toolDisplayName?: string;
  /** Tool display metadata with base64 icon - embedded at storage time for viewer */
  toolDisplayMeta?: ToolDisplayMeta;
  // Parent tool ID for nested tool calls (e.g., child tools inside Task subagent)
  parentToolUseId?: string;
  // Background task fields
  taskId?: string;          // For Task with run_in_background
  shellId?: string;         // For Bash with run_in_background
  elapsedSeconds?: number;  // Live progress updates
  isBackground?: boolean;   // Flag for UI differentiation
  // Stored attachments for user messages (persistent, no base64)
  attachments?: StoredAttachment[];
  // Content badges for inline display (sources, skills)
  badges?: ContentBadge[];
  isError?: boolean;
  isStreaming?: boolean;
  // Pending: streaming text where we don't yet know if it's intermediate
  // Set to true when text_delta creates message, false when text_complete arrives
  // Also used for optimistic user messages before backend confirmation
  isPending?: boolean;
  // Queued: user message that is waiting to be processed (sent during ongoing response)
  isQueued?: boolean;
  // Intermediate text (commentary between tool calls, not final response)
  isIntermediate?: boolean;
  // Turn ID: Correlation ID from the API's message.id, groups all messages in an assistant turn
  turnId?: string;
  // Status type for special status messages (e.g., compacting)
  statusType?: 'compacting' | 'compaction_complete';
  // Info level for info messages (determines icon/color)
  infoLevel?: 'info' | 'warning' | 'error' | 'success';
  // Error-specific fields (for typed errors with diagnostics)
  errorCode?: string;
  errorTitle?: string;
  errorDetails?: string[];
  errorOriginal?: string;
  errorCanRetry?: boolean;
  // Ultrathink mode - indicates this user message was sent with extended thinking
  ultrathink?: boolean;
  // Plan-specific fields (for role='plan')
  planPath?: string;  // Path to the plan markdown file
  // Auth-request-specific fields (for role='auth-request')
  authRequestId?: string;         // Unique ID for the auth request
  authRequestType?: AuthRequestType;
  authSourceSlug?: string;
  authSourceName?: string;
  authStatus?: AuthStatus;
  authCredentialMode?: CredentialInputMode;  // For credential requests
  authHeaderName?: string;        // For header auth - the header name
  authLabels?: {                  // Custom field labels
    credential?: string;
    username?: string;
    password?: string;
  };
  authDescription?: string;       // Description/instructions
  authHint?: string;              // Hint about where to find credentials
  authSourceUrl?: string;         // Source URL for password manager domain matching (1Password)
  authPasswordRequired?: boolean; // For basic auth: whether password is required (default true)
  authError?: string;             // Error message if auth failed
  authEmail?: string;             // Authenticated email (for OAuth)
  authWorkspace?: string;         // Authenticated workspace (for Slack)
}

/**
 * Stored message format (persistence)
 * Excludes only transient fields (isStreaming)
 */
export interface StoredMessage {
  id: string;
  type: MessageRole;
  content: string;
  timestamp?: number;
  // Tool-specific fields
  toolName?: string;
  toolUseId?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: string;
  toolStatus?: ToolStatus;
  toolDuration?: number;
  toolIntent?: string;
  toolDisplayName?: string;
  /** Tool display metadata with base64 icon - embedded at storage time for viewer */
  toolDisplayMeta?: ToolDisplayMeta;
  // Parent tool ID for nested tool calls (persisted for session restore)
  parentToolUseId?: string;
  // Background task fields (persisted)
  taskId?: string;
  shellId?: string;
  elapsedSeconds?: number;
  isBackground?: boolean;
  isError?: boolean;
  /** Stored attachments for user messages (persisted to disk) */
  attachments?: StoredAttachment[];
  /** Content badges for inline display (sources, skills) */
  badges?: ContentBadge[];
  // Turn grouping - critical for TurnCard rendering after reload
  isIntermediate?: boolean;
  turnId?: string;
  // Status type for compaction messages (persisted for reload)
  statusType?: 'compacting' | 'compaction_complete';
  // Error display fields
  errorCode?: string;
  errorTitle?: string;
  errorDetails?: string[];
  errorOriginal?: string;
  errorCanRetry?: boolean;
  // Ultrathink mode - indicates this user message was sent with extended thinking
  ultrathink?: boolean;
  // Plan-specific fields (for role='plan')
  planPath?: string;
  // Auth-request-specific fields (for role='auth-request')
  authRequestId?: string;
  authRequestType?: AuthRequestType;
  authSourceSlug?: string;
  authSourceName?: string;
  authStatus?: AuthStatus;
  authCredentialMode?: CredentialInputMode;
  authHeaderName?: string;
  authLabels?: {
    credential?: string;
    username?: string;
    password?: string;
  };
  authDescription?: string;
  authHint?: string;
  authSourceUrl?: string;
  authPasswordRequired?: boolean;
  authError?: string;
  authEmail?: string;
  authWorkspace?: string;
}

/**
 * Token usage tracking
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextTokens: number;
  costUsd: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

/**
 * Recovery action for typed errors
 */
export interface RecoveryAction {
  /** Keyboard shortcut (single letter) */
  key: string;
  /** Description of the action */
  label: string;
  /** Slash command to execute (e.g., '/settings') */
  command?: string;
  /** Custom action type for special handling */
  action?: 'retry' | 'settings' | 'reauth';
}

/**
 * Error codes for typed errors - must match AgentError.code in shared/agent/errors.ts
 */
export type ErrorCode =
  | 'invalid_api_key'
  | 'invalid_credentials'
  | 'expired_oauth_token'
  | 'token_expired'
  | 'rate_limited'
  | 'service_error'
  | 'service_unavailable'
  | 'network_error'
  | 'mcp_auth_required'
  | 'mcp_unreachable'
  | 'billing_error'
  | 'model_no_tool_support'  // Model doesn't support tool/function calling
  | 'invalid_model'          // Model ID not found
  | 'data_policy_error'      // OpenRouter data policy restriction
  | 'invalid_request'        // API rejected the request (e.g., bad image, invalid content)
  | 'unknown_error';

/**
 * Typed error from agent
 */
export interface TypedError {
  /** Error code for programmatic handling */
  code: ErrorCode;
  /** User-friendly title */
  title: string;
  /** Detailed message explaining what went wrong */
  message: string;
  /** Suggested recovery actions */
  actions: RecoveryAction[];
  /** Whether auto-retry is possible */
  canRetry: boolean;
  /** Retry delay in ms (if canRetry is true) */
  retryDelayMs?: number;
  /** Diagnostic check results for debugging */
  details?: string[];
  /** Original error message for debugging */
  originalError?: string;
}

/**
 * Permission request from agent (e.g., bash command approval)
 */
export interface PermissionRequest {
  requestId: string;
  toolName: string;
  command: string;
  description: string;
  type?: 'bash';  // Type of permission request
}

/**
 * Usage data emitted by CraftAgent in 'complete' events
 * Note: This is a subset of TokenUsage - totalTokens/contextTokens are computed by consumers
 */
export interface AgentEventUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  costUsd?: number;
  /** Model's context window size in tokens (from SDK modelUsage) */
  contextWindow?: number;
}

/**
 * Events emitted by CraftAgent during chat
 * turnId: Correlation ID from the API's message.id, groups all events in an assistant turn
 */
export type AgentEvent =
  | { type: 'status'; message: string }
  | { type: 'info'; message: string }
  | { type: 'text_delta'; text: string; turnId?: string; parentToolUseId?: string }
  | { type: 'text_complete'; text: string; isIntermediate?: boolean; turnId?: string; parentToolUseId?: string }
  | { type: 'tool_start'; toolName: string; toolUseId: string; input: Record<string, unknown>; intent?: string; displayName?: string; turnId?: string; parentToolUseId?: string; toolDisplayMeta?: ToolDisplayMeta }
  | { type: 'tool_result'; toolUseId: string; toolName?: string; result: string; isError: boolean; input?: Record<string, unknown>; turnId?: string; parentToolUseId?: string }
  | { type: 'permission_request'; requestId: string; toolName: string; command: string; description: string }
  | { type: 'error'; message: string }
  | { type: 'typed_error'; error: TypedError }
  | { type: 'complete'; usage?: AgentEventUsage }
  | { type: 'working_directory_changed'; workingDirectory: string }
  | { type: 'task_backgrounded'; toolUseId: string; taskId: string; intent?: string; turnId?: string }
  | { type: 'shell_backgrounded'; toolUseId: string; shellId: string; intent?: string; command?: string; turnId?: string }
  | { type: 'task_progress'; toolUseId: string; elapsedSeconds: number; turnId?: string }
  | { type: 'shell_killed'; shellId: string; turnId?: string }
  | { type: 'source_activated'; sourceSlug: string; originalMessage: string }
  | { type: 'usage_update'; usage: Pick<AgentEventUsage, 'inputTokens' | 'contextWindow'> };

/**
 * Generate a unique message ID
 */
export function generateMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
