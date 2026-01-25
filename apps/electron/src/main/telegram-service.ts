import { EventEmitter } from 'events'
import TelegramBot from 'node-telegram-bot-api'
import type { TelegramMessage, TelegramConnectionStatus, TelegramError } from '@vesper/shared/telegram'
import type { CredentialManager } from '@vesper/shared/credentials'
import { createMessageRouter, type TelegramMessageRouter, type SessionCompletionResult } from '@vesper/shared/telegram/message-router'
import { formatLargeResult } from '@vesper/shared/telegram/result-formatter'
import { showNotification } from './notifications'
import { IPC_CHANNELS } from '../shared/types'
import { BrowserWindow } from 'electron'

/**
 * Delay between sending messages to avoid Telegram rate limiting (in ms)
 * Telegram allows 30 messages/second, so 35ms delay is safe
 */
const MESSAGE_SEND_DELAY_MS = 35

/**
 * Queue for rate-limited message sending
 */
class MessageQueue {
  private queue: Array<{ chatId: number; text: string; resolve: (messageId: number) => void; reject: (error: Error) => void }> = []
  private processing = false

  constructor(
    private bot: TelegramBot,
    private delayMs: number = MESSAGE_SEND_DELAY_MS
  ) {}

  async enqueue(chatId: number, text: string): Promise<number> {
    return new Promise((resolve, reject) => {
      this.queue.push({ chatId, text, resolve, reject })
      if (!this.processing) {
        void this.processQueue()
      }
    })
  }

  private async processQueue(): Promise<void> {
    this.processing = true

    while (this.queue.length > 0) {
      const item = this.queue.shift()
      if (!item) break

      try {
        const sentMessage = await this.bot.sendMessage(item.chatId, item.text, {
          parse_mode: 'Markdown',
          disable_web_page_preview: false
        })
        item.resolve(sentMessage.message_id)
      } catch (error) {
        item.reject(error as Error)
      }

      // Rate limiting delay
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

  constructor(private workspaceId: string) {
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
      this.messageRouter = createMessageRouter(this.workspaceId, sessionManager)
      // Wire up error feedback callback so routing errors get sent back to Telegram
      this.messageRouter.setErrorFeedbackCallback(this.sendErrorFeedback.bind(this))
      // Wire up session completion callback to deliver results back to Telegram
      this.completionUnsubscribe = this.messageRouter.onSessionComplete(
        this.handleSessionCompletion.bind(this)
      )
    }
  }

  /**
   * Start the Telegram bot with the given token
   */
  async start(botToken: string): Promise<void> {
    if (this.isRunning) {
      throw new Error('Telegram service is already running')
    }

    try {
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

      // Save credentials if credential manager is set
      if (this.credentialManager) {
        await this.credentialManager.setTelegramBotToken(this.workspaceId, botToken)
      }

      // Initialize message queue
      this.messageQueue = new MessageQueue(this.bot)

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

    } catch (error) {
      this.connectionStatus = {
        isConnected: false,
        isConnecting: false,
        lastDisconnect: {
          error: error as Error,
          date: new Date()
        }
      }
      this.broadcastConnectionStatus()

      const errorEvent: TelegramError = {
        message: 'Failed to start Telegram bot',
        timestamp: Date.now(),
        code: 'INTERNAL_ERROR',
        originalError: error
      }
      this.emit('error', errorEvent)

      throw error
    }
  }

  /**
   * Stop the Telegram bot
   */
  async stop(): Promise<void> {
    if (!this.isRunning || !this.bot) {
      return
    }

    try {
      // Stop polling
      await this.bot.stopPolling()

      // Clean up message router
      if (this.messageRouter) {
        this.messageRouter.cleanup()
      }

      // Unsubscribe from completion callbacks
      if (this.completionUnsubscribe) {
        this.completionUnsubscribe()
        this.completionUnsubscribe = null
      }

      // Delete credentials if credential manager is set
      if (this.credentialManager) {
        await this.credentialManager.deleteTelegramBotToken(this.workspaceId)
      }

      this.bot = null
      this.messageQueue = null
      this.isRunning = false
      this.connectionStatus = {
        isConnected: false,
        isConnecting: false
      }
      this.broadcastConnectionStatus()

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
      return await this.messageQueue.enqueue(chatId, text)
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

        // Broadcast message activity to renderer
        this.broadcastMessageActivity({
          status: 'received',
          chatId: msg.chat.id,
          chatTitle: msg.chat.title || 'Private',
          username: msg.from!.username || msg.from!.first_name
        })

        // Route to message router
        if (this.messageRouter) {
          this.broadcastMessageActivity({
            status: 'processing',
            chatId: msg.chat.id
          })

          await this.messageRouter.routeIncomingMessage(telegramMessage)
        } else {
          console.warn('Message router not initialized, cannot route message')
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
        await this.sendMessage(chatId, chunk)
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
          ...data
        })
      }
    }
  }
}

// Singleton factory
const services = new Map<string, TelegramService>()

export function getTelegramService(workspaceId: string): TelegramService {
  if (!services.has(workspaceId)) {
    services.set(workspaceId, new TelegramService(workspaceId))
  }
  return services.get(workspaceId)!
}
