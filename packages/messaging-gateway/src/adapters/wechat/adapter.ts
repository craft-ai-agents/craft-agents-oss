/**
 * WeChatAdapter — text-MVP adapter for the iLink bot channel.
 *
 * What's wired:
 *   - Long-poll loop on `getupdates` (server-suggested timeout, exponential
 *     backoff on transient errors, restart on session-timeout error code).
 *   - Inbound text + voice-transcription extraction → IncomingMessage.
 *   - Outbound `sendText` against `sendmessage`, echoing the per-recipient
 *     `context_token` captured from the latest inbound from that user.
 *   - `sendTyping` against `sendtyping`, lazily fetching `typing_ticket`
 *     via `getconfig` and caching it per-recipient.
 *   - `get_updates_buf` cursor persisted to disk so a restart resumes the
 *     stream without rewinding.
 *
 * Not yet wired (deferred to follow-up stages):
 *   - Inbound media (image / video / file) — protocol layer is in place but
 *     CDN AES decryption needs porting first.
 *   - `editMessage` — iLink protocol has no in-place edit; treat as no-op.
 *   - `sendButtons` — iLink has no inline buttons; throws "unsupported".
 *   - `sendFile` — needs CDN AES upload (stage 5).
 *   - Group chat — openclaw's process-message pins `isGroup: false`; same here.
 *
 * Reactive only: `sendText` requires that the recipient has messaged the bot
 * at least once in the lifetime of this adapter (so we have a context_token).
 */

import { Buffer } from 'node:buffer'
import type {
  AdapterCapabilities,
  ButtonPress,
  IncomingMessage,
  InlineButton,
  MessagingLogger,
  PlatformAdapter,
  PlatformConfig,
  SendOptions,
  SentMessage,
} from '../../types'
import { randomUUID } from 'node:crypto'
import { extname } from 'node:path'
import { downloadInboundMedia } from './cdn/media-download'
import { uploadMedia, type UploadedMedia } from './cdn/media-upload'
import { getConfig, getUpdates, sendMessage, sendTyping, type WeixinClientIdentity } from './protocol/api'
import {
  MessageItemType,
  MessageState,
  MessageType,
  TypingStatus,
  UploadMediaType,
  type MessageItem,
  type WeixinMessage,
} from './protocol/types'
import { parseWeChatCredentials, type WeChatCredentials } from './index'
import { loadSyncBuf, saveSyncBuf, syncBufPath } from './sync-buf'

const NOOP_LOGGER: MessagingLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => NOOP_LOGGER,
}

/**
 * iLink server error code returned when the long-poll session expires. The
 * caller is expected to drop `get_updates_buf` and start fresh — the next
 * call will succeed against an empty cursor.
 */
const ILINK_ERR_SESSION_TIMEOUT = -14

/** Soft cap on outbound text length. iLink is more permissive than 4096 in
 *  practice but Markdown-heavy responses can balloon, so we keep parity
 *  with the WhatsApp / Telegram defaults. */
const MAX_TEXT_LENGTH = 4000

/** Backoff window for repeated transient errors. */
const POLL_ERROR_BACKOFF_MS = 5_000

/** Typing tickets aren't versioned by Tencent — treat them as long-lived
 *  but refresh every hour to handle rotation gracefully. */
const TYPING_TICKET_TTL_MS = 60 * 60_000

export interface WeChatAdapterConfig extends PlatformConfig {
  /** Per-workspace identity headers. */
  identity: WeixinClientIdentity
  /** Base directory for sync-buf persistence (typically the workspace messaging dir). */
  stateDir: string
}

interface TypingTicketEntry {
  ticket: string
  expiresAt: number
}

export class WeChatAdapter implements PlatformAdapter {
  readonly platform = 'wechat' as const
  readonly capabilities: AdapterCapabilities = {
    messageEditing: false,
    inlineButtons: false,
    maxButtons: 0,
    maxMessageLength: MAX_TEXT_LENGTH,
    markdown: 'wechat',
    webhookSupport: false,
  }

  private credentials: WeChatCredentials | null = null
  private identity: WeixinClientIdentity | null = null
  private stateDir = ''
  private log: MessagingLogger = NOOP_LOGGER

  private connected = false
  private polling = false
  private getUpdatesBuf = ''

  /** userId → most recent context_token. Outbound calls MUST echo this. */
  private readonly contextTokens = new Map<string, string>()
  /** userId → cached typing ticket (refreshed lazily). */
  private readonly typingTickets = new Map<string, TypingTicketEntry>()

  private messageHandler: (msg: IncomingMessage) => Promise<void> = async () => {}
  private buttonHandler: (press: ButtonPress) => Promise<void> = async () => {}

  async initialize(config: PlatformConfig): Promise<void> {
    const adapterConfig = assertWeChatConfig(config)
    this.credentials = parseWeChatCredentials(adapterConfig.token)
    this.identity = adapterConfig.identity
    this.stateDir = adapterConfig.stateDir
    this.log = (config.logger ?? NOOP_LOGGER).child({
      component: 'wechat-adapter',
      platform: 'wechat',
    })
    this.getUpdatesBuf = loadSyncBuf(syncBufPath(this.stateDir, this.credentials.ilinkBotId))
    this.connected = true
    this.startPolling()
  }

  async destroy(): Promise<void> {
    this.polling = false
    this.connected = false
    this.contextTokens.clear()
    this.typingTickets.clear()
  }

  isConnected(): boolean {
    return this.connected
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void {
    this.messageHandler = handler
  }

  onButtonPress(handler: (press: ButtonPress) => Promise<void>): void {
    this.buttonHandler = handler
  }

  async sendText(channelId: string, text: string, _opts?: SendOptions): Promise<SentMessage> {
    const contextToken = this.requireContextToken(channelId)
    const messageId = await this.sendOutboundMessage(channelId, contextToken, [
      { type: MessageItemType.TEXT, text_item: { text: clampText(text) } },
    ])
    return { platform: 'wechat', channelId, messageId }
  }

  async editMessage(_channelId: string, _messageId: string, _text: string, _opts?: SendOptions): Promise<void> {
    // iLink has no in-place edit. Renderer's progress-mode rebuilds the
    // message via a fresh send, so silently no-op here keeps the contract
    // intact without surfacing a confusing error.
  }

  async sendButtons(
    _channelId: string,
    _text: string,
    _buttons: InlineButton[],
    _opts?: SendOptions,
  ): Promise<SentMessage> {
    throw new Error('WeChat: inline buttons are not supported by the iLink protocol')
  }

  async sendTyping(channelId: string, _opts?: SendOptions): Promise<void> {
    const { credentials, identity } = this.requireReady()
    let ticket: string
    try {
      ticket = await this.getOrFetchTypingTicket(channelId)
    } catch (err) {
      this.log.warn('typing ticket unavailable, skipping sendTyping', {
        event: 'wechat_typing_ticket_failed',
        channelId,
        error: errMessage(err),
      })
      return
    }

    try {
      await sendTyping({
        baseUrl: credentials.baseUrl,
        identity,
        token: credentials.botToken,
        body: {
          ilink_user_id: channelId,
          typing_ticket: ticket,
          status: TypingStatus.TYPING,
        },
        logger: this.log,
      })
    } catch (err) {
      // Typing is best-effort; never throw upstream.
      this.log.warn('sendTyping failed', {
        event: 'wechat_send_typing_failed',
        channelId,
        error: errMessage(err),
      })
    }
  }

  async sendFile(
    channelId: string,
    file: Buffer,
    filename: string,
    caption?: string,
    _opts?: SendOptions,
  ): Promise<SentMessage> {
    const { credentials, identity } = this.requireReady()
    const contextToken = this.requireContextToken(channelId)

    const kind = classifyMedia(filename)
    const uploaded = await uploadMedia({
      buffer: file,
      toUserId: channelId,
      baseUrl: credentials.baseUrl,
      identity,
      token: credentials.botToken,
      mediaType: kind.mediaType,
      label: `wechat-upload-${kind.kind}`,
      logger: this.log,
    })

    // openclaw splits caption + media into two consecutive sendmessage
    // requests rather than packing both items into one item_list. Mirroring
    // that here keeps recipient-side rendering identical and avoids an iLink
    // edge case where mixed item_lists are silently dropped.
    if (caption && caption.trim()) {
      await this.sendOutboundMessage(channelId, contextToken, [
        { type: MessageItemType.TEXT, text_item: { text: clampText(caption) } },
      ])
    }

    const mediaItem = buildMediaItem(kind.kind, filename, uploaded)
    const messageId = await this.sendOutboundMessage(channelId, contextToken, [mediaItem])
    return { platform: 'wechat', channelId, messageId }
  }

  /**
   * Internal helper: send one outbound message frame. Used by both `sendText`
   * and `sendFile` to keep the BOT/FINISH/client_id/from_user_id boilerplate
   * in one place. Returns the synthesised client_id for the caller to surface
   * as `SentMessage.messageId`.
   */
  private async sendOutboundMessage(
    channelId: string,
    contextToken: string,
    items: MessageItem[],
  ): Promise<string> {
    const { credentials, identity } = this.requireReady()
    const clientId = `craft-agents-${randomUUID()}`
    const payload: WeixinMessage = {
      from_user_id: '',
      to_user_id: channelId,
      client_id: clientId,
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      context_token: contextToken,
      item_list: items,
    }
    await sendMessage({
      baseUrl: credentials.baseUrl,
      identity,
      token: credentials.botToken,
      body: { msg: payload },
      logger: this.log,
    })
    return clientId
  }

  // -------------------------------------------------------------------------
  // Long-poll loop
  // -------------------------------------------------------------------------

  private startPolling(): void {
    this.polling = true
    void this.runPollLoop().catch((err) => {
      this.log.error('wechat poll loop crashed', {
        event: 'wechat_poll_loop_crashed',
        error: errMessage(err),
      })
      this.connected = false
    })
  }

  private async runPollLoop(): Promise<void> {
    const { credentials, identity } = this.requireReady()
    while (this.polling) {
      try {
        const resp = await getUpdates({
          baseUrl: credentials.baseUrl,
          identity,
          token: credentials.botToken,
          get_updates_buf: this.getUpdatesBuf,
          logger: this.log,
        })

        if (resp.errcode === ILINK_ERR_SESSION_TIMEOUT) {
          this.log.warn('wechat session timeout, resetting cursor', {
            event: 'wechat_session_timeout',
            errcode: resp.errcode,
            errmsg: resp.errmsg,
          })
          this.getUpdatesBuf = ''
          this.persistSyncBuf()
          continue
        }

        if (typeof resp.get_updates_buf === 'string' && resp.get_updates_buf !== this.getUpdatesBuf) {
          this.getUpdatesBuf = resp.get_updates_buf
          this.persistSyncBuf()
        }

        for (const message of resp.msgs ?? []) {
          await this.dispatchInbound(message)
        }
      } catch (err) {
        if (!this.polling) return
        this.log.warn('wechat getUpdates error, backing off', {
          event: 'wechat_get_updates_error',
          error: errMessage(err),
        })
        await sleep(POLL_ERROR_BACKOFF_MS)
      }
    }
  }

  private persistSyncBuf(): void {
    if (!this.credentials) return
    try {
      saveSyncBuf(syncBufPath(this.stateDir, this.credentials.ilinkBotId), this.getUpdatesBuf)
    } catch (err) {
      this.log.warn('failed to persist sync-buf', {
        event: 'wechat_sync_buf_persist_failed',
        error: errMessage(err),
      })
    }
  }

  private async dispatchInbound(message: WeixinMessage): Promise<void> {
    if (message.message_type !== MessageType.USER) return
    if (!message.from_user_id) return

    // Always refresh the context_token so the next outbound replies in the
    // same conversation thread, even when the inbound has no extractable text
    // (e.g. an image we don't yet decode).
    if (typeof message.context_token === 'string' && message.context_token) {
      this.contextTokens.set(message.from_user_id, message.context_token)
    }

    const text = extractInboundText(message.item_list)
    const attachments = await downloadInboundMedia(message.item_list, { logger: this.log })

    if (!text && attachments.length === 0) {
      // No renderable payload reached the agent. Drop the message but log
      // enough context to debug "I sent a video and the bot saw nothing"
      // reports — `downloadInboundMedia` already logs the per-item failure
      // reason, this surfaces the upstream "we received N items but kept 0".
      this.log.warn('wechat inbound message dropped (no text, no attachments)', {
        event: 'wechat_inbound_dropped_empty',
        senderId: message.from_user_id,
        messageId: message.message_id,
        itemTypes: (message.item_list ?? []).map((i) => i.type),
      })
      return
    }

    try {
      await this.messageHandler({
        platform: 'wechat',
        channelId: message.from_user_id,
        messageId: String(message.message_id ?? `wc_in_${Date.now()}`),
        senderId: message.from_user_id,
        text,
        attachments: attachments.length > 0 ? attachments : undefined,
        timestamp: message.create_time_ms ?? Date.now(),
        raw: message,
      })
    } catch (err) {
      this.log.error('wechat inbound handler threw', {
        event: 'wechat_inbound_handler_error',
        senderId: message.from_user_id,
        error: errMessage(err),
      })
    }
  }

  // -------------------------------------------------------------------------
  // Typing-ticket cache
  // -------------------------------------------------------------------------

  private async getOrFetchTypingTicket(channelId: string): Promise<string> {
    const cached = this.typingTickets.get(channelId)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.ticket
    }

    const { credentials, identity } = this.requireReady()
    const contextToken = this.contextTokens.get(channelId)
    const resp = await getConfig({
      baseUrl: credentials.baseUrl,
      identity,
      token: credentials.botToken,
      ilinkUserId: channelId,
      contextToken,
      logger: this.log,
    })
    const ticket = resp.typing_ticket
    if (!ticket) throw new Error('iLink getconfig returned no typing_ticket')

    this.typingTickets.set(channelId, {
      ticket,
      expiresAt: Date.now() + TYPING_TICKET_TTL_MS,
    })
    return ticket
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private requireReady(): { credentials: WeChatCredentials; identity: WeixinClientIdentity } {
    if (!this.credentials || !this.identity) {
      throw new Error('WeChatAdapter: initialize() has not been called')
    }
    return { credentials: this.credentials, identity: this.identity }
  }

  /**
   * Reactive-only guarantee: outbound sends MUST piggyback on the context the
   * recipient established by messaging us first. Centralised so both
   * `sendText` and `sendFile` surface the same actionable error.
   */
  private requireContextToken(channelId: string): string {
    const contextToken = this.contextTokens.get(channelId)
    if (!contextToken) {
      throw new Error(
        `WeChat: no context_token cached for ${channelId} — the recipient must message the bot first`,
      )
    }
    return contextToken
  }
}

// ---------------------------------------------------------------------------
// Outbound media helpers
// ---------------------------------------------------------------------------

type MediaKind = 'image' | 'video' | 'file'

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.bmp'])
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.m4v', '.webm'])

/**
 * Pick the appropriate media bucket for an outbound payload. iLink demands
 * the right `media_type` enum on getuploadurl AND the right MessageItem
 * shape on sendmessage — getting it wrong silently drops the payload (or
 * worse, surfaces it as an undisplayable item on the recipient).
 */
function classifyMedia(filename: string): {
  kind: MediaKind
  mediaType: (typeof UploadMediaType)[keyof typeof UploadMediaType]
} {
  const ext = extname(filename).toLowerCase()
  if (IMAGE_EXTS.has(ext)) return { kind: 'image', mediaType: UploadMediaType.IMAGE }
  if (VIDEO_EXTS.has(ext)) return { kind: 'video', mediaType: UploadMediaType.VIDEO }
  return { kind: 'file', mediaType: UploadMediaType.FILE }
}

/**
 * Build the outbound MessageItem for an uploaded media. The hex aeskey is
 * wrapped in `Buffer.from(hex).toString('base64')` rather than re-encoded —
 * receivers (including ourselves on the inbound path) detect the 32-char hex
 * shape and decode it back, matching openclaw's wire format.
 */
function buildMediaItem(kind: MediaKind, filename: string, uploaded: UploadedMedia): MessageItem {
  const aesKeyBase64 = Buffer.from(uploaded.aeskeyHex).toString('base64')
  const media = {
    encrypt_query_param: uploaded.downloadEncryptedQueryParam,
    aes_key: aesKeyBase64,
    encrypt_type: 1,
  }
  switch (kind) {
    case 'image':
      // Mirrors openclaw's `sendImageMessageWeixin` exactly — only `mid_size`
      // populated. `hd_size` and a top-level `aeskey` exist on the protocol
      // type but openclaw's send path never sets them, so we don't either:
      // openclaw's wire format is the known-working baseline and we'd rather
      // a recipient render-failure surface as a "matches reference, debug
      // upstream" issue than as a "we invented fields, who knows" one.
      return {
        type: MessageItemType.IMAGE,
        image_item: {
          media,
          mid_size: uploaded.cipherSize,
        },
      }
    case 'video':
      return {
        type: MessageItemType.VIDEO,
        video_item: {
          media,
          video_size: uploaded.cipherSize,
        },
      }
    case 'file':
      return {
        type: MessageItemType.FILE,
        file_item: {
          media,
          file_name: filename,
          len: String(uploaded.plainSize),
        },
      }
  }
}

function assertWeChatConfig(config: PlatformConfig): WeChatAdapterConfig {
  const c = config as Partial<WeChatAdapterConfig>
  if (!c.identity) throw new Error('WeChatAdapter: identity is required')
  if (!c.stateDir) throw new Error('WeChatAdapter: stateDir is required')
  if (!c.token) throw new Error('WeChatAdapter: token (credential JSON) is required')
  return config as WeChatAdapterConfig
}

/**
 * Pull a renderable text body from an iLink message.
 *
 * Mirrors openclaw's `bodyFromItemList`:
 *   - Plain TEXT items become the body verbatim.
 *   - VOICE items use the server-side transcription (`voice_item.text`)
 *     when present.
 *   - A `ref_msg` quote is prefixed as "[引用: …]\n" so the agent has
 *     the conversational context.
 */
function extractInboundText(items?: MessageItem[]): string {
  if (!items?.length) return ''

  for (const item of items) {
    if (item.type === MessageItemType.TEXT && typeof item.text_item?.text === 'string') {
      const text = item.text_item.text
      const ref = item.ref_msg
      if (!ref) return text
      const parts: string[] = []
      if (ref.title) parts.push(ref.title)
      if (ref.message_item) {
        const refBody = extractInboundText([ref.message_item])
        if (refBody) parts.push(refBody)
      }
      return parts.length > 0 ? `[引用: ${parts.join(' | ')}]\n${text}` : text
    }
    if (item.type === MessageItemType.VOICE && typeof item.voice_item?.text === 'string') {
      return item.voice_item.text
    }
  }
  return ''
}

function clampText(text: string): string {
  if (text.length <= MAX_TEXT_LENGTH) return text
  return `${text.slice(0, MAX_TEXT_LENGTH - 1)}…`
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
