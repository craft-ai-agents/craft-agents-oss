import { EventEmitter } from 'events'
import TelegramBot from 'node-telegram-bot-api'
import type { TelegramMessage, TelegramConnectionStatus, TelegramError, AccessControlConfig } from '@vesper/shared/telegram'
import type { CredentialManager } from '@vesper/shared/credentials'
import { createMessageRouter, type TelegramMessageRouter, type SessionCompletionResult } from '@vesper/shared/telegram/message-router'
import { formatLargeResult } from '@vesper/shared/telegram/result-formatter'
import { MessageDeduplicator } from '@vesper/shared/telegram/deduplication'
import { InboundDebouncer, type DebouncedMessage } from '@vesper/shared/telegram/debounce'
import { withRetry, shouldRetryTelegramError, DEFAULT_BACKOFF, computeBackoff } from '@vesper/shared/telegram/retry'
import { checkDMAccess, checkGroupAccess } from '@vesper/shared/telegram/access-control'
import { shouldProcessGroupMessage } from '@vesper/shared/telegram/mention-gate'
import { EchoTracker } from '@vesper/shared/telegram/echo-tracker'
import { sanitizeError } from '@vesper/shared/utils'
import { showNotification } from './notifications'
import { IPC_CHANNELS } from '../shared/types'
import { BrowserWindow } from 'electron'

/**
 * Delay between sending messages to avoid Telegram rate limiting (in ms)
 * Telegram allows 30 messages/second, so 35ms delay is safe
 */
const MESSAGE_SEND_DELAY_MS = 35

/**
 * Maximum number of messages allowed in queue (~2MB max memory)
 */
const MAX_QUEUE_SIZE = 1000

/**
 * Default debounce window for combining rapid sequential messages (in ms)
 * Recommended: 1500ms (1.5 seconds)
 */
const DEFAULT_DEBOUNCE_MS = 1500

/**
 * Uptime threshold to consider connection "healthy" and reset backoff (in ms)
 * After 60 seconds of uptime, reset reconnection attempts to 0
 */
const HEALTHY_UPTIME_THRESHOLD_MS = 60_000

/**
 * Maximum number of reconnection attempts before giving up
 */
const MAX_RECONNECT_ATTEMPTS = 12

/**
 * Per-chat rate limiting using token bucket algorithm
 */
interface TokenBucket {
  tokens: number
  lastRefillTime: number
}

const RATE_LIMIT_BURST_CAPACITY = 5
const RATE_LIMIT_TOKENS_PER_SEC = 0.5

/**
 * Queue for rate-limited message sending
 */
class MessageQueue {
  private queue: Array<{ chatId: number; text: string; resolve: (messageId: number) => void; reject: (error: Error) => void }> = []
  private processing = false
  private perChatTokens = new Map<number, TokenBucket>()

  constructor(
    private bot: TelegramBot,
    private delayMs: number = MESSAGE_SEND_DELAY_MS
  ) {}

  async enqueue(chatId: number, text: string): Promise<number> {
    return new Promise((resolve, reject) => {
      // Reject if queue is full
      if (this.queue.length >= MAX_QUEUE_SIZE) {
        reject(new Error(
          `Message queue full (${MAX_QUEUE_SIZE} messages). ` +
          `Telegram delivery is overwhelmed. Try again later.`
        ))
        return
      }

      this.queue.push({ chatId, text, resolve, reject })
      if (!this.processing) {
        void this.processQueue()
      }
    })
  }

  getQueueSize(): number {
    return this.queue.length
  }

  /**
   * Check if a chat has available tokens for sending a message
   * Implements token bucket algorithm: 5 burst capacity, 0.5 tokens/sec refill
   */
  private canSendToChat(chatId: number): boolean {
    const now = Date.now()
    let bucket = this.perChatTokens.get(chatId)

    if (!bucket) {
      // Initialize new bucket with full capacity
      bucket = {
        tokens: RATE_LIMIT_BURST_CAPACITY,
        lastRefillTime: now
      }
      this.perChatTokens.set(chatId, bucket)
      return true
    }

    // Refill tokens based on elapsed time
    const elapsedMs = now - bucket.lastRefillTime
    const tokensToAdd = (elapsedMs / 1000) * RATE_LIMIT_TOKENS_PER_SEC
    bucket.tokens = Math.min(
      RATE_LIMIT_BURST_CAPACITY,
      bucket.tokens + tokensToAdd
    )
    bucket.lastRefillTime = now

    // Check if we have at least 1 token
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1
      return true
    }

    return false
  }

  /**
   * Get time to wait (ms) before next message can be sent to a chat
   */
  private getWaitTimeForChat(chatId: number): number {
    const now = Date.now()
    let bucket = this.perChatTokens.get(chatId)

    if (!bucket) {
      return 0
    }

    // Refill tokens based on elapsed time
    const elapsedMs = now - bucket.lastRefillTime
    const tokensToAdd = (elapsedMs / 1000) * RATE_LIMIT_TOKENS_PER_SEC
    const availableTokens = Math.min(
      RATE_LIMIT_BURST_CAPACITY,
      bucket.tokens + tokensToAdd
    )

    // If we have tokens, no wait needed
    if (availableTokens >= 1) {
      return 0
    }

    // Calculate time to next token
    const tokensNeeded = 1 - availableTokens
    const timeToNextToken = (tokensNeeded / RATE_LIMIT_TOKENS_PER_SEC) * 1000
    return Math.ceil(timeToNextToken)
  }

  private async processQueue(): Promise<void> {
    this.processing = true

    while (this.queue.length > 0) {
      const item = this.queue.shift()
      if (!item) break

      try {
        // Check per-chat rate limiting
        const waitTime = this.getWaitTimeForChat(item.chatId)
        if (waitTime > 0) {
          await new Promise(resolve => setTimeout(resolve, waitTime))
        }

        // Wrap sendMessage in retry logic with exponential backoff
        const sentMessage = await withRetry(
          async () => {
            return await this.bot.sendMessage(item.chatId, item.text, {
              parse_mode: 'Markdown',
              disable_web_page_preview: false
            })
          },
          DEFAULT_BACKOFF,
          shouldRetryTelegramError
        )
        item.resolve(sentMessage.message_id)
      } catch (error) {
        item.reject(error as Error)
      }

      // Rate limiting delay for global queue
      if (this.queue.length > 0) {
        await new Promise(resolve => setTimeout(resolve, this.delayMs))
      }
    }

    this.processing = false
  }
}

export class TelegramService extends EventEmitter {
  private bot: TelegramBot | null = null
  private messageQueue: MessageQueue | null = null
  private isRunning = false
  private connectionStatus: TelegramConnectionStatus = {
    isConnected: false,
    isConnecting: false
  }
  private credentialManager: CredentialManager | null = null
  private messageRouter: TelegramMessageRouter | null = null
  private sessionManager: any = null // Will be typed as SessionManager when available
  private completionUnsubscribe: (() => void) | null = null
  private deduplicator = new MessageDeduplicator()
  private debouncer: InboundDebouncer | null = null
  private shouldStop = false
  private isTokenRevoked = false
  private disconnectPromise: Promise<void> | null = null
  private disconnectResolve: (() => void) | null = null
  private accessControlConfig: AccessControlConfig | null = null
  private echoTracker = new EchoTracker() // Track bot's sent messages to prevent self-reply loops

  constructor(
    private workspaceId: string,
    private accountId: string = 'default'
  ) {
    super()
  }

  /**
   * Set credential manager for token persistence
   */
  setCredentialManager(credentialManager: CredentialManager): void {
    this.credentialManager = credentialManager
  }

  /**
   * Set SessionManager for routing
   */
  setSessionManager(sessionManager: any): void {
    this.sessionManager = sessionManager
    if (sessionManager && !this.messageRouter) {
      // Get reaction level from access control config (default: 'off')
      const reactionLevel = this.accessControlConfig?.reactionLevel || 'off'

      this.messageRouter = createMessageRouter(this.workspaceId, sessionManager, {
        reactionLevel
      })

      // Wire up error feedback callback so routing errors get sent back to Telegram
      this.messageRouter.setErrorFeedbackCallback(this.sendErrorFeedback.bind(this))

      // Wire up chat action callback for typing indicator
      this.messageRouter.setChatActionCallback(this.sendChatAction.bind(this))

      // Wire up message reaction callback for status updates
      this.messageRouter.setMessageReactionCallback(this.setMessageReaction.bind(this))

      // Wire up session completion callback to deliver results back to Telegram
      this.completionUnsubscribe = this.messageRouter.onSessionComplete(
        this.handleSessionCompletion.bind(this)
      )
    }
  }

  /**
   * Set access control configuration
   */
  setAccessControlConfig(config: AccessControlConfig | null): void {
    this.accessControlConfig = config

    // Update reaction level in message router if it exists
    if (this.messageRouter && config?.reactionLevel) {
      this.messageRouter.setReactionLevel(config.reactionLevel)
    }
  }

  /**
   * Check if a message is allowed based on access control policies.
   *
   * @param message - Telegram message to check
   * @returns AccessCheckResult with allowed status and optional reason/pairing code
   */
  private checkMessageAccess(message: TelegramMessage): {
    allowed: boolean
    reason?: string
    pairingCode?: string
  } {
    // If no access control config, allow all (backward compatibility)
    if (!this.accessControlConfig) {
      return { allowed: true }
    }

    const { chatType, chatId, userId } = message
    const config = this.accessControlConfig

    // Convert string IDs to numbers for comparison
    const allowedUserIds = config.allowedUsers.map(id => parseInt(id, 10))
    const allowedChatIds = config.allowedChats.map(id => parseInt(id, 10))

    // Check DM access for private chats
    if (chatType === 'private') {
      return checkDMAccess({
        userId,
        policy: config.dmPolicy,
        allowlist: allowedUserIds
      })
    }

    // Check group access for group/supergroup chats
    return checkGroupAccess({
      chatId,
      userId,
      groupPolicy: config.groupPolicy,
      allowedGroups: allowedChatIds,
      allowedUsers: allowedUserIds
    })
  }

  /**
   * Start the Telegram bot with the given token.
   * Initiates the reconnection loop for automatic recovery on disconnect.
   */
  async start(botToken: string): Promise<void> {
    if (this.isRunning) {
      throw new Error('Telegram service is already running')
    }

    try {
      // Save credentials first (for reconnection loop)
      if (this.credentialManager) {
        await this.credentialManager.setTelegramBotToken(this.workspaceId, botToken, this.accountId)
      }

      // Reset stop flag
      this.shouldStop = false
      this.isTokenRevoked = false

      // Start reconnection loop
      void this.reconnectionLoop(botToken)

    } catch (error) {
      // Sanitize bot token from error before logging or storing
      const sanitized = sanitizeError(error, [botToken])

      const errorEvent: TelegramError = {
        message: 'Failed to start Telegram bot',
        timestamp: Date.now(),
        code: 'INTERNAL_ERROR',
        originalError: sanitized
      }
      this.emit('error', errorEvent)

      throw sanitized
    }
  }

  /**
   * Reconnection loop with exponential backoff.
   *
   * Handles automatic reconnection on disconnect with:
   * - Exponential backoff up to 12 attempts
   * - Backoff reset after 60s healthy uptime
   * - Token revocation detection
   * - Event emission for auth-required and reconnect-failed
   */
  private async reconnectionLoop(botToken: string): Promise<void> {
    let attempts = 0

    while (!this.shouldStop) {
      const startedAt = Date.now()

      try {
        // Start polling (this will throw if token is invalid)
        await this.startPolling(botToken)

        // Reset attempts on successful connection
        attempts = 0

        // Wait for disconnect
        await this.waitForDisconnect()

        const uptimeMs = Date.now() - startedAt

        // Reset backoff after healthy stretch
        if (uptimeMs > HEALTHY_UPTIME_THRESHOLD_MS) {
          attempts = 0
          console.log(`✅ Telegram connection was healthy for ${Math.floor(uptimeMs / 1000)}s, reset backoff`)
        }

        // Check if token was revoked (401/403 errors)
        if (this.isTokenRevoked) {
          console.error('Telegram bot token revoked. Manual re-auth required.')
          this.emit('auth-required', {
            workspaceId: this.workspaceId,
            accountId: this.accountId
          })
          break
        }

      } catch (err) {
        console.error('Telegram connection error:', err)

        // Check if this is a token revocation error
        if (this.isAuthError(err)) {
          this.isTokenRevoked = true
          console.error('Telegram bot token revoked. Manual re-auth required.')
          this.emit('auth-required', {
            workspaceId: this.workspaceId,
            accountId: this.accountId
          })
          break
        }
      }

      if (this.shouldStop) break

      // Increment attempts
      attempts++

      if (attempts >= MAX_RECONNECT_ATTEMPTS) {
        console.error(`Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Giving up.`)
        this.emit('reconnect-failed', {
          workspaceId: this.workspaceId,
          accountId: this.accountId,
          attempts
        })
        break
      }

      // Compute backoff delay
      const delay = computeBackoff(DEFAULT_BACKOFF, attempts)
      console.log(`⏳ Reconnecting in ${delay}ms (attempt ${attempts}/${MAX_RECONNECT_ATTEMPTS})`)

      await new Promise(r => setTimeout(r, delay))
    }

    // Clean up on exit
    await this.cleanupConnection()
  }

  /**
   * Start polling with connection setup.
   * Extracted from original start() method for use in reconnection loop.
   */
  private async startPolling(botToken: string): Promise<void> {
    this.connectionStatus = {
      isConnected: false,
      isConnecting: true
    }
    this.broadcastConnectionStatus()

    // Create bot instance
    this.bot = new TelegramBot(botToken, { polling: false })

    // Validate token by calling getMe()
    const botInfo = await this.bot.getMe()
    console.log(`✅ Telegram bot validated: @${botInfo.username}`)

    // Initialize message queue
    this.messageQueue = new MessageQueue(this.bot)

    // Initialize inbound debouncer
    this.debouncer = new InboundDebouncer({
      debounceMs: DEFAULT_DEBOUNCE_MS,
      onFlush: this.handleDebouncedMessage.bind(this)
    })

    // Set up event handlers
    this.setupEventHandlers()

    // Start polling
    await this.bot.startPolling()

    this.isRunning = true
    this.connectionStatus = {
      isConnected: true,
      isConnecting: false,
      botUsername: botInfo.username,
      botId: botInfo.id
    }
    this.broadcastConnectionStatus()

    console.log(`🤖 Telegram bot started: @${botInfo.username}`)
  }

  /**
   * Wait for disconnect event.
   * Creates a promise that resolves when the connection is lost.
   */
  private async waitForDisconnect(): Promise<void> {
    if (!this.disconnectPromise) {
      this.disconnectPromise = new Promise<void>((resolve) => {
        this.disconnectResolve = resolve
      })
    }
    return this.disconnectPromise
  }

  /**
   * Trigger disconnect resolution.
   * Called when polling error occurs or stop() is called.
   */
  private triggerDisconnect(): void {
    if (this.disconnectResolve) {
      this.disconnectResolve()
      this.disconnectResolve = null
      this.disconnectPromise = null
    }
  }

  /**
   * Check if an error is an authentication error (401/403).
   */
  private isAuthError(err: unknown): boolean {
    if (err instanceof Error) {
      const msg = err.message.toLowerCase()
      return msg.includes('401') || msg.includes('403') || msg.includes('unauthorized')
    }
    return false
  }

  /**
   * Clean up connection resources.
   */
  private async cleanupConnection(): Promise<void> {
    if (this.bot) {
      try {
        await this.bot.stopPolling()
      } catch (err) {
        console.error('Error stopping polling:', err)
      }
    }

    // Clean up message router
    if (this.messageRouter) {
      this.messageRouter.cleanup()
    }

    // Clean up debouncer
    if (this.debouncer) {
      this.debouncer.cleanup()
      this.debouncer = null
    }

    // Unsubscribe from completion callbacks
    if (this.completionUnsubscribe) {
      this.completionUnsubscribe()
      this.completionUnsubscribe = null
    }

    this.bot = null
    this.messageQueue = null
    this.isRunning = false
    this.connectionStatus = {
      isConnected: false,
      isConnecting: false
    }
    this.broadcastConnectionStatus()
  }

  /**
   * Stop the Telegram bot
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return
    }

    try {
      // Set stop flag to exit reconnection loop
      this.shouldStop = true

      // Trigger disconnect to wake up reconnection loop
      this.triggerDisconnect()

      // Clean up connection
      await this.cleanupConnection()

      // Delete credentials if credential manager is set
      if (this.credentialManager) {
        await this.credentialManager.deleteTelegramBotToken(this.workspaceId, this.accountId)
      }

      console.log('🛑 Telegram bot stopped')

    } catch (error) {
      console.error('Error stopping Telegram bot:', error)
      throw error
    }
  }

  /**
   * Send a message to a Telegram chat (with rate limiting)
   */
  async sendMessage(chatId: number, text: string): Promise<number> {
    if (!this.bot || !this.messageQueue) {
      throw new Error('Telegram bot is not running')
    }

    try {
      const messageId = await this.messageQueue.enqueue(chatId, text)

      // Track sent message ID to prevent echo loops (TTL: 5 minutes, max 100 items)
      this.echoTracker.track(messageId)

      return messageId
    } catch (error) {
      console.error('Failed to send Telegram message:', error)
      const errorEvent: TelegramError = {
        message: 'Failed to send message',
        timestamp: Date.now(),
        code: 'DELIVERY_ERROR',
        originalError: error
      }
      this.emit('error', errorEvent)
      throw error
    }
  }

  /**
   * Send a chat action (e.g., "typing") to show activity indicator.
   * Used to provide visual feedback while processing messages.
   *
   * @param chatId - The Telegram chat ID
   * @param action - The action to send (e.g., "typing")
   */
  async sendChatAction(chatId: number, action: 'typing' | 'upload_photo' | 'record_video' | 'upload_video' | 'record_voice' | 'upload_voice' | 'upload_document' | 'find_location' | 'record_video_note' | 'upload_video_note'): Promise<void> {
    if (!this.bot) {
      throw new Error('Telegram bot is not running')
    }

    try {
      await this.bot.sendChatAction(chatId, action)
    } catch (error) {
      // Don't throw - chat actions are best-effort
      console.warn(`Failed to send chat action "${action}" to chat ${chatId}:`, error)
    }
  }

  /**
   * Set a reaction on a message (Telegram API 7.0+).
   * Used for status feedback: 👀 (received), ✅ (done), ❌ (error).
   *
   * NOTE: Reactions require specific bot permissions and may not work in all chats.
   * This method is best-effort and will not throw on failure.
   *
   * @param chatId - The Telegram chat ID
   * @param messageId - The message ID to react to
   * @param emoji - The emoji to use as reaction (or null to remove)
   */
  async setMessageReaction(chatId: number, messageId: number, emoji: string | null): Promise<void> {
    if (!this.bot) {
      return
    }

    try {
      // Use the setMessageReaction API (requires node-telegram-bot-api 0.64.0+)
      // Note: This may not be available in older versions, so we wrap it safely
      if (typeof (this.bot as any).setMessageReaction === 'function') {
        await (this.bot as any).setMessageReaction(chatId, messageId, {
          reaction: emoji ? [{ type: 'emoji', emoji }] : []
        })
      } else {
        console.warn('setMessageReaction not available in current node-telegram-bot-api version')
      }
    } catch (error) {
      // Don't throw - reactions are best-effort and may fail due to permissions
      console.warn(`Failed to set reaction "${emoji}" on message ${chatId}:${messageId}:`, error)
    }
  }

  /**
   * Get current connection status
   */
  getConnectionStatus(): TelegramConnectionStatus {
    return this.connectionStatus
  }

  /**
   * Set up event handlers for incoming messages and errors
   */
  private setupEventHandlers(): void {
    if (!this.bot) return

    // Handle incoming messages
    this.bot.on('message', async (msg) => {
      // Only handle text messages
      if (!msg.text) return

      // Ignore bot messages
      if (msg.from?.is_bot) return

      try {
        // Check if this is an echo of our own message
        if (this.echoTracker.isEcho(msg.message_id)) {
          console.log(`Skipping echo of bot's own message: ${msg.chat.id}:${msg.message_id}`)
          return
        }

        // Check for duplicate messages
        // Note: node-telegram-bot-api doesn't expose update_id in message events,
        // so we use message_id (0) as updateId and rely on the chatId:messageId fallback
        const isDuplicate = this.deduplicator.isDuplicate(
          0, // updateId not available in message event
          msg.message_id,
          msg.chat.id
        )

        if (isDuplicate) {
          console.log(`Skipping duplicate message: ${msg.chat.id}:${msg.message_id}`)
          return
        }

        const telegramMessage: TelegramMessage = {
          id: msg.message_id,
          chatId: msg.chat.id,
          chatTitle: msg.chat.title || '',
          chatType: msg.chat.type === 'private' ? 'private' :
                    msg.chat.type === 'supergroup' ? 'supergroup' : 'group',
          userId: msg.from!.id,
          username: msg.from!.username || '',
          firstName: msg.from!.first_name,
          content: msg.text,
          timestamp: msg.date,
          // Phase 1: no attachments support
        }

        // Apply mention gating for group messages
        if (telegramMessage.chatType !== 'private' && this.connectionStatus.botUsername) {
          // Check if this is a reply to the bot
          const isReplyToBot = msg.reply_to_message?.from?.id === this.connectionStatus.botId

          const shouldProcess = shouldProcessGroupMessage({
            content: telegramMessage.content,
            botUsername: this.connectionStatus.botUsername,
            requireMention: this.accessControlConfig?.requireMention || false,
            isReplyToBot: isReplyToBot || false
          })

          if (!shouldProcess) {
            console.log(`Skipping group message without mention: ${msg.chat.id}:${msg.message_id}`)
            return
          }
        }

        // Broadcast message activity to renderer
        this.broadcastMessageActivity({
          status: 'received',
          chatId: msg.chat.id,
          chatTitle: msg.chat.title || 'Private',
          username: msg.from!.username || msg.from!.first_name
        })

        // Add to debouncer instead of directly routing
        // The debouncer will combine rapid sequential messages and flush them after the delay
        if (this.debouncer) {
          await this.debouncer.add(telegramMessage)
        } else {
          console.warn('Debouncer not initialized, routing message directly')
          await this.routeMessage(telegramMessage)
        }

      } catch (error) {
        console.error('Error handling Telegram message:', error)
        const errorEvent: TelegramError = {
          message: 'Error processing message',
          timestamp: Date.now(),
          code: 'ROUTING_ERROR',
          originalError: error
        }
        this.emit('error', errorEvent)
      }
    })

    // Handle polling errors
    this.bot.on('polling_error', (error) => {
      console.error('Telegram polling error:', error)

      // Check if this is an auth error
      if (this.isAuthError(error)) {
        this.isTokenRevoked = true
      }

      // Trigger disconnect to initiate reconnection
      this.triggerDisconnect()

      const errorEvent: TelegramError = {
        message: 'Polling error',
        timestamp: Date.now(),
        code: 'INTERNAL_ERROR',
        originalError: error
      }
      this.emit('error', errorEvent)
    })

    // Handle webhook errors (not used in polling mode, but good to have)
    this.bot.on('webhook_error', (error) => {
      console.error('Telegram webhook error:', error)
      const errorEvent: TelegramError = {
        message: 'Webhook error',
        timestamp: Date.now(),
        code: 'INTERNAL_ERROR',
        originalError: error
      }
      this.emit('error', errorEvent)
    })
  }

  /**
   * Handle debounced message flush.
   *
   * This callback is triggered by the debouncer when messages are combined and ready to route.
   * Uses the combined content from potentially multiple rapid messages.
   */
  private async handleDebouncedMessage(debounced: DebouncedMessage): Promise<void> {
    // Take the first message as the template and replace content with combined
    const firstMsg = debounced.messages[0]
    const combinedMessage: TelegramMessage = {
      ...firstMsg,
      content: debounced.combinedContent
    }

    console.log(
      `Debounced ${debounced.messages.length} message(s) from chat ${firstMsg.chatId}:${firstMsg.userId}`
    )

    await this.routeMessage(combinedMessage)
  }

  /**
   * Route a message to the message router for processing.
   *
   * Extracted into a separate method to allow both direct routing (for skipped messages)
   * and debounced routing (for combined messages).
   */
  private async routeMessage(telegramMessage: TelegramMessage): Promise<void> {
    if (!this.messageRouter) {
      console.warn('Message router not initialized, cannot route message')
      return
    }

    try {
      // Check access control before routing
      const accessCheck = this.checkMessageAccess(telegramMessage)

      if (!accessCheck.allowed) {
        console.log(
          `Access denied for ${telegramMessage.chatType} chat ${telegramMessage.chatId}, user ${telegramMessage.userId}: ${accessCheck.reason}`
        )

        // Send rejection message with pairing code if applicable
        let rejectionMessage = accessCheck.reason || 'Access denied'
        if (accessCheck.pairingCode) {
          rejectionMessage += `\n\nPairing Code: \`${accessCheck.pairingCode}\``
        }

        await this.sendErrorFeedback(telegramMessage.chatId, rejectionMessage)
        return
      }

      this.broadcastMessageActivity({
        status: 'processing',
        chatId: telegramMessage.chatId
      })

      await this.messageRouter.routeIncomingMessage(telegramMessage)
    } catch (error) {
      console.error('Error routing message:', error)
      const errorEvent: TelegramError = {
        message: 'Error processing message',
        timestamp: Date.now(),
        code: 'ROUTING_ERROR',
        originalError: error
      }
      this.emit('error', errorEvent)
    }
  }

  /**
   * Handle session completion - deliver results back to Telegram
   *
   * This callback is triggered when the agent finishes processing a message.
   * It formats the response and sends it back to the originating Telegram chat.
   */
  private async handleSessionCompletion(result: SessionCompletionResult): Promise<void> {
    // Don't deliver if there was an error and no response text
    // (error feedback already sent by router)
    if (result.hasError && !result.responseText) {
      console.log(`Session ${result.sessionId} completed with error, skipping delivery`)
      this.broadcastMessageActivity({
        status: 'error',
        sessionId: result.sessionId,
      })
      return
    }

    // Format and deliver the result using chatId from the completion result
    await this.deliverResult(result.chatId, result.sessionId, result.responseText)

    // Broadcast completion to renderer for toast notification
    this.broadcastMessageActivity({
      status: 'complete',
      sessionId: result.sessionId,
    })
  }

  /**
   * Deliver agent result back to Telegram chat
   */
  private async deliverResult(
    chatId: number,
    sessionId: string,
    responseText: string
  ): Promise<void> {
    if (!this.bot) {
      console.error('Cannot deliver result - bot not running')
      return
    }

    try {
      // Format result for Telegram (handles chunking for 4096 char limit)
      const chunks = formatLargeResult(responseText, this.workspaceId, sessionId)

      // Send each chunk with rate limiting
      for (const chunk of chunks) {
        try {
          await this.sendMessage(chatId, chunk)
        } catch (error) {
          if (error instanceof Error && error.message.includes('queue full')) {
            // Send user-friendly error about system overload
            console.error(`Queue full, dropping message for chat ${chatId}`)
            await this.sendMessage(chatId, '⚠️ System is overloaded. Please try again in a few minutes.')
            break  // Stop trying to send chunks
          }
          throw error
        }
      }

      console.log(`✅ Delivered result to Telegram chat ${chatId} (${chunks.length} messages)`)

    } catch (error) {
      console.error('Failed to deliver result to Telegram:', error)
      // Try to send an error message
      try {
        await this.sendMessage(
          chatId,
          '❌ Sorry, I encountered an error while sending the response. Please try again.'
        )
      } catch (sendError) {
        console.error('Failed to send error message:', sendError)
      }
    }
  }

  /**
   * Send error feedback to Telegram user
   */
  private async sendErrorFeedback(chatId: number, errorMessage: string): Promise<void> {
    try {
      await this.sendMessage(chatId, errorMessage)
    } catch (error) {
      console.error('Failed to send error feedback:', error)
    }
  }

  /**
   * Broadcast connection status to all renderer windows
   */
  private broadcastConnectionStatus(): void {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.TELEGRAM_CONNECTION_STATUS, {
          workspaceId: this.workspaceId,
          accountId: this.accountId,
          status: this.connectionStatus
        })
      }
    }
  }

  /**
   * Broadcast message activity to renderer for toast notifications
   */
  private broadcastMessageActivity(data: {
    status: 'received' | 'processing' | 'complete' | 'error'
    chatId?: number
    chatTitle?: string
    username?: string
    sessionId?: string
  }): void {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.TELEGRAM_MESSAGE_ACTIVITY, {
          workspaceId: this.workspaceId,
          accountId: this.accountId,
          ...data
        })
      }
    }
  }
}

// Multi-account factory
// Key format: "workspaceId:accountId"
const services = new Map<string, TelegramService>()

/**
 * Get or create a TelegramService instance for a specific workspace and account.
 * Supports multiple bot accounts per workspace.
 *
 * @param workspaceId - Workspace ID
 * @param accountId - Account ID (default: 'default')
 * @returns TelegramService instance
 */
export function getTelegramService(
  workspaceId: string,
  accountId: string = 'default'
): TelegramService {
  const key = `${workspaceId}:${accountId}`
  if (!services.has(key)) {
    services.set(key, new TelegramService(workspaceId, accountId))
  }
  return services.get(key)!
}

/**
 * Get all active TelegramService instances for a workspace.
 * Used for workspace-wide operations like cleanup.
 *
 * @param workspaceId - Workspace ID
 * @returns Array of TelegramService instances
 */
export function getAllTelegramServicesForWorkspace(
  workspaceId: string
): TelegramService[] {
  const result: TelegramService[] = []
  for (const [key, service] of services.entries()) {
    if (key.startsWith(`${workspaceId}:`)) {
      result.push(service)
    }
  }
  return result
}
