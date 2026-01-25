/**
 * WhatsApp Integration Types
 *
 * Core types for WhatsApp message handling, session management,
 * and credential storage within Vesper's credential system.
 */

/**
 * Represents a WhatsApp message received from a group or direct chat.
 *
 * All fields are immutable once created. Timestamps in milliseconds since epoch.
 */
export interface WhatsAppMessage {
  /** Unique message identifier (from Baileys) */
  id: string;

  /** Group JID (e.g., "123456789-123456789@g.us") */
  groupJid: string;

  /** Human-readable group name (e.g., "Team Discussion") */
  groupName: string;

  /** Sender's user JID (e.g., "1234567890@s.whatsapp.net") */
  senderJid: string;

  /** Sender's phone number in E.164 format (e.g., "+1234567890") */
  senderPhoneNumber: string;

  /** Sender's display name or nickname in the group */
  senderName: string;

  /** Message text content */
  content: string;

  /** Timestamp when message was received (milliseconds since epoch) */
  timestamp: number;

  /** Optional: List of attachments (images, documents, etc.) */
  attachments?: WhatsAppAttachment[];
}

/**
 * Represents an attachment within a WhatsApp message.
 *
 * Phase 1 MVP supports file metadata only. Actual file download/parsing deferred.
 */
export interface WhatsAppAttachment {
  /** File name with extension (e.g., "document.pdf") */
  fileName: string;

  /** MIME type (e.g., "application/pdf", "image/jpeg") */
  mimeType: string;

  /** File size in bytes */
  sizeBytes: number;

  /** Optional: URL for downloading the attachment (if available) */
  downloadUrl?: string;
}

/**
 * Represents stored WhatsApp session state (encrypted in credentials.enc).
 *
 * Contains full Baileys session data for persistence and reconnection.
 * Encryption: AES-256-GCM (managed by CredentialManager)
 */
export interface WhatsAppSession {
  /** User's JID as provided by Baileys */
  jid: string;

  /** Push name (display name) from Baileys */
  pushName: string;

  /** Full Baileys session state (opaque from storage perspective) */
  sessionData: unknown;

  /** Timestamp when session was created (milliseconds since epoch) */
  createdAt: number;

  /** Timestamp when user last connected (milliseconds since epoch) */
  connectedAt: number;

  /** Whether session has expired and needs re-authentication */
  isExpired: boolean;
}

/**
 * Composite key for identifying a unique WhatsApp conversation context.
 *
 * Used by session mapper to create deterministic session IDs.
 * Same sender + same group = same sessionId (context preserved)
 * Same sender + different group = different sessionId (isolation)
 */
export interface WhatsAppSessionId {
  /** Group JID where the message originated */
  groupJid: string;

  /** Sender's JID (initiates the conversation) */
  senderJid: string;
}

/**
 * Formatted result ready for delivery back to WhatsApp.
 *
 * Respects WhatsApp's 4096 character limit per message.
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
 * WhatsApp connection status from Baileys.
 */
export interface WhatsAppConnectionStatus {
  /** Connection state: 'close' | 'connecting' | 'open' */
  connection: 'close' | 'connecting' | 'open';

  /** QR code string when connection needs authentication */
  qr?: string;

  /** True if this is a new login (not restored from saved session) */
  isNewLogin?: boolean;

  /** Last disconnect reason (if applicable) */
  lastDisconnect?: {
    error?: Error;
    date?: Date;
  };
}

/**
 * WhatsApp error event.
 */
export interface WhatsAppError {
  /** Human-readable error message */
  message: string;

  /** Timestamp when error occurred (milliseconds since epoch) */
  timestamp: number;

  /** Optional error code for categorization */
  code?: WhatsAppErrorCode;

  /** Optional: original error for debugging (not exposed to users) */
  originalError?: unknown;
}

/**
 * Error codes for categorizing WhatsApp errors.
 * Used to generate user-friendly error messages.
 */
export type WhatsAppErrorCode =
  | 'PERMISSION_DENIED'      // Tool blocked in safe mode
  | 'AGENT_ERROR'            // Agent processing failed
  | 'TIMEOUT'                // Agent took too long
  | 'SESSION_CREATE_FAILED'  // Could not create session
  | 'ROUTING_ERROR'          // Message routing failed
  | 'DELIVERY_ERROR'         // Could not send message to WhatsApp
  | 'INTERNAL_ERROR';        // Generic internal error

/**
 * User-friendly error message templates.
 * Maps error codes to human-readable messages (no stack traces).
 */
export const ERROR_MESSAGES: Record<WhatsAppErrorCode, string> = {
  PERMISSION_DENIED:
    'This action requires elevated permissions. Use /ask or /allow-all directive to enable write operations.',
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
