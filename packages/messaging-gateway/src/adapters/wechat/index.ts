/**
 * WeChatAdapter — in-process adapter using WeChat's official iLink Bot API.
 *
 * Transport: long-polling via HTTP/JSON (no WebSocket, no webhook needed).
 * Same lifecycle shape as the Telegram adapter, just a different transport.
 *
 * Phase 1 scope: text messaging in DMs, QR scan login, /pair-style commands.
 * Phase 2 layers on media attachments, groups, and rich formatting.
 */

import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type {
  PlatformAdapter,
  PlatformConfig,
  AdapterCapabilities,
  IncomingMessage,
  SentMessage,
  MessagingLogger,
  SendOptions,
} from '../../types'
import { iLinkClient, type iLinkMessage } from './ilink'
import { formatForWeChat, splitMessage } from './format'

/**
 * Hard cap for downloaded attachment size. Matches Telegram's limit.
 */
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

const NOOP_LOGGER: MessagingLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => NOOP_LOGGER,
}

/**
 * QR scan login status emitted to the UI.
 */
export interface WeChatQRStatus {
  status: 'waiting' | 'scanned' | 'confirmed' | 'expired' | 'error'
  qrImageBase64?: string
  botToken?: string
  error?: string
}

/**
 * Callback type for QR login flow events.
 */
export type WeChatQRCallback = (status: WeChatQRStatus) => void

export class WeChatAdapter implements PlatformAdapter {
  readonly platform = 'wechat' as const
  readonly capabilities: AdapterCapabilities = {
    messageEditing: false,
    inlineButtons: false,
    maxButtons: 0,
    maxMessageLength: 4000,
    markdown: 'wechat',
    webhookSupport: false,
  }

  private client: iLinkClient
  private botToken: string = ''
  private connected = false
  private destroyed = false
  private messageHandler: ((msg: IncomingMessage) => Promise<void>) | null = null
  private buttonHandler: (() => Promise<void>) | null = null
  private log: MessagingLogger = NOOP_LOGGER
  private abortController: AbortController | null = null
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private getUpdatesBuf = ''

  /**
   * Store the most recent context_token per user for outbound messages.
   * This is critical — WeChat requires echoing the context_token from
   * inbound messages in outbound replies.
   */
  private contextTokens = new Map<string, string>()

  /**
   * Optional callback for QR login flow events. Set during the QR
   * scan login process to push status updates to the UI.
   */
  private qrCallback: WeChatQRCallback | null = null

  constructor() {
    this.client = new iLinkClient()
  }

  async initialize(config: PlatformConfig): Promise<void> {
    if (!config.token) {
      throw new Error('[wechat] bot_token is required')
    }

    this.log = config.logger ?? NOOP_LOGGER
    this.botToken = config.token
    this.client = new iLinkClient(this.log.child({ component: 'wechat-ilink' }))

    // Note: token validation was already done in testWeChatCredentials (manual)
    // or trusted by iLink server (QR scan). If the token is invalid,
    // the first getUpdates call will surface the error.
    this.log.info('[wechat] starting polling')
    this.destroyed = false
    this.reconnectAttempts = 0
    this.startPolling()
  }

  /**
   * Start the QR scan login flow. This is an alternative to initialize()
   * for first-time setup when the user doesn't have a bot_token yet.
   *
   * Emits status updates via the qrCallback.
   */
  async startQRLogin(callback: WeChatQRCallback): Promise<void> {
    this.qrCallback = callback
    this.log = NOOP_LOGGER
    this.client = new iLinkClient(this.log.child({ component: 'wechat-ilink' }))

    try {
      // Step 1: Get QR code
      callback({ status: 'waiting' })
      const qrResponse = await this.client.getBotQRCode()

      callback({
        status: 'waiting',
        qrImageBase64: qrResponse.qrcode_img_content,
      })

      // Step 2: Poll scan status
      let attempts = 0
      const maxAttempts = 120 // ~2 minutes at 1s interval

      while (attempts < maxAttempts) {
        if (this.destroyed) {
          callback({ status: 'error', error: 'Login cancelled' })
          return
        }

        const status = await this.client.getQRCodeStatus(qrResponse.qrcode)

        if (status.status === 'confirmed' && status.bot_token) {
          this.botToken = status.bot_token
          callback({
            status: 'confirmed',
            botToken: status.bot_token,
          })
          return
        }

        if (status.status === 'expired') {
          callback({ status: 'expired' })
          return
        }

        if (status.status === 'scanned') {
          callback({ status: 'scanned' })
        }

        attempts++
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }

      callback({ status: 'expired' })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      callback({ status: 'error', error: message })
    }
  }

  /**
   * After a successful QR login, call this to initialize polling
   * with the obtained bot_token.
   */
  async initializeWithToken(botToken: string): Promise<void> {
    this.botToken = botToken
    this.destroyed = false
    this.reconnectAttempts = 0
    this.getUpdatesBuf = ''
    this.startPolling()
  }

  private startPolling(): void {
    if (this.destroyed) return

    this.abortController = new AbortController()

    const poll = async (): Promise<void> => {
      while (!this.destroyed) {
        try {
          const result = await this.client.getUpdates(
            this.getUpdatesBuf,
            this.botToken,
            this.abortController?.signal,
          )

          // iLink API success: no errcode, has msgs and sync_buf
          // iLink API failure: has errcode and errmsg
          const isSuccess = !result.errcode && result.errcode !== 0
          if (isSuccess) {
            // Update cursor
            if (result.get_updates_buf) {
              this.getUpdatesBuf = result.get_updates_buf
            }

            // Mark connected on first successful poll — BEFORE processing
            // messages so that replies can be sent back immediately.
            if (!this.connected) {
              this.connected = true
              this.reconnectAttempts = 0
              this.log.info('[wechat] polling connected')
            }

            // Process messages
            if (result.msgs && result.msgs.length > 0) {
              this.log.info('[wechat] received messages', {
                count: result.msgs.length,
                handlerSet: !!this.messageHandler,
                types: result.msgs.map((m: any) => ({ type: m.message_type, from: m.from_user_id })),
              })
            }
            if (result.msgs && this.messageHandler) {
              for (const msg of result.msgs) {
                if (msg.message_type === 1) { // User message only
                  await this.handleInboundMessage(msg)
                }
              }
            } else if (result.msgs && result.msgs.length > 0 && !this.messageHandler) {
              this.log.warn('[wechat] messages received but no messageHandler set!')
            }
          } else {
            const errcode = result.errcode
            const errmsg = result.errmsg

            // errcode -14 = session timeout, need to re-login
            if (errcode === -14) {
              this.log.error('[wechat] session timeout — bot_token expired, need re-login', { errcode, errmsg })
              this.connected = false
              // Don't reconnect — token is dead, user must re-scan QR
              this.destroyed = true
              return
            }

            this.log.warn('[wechat] getUpdates returned error', { ret: result.ret, errcode, errmsg, get_updates_buf: result.get_updates_buf?.substring(0, 20) })
          }
        } catch (err: unknown) {
          if (this.destroyed) break

          // AbortError means we're shutting down
          if (err instanceof Error && err.name === 'AbortError') break

          this.log.error('[wechat] polling error', {
            error: err instanceof Error ? err.message : String(err),
          })

          // Schedule reconnect
          this.connected = false
          this.scheduleReconnect()
          return
        }
      }
    }

    poll().catch((err) => {
      this.log.error('[wechat] polling loop crashed', {
        error: err instanceof Error ? err.message : String(err),
      })
    })
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return

    this.reconnectAttempts++
    const delay = Math.min(5_000 * Math.pow(2, this.reconnectAttempts - 1), 5 * 60_000)

    this.log.warn('[wechat] scheduling reconnect', {
      attempt: this.reconnectAttempts,
      delayMs: delay,
    })

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.destroyed) {
        this.log.info('[wechat] attempting reconnect', { attempt: this.reconnectAttempts })
        this.startPolling()
      }
    }, delay)
  }

  /**
   * Map an iLink inbound message to our standard IncomingMessage.
   */
  private async handleInboundMessage(msg: iLinkMessage): Promise<void> {
    this.log.info('[wechat] handleInboundMessage', {
      from: msg.from_user_id,
      to: msg.to_user_id,
      type: msg.message_type,
      itemCount: msg.item_list?.length,
      contextToken: msg.context_token?.substring(0, 8) + '...',
      handlerSet: !!this.messageHandler,
    })
    if (!this.messageHandler) return

    // Store context token for this user (needed for replies)
    this.contextTokens.set(msg.from_user_id, msg.context_token)

    // Extract text from first text item
    const textItem = msg.item_list?.find((item) => item.type === 1)
    const text = textItem?.text_item?.text ?? ''

    // Process attachments
    const attachments: IncomingMessage[] = []
    const incomingAttachments: NonNullable<IncomingMessage['attachments']> = []

    for (const item of msg.item_list ?? []) {
      if (item.type === 2 && item.image_item) {
        // Image — download and decrypt from CDN
        try {
          const buffer = await this.client.downloadMedia(
            item.image_item.cdn_big_img_url,
            item.image_item.aes_key,
          )
          const localPath = join(tmpdir(), `wechat-${randomBytes(8).toString('hex')}.jpg`)
          writeFileSync(localPath, buffer)
          incomingAttachments.push({
            type: 'photo',
            fileId: item.image_item.md5,
            fileName: 'image.jpg',
            mimeType: 'image/jpeg',
            fileSize: buffer.byteLength,
            localPath,
          })
        } catch (err) {
          this.log.error('[wechat] failed to download image', {
            error: err instanceof Error ? err.message : String(err),
          })
        }
      } else if (item.type === 4 && item.file_item) {
        // File attachment
        try {
          const buffer = await this.client.downloadMedia(
            item.file_item.cdn_file_url,
            item.file_item.aes_key,
          )
          if (buffer.byteLength > MAX_ATTACHMENT_BYTES) {
            this.log.warn('[wechat] file attachment too large, skipping', {
              size: buffer.byteLength,
            })
            continue
          }
          const localPath = join(
            tmpdir(),
            `wechat-${randomBytes(8).toString('hex')}-${item.file_item.file_name}`,
          )
          writeFileSync(localPath, buffer)
          incomingAttachments.push({
            type: 'document',
            fileId: item.file_item.md5,
            fileName: item.file_item.file_name,
            fileSize: item.file_item.total_len,
            localPath,
          })
        } catch (err) {
          this.log.error('[wechat] failed to download file', {
            error: err instanceof Error ? err.message : String(err),
          })
        }
      } else if (item.type === 3 && item.voice_item) {
        // Voice
        try {
          const buffer = await this.client.downloadMedia(
            item.voice_item.cdn_voice_url,
            item.voice_item.aes_key,
          )
          const localPath = join(tmpdir(), `wechat-${randomBytes(8).toString('hex')}.silk`)
          writeFileSync(localPath, buffer)
          incomingAttachments.push({
            type: 'voice',
            fileId: item.voice_item.md5,
            mimeType: 'audio/silk',
            fileSize: buffer.byteLength,
            localPath,
          })
          // If voice has transcription, append to text
          if (item.voice_item.voice_text) {
            // We'll add it to the message text below
          }
        } catch (err) {
          this.log.error('[wechat] failed to download voice', {
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
      // Video (type=5) is not supported in Phase 1
    }

    const incoming: IncomingMessage = {
      platform: 'wechat',
      channelId: msg.from_user_id,
      messageId: `${Date.now()}-${randomBytes(4).toString('hex')}`,
      senderId: msg.from_user_id,
      senderName: undefined, // iLink doesn't provide sender names
      text,
      attachments: incomingAttachments.length > 0 ? incomingAttachments : undefined,
      timestamp: msg.create_time ? msg.create_time * 1000 : Date.now(),
      raw: msg,
    }

    await this.messageHandler(incoming)
  }

  // ---- PlatformAdapter interface ----

  async destroy(): Promise<void> {
    this.destroyed = true
    this.connected = false
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.contextTokens.clear()
  }

  isConnected(): boolean {
    return this.connected
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void {
    this.messageHandler = handler
  }

  onButtonPress(_handler: (press: never) => Promise<void>): void {
    // WeChat doesn't support inline buttons — no-op
  }

  async sendText(channelId: string, text: string, _opts?: SendOptions): Promise<SentMessage> {
    if (!this.botToken) throw new Error('[wechat] not initialized')

    this.log.info('[wechat] sendText', {
      channelId: channelId.substring(0, 20),
      textLen: text.length,
    })

    const contextToken = this.contextTokens.get(channelId) ?? ''
    const formatted = formatForWeChat(text)

    // Split long messages
    const chunks = splitMessage(formatted, this.capabilities.maxMessageLength)

    let lastMsgId = ''
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!
      const result = await this.client.sendTextMessage(
        channelId,
        contextToken,
        chunk,
        this.botToken,
      )
      if (result.msg_id) {
        lastMsgId = result.msg_id
      }
    }

    return {
      platform: 'wechat',
      channelId,
      messageId: lastMsgId || `wechat-${Date.now()}`,
    }
  }

  async editMessage(
    _channelId: string,
    _messageId: string,
    _text: string,
    _opts?: SendOptions,
  ): Promise<void> {
    // WeChat doesn't support message editing — no-op
    this.log.warn('[wechat] editMessage called but WeChat does not support editing')
  }

  async sendButtons(
    channelId: string,
    text: string,
    _buttons: never[],
    opts?: SendOptions,
  ): Promise<SentMessage> {
    // WeChat doesn't support inline buttons — send as plain text
    return this.sendText(channelId, text, opts)
  }

  async sendTyping(channelId: string, _opts?: SendOptions): Promise<void> {
    if (!this.botToken) return

    try {
      const config = await this.client.getConfig(this.botToken)
      if (config.typing_ticket) {
        await this.client.sendTyping(channelId, config.typing_ticket, this.botToken)
      }
    } catch {
      // Typing indicator is best-effort
    }
  }

  async sendFile(
    channelId: string,
    file: Buffer,
    filename: string,
    caption?: string,
    _opts?: SendOptions,
  ): Promise<SentMessage> {
    if (!this.botToken) throw new Error('[wechat] not initialized')

    const contextToken = this.contextTokens.get(channelId) ?? ''

    // Upload file to CDN
    const { aesKey } = await this.client.uploadMedia(file, filename, this.botToken)

    // Send file message
    const result = await this.client.sendMessage(
      channelId,
      contextToken,
      [{
        type: 4,
        file_item: {
          aes_key: aesKey,
          cdn_file_url: '', // Will be set by the server
          file_name: filename,
          md5: '',
          total_len: file.byteLength,
        },
      }],
      this.botToken,
    )

    // If there's a caption, send it as a separate text message
    if (caption) {
      await this.client.sendTextMessage(channelId, contextToken, caption, this.botToken)
    }

    return {
      platform: 'wechat',
      channelId,
      messageId: result.msg_id || `wechat-file-${Date.now()}`,
    }
  }

  /** Get the current bot token (for credential persistence). */
  getBotToken(): string {
    return this.botToken
  }
}
