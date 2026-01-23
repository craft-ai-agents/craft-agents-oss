import type { WhatsAppMessage, WhatsAppErrorCode } from './types'
// Note: ERROR_MESSAGES is exported from types.ts but we define our own USER_ERROR_MESSAGES
// to keep the router self-contained and easily testable
import { getSessionId } from './session-mapper'
import { extractDirective, type PermissionDirective } from './directive-parser'
import type { AgentEvent } from '@craft-agent/core/types'

// SessionManager type from main process IPC bridge
// TODO: Move to shared types once IPC types are formalized
type SessionManager = Record<string, any>

/**
 * Default timeout for agent processing (5 minutes)
 */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000

/**
 * Callback for sending error feedback back to WhatsApp.
 * Implemented by WhatsAppService to send messages via the worker.
 */
export type ErrorFeedbackCallback = (groupJid: string, errorMessage: string) => Promise<void>

/**
 * Error thrown during message routing with categorized error code.
 */
export class WhatsAppRoutingError extends Error {
  constructor(
    message: string,
    public readonly code: WhatsAppErrorCode,
    public readonly originalError?: unknown,
  ) {
    super(message)
    this.name = 'WhatsAppRoutingError'
  }
}

/**
 * User-friendly error message templates.
 * Maps error codes to human-readable messages (no stack traces).
 */
const USER_ERROR_MESSAGES: Record<WhatsAppErrorCode, string> = {
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
}

/**
 * Get user-friendly error message for an error code.
 * Never exposes internal details or stack traces.
 */
export function getUserFriendlyErrorMessage(code: WhatsAppErrorCode): string {
  return USER_ERROR_MESSAGES[code] || USER_ERROR_MESSAGES.INTERNAL_ERROR
}

/**
 * Categorize an error into a WhatsAppErrorCode.
 * Used to determine appropriate user-facing message.
 */
export function categorizeError(error: unknown): WhatsAppErrorCode {
  if (error instanceof WhatsAppRoutingError) {
    return error.code
  }

  const errorMessage = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()

  // Permission denied patterns
  if (
    errorMessage.includes('permission denied') ||
    errorMessage.includes('blocked') ||
    errorMessage.includes('safe mode') ||
    errorMessage.includes('not allowed')
  ) {
    return 'PERMISSION_DENIED'
  }

  // Timeout patterns
  if (
    errorMessage.includes('timeout') ||
    errorMessage.includes('timed out') ||
    errorMessage.includes('took too long')
  ) {
    return 'TIMEOUT'
  }

  // Session creation patterns
  if (
    errorMessage.includes('session') &&
    (errorMessage.includes('create') || errorMessage.includes('failed'))
  ) {
    return 'SESSION_CREATE_FAILED'
  }

  // Agent processing patterns
  if (
    errorMessage.includes('agent') ||
    errorMessage.includes('processing') ||
    errorMessage.includes('claude')
  ) {
    return 'AGENT_ERROR'
  }

  // Default to internal error
  return 'INTERNAL_ERROR'

}

/**
 * Format an error for user display in WhatsApp.
 * Adds emoji prefix and keeps message concise.
 */
export function formatErrorForWhatsApp(code: WhatsAppErrorCode): string {
  const message = getUserFriendlyErrorMessage(code)
  return `Sorry, ${message}`
}

/**
 * Result from session completion monitoring
 */
export interface SessionCompletionResult {
  /** Session ID that completed */
  sessionId: string
  /** Original WhatsApp message ID */
  messageId: string
  /** WhatsApp group JID to deliver the response to */
  groupJid: string
  /** Agent's final response text (concatenated from all text_complete events) */
  responseText: string
  /** Whether the session timed out */
  timedOut: boolean
  /** Whether there was an error */
  hasError: boolean
  /** Error message if hasError is true */
  errorMessage?: string
}

/**
 * Callback type for session completion notifications
 */
export type SessionCompleteCallback = (result: SessionCompletionResult) => void

/**
 * Tracks a pending WhatsApp message being processed
 */
interface PendingMessage {
  /** Original WhatsApp message */
  message: WhatsAppMessage
  /** Session ID handling this message */
  sessionId: string
  /** When processing started (timestamp) */
  startedAt: number
  /** Timeout handle for cleanup */
  timeoutHandle: ReturnType<typeof setTimeout>
  /** Accumulated response text from agent */
  responseText: string
  /** Whether an error occurred */
  hasError: boolean
  /** Error message if error occurred */
  errorMessage?: string
  /** Resolve function for the completion promise */
  resolve: (result: SessionCompletionResult) => void
}

export class WhatsAppMessageRouter {
  /**
   * Map of WhatsApp message ID → pending message tracking
   * Used to correlate session events back to original WhatsApp messages
   */
  private pendingMessages = new Map<string, PendingMessage>()

  /**
   * Map of session ID → WhatsApp message ID
   * Reverse lookup for handling session events
   */
  private sessionToMessageId = new Map<string, string>()

  /**
   * Callbacks to notify when a session completes
   */
  private completionCallbacks: SessionCompleteCallback[] = []

  /**
   * Callback for sending error feedback to WhatsApp users
   */
  private errorFeedbackCallback: ErrorFeedbackCallback | null = null

  /**
   * Timeout duration for agent processing (default 5 minutes)
   */
  private timeoutMs: number

  constructor(
    private workspaceId: string,
    private sessionManager: SessionManager,
    options?: { timeoutMs?: number }
  ) {
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  /**
   * Set the callback for sending error feedback to WhatsApp users.
   * This should be called by WhatsAppService after creating the router.
   */
  setErrorFeedbackCallback(callback: ErrorFeedbackCallback): void {
    this.errorFeedbackCallback = callback
  }

  /**
   * Register a callback to be notified when sessions complete
   * @param callback Function to call when a session completes processing
   * @returns Unsubscribe function
   */
  onSessionComplete(callback: SessionCompleteCallback): () => void {
    this.completionCallbacks.push(callback)
    return () => {
      const index = this.completionCallbacks.indexOf(callback)
      if (index !== -1) {
        this.completionCallbacks.splice(index, 1)
      }
    }
  }

  /**
   * Get the number of pending messages being processed
   */
  getPendingCount(): number {
    return this.pendingMessages.size
  }

  /**
   * Check if a WhatsApp message is currently being processed
   */
  isMessagePending(messageId: string): boolean {
    return this.pendingMessages.has(messageId)
  }

  /**
   * Get all pending message IDs
   */
  getPendingMessageIds(): string[] {
    return Array.from(this.pendingMessages.keys())
  }

  /**
   * Route incoming WhatsApp message to Vespr session
   *
   * Directive Processing Flow:
   * 1. Extract inline permission directive from message (if present)
   *    - Format: @vespr /safe|/ask|/allow-all <message>
   *    - No directive → defaults to safe mode (read-only)
   * 2. Strip directive prefix from message content before sending to agent
   * 3. Apply permission mode override BEFORE sending message
   *
   * Full Logic:
   * 1. Determine session ID from (groupJid, senderJid)
   * 2. Get or create session with WhatsApp metadata
   * 3. Extract and parse directive (null → safe, /safe → safe, /ask → ask, /allow-all → allow-all)
   * 4. Apply permission mode override via setSessionPermissionMode()
   * 5. Send stripped message content to agent (non-blocking)
   * 6. Monitor for session completion
   */
  async routeIncomingMessage(msg: WhatsAppMessage): Promise<void> {
    try {
      // Step 1: Determine session ID
      const sessionId = getSessionId(msg.groupJid, msg.senderJid)

      // Step 2: Get or create session
      let session = await this.sessionManager.getSession(sessionId)
      if (!session) {
        try {
          session = await this.sessionManager.createSession(this.workspaceId, {
            name: `${msg.groupName} / ${msg.senderName}`,
            metadata: {
              type: 'whatsapp',
              groupJid: msg.groupJid,
              groupName: msg.groupName,
              senderJid: msg.senderJid,
              senderPhoneNumber: msg.senderPhoneNumber,
              senderName: msg.senderName,
              createdVia: 'whatsapp',
            } as any,
          })
        } catch (sessionError) {
          // Session creation failed - send feedback and rethrow
          await this.sendErrorFeedback(msg.groupJid, 'SESSION_CREATE_FAILED')
          throw new WhatsAppRoutingError(
            'Failed to create session',
            'SESSION_CREATE_FAILED',
            sessionError,
          )
        }
      }

      // Step 3: Extract and parse directive from message
      const { directive, content: strippedContent } = extractDirective(msg.content)

      // Determine permission mode based on directive
      // null → safe, /safe → safe, /ask → ask, /allow-all → allow-all
      const permissionMode = this.getPermissionModeFromDirective(directive)

      // Step 4: Apply permission mode override BEFORE sending message
      await this.sessionManager.setSessionPermissionMode(sessionId, permissionMode)

      // Step 5: Send stripped message to agent (directive prefix removed)
      // Non-blocking: don't wait for agent response
      void this.sessionManager.sendMessage(
        sessionId,
        strippedContent,
        msg.attachments
      )

      // Step 6: Monitor for completion
      this.monitorSessionForResults(sessionId, msg)

    } catch (error) {
      // Only send error feedback if not already sent (check if it's a routing error)
      if (!(error instanceof WhatsAppRoutingError)) {
        const errorCode = categorizeError(error)
        await this.sendErrorFeedback(msg.groupJid, errorCode)
      }
      console.error('Failed to route WhatsApp message:', error)
      throw error
    }
  }

  /**
   * Send error feedback to WhatsApp user.
   * Uses the registered callback if available, otherwise logs a warning.
   *
   * @param groupJid - The WhatsApp group to send the error to
   * @param errorCode - The categorized error code
   */
  private async sendErrorFeedback(groupJid: string, errorCode: WhatsAppErrorCode): Promise<void> {
    if (!this.errorFeedbackCallback) {
      console.warn('No error feedback callback registered - error will not be sent to WhatsApp')
      return
    }

    try {
      const errorMessage = formatErrorForWhatsApp(errorCode)
      await this.errorFeedbackCallback(groupJid, errorMessage)
    } catch (feedbackError) {
      // Don't let feedback errors propagate - just log them
      console.error('Failed to send error feedback to WhatsApp:', feedbackError)
    }
  }

  /**
   * Determine permission mode from directive
   * Mapping:
   * - null (no directive) → 'safe' (default: read-only)
   * - 'safe' → 'safe' (read-only)
   * - 'ask' → 'ask' (prompt for approval)
   * - 'allow-all' → 'allow-all' (auto-approve)
   */
  private getPermissionModeFromDirective(
    directive: PermissionDirective
  ): 'safe' | 'ask' | 'allow-all' {
    // When no directive, default to safe mode
    if (directive === null) {
      return 'safe'
    }

    // Directive is already a valid permission mode
    return directive
  }

  /**
   * Monitor session until completion, then deliver results.
   * Returns a promise that resolves when the agent completes processing.
   *
   * This method:
   * 1. Registers the message as pending
   * 2. Sets up a timeout for long-running requests
   * 3. Waits for session completion events
   * 4. Notifies callbacks and resolves when complete
   */
  private monitorSessionForResults(
    sessionId: string,
    originalMsg: WhatsAppMessage,
  ): Promise<SessionCompletionResult> {
    return new Promise((resolve) => {
      // Create timeout handler
      const timeoutHandle = setTimeout(() => {
        this.handleSessionTimeout(originalMsg.id, originalMsg.groupJid)
      }, this.timeoutMs)

      // Create pending message entry
      const pending: PendingMessage = {
        message: originalMsg,
        sessionId,
        startedAt: Date.now(),
        timeoutHandle,
        responseText: '',
        hasError: false,
        resolve,
      }

      // Register in tracking maps
      this.pendingMessages.set(originalMsg.id, pending)
      this.sessionToMessageId.set(sessionId, originalMsg.id)
    })
  }

  /**
   * Handle agent events for a session.
   * Call this method when receiving events from the session manager.
   *
   * @param sessionId The session ID that emitted the event
   * @param event The agent event
   */
  handleSessionEvent(sessionId: string, event: AgentEvent): void {
    const messageId = this.sessionToMessageId.get(sessionId)
    if (!messageId) {
      // No pending message for this session
      return
    }

    const pending = this.pendingMessages.get(messageId)
    if (!pending) {
      return
    }

    // Handle different event types
    switch (event.type) {
      case 'text_complete':
        // Accumulate response text (excluding intermediate text)
        if (!event.isIntermediate) {
          pending.responseText += (pending.responseText ? '\n\n' : '') + event.text
        }
        break

      case 'error':
        pending.hasError = true
        pending.errorMessage = event.message
        // Send error feedback to WhatsApp user
        void this.sendErrorFeedback(pending.message.groupJid, categorizeError(new Error(event.message)))
        break

      case 'typed_error':
        pending.hasError = true
        pending.errorMessage = event.error.message
        // Send error feedback to WhatsApp user
        void this.sendErrorFeedback(pending.message.groupJid, categorizeError(event.error))
        break

      case 'complete':
        // Session completed - finalize and notify
        this.finalizeMessage(messageId, false)
        break
    }
  }

  /**
   * Handle session timeout - agent took too long to respond
   */
  private handleSessionTimeout(messageId: string, groupJid: string): void {
    const pending = this.pendingMessages.get(messageId)
    if (!pending) {
      return
    }

    console.warn(`WhatsApp message ${messageId} timed out after ${this.timeoutMs}ms`)

    // Send timeout error feedback to WhatsApp user
    void this.sendErrorFeedback(groupJid, 'TIMEOUT')

    this.finalizeMessage(messageId, true)
  }

  /**
   * Finalize a pending message and notify callbacks
   */
  private finalizeMessage(messageId: string, timedOut: boolean): void {
    const pending = this.pendingMessages.get(messageId)
    if (!pending) {
      return
    }

    // Clear timeout
    clearTimeout(pending.timeoutHandle)

    // Build result with groupJid for delivery
    const result: SessionCompletionResult = {
      sessionId: pending.sessionId,
      messageId,
      groupJid: pending.message.groupJid,
      responseText: pending.responseText,
      timedOut,
      hasError: pending.hasError || timedOut,
      errorMessage: timedOut ? 'Request timed out' : pending.errorMessage,
    }

    // Clean up tracking maps
    this.pendingMessages.delete(messageId)
    this.sessionToMessageId.delete(pending.sessionId)

    // Notify all callbacks
    for (const callback of this.completionCallbacks) {
      try {
        callback(result)
      } catch (error) {
        console.error('Error in session completion callback:', error)
      }
    }

    // Resolve the promise
    pending.resolve(result)
  }

  /**
   * Cancel a pending message (e.g., if user cancels the request)
   */
  cancelPendingMessage(messageId: string): boolean {
    const pending = this.pendingMessages.get(messageId)
    if (!pending) {
      return false
    }

    clearTimeout(pending.timeoutHandle)

    const result: SessionCompletionResult = {
      sessionId: pending.sessionId,
      messageId,
      groupJid: pending.message.groupJid,
      responseText: pending.responseText,
      timedOut: false,
      hasError: true,
      errorMessage: 'Message processing cancelled',
    }

    this.pendingMessages.delete(messageId)
    this.sessionToMessageId.delete(pending.sessionId)

    // Notify callbacks
    for (const callback of this.completionCallbacks) {
      try {
        callback(result)
      } catch (error) {
        console.error('Error in session completion callback:', error)
      }
    }

    pending.resolve(result)
    return true
  }

  /**
   * Clean up all pending messages (e.g., on shutdown)
   */
  cleanup(): void {
    for (const [messageId, pending] of this.pendingMessages) {
      clearTimeout(pending.timeoutHandle)

      const result: SessionCompletionResult = {
        sessionId: pending.sessionId,
        messageId,
        groupJid: pending.message.groupJid,
        responseText: pending.responseText,
        timedOut: false,
        hasError: true,
        errorMessage: 'Router shutdown',
      }

      pending.resolve(result)
    }

    this.pendingMessages.clear()
    this.sessionToMessageId.clear()
  }

  /**
   * Handle multiple routers per workspace
   */
  async routeMultipleMessages(messages: WhatsAppMessage[]): Promise<void> {
    // Route messages in parallel but maintain order per sender
    // Group by sender, route sequentially per sender, parallel across senders
    const bySender = new Map<string, WhatsAppMessage[]>()

    for (const msg of messages) {
      if (!bySender.has(msg.senderJid)) {
        bySender.set(msg.senderJid, [])
      }
      bySender.get(msg.senderJid)!.push(msg)
    }

    // Route all senders in parallel
    await Promise.all(
      Array.from(bySender.values()).map(senderMessages =>
        this.routeSequentially(senderMessages)
      )
    )
  }

  /**
   * Route messages sequentially for same sender (preserves order)
   */
  private async routeSequentially(messages: WhatsAppMessage[]): Promise<void> {
    for (const msg of messages) {
      try {
        await this.routeIncomingMessage(msg)
      } catch (error) {
        console.error(`Failed to route message from ${msg.senderName}:`, error)
      }
    }
  }
}

export function createMessageRouter(
  workspaceId: string,
  sessionManager: SessionManager,
): WhatsAppMessageRouter {
  return new WhatsAppMessageRouter(workspaceId, sessionManager)
}
