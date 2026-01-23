/**
 * WhatsApp Integration Types
 *
 * Core types for WhatsApp message handling, session management,
 * and credential storage within Vespr's credential system.
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
