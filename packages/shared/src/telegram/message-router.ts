import type { TelegramMessage, TelegramErrorCode, TelegramSessionMetadata, ReactionLevel } from './types'
import { getSessionId } from './session-mapper'
import { extractDirective, type PermissionDirective } from './directive-parser'
import type { AgentEvent } from '@vesper/core/types'

// SessionManager interface for Telegram integration
// Defines the subset of SessionManager methods used by the message router
interface SessionManager {
  getSession(sessionId: string): Promise<{ id: string } | null>
  createSession<M = Record<string, unknown>>(workspaceId: string, options?: {
    name?: string
    metadata?: M
  }): Promise<{ id: string }>
  sendMessage(sessionId: string, message: string, attachments?: unknown[]): Promise<void>
  setSessionPermissionMode(sessionId: string, mode: 'safe' | 'ask' | 'allow-all'): void
  setSessionCompletionCallback(
    sessionId: string,
    callback: (sessionId: string, messages: Array<{ role: string; content: string; isIntermediate?: boolean }>) => Promise<void>
  ): void
}

/**
 * Default timeout for agent processing (5 minutes)
 */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000

/**
 * Callback for sending error feedback back to Telegram.
 * Implemented by TelegramService to send messages via the bot.
 */
export type ErrorFeedbackCallback = (chatId: number, errorMessage: string) => Promise<void>

/**
 * Callback for sending chat actions (typing indicator).
 * Implemented by TelegramService to show activity indicators.
 */
export type ChatActionCallback = (chatId: number, action: 'typing') => Promise<void>

/**
 * Callback for setting message reactions.
 * Implemented by TelegramService to add emoji reactions for status updates.
 */
export type MessageReactionCallback = (chatId: number, messageId: number, emoji: string | null) => Promise<void>

/**
 * Error thrown during message routing with categorized error code.
 */
export class TelegramRoutingError extends Error {
  constructor(
    message: string,
    public readonly code: TelegramErrorCode,
    public readonly originalError?: unknown,
  ) {
    super(message)
    this.name = 'TelegramRoutingError'
  }
}

/**
 * User-friendly error message templates.
 * Maps error codes to human-readable messages (no stack traces).
 */
const USER_ERROR_MESSAGES: Record<TelegramErrorCode, string> = {
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
}

/**
 * Get user-friendly error message for an error code.
 * Never exposes internal details or stack traces.
 */
export function getUserFriendlyErrorMessage(code: TelegramErrorCode): string {
  return USER_ERROR_MESSAGES[code] || USER_ERROR_MESSAGES.INTERNAL_ERROR
}

/**
 * Categorize an error into a TelegramErrorCode.
 * Used to determine appropriate user-facing message.
 */
export function categorizeError(error: unknown): TelegramErrorCode {
  if (error instanceof TelegramRoutingError) {
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
 * Format an error for user display in Telegram.
 * Adds emoji prefix and keeps message concise.
 */
export function formatErrorForTelegram(code: TelegramErrorCode): string {
  const message = getUserFriendlyErrorMessage(code)
  return `❌ Sorry, ${message}`
}

/**
 * Result from session completion monitoring
 */
export interface SessionCompletionResult {
  /** Session ID that completed */
  sessionId: string
  /** Original Telegram message ID */
  messageId: number
  /** Telegram chat ID to deliver the response to */
  chatId: number
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
 * Tracks a pending Telegram message being processed
 */
interface PendingMessage {
  /** Original Telegram message */
  message: TelegramMessage
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
}

export class TelegramMessageRouter {
  /**
   * Map of Telegram message ID → pending message tracking
   * Used to correlate session events back to original Telegram messages
   */
  private pendingMessages = new Map<number, PendingMessage>()

  /**
   * Map of session ID → Telegram message ID
   * Reverse lookup for handling session events
   */
  private sessionToMessageId = new Map<string, number>()

  /**
   * Callbacks to notify when a session completes
   */
  private completionCallbacks: SessionCompleteCallback[] = []

  /**
   * Callback for sending error feedback to Telegram users
   */
  private errorFeedbackCallback: ErrorFeedbackCallback | null = null

  /**
   * Callback for sending chat actions (typing indicator)
   */
  private chatActionCallback: ChatActionCallback | null = null

  /**
   * Callback for setting message reactions
   */
  private messageReactionCallback: MessageReactionCallback | null = null

  /**
   * Reaction level for status feedback (default: 'off')
   */
  private reactionLevel: ReactionLevel = 'off'

  /**
   * Timeout duration for agent processing (default 5 minutes)
   */
  private timeoutMs: number

  constructor(
    private workspaceId: string,
    private sessionManager: SessionManager,
    options?: { timeoutMs?: number; reactionLevel?: ReactionLevel }
  ) {
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.reactionLevel = options?.reactionLevel ?? 'off'
  }

  /**
   * Set the callback for sending error feedback to Telegram users.
   * This should be called by TelegramService after creating the router.
   */
  setErrorFeedbackCallback(callback: ErrorFeedbackCallback): void {
    this.errorFeedbackCallback = callback
  }

  /**
   * Set the callback for sending chat actions (typing indicator).
   * This should be called by TelegramService after creating the router.
   */
  setChatActionCallback(callback: ChatActionCallback): void {
    this.chatActionCallback = callback
  }

  /**
   * Set the callback for setting message reactions.
   * This should be called by TelegramService after creating the router.
   */
  setMessageReactionCallback(callback: MessageReactionCallback): void {
    this.messageReactionCallback = callback
  }

  /**
   * Set the reaction level for status feedback.
   * Called by TelegramService when configuration changes.
   */
  setReactionLevel(level: ReactionLevel): void {
    this.reactionLevel = level
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
   * Check if a Telegram message is currently being processed
   */
  isMessagePending(messageId: number): boolean {
    return this.pendingMessages.has(messageId)
  }

  /**
   * Get all pending message IDs
   */
  getPendingMessageIds(): number[] {
    return Array.from(this.pendingMessages.keys())
  }

  /**
   * Route incoming Telegram message to Vesper session
   *
   * Directive Processing Flow:
   * 1. Extract inline permission directive from message (if present)
   *    - Format: /safe|/ask|/allow_all <message>
   *    - No directive → defaults to safe mode (read-only)
   * 2. Strip directive prefix from message content before sending to agent
   * 3. Apply permission mode override BEFORE sending message
   *
   * Full Logic:
   * 1. Determine session ID from (chatId, userId)
   * 2. Get or create session with Telegram metadata
   * 3. Extract and parse directive (null → safe, /safe → safe, /ask → ask, /allow_all → allow-all)
   * 4. Apply permission mode override via setSessionPermissionMode()
   * 5. Send stripped message content to agent (non-blocking)
   * 6. Monitor for session completion
   */
  async routeIncomingMessage(msg: TelegramMessage): Promise<void> {
    try {
      // Step 1: Determine session ID
      const sessionId = getSessionId(msg.chatId, msg.userId)

      // Step 2: Get or create session
      let session = await this.sessionManager.getSession(sessionId)
      if (!session) {
        try {
          // Create properly typed metadata for the session
          const metadata: TelegramSessionMetadata = {
            type: 'telegram',
            chatId: msg.chatId,
            chatTitle: msg.chatTitle,
            chatType: msg.chatType,
            userId: msg.userId,
            username: msg.username,
            firstName: msg.firstName,
            createdVia: 'telegram',
          }

          session = await this.sessionManager.createSession<TelegramSessionMetadata>(
            this.workspaceId,
            {
              name: `${msg.chatTitle || 'Private'} / ${msg.firstName}`,
              metadata,
            }
          )
        } catch (sessionError) {
          // Session creation failed - send feedback and rethrow
          await this.sendErrorFeedback(msg.chatId, 'SESSION_CREATE_FAILED')
          throw new TelegramRoutingError(
            'Failed to create session',
            'SESSION_CREATE_FAILED',
            sessionError,
          )
        }
      }

      // Step 3: Extract and parse directive from message
      const { directive, content: strippedContent } = extractDirective(msg.content)

      // Determine permission mode based on directive
      // null → safe, /safe → safe, /ask → ask, /allow_all → allow-all
      const permissionMode = this.getPermissionModeFromDirective(directive)

      // Step 4: Apply permission mode override BEFORE sending message
      await this.sessionManager.setSessionPermissionMode(sessionId, permissionMode)

      // Step 5: Send typing indicator (shows "typing..." in chat)
      if (this.chatActionCallback) {
        void this.chatActionCallback(msg.chatId, 'typing')
      }

      // Step 6: Set acknowledgment reaction (👀) if enabled
      if (this.shouldShowReaction('ack')) {
        void this.setReaction(msg.chatId, msg.id, '👀')
      }

      // Step 7: Set up completion callback BEFORE sending message
      // This ensures we don't miss the completion event for fast responses
      this.setupCompletionCallback(sessionId, msg)

      // Step 8: Send stripped message to agent (directive prefix removed)
      // Non-blocking: don't wait for agent response
      void this.sessionManager.sendMessage(
        sessionId,
        strippedContent,
        msg.attachments
      )

    } catch (error) {
      // Only send error feedback if not already sent (check if it's a routing error)
      if (!(error instanceof TelegramRoutingError)) {
        const errorCode = categorizeError(error)
        await this.sendErrorFeedback(msg.chatId, errorCode)
      }
      console.error('Failed to route Telegram message:', error)
      throw error
    }
  }

  /**
   * Send error feedback to Telegram user.
   * Uses the registered callback if available, otherwise logs a warning.
   *
   * @param chatId - The Telegram chat to send the error to
   * @param errorCode - The categorized error code
   */
  private async sendErrorFeedback(chatId: number, errorCode: TelegramErrorCode): Promise<void> {
    if (!this.errorFeedbackCallback) {
      console.warn('No error feedback callback registered - error will not be sent to Telegram')
      return
    }

    try {
      const errorMessage = formatErrorForTelegram(errorCode)
      await this.errorFeedbackCallback(chatId, errorMessage)
    } catch (feedbackError) {
      // Don't let feedback errors propagate - just log them
      console.error('Failed to send error feedback to Telegram:', feedbackError)
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
   * Set up completion callback for a session.
   * This registers a callback with the SessionManager that will be invoked
   * when the agent finishes processing the message.
   *
   * IMPORTANT: The callback is registered BEFORE adding to tracking maps
   * to prevent race conditions with very fast agent responses.
   *
   * @param sessionId - The session ID to monitor
   * @param originalMsg - The original Telegram message for tracking
   */
  private setupCompletionCallback(
    sessionId: string,
    originalMsg: TelegramMessage,
  ): void {
    // Create pending message entry FIRST (but don't register in maps yet)
    const pending: PendingMessage = {
      message: originalMsg,
      sessionId,
      startedAt: Date.now(),
      timeoutHandle: null as any, // Will be set after callback registration
      responseText: '',
      hasError: false,
    }

    // Register completion callback BEFORE adding to tracking maps
    // This prevents race conditions where fast agent responses might complete
    // before the callback is registered
    this.sessionManager.setSessionCompletionCallback(
      sessionId,
      async (_completedSessionId: string, messages: Array<{ role: string; content?: string; isIntermediate?: boolean }>) => {
        // Extract response text from the last non-intermediate assistant message
        const assistantMessages = messages
          .filter((m): m is { role: string; content: string; isIntermediate?: boolean } =>
            m.role === 'assistant' && !m.isIntermediate && typeof m.content === 'string'
          )
          .map(m => m.content)

        // Get the last assistant response (or empty string if none)
        const lastMessage = assistantMessages[assistantMessages.length - 1]
        const responseText: string = lastMessage ?? ''

        // Update pending message with response
        const pendingMsg = this.pendingMessages.get(originalMsg.id)
        if (!pendingMsg) {
          console.warn(`[TelegramRouter] Completion callback fired but no pending message for ${originalMsg.id}`)
          return
        }

        pendingMsg.responseText = responseText
        // Finalize the message (notifies callbacks, cleans up tracking)
        this.finalizeMessage(originalMsg.id, false)
      }
    )

    // NOW register in tracking maps (callback is already registered)
    this.pendingMessages.set(originalMsg.id, pending)
    this.sessionToMessageId.set(sessionId, originalMsg.id)

    // Create timeout LAST (after callback and maps are set up)
    const timeoutHandle = setTimeout(() => {
      this.handleSessionTimeout(originalMsg.id, originalMsg.chatId)
    }, this.timeoutMs)
    pending.timeoutHandle = timeoutHandle

    console.log(`[TelegramRouter] Completion callback registered for session ${sessionId}, message ${originalMsg.id}`)
  }

  /**
   * Handle session timeout - agent took too long to respond
   */
  private handleSessionTimeout(messageId: number, chatId: number): void {
    const pending = this.pendingMessages.get(messageId)
    if (!pending) {
      return
    }

    console.warn(`Telegram message ${messageId} timed out after ${this.timeoutMs}ms`)

    // Send timeout error feedback to Telegram user
    void this.sendErrorFeedback(chatId, 'TIMEOUT')

    this.finalizeMessage(messageId, true)
  }

  /**
   * Finalize a pending message and notify callbacks
   */
  private finalizeMessage(messageId: number, timedOut: boolean): void {
    const pending = this.pendingMessages.get(messageId)
    if (!pending) {
      return
    }

    // Clear timeout
    clearTimeout(pending.timeoutHandle)

    // Build result with chatId for delivery
    const result: SessionCompletionResult = {
      sessionId: pending.sessionId,
      messageId,
      chatId: pending.message.chatId,
      responseText: pending.responseText,
      timedOut,
      hasError: pending.hasError || timedOut,
      errorMessage: timedOut ? 'Request timed out' : pending.errorMessage,
    }

    // Set completion reaction (✅/❌) if enabled
    if (this.shouldShowReaction('minimal')) {
      const emoji = result.hasError ? '❌' : '✅'
      void this.setReaction(result.chatId, messageId, emoji)
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
  }

  /**
   * Check if a reaction should be shown based on the current reaction level.
   *
   * @param minLevel - Minimum reaction level required ('ack', 'minimal', 'extensive')
   * @returns true if reaction should be shown
   */
  private shouldShowReaction(minLevel: 'ack' | 'minimal' | 'extensive'): boolean {
    if (this.reactionLevel === 'off') return false

    const levels: ReactionLevel[] = ['off', 'ack', 'minimal', 'extensive']
    const currentIndex = levels.indexOf(this.reactionLevel)
    const minIndex = levels.indexOf(minLevel)

    return currentIndex >= minIndex
  }

  /**
   * Set a message reaction via callback.
   * Best-effort - failures are logged but not propagated.
   *
   * @param chatId - The Telegram chat ID
   * @param messageId - The message ID to react to
   * @param emoji - The emoji to use as reaction
   */
  private async setReaction(chatId: number, messageId: number, emoji: string): Promise<void> {
    if (!this.messageReactionCallback) {
      return
    }

    try {
      await this.messageReactionCallback(chatId, messageId, emoji)
    } catch (error) {
      // Don't propagate - reactions are best-effort
      console.warn(`Failed to set reaction ${emoji} on ${chatId}:${messageId}:`, error)
    }
  }

  /**
   * Cancel a pending message (e.g., if user cancels the request)
   */
  cancelPendingMessage(messageId: number): boolean {
    const pending = this.pendingMessages.get(messageId)
    if (!pending) {
      return false
    }

    clearTimeout(pending.timeoutHandle)

    const result: SessionCompletionResult = {
      sessionId: pending.sessionId,
      messageId,
      chatId: pending.message.chatId,
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

    return true
  }

  /**
   * Clean up all pending messages (e.g., on shutdown)
   */
  cleanup(): void {
    for (const [messageId, pending] of this.pendingMessages) {
      clearTimeout(pending.timeoutHandle)
    }

    this.pendingMessages.clear()
    this.sessionToMessageId.clear()
  }

  /**
   * Handle multiple routers per workspace
   */
  async routeMultipleMessages(messages: TelegramMessage[]): Promise<void> {
    // Route messages in parallel but maintain order per sender
    // Group by sender, route sequentially per sender, parallel across senders
    const bySender = new Map<number, TelegramMessage[]>()

    for (const msg of messages) {
      if (!bySender.has(msg.userId)) {
        bySender.set(msg.userId, [])
      }
      bySender.get(msg.userId)!.push(msg)
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
  private async routeSequentially(messages: TelegramMessage[]): Promise<void> {
    for (const msg of messages) {
      try {
        await this.routeIncomingMessage(msg)
      } catch (error) {
        console.error(`Failed to route message from ${msg.firstName}:`, error)
      }
    }
  }
}

export function createMessageRouter(
  workspaceId: string,
  sessionManager: SessionManager,
): TelegramMessageRouter {
  return new TelegramMessageRouter(workspaceId, sessionManager)
}
