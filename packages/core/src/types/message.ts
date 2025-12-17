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
  // Stored attachments for user messages (persistent, no base64)
  attachments?: StoredAttachment[];
  isError?: boolean;
  isStreaming?: boolean;
}

/**
 * Stored message format (persistence)
 * Excludes transient fields like isStreaming
 * Note: For tool messages, the result is stored in `content` (not duplicated in toolResult)
 */
export interface StoredMessage {
  id: string;
  type: MessageRole;
  content: string;
  timestamp?: number;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolStatus?: ToolStatus;
  toolDuration?: number;
  isError?: boolean;
  /** Stored attachments for user messages (persisted to disk) */
  attachments?: StoredAttachment[];
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
 * Typed error from agent
 */
export interface TypedError {
  code: string;
  title: string;
  message: string;
  canRetry: boolean;
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
 * Events emitted by CraftAgent during chat
 */
export type AgentEvent =
  | { type: 'status'; message: string }
  | { type: 'text_delta'; text: string }
  | { type: 'text_complete'; text: string }
  | { type: 'tool_start'; toolName: string; toolUseId: string; input: Record<string, unknown>; intent?: string }
  | { type: 'tool_result'; toolUseId: string; result: string; isError: boolean; input?: Record<string, unknown> }
  | { type: 'permission_request'; requestId: string; toolName: string; command: string; description: string }
  | { type: 'ask_user'; requestId: string; questions: Question[] }
  | { type: 'error'; message: string }
  | { type: 'typed_error'; error: TypedError }
  | { type: 'complete'; usage?: TokenUsage };

/**
 * Generate a unique message ID
 */
export function generateMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
