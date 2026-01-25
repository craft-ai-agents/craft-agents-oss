/**
 * Telegram Integration Types
 *
 * Core types for Telegram message handling, session management,
 * and credential storage within Vesper's credential system.
 */

/**
 * Represents a Telegram message received from a group, supergroup, or direct chat.
 *
 * All fields are immutable once created. Timestamps in seconds since epoch.
 */
export interface TelegramMessage {
  /** Unique message identifier (from Telegram) */
  id: number;

  /** Chat ID (group, supergroup, or private chat) */
  chatId: number;

  /** Human-readable chat title (empty for private chats) */
  chatTitle: string;

  /** Chat type: 'group', 'supergroup', or 'private' */
  chatType: 'group' | 'supergroup' | 'private';

  /** Sender's user ID */
  userId: number;

  /** Sender's username (may be empty) */
  username: string;

  /** Sender's first name */
  firstName: string;

  /** Message text content */
  content: string;

  /** Timestamp when message was sent (seconds since epoch) */
  timestamp: number;

  /** Optional: List of attachments (images, documents, etc.) */
  attachments?: TelegramAttachment[];
}

/**
 * Represents an attachment within a Telegram message.
 *
 * Phase 1 MVP supports file metadata only. Actual file download/parsing deferred.
 */
export interface TelegramAttachment {
  /** File name with extension (e.g., "document.pdf") */
  fileName: string;

  /** MIME type (e.g., "application/pdf", "image/jpeg") */
  mimeType: string;

  /** File size in bytes */
  sizeBytes: number;

  /** Optional: File ID for downloading the attachment (from Telegram) */
  fileId?: string;
}

/**
 * Composite key for identifying a unique Telegram conversation context.
 *
 * Used by session mapper to create deterministic session IDs.
 * Same sender + same chat = same sessionId (context preserved)
 * Same sender + different chat = different sessionId (isolation)
 */
export interface TelegramSessionId {
  /** Chat ID where the message originated */
  chatId: number;

  /** Sender's user ID (initiates the conversation) */
  userId: number;
}

/**
 * Formatted result ready for delivery back to Telegram.
 *
 * Respects Telegram's 4096 character limit per message.
 * If result exceeds limit, provides summary + deep link to desktop app.
 */
export interface FormattedResult {
  /** Array of message chunks (each ≤ 4096 chars) */
  messages: string[];

  /** One-line summary for display in chat */
  summary: string;

  /** Full markdown result (for reference/storage) */
  fullMarkdown: string;

  /** True if result was truncated across multiple messages */
  truncated: boolean;
}

/**
 * Telegram connection status.
 */
export interface TelegramConnectionStatus {
  /** True if bot is connected and polling */
  isConnected: boolean;

  /** True if connection is in progress */
  isConnecting: boolean;

  /** Bot username (if connected) */
  botUsername?: string;

  /** Bot user ID (if connected) */
  botId?: number;

  /** Last disconnect reason (if applicable) */
  lastDisconnect?: {
    error?: Error;
    date?: Date;
  };
}

/**
 * Telegram error event.
 */
export interface TelegramError {
  /** Human-readable error message */
  message: string;

  /** Timestamp when error occurred (milliseconds since epoch) */
  timestamp: number;

  /** Optional error code for categorization */
  code?: TelegramErrorCode;

  /** Optional: original error for debugging (not exposed to users) */
  originalError?: unknown;
}

/**
 * Error codes for categorizing Telegram errors.
 * Used to generate user-friendly error messages.
 */
export type TelegramErrorCode =
  | 'PERMISSION_DENIED'      // Tool blocked in safe mode
  | 'AGENT_ERROR'            // Agent processing failed
  | 'TIMEOUT'                // Agent took too long
  | 'SESSION_CREATE_FAILED'  // Could not create session
  | 'ROUTING_ERROR'          // Message routing failed
  | 'DELIVERY_ERROR'         // Could not send message to Telegram
  | 'INTERNAL_ERROR';        // Generic internal error

/**
 * User-friendly error message templates.
 * Maps error codes to human-readable messages (no stack traces).
 */
export const ERROR_MESSAGES: Record<TelegramErrorCode, string> = {
  PERMISSION_DENIED:
    'This action requires elevated permissions. Use /ask or /allow_all directive to enable write operations.',
  AGENT_ERROR:
    'I encountered an issue while processing your request. Please try again or rephrase your question.',
  TIMEOUT:
    'Your request took too long to process. Try a simpler query or break it into smaller parts.',
  SESSION_CREATE_FAILED:
    'Could not start a new conversation. Please try again in a moment.',
  ROUTING_ERROR:
    'Failed to process your message. Please try again.',
  DELIVERY_ERROR:
    'Could not send the response. Please check your connection and try again.',
  INTERNAL_ERROR:
    'Something went wrong on our end. Please try again later.',
};
