/**
 * WhatsApp Integration Module
 *
 * Provides message routing, session management, and result formatting
 * for WhatsApp Web integration via Baileys.
 */

// Types
export type {
  WhatsAppMessage,
  WhatsAppAttachment,
  WhatsAppSession,
  WhatsAppSessionId,
  FormattedResult,
} from './types'

// Connection status type (not in types.ts - define here)
export interface WhatsAppConnectionStatus {
  connection: 'qr' | 'open' | 'close'
  qr?: string
  isNewLogin?: boolean
  shouldReconnect?: boolean
  statusCode?: number
}

// Error type
export interface WhatsAppError {
  message: string
  timestamp: number
}

// Message routing
export { WhatsAppMessageRouter, createMessageRouter } from './message-router'

// Session mapping
export { SessionMapper, getSessionId } from './session-mapper'

// Message queue
export { WhatsAppMessageQueue } from './message-queue'

// Result formatting
export { formatResult, chunkForWhatsApp, estimateWhatsAppSize } from './result-formatter'

// Directive parsing
export type { PermissionDirective } from './directive-parser'
export { extractDirective, hasDirective, getDirective } from './directive-parser'
