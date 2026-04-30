/**
 * LarkAdapter — Lark / Feishu in-process adapter.
 *
 * Transport: long-polling via `@larksuiteoapi/node-sdk`'s `WSClient`. No public
 * webhook URL needed (correct fit for desktop / electron). Same lifecycle
 * shape as the Telegram adapter, just a different SDK underneath.
 *
 * Phase 1 scope (text only): receive text in DMs and group @mentions, send
 * text replies, support `/pair`-style commands. Phase 2 layers on edits,
 * interactive cards, attachments, and Markdown→post rich-text formatting.
 */

import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import * as lark from '@larksuiteoapi/node-sdk'
import type {
  PlatformAdapter,
  PlatformConfig,
  AdapterCapabilities,
  IncomingAttachment,
  IncomingMessage,
  SentMessage,
  InlineButton,
  ButtonPress,
  MessagingLogger,
  SendOptions,
} from '../../types'
import {
  formatForLarkPost,
  wrapAsTrivialPost,
  type LarkPost,
} from './format'
import {
  buildLarkCard,
  buildClearedCard,
  isLarkEditExpiredError,
  LARK_MAX_BUTTONS,
} from './card'

/**
 * Hard cap for downloaded attachment size. Matches Telegram's MAX_ATTACHMENT_BYTES
 * — files larger than this would be rejected by `readFileAttachment` anyway, so
 * we fail fast in the adapter with a user-visible reply.
 */
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

const NOOP_LOGGER: MessagingLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => NOOP_LOGGER,
}

/**
 * Credential payload for a Lark/Feishu bot.
 *
 * Stored as a JSON string in the `messaging_bearer` credential row (one row
 * per workspace+platform). Single existing schema, no migrations.
 */
export interface LarkCredentials {
  appId: string
  appSecret: string
  /**
   * Which Open Platform domain to talk to. Lark and Feishu are separate
   * ecosystems — a Lark bot only works against open.larksuite.com,
   * a Feishu bot only against open.feishu.cn.
   */
  domain: 'lark' | 'feishu'
}

/**
 * Parse the JSON-encoded credentials from `PlatformConfig.token`.
 *
 * Throws with a clear message if the input is malformed — surfaces as
 * `state: 'error'` with a user-readable `lastError` in the registry.
 */
export function parseLarkCredentials(token: string | undefined): LarkCredentials {
  if (!token) throw new Error('Lark credentials are missing')
  let parsed: unknown
  try {
    parsed = JSON.parse(token)
  } catch {
    throw new Error('Lark credentials are not valid JSON')
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Lark credentials must be a JSON object')
  }
  const { appId, appSecret, domain } = parsed as Record<string, unknown>
  if (typeof appId !== 'string' || appId.length === 0) {
    throw new Error('Lark credentials are missing `appId`')
  }
  if (typeof appSecret !== 'string' || appSecret.length === 0) {
    throw new Error('Lark credentials are missing `appSecret`')
  }
  if (domain !== 'lark' && domain !== 'feishu') {
    throw new Error('Lark credentials `domain` must be "lark" or "feishu"')
  }
  return { appId, appSecret, domain }
}

/**
 * Map our `'lark' | 'feishu'` selector to the SDK's `Domain` enum.
 */
function resolveLarkDomain(domain: 'lark' | 'feishu'): lark.Domain {
  return domain === 'feishu' ? lark.Domain.Feishu : lark.Domain.Lark
}

/**
 * Strip a leading `<at user_id="...">…</at> ` prefix from a Lark text message
 * content. Lark prepends the @mention as a literal in the content, but the
 * agent only cares about what comes after.
 */
function stripMentionPrefix(text: string): string {
  return text.replace(/^<at[^>]*>[^<]*<\/at>\s*/, '').trim()
}

/**
 * Narrow projection over the SDK's `Client` for the methods we actually call.
 * The SDK's full type union is enormous (~250k lines) and changes shape between
 * minor versions; pinning a hand-rolled interface keeps our adapter loosely
 * coupled and the ts-checker happy.
 */
interface LarkClient {
  im: {
    message: {
      create: (args: {
        params: { receive_id_type: 'chat_id' | 'open_id' | 'union_id' }
        data: { receive_id: string; msg_type: string; content: string; uuid?: string }
      }) => Promise<{ data?: { message_id?: string } } | null>
      update: (args: {
        path: { message_id: string }
        data: { msg_type: string; content: string }
      }) => Promise<unknown>
      patch: (args: {
        path: { message_id: string }
        data: { content: string }
      }) => Promise<unknown>
    }
    file: {
      create: (args: {
        data: { file_type: string; file_name: string; file: Buffer }
      }) => Promise<{ file_key?: string } | null>
    }
    image: {
      create: (args: {
        data: { image_type: 'message' | 'avatar'; image: Buffer }
      }) => Promise<{ image_key?: string } | null>
    }
  }
}

interface LarkMessageEvent {
  event: {
    sender: {
      sender_id?: { user_id?: string; open_id?: string; union_id?: string }
    }
    message: {
      message_id: string
      chat_id: string
      chat_type: string
      message_type: string
      content: string
      create_time: string
      mentions?: Array<{ key: string; id: { user_id?: string }; name: string }>
    }
  }
}

interface LarkCardActionEvent {
  event: {
    operator?: { user_id?: string; open_id?: string; union_id?: string }
    open_chat_id?: string
    action?: {
      value?: unknown
    }
  }
}

export class LarkAdapter implements PlatformAdapter {
  readonly platform = 'lark' as const
  readonly capabilities: AdapterCapabilities = {
    messageEditing: true,
    inlineButtons: true,
    maxButtons: LARK_MAX_BUTTONS,
    maxMessageLength: 30000,
    markdown: 'lark-post',
    webhookSupport: false,
  }

  private client: LarkClient | null = null
  private wsClient: lark.WSClient | null = null
  private messageHandler: ((msg: IncomingMessage) => Promise<void>) | null = null
  private buttonHandler: ((press: ButtonPress) => Promise<void>) | null = null
  private connected = false
  private log: MessagingLogger = NOOP_LOGGER
  /**
   * Track each outbound message's wire `msg_type` so `editMessage` can dispatch
   * to `update` (text/post) vs `patch` (interactive card) correctly. Lark
   * requires the new `msg_type` to match the original.
   */
  private sentMsgTypes = new Map<string, 'text' | 'post' | 'interactive'>()

  /** Fetch bot profile for UI hints. */
  async getBotInfo(): Promise<{ name?: string } | null> {
    if (!this.client) return null
    try {
      // The SDK's `bot.v3.info.get` (no args) returns `{ data: { bot: { app_name } } }`.
      // Unsafe-cast through unknown — the bot namespace isn't in our narrow projection.
      const c = this.client as unknown as {
        bot: { v3: { info: { get: () => Promise<{ data?: { bot?: { app_name?: string } } }> } } }
      }
      const result = await c.bot.v3.info.get()
      const name = result.data?.bot?.app_name
      return name ? { name } : null
    } catch {
      return null
    }
  }

  async initialize(config: PlatformConfig): Promise<void> {
    this.log = config.logger ?? NOOP_LOGGER
    const creds = parseLarkCredentials(config.token)
    const sdkDomain = resolveLarkDomain(creds.domain)

    // Construct REST client (sends + lookups go through this).
    this.client = new lark.Client({
      appId: creds.appId,
      appSecret: creds.appSecret,
      domain: sdkDomain,
      loggerLevel: lark.LoggerLevel.warn,
    }) as unknown as LarkClient

    // Long-connection WS client + event dispatcher.
    this.wsClient = new lark.WSClient({
      appId: creds.appId,
      appSecret: creds.appSecret,
      domain: sdkDomain,
      loggerLevel: lark.LoggerLevel.warn,
    })

    // The SDK's `register` typing is a wide-open union over hundreds of event
    // names. Cast the handler block once via `unknown` to keep the adapter
    // readable; the per-handler payload casts above handle the actual shape.
    const eventDispatcher = new lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data: unknown) => {
        await this.handleIncomingMessage(data as LarkMessageEvent)
      },
      'card.action.trigger': async (data: unknown) => {
        await this.handleCardAction(data as LarkCardActionEvent)
        // Lark expects a synchronous return that may patch the card; we
        // return an empty object (no patch) and let `clearButtons` do the
        // visual cleanup async via the binding's existing post-press flow.
        return {}
      },
    } as unknown as Parameters<lark.EventDispatcher['register']>[0])

    await this.wsClient.start({ eventDispatcher })
    this.connected = true
    this.log.info('[lark] connected', {
      event: 'lark_connected',
      domain: creds.domain,
    })
  }

  async destroy(): Promise<void> {
    // The SDK's WSClient doesn't currently expose a `.stop()` method in its
    // public types — it tears down on process exit. We null out our refs so
    // re-init works; the underlying socket gets garbage-collected.
    this.wsClient = null
    this.client = null
    this.connected = false
    this.sentMsgTypes.clear()
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

  // -------------------------------------------------------------------------
  // Outbound — sends, edits, files, cards
  // -------------------------------------------------------------------------

  async sendText(channelId: string, text: string, _opts?: SendOptions): Promise<SentMessage> {
    if (!this.client) throw new Error('Lark adapter is not connected')
    const formatted = formatForLarkPost(text)
    const { msgType, content } =
      formatted.kind === 'text'
        ? { msgType: 'text' as const, content: JSON.stringify({ text: formatted.text }) }
        : { msgType: 'post' as const, content: JSON.stringify(formatted.post) }

    const result = await this.client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: { receive_id: channelId, msg_type: msgType, content },
    })
    const messageId = result?.data?.message_id ?? ''
    if (messageId) this.sentMsgTypes.set(messageId, msgType)
    return { platform: 'lark', channelId, messageId }
  }

  async editMessage(
    channelId: string,
    messageId: string,
    text: string,
    _opts?: SendOptions,
  ): Promise<void> {
    if (!this.client) throw new Error('Lark adapter is not connected')
    const originalType = this.sentMsgTypes.get(messageId) ?? 'text'

    // Cards are patched, not updated — different API.
    if (originalType === 'interactive') {
      // Editing an active card replaces its text body but keeps the buttons.
      // For the text-only edit path the renderer takes, we fall back to a
      // cleared-card patch (text without buttons), matching the Telegram
      // behaviour where a final-text edit removes the button row.
      try {
        await this.client.im.message.patch({
          path: { message_id: messageId },
          data: { content: JSON.stringify(buildClearedCard(text)) },
        })
      } catch (err: unknown) {
        if (isLarkEditExpiredError(err)) return
        throw err
      }
      return
    }

    // text or post — match the original type so Lark accepts the update.
    let content: string
    let msgType: 'text' | 'post'
    if (originalType === 'post') {
      // If the new content has formatting, format it; otherwise wrap as
      // a trivial post so the msg_type still matches the original.
      const formatted = formatForLarkPost(text)
      const post: LarkPost = formatted.kind === 'post' ? formatted.post : wrapAsTrivialPost(text)
      content = JSON.stringify(post)
      msgType = 'post'
    } else {
      content = JSON.stringify({ text })
      msgType = 'text'
    }

    try {
      await this.client.im.message.update({
        path: { message_id: messageId },
        data: { msg_type: msgType, content },
      })
    } catch (err: unknown) {
      if (isLarkEditExpiredError(err)) return
      throw err
    }
  }

  async sendButtons(
    channelId: string,
    text: string,
    buttons: InlineButton[],
    _opts?: SendOptions,
  ): Promise<SentMessage> {
    if (!this.client) throw new Error('Lark adapter is not connected')
    if (buttons.length > LARK_MAX_BUTTONS) {
      this.log.warn('[lark] too many buttons; truncating to cap', {
        event: 'lark_button_cap',
        requested: buttons.length,
        cap: LARK_MAX_BUTTONS,
      })
    }

    // Send the card without the messageId in the buttons' value — we don't
    // know the messageId until after the create. Fix this up in two stages:
    // 1) post the card with a placeholder; 2) extract the returned message_id
    //    and patch the card with the real value. Phase 2 acceptance is good
    //    enough — the press handler can look up the binding from chat_id alone
    //    if needed, but storing the id keeps gated routing simple.
    const placeholderCard = buildLarkCard(text, buttons, { messageId: 'pending' })
    const result = await this.client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: channelId,
        msg_type: 'interactive',
        content: JSON.stringify(placeholderCard),
      },
    })
    const messageId = result?.data?.message_id ?? ''
    if (messageId) {
      this.sentMsgTypes.set(messageId, 'interactive')
      // Patch with the real message_id baked into each button's value so card
      // press events carry the correct correlation.
      try {
        const realCard = buildLarkCard(text, buttons, { messageId })
        await this.client.im.message.patch({
          path: { message_id: messageId },
          data: { content: JSON.stringify(realCard) },
        })
      } catch (err: unknown) {
        // Non-fatal — the card already exists with placeholder ids; press
        // routing will fall back to looking up by chat_id.
        if (!isLarkEditExpiredError(err)) {
          this.log.warn('[lark] failed to patch card with real messageId', {
            event: 'lark_card_patch_failed',
            messageId,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
    }
    return { platform: 'lark', channelId, messageId }
  }

  async clearButtons(channelId: string, messageId: string, _opts?: SendOptions): Promise<void> {
    if (!this.client) return
    void channelId
    try {
      await this.client.im.message.patch({
        path: { message_id: messageId },
        data: { content: JSON.stringify(buildClearedCard('')) },
      })
    } catch (err: unknown) {
      if (isLarkEditExpiredError(err)) return
      this.log.warn('[lark] clearButtons failed', {
        event: 'lark_clear_buttons_failed',
        messageId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  async sendTyping(_channelId: string, _opts?: SendOptions): Promise<void> {
    // Lark has no typing-indicator API. No-op.
  }

  async sendFile(
    channelId: string,
    file: Buffer,
    filename: string,
    caption?: string,
    _opts?: SendOptions,
  ): Promise<SentMessage> {
    if (!this.client) throw new Error('Lark adapter is not connected')

    const isImage = /\.(jpe?g|png|gif|webp|bmp)$/i.test(filename)

    let content: string
    let msgType: 'image' | 'file'
    if (isImage) {
      const upload = await this.client.im.image.create({
        data: { image_type: 'message', image: file },
      })
      const imageKey = upload?.image_key
      if (!imageKey) throw new Error('Lark image upload returned no image_key')
      content = JSON.stringify({ image_key: imageKey })
      msgType = 'image'
    } else {
      const upload = await this.client.im.file.create({
        data: { file_type: 'stream', file_name: filename, file: file },
      })
      const fileKey = upload?.file_key
      if (!fileKey) throw new Error('Lark file upload returned no file_key')
      content = JSON.stringify({ file_key: fileKey, file_name: filename })
      msgType = 'file'
    }

    const result = await this.client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: { receive_id: channelId, msg_type: msgType, content },
    })
    const messageId = result?.data?.message_id ?? ''

    // Lark can't combine caption + file in one message. If the caller wants a
    // caption, send it as a follow-up text message (best-effort).
    if (caption) {
      this.sendText(channelId, caption).catch((err) => {
        this.log.warn('[lark] caption follow-up failed', {
          event: 'lark_caption_failed',
          messageId,
          error: err instanceof Error ? err.message : String(err),
        })
      })
    }

    return { platform: 'lark', channelId, messageId }
  }

  // -------------------------------------------------------------------------
  // Inbound — message + card events
  // -------------------------------------------------------------------------

  private async handleIncomingMessage(data: LarkMessageEvent): Promise<void> {
    if (!this.messageHandler) return
    const { sender, message } = data.event

    const senderId =
      sender.sender_id?.user_id ?? sender.sender_id?.open_id ?? sender.sender_id?.union_id ?? ''

    // Phase 2: support text + image + file. Other types (audio/video/sticker/etc.)
    // are dropped with an info log so users can see the bot received the event
    // but can't process it.
    if (message.message_type === 'text') {
      let text: string
      try {
        const parsed = JSON.parse(message.content) as { text?: string }
        text = parsed.text ?? ''
      } catch {
        text = ''
      }
      const cleaned = stripMentionPrefix(text)
      const msg: IncomingMessage = {
        platform: 'lark',
        channelId: message.chat_id,
        messageId: message.message_id,
        senderId,
        text: cleaned,
        timestamp: parseInt(message.create_time, 10) || Date.now(),
        raw: message,
      }
      await this.messageHandler(msg)
      return
    }

    if (message.message_type === 'image' || message.message_type === 'file') {
      await this.handleAttachmentMessage(data)
      return
    }

    // Unhandled type — log and drop.
    this.log.info('[lark] dropped unsupported message type', {
      event: 'lark_unsupported_msg_type',
      messageType: message.message_type,
      messageId: message.message_id,
      chatId: message.chat_id,
    })
  }

  private async handleAttachmentMessage(data: LarkMessageEvent): Promise<void> {
    if (!this.client || !this.messageHandler) return
    const { sender, message } = data.event
    const senderId =
      sender.sender_id?.user_id ?? sender.sender_id?.open_id ?? sender.sender_id?.union_id ?? ''

    let parsedContent: { image_key?: string; file_key?: string; file_name?: string }
    try {
      parsedContent = JSON.parse(message.content)
    } catch {
      this.log.warn('[lark] could not parse attachment content', {
        event: 'lark_attachment_parse_failed',
        messageId: message.message_id,
      })
      return
    }

    const isImage = message.message_type === 'image'
    const fileKey = isImage ? parsedContent.image_key : parsedContent.file_key
    if (!fileKey) {
      this.log.warn('[lark] attachment missing key', {
        event: 'lark_attachment_no_key',
        messageId: message.message_id,
      })
      return
    }
    const fallbackName = isImage
      ? `image-${randomBytes(4).toString('hex')}.jpg`
      : parsedContent.file_name ?? `file-${randomBytes(4).toString('hex')}.bin`

    const localPath = await this.downloadResource({
      messageId: message.message_id,
      fileKey,
      filename: fallbackName,
      isImage,
    })
    if (!localPath) return

    const incomingAttachment: IncomingAttachment = {
      type: isImage ? 'photo' : 'document',
      fileId: fileKey,
      fileName: fallbackName,
      localPath,
    }
    const msg: IncomingMessage = {
      platform: 'lark',
      channelId: message.chat_id,
      messageId: message.message_id,
      senderId,
      text: '',
      attachments: [incomingAttachment],
      timestamp: parseInt(message.create_time, 10) || Date.now(),
      raw: message,
    }
    await this.messageHandler(msg)
  }

  /**
   * Download a Lark resource (image or file) to a local temp path.
   *
   * Lark resource URLs require bearer-token auth; we can't hand a URL to the
   * router. Instead we stream the binary to a temp file and emit `localPath`,
   * matching the Telegram pattern.
   */
  private async downloadResource(args: {
    messageId: string
    fileKey: string
    filename: string
    isImage: boolean
  }): Promise<string | null> {
    if (!this.client) return null
    try {
      // The SDK's `im.message.resource.get` returns a Node stream-like object
      // with a `writeFile` helper for the common case. We use that for size+brevity.
      const sdkResource = await (
        (this.client as unknown as {
          im: {
            message: {
              resource: {
                get: (args: {
                  path: { message_id: string; file_key: string }
                  params: { type: 'image' | 'file' }
                }) => Promise<{ writeFile: (path: string) => Promise<void> } & Record<string, unknown>>
              }
            }
          }
        }).im.message.resource.get
      )({
        path: { message_id: args.messageId, file_key: args.fileKey },
        params: { type: args.isImage ? 'image' : 'file' },
      })

      const ext = extname(args.filename) || (args.isImage ? '.jpg' : '.bin')
      const localPath = join(tmpdir(), `lark-${randomBytes(8).toString('hex')}${ext}`)
      // Different SDK versions expose either `writeFile`, `file` (Buffer), or
      // a plain Node Readable. Handle the common shapes.
      if (typeof sdkResource.writeFile === 'function') {
        await sdkResource.writeFile(localPath)
      } else if (sdkResource.file instanceof Buffer) {
        const buf = sdkResource.file
        if (buf.length > MAX_ATTACHMENT_BYTES) {
          throw new Error(`attachment exceeds ${MAX_ATTACHMENT_BYTES} bytes`)
        }
        writeFileSync(localPath, buf)
      } else {
        throw new Error('Lark resource SDK returned an unsupported shape')
      }
      return localPath
    } catch (err: unknown) {
      this.log.warn('[lark] resource download failed', {
        event: 'lark_resource_download_failed',
        messageId: args.messageId,
        fileKey: args.fileKey,
        error: err instanceof Error ? err.message : String(err),
      })
      return null
    }
  }

  private async handleCardAction(data: LarkCardActionEvent): Promise<void> {
    if (!this.buttonHandler) return
    const value = data.event.action?.value as
      | { buttonId?: string; messageId?: string; data?: string }
      | undefined
    if (!value?.buttonId || !value?.messageId) {
      this.log.warn('[lark] card action missing correlation ids', {
        event: 'lark_card_action_no_ids',
        operator: data.event.operator,
      })
      return
    }
    const operator = data.event.operator
    const senderId = operator?.user_id ?? operator?.open_id ?? operator?.union_id ?? ''

    const press: ButtonPress = {
      platform: 'lark',
      channelId: data.event.open_chat_id ?? '',
      messageId: value.messageId,
      buttonId: value.buttonId,
      senderId,
      ...(value.data !== undefined ? { data: value.data } : {}),
    }
    await this.buttonHandler(press)
  }
}
