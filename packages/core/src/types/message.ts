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
  | 'system'
  | 'info'
  | 'warning';

/**
 * Tool execution status
 */
export type ToolStatus = 'pending' | 'executing' | 'completed' | 'error';

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
 * Stored attachment metadata (persisted to disk, no base64)
 * Created when user sends a message with attachments
 */
export interface StoredAttachment {
  id: string;                    // UUID for uniqueness
  type: AttachmentType;
  name: string;                  // Original filename
  mimeType: string;
  size: number;
  storedPath: string;            // Full path to copied file on disk
  thumbnailPath?: string;        // Path to OS-generated thumbnail (images/PDFs/Office)
  thumbnailBase64?: string;      // Base64-encoded thumbnail PNG (for renderer display)
  markdownPath?: string;         // For Office files: converted markdown for Claude
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
  // Parent tool ID for nested tool calls (e.g., child tools inside Task subagent)
  parentToolUseId?: string;
  // Stored attachments for user messages (persistent, no base64)
  attachments?: StoredAttachment[];
  isError?: boolean;
  isStreaming?: boolean;
  // Pending: streaming text where we don't yet know if it's intermediate
  // Set to true when text_delta creates message, false when text_complete arrives
  isPending?: boolean;
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
  // Parent tool ID for nested tool calls (persisted for session restore)
  parentToolUseId?: string;
  isError?: boolean;
  /** Stored attachments for user messages (persisted to disk) */
  attachments?: StoredAttachment[];
  // Turn grouping - critical for TurnCard rendering after reload
  isIntermediate?: boolean;
  turnId?: string;
  // Error display fields
  errorCode?: string;
  errorTitle?: string;
  errorDetails?: string[];
  errorOriginal?: string;
  errorCanRetry?: boolean;
  // Ultrathink mode - indicates this user message was sent with extended thinking
  ultrathink?: boolean;
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
  /** Slash command to execute (e.g., '/credits') */
  command?: string;
  /** Custom action type for special handling */
  action?: 'retry' | 'settings' | 'credits' | 'reauth';
}

/**
 * Error codes for typed errors - must match AgentError.code in shared/agent/errors.ts
 */
export type ErrorCode =
  | 'insufficient_credits'
  | 'credits_exhausted'
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
  /** Diagnostic check results for debugging (e.g., "✓ Credits: 150") */
  details?: string[];
  /** Original error message for debugging */
  originalError?: string;
}

/**
 * Question for AskUserQuestion tool
 */
export interface Question {
  question: string;
  header: string;
  options: Array<{
    label: string;
    description: string;
  }>;
  multiSelect: boolean;
}

/**
 * Permission request from agent (e.g., bash command approval)
 */
export interface PermissionRequest {
  requestId: string;
  toolName: string;
  command: string;
  description: string;
  type?: 'bash' | 'plan_mode';  // Type of permission request
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
}

/**
 * Events emitted by CraftAgent during chat
 * turnId: Correlation ID from the API's message.id, groups all events in an assistant turn
 */
export type AgentEvent =
  | { type: 'status'; message: string }
  | { type: 'info'; message: string }
  | { type: 'text_delta'; text: string; turnId?: string }
  | { type: 'text_complete'; text: string; isIntermediate?: boolean; turnId?: string }
  | { type: 'tool_start'; toolName: string; toolUseId: string; input: Record<string, unknown>; intent?: string; turnId?: string; parentToolUseId?: string }
  | { type: 'tool_result'; toolUseId: string; result: string; isError: boolean; input?: Record<string, unknown>; turnId?: string; parentToolUseId?: string }
  | { type: 'permission_request'; requestId: string; toolName: string; command: string; description: string }
  | { type: 'ask_user'; requestId: string; questions: Question[] }
  | { type: 'error'; message: string }
  | { type: 'typed_error'; error: TypedError }
  | { type: 'complete'; usage?: AgentEventUsage };

/**
 * Generate a unique message ID
 */
export function generateMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
