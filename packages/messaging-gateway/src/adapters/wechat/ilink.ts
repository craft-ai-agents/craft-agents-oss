/**
 * iLink Bot API client — HTTP wrapper for WeChat's official bot protocol.
 *
 * @see https://ilinkai.weixin.qq.com
 *
 * The iLink protocol is a straightforward HTTP/JSON API:
 * - Auth: QR scan → bot_token (Bearer auth)
 * - Receive: long-polling POST /ilink/bot/getupdates
 * - Send: POST /ilink/bot/sendmessage
 * - Media: AES-128-ECB encrypted CDN
 * - IDs: users = `xxx@im.wechat`, bots = `xxx@im.bot`
 */

import { createCipheriv, createDecipheriv } from 'node:crypto'
import { randomBytes, randomInt } from 'node:crypto'
import type { MessagingLogger } from '../../types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_URL = 'https://ilinkai.weixin.qq.com'
const CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c'
const LONG_POLLING_TIMEOUT_MS = 35_000

const NOOP_LOGGER: MessagingLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => NOOP_LOGGER,
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface iLinkQRCodeResponse {
  qrcode: string
  /** URL to the QR code image (e.g. https://liteapp.weixin.qq.com/q/...). */
  qrcode_img_content: string
  ret: number
}

export interface iLinkQRCodeStatus {
  status: 'waiting' | 'scanned' | 'confirmed' | 'expired'
  bot_token?: string
  baseurl?: string
}

export interface iLinkMessage {
  from_user_id: string
  to_user_id: string
  message_type: number  // 1 = user message, 2 = bot message
  message_state: number // 2 = FINISH
  context_token: string
  group_id?: string
  item_list: iLinkItem[]
  /** Unix timestamp in seconds. */
  create_time?: number
}

export interface iLinkItem {
  type: 1 | 2 | 3 | 4 | 5  // text, image, voice, file, video
  text_item?: { text: string }
  image_item?: {
    aes_key: string
    cdn_big_img_url: string
    cdn_mid_img_url: string
    cdn_small_img_url: string
    md5: string
    total_len: number
  }
  voice_item?: {
    aes_key: string
    cdn_voice_url: string
    md5: string
    total_len: number
    voice_text?: string
  }
  file_item?: {
    aes_key: string
    cdn_file_url: string
    file_name: string
    md5: string
    total_len: number
  }
  video_item?: {
    aes_key: string
    cdn_video_url: string
    md5: string
    total_len: number
    play_length: number
  }
}

export interface iLinkGetUpdatesResponse {
  ret?: number
  errcode?: number
  errmsg?: string
  msgs: iLinkMessage[] | null
  get_updates_buf: string
  longpolling_timeout_ms: number
}

export interface iLinkSendMessageResponse {
  ret: number
  msg_id?: string
}

export interface iLinkUploadUrlResponse {
  ret: number
  url: string
  aes_key: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a random X-WECHAT-UIN header value.
 * The protocol expects: base64(String(randomUint32()))
 */
function randomUin(): string {
  return Buffer.from(String(randomInt(1, 0xFFFFFFFF))).toString('base64')
}

/**
 * Build the standard iLink request headers.
 */
function buildHeaders(botToken?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'AuthorizationType': 'ilink_bot_token',
    'X-WECHAT-UIN': randomUin(),
  }
  if (botToken) {
    headers['Authorization'] = `Bearer ${botToken}`
  }
  return headers
}

// ---------------------------------------------------------------------------
// AES-128-ECB encrypt/decrypt for CDN media
// ---------------------------------------------------------------------------

/**
 * Encrypt a buffer with AES-128-ECB. Used before uploading to WeChat CDN.
 */
export function encryptAesEcb(data: Buffer, key: Buffer): Buffer {
  const cipher = createCipheriv('aes-128-ecb', key, null)
  return Buffer.concat([cipher.update(data), cipher.final()])
}

/**
 * Decrypt a buffer with AES-128-ECB. Used after downloading from WeChat CDN.
 */
export function decryptAesEcb(data: Buffer, key: Buffer): Buffer {
  const decipher = createDecipheriv('aes-128-ecb', key, null)
  return Buffer.concat([decipher.update(data), decipher.final()])
}

// ---------------------------------------------------------------------------
// iLinkClient
// ---------------------------------------------------------------------------

export class iLinkClient {
  private log: MessagingLogger

  constructor(logger?: MessagingLogger) {
    this.log = logger ?? NOOP_LOGGER
  }

  // ---- Auth flow ----

  /**
   * Step 1 of the login flow: request a QR code for the user to scan.
   * Returns the QR code string and a base64-encoded QR image.
   */
  async getBotQRCode(): Promise<iLinkQRCodeResponse> {
    const url = `${BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=3`
    this.log.info('[wechat] requesting QR code')

    const res = await fetch(url, {
      method: 'GET',
      headers: buildHeaders(),
    })

    if (!res.ok) {
      throw new Error(`[wechat] getBotQRCode failed: ${res.status} ${res.statusText}`)
    }

    const data = await res.json() as iLinkQRCodeResponse
    this.log.info('[wechat] QR code obtained', { qrcode: data.qrcode })
    return data
  }

  /**
   * Step 2: poll the QR code scan status. Returns 'confirmed' with a
   * bot_token when the user has scanned and confirmed.
   */
  async getQRCodeStatus(qrcode: string): Promise<iLinkQRCodeStatus> {
    const url = `${BASE_URL}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`
    this.log.info('[wechat] polling QR status', { qrcode })

    // get_qrcode_status is long-polling — cap at 8 seconds per request
    // so the caller can retry in a loop from the UI side.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8_000)

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: buildHeaders(),
        signal: controller.signal,
      })

      if (!res.ok) {
        throw new Error(`[wechat] getQRCodeStatus failed: ${res.status} ${res.statusText}`)
      }

      const data = await res.json() as iLinkQRCodeStatus
      this.log.info('[wechat] QR status', { status: data.status, baseurl: data.baseurl, hasBotToken: !!data.bot_token, ilinkBotId: data.ilink_bot_id })
      return data
    } catch (err) {
      // Timeout / abort → treat as "still waiting" so the caller retries
      if (err instanceof DOMException && err.name === 'AbortError') {
        return { status: 'waiting' }
      }
      throw err
    } finally {
      clearTimeout(timer)
    }
  }

  // ---- Long-polling ----

  /**
   * Long-polling message receive. Blocks up to ~35 seconds.
   * Returns new messages and an updated cursor (`get_updates_buf`).
   */
  async getUpdates(
    cursor: string,
    botToken: string,
    signal?: AbortSignal,
  ): Promise<iLinkGetUpdatesResponse> {
    const url = `${BASE_URL}/ilink/bot/getupdates`
    const body = JSON.stringify({
      get_updates_buf: cursor,
      base_info: { channel_version: '1.0.3' },
    })

    const res = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(botToken),
      body,
      signal,
    })

    if (!res.ok) {
      throw new Error(`[wechat] getUpdates failed: ${res.status} ${res.statusText}`)
    }

    const data = await res.json()

    this.log.info('[wechat] getUpdates raw response', {
      keys: Object.keys(data),
      ret: data.ret,
      errcode: data.errcode,
      errmsg: data.errmsg,
      msgsCount: data.msgs?.length,
      hasBuf: !!data.get_updates_buf,
      syncBuf: (data as any).sync_buf?.substring(0, 20),
      updatesBuf: data.get_updates_buf?.substring(0, 20),
    })
    return data as iLinkGetUpdatesResponse
  }

  // ---- Sending ----

  /**
   * Send a message to a user. The `contextToken` must be echoed from
   * the inbound message — this is critical for WeChat to associate
   * the reply with the correct conversation.
   */
  async sendMessage(
    toUserId: string,
    contextToken: string,
    items: iLinkItem[],
    botToken: string,
  ): Promise<iLinkSendMessageResponse> {
    const url = `${BASE_URL}/ilink/bot/sendmessage`
    const clientId = `openclaw-weixin-${Date.now().toString(16)}-${randomBytes(4).toString('hex')}`
    const body = JSON.stringify({
      msg: {
        from_user_id: '',
        to_user_id: toUserId,
        client_id: clientId,
        message_type: 2,     // Bot
        message_state: 2,    // Finish
        context_token: contextToken,
        item_list: items,
      },
      base_info: { channel_version: '1.0.3' },
    })

    const res = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(botToken),
      body,
    })

    if (!res.ok) {
      throw new Error(`[wechat] sendMessage failed: ${res.status} ${res.statusText}`)
    }

    const responseText = await res.text()
    // iLink returns {} on success or {errcode, errmsg} on error
    const parsed = JSON.parse(responseText)
    if (parsed.errcode && parsed.errcode !== 0) {
      this.log.warn('[wechat-ilink] sendmessage returned error', { errcode: parsed.errcode, errmsg: parsed.errmsg })
    }

    return JSON.parse(responseText) as iLinkSendMessageResponse
  }

  /**
   * Send a text reply to a user.
   */
  async sendTextMessage(
    toUserId: string,
    contextToken: string,
    text: string,
    botToken: string,
  ): Promise<iLinkSendMessageResponse> {
    return this.sendMessage(
      toUserId,
      contextToken,
      [{ type: 1, text_item: { text } }],
      botToken,
    )
  }

  // ---- Typing indicator ----

  /**
   * Send a "typing..." indicator. Requires a typing_ticket obtained
   * via getconfig.
   */
  async sendTyping(
    toUserId: string,
    typingTicket: string,
    botToken: string,
  ): Promise<void> {
    const url = `${BASE_URL}/ilink/bot/sendtyping`
    const body = JSON.stringify({
      to_user_id: toUserId,
      typing_ticket: typingTicket,
    })

    try {
      await fetch(url, {
        method: 'POST',
        headers: buildHeaders(botToken),
        body,
      })
    } catch {
      // Typing indicator is best-effort, ignore failures.
    }
  }

  /**
   * Get a typing ticket (required by sendTyping).
   */
  async getConfig(botToken: string): Promise<{ typing_ticket?: string }> {
    const url = `${BASE_URL}/ilink/bot/getconfig`
    const res = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(botToken),
      body: JSON.stringify({}),
    })

    if (!res.ok) {
      return {}
    }

    return res.json() as Promise<{ typing_ticket?: string }>
  }

  // ---- CDN / Media ----

  /**
   * Get a pre-signed upload URL for CDN media upload.
   */
  async getUploadUrl(botToken: string): Promise<iLinkUploadUrlResponse> {
    const url = `${BASE_URL}/ilink/bot/getuploadurl`
    const res = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(botToken),
      body: JSON.stringify({}),
    })

    if (!res.ok) {
      throw new Error(`[wechat] getUploadUrl failed: ${res.status} ${res.statusText}`)
    }

    return res.json() as Promise<iLinkUploadUrlResponse>
  }

  /**
   * Download and decrypt a CDN media file.
   */
  async downloadMedia(
    cdnUrl: string,
    aesKeyBase64: string,
  ): Promise<Buffer> {
    const res = await fetch(cdnUrl)
    if (!res.ok) {
      throw new Error(`[wechat] CDN download failed: ${res.status}`)
    }

    const encrypted = Buffer.from(await res.arrayBuffer())
    const aesKey = Buffer.from(aesKeyBase64, 'base64')
    return decryptAesEcb(encrypted, aesKey)
  }

  /**
   * Upload a file to CDN with AES-128-ECB encryption.
   * Returns the CDN URL and the AES key used.
   */
  async uploadMedia(
    fileBuffer: Buffer,
    fileName: string,
    botToken: string,
  ): Promise<{ cdnUrl: string; aesKey: string }> {
    const uploadInfo = await this.getUploadUrl(botToken)
    if (!uploadInfo.url || !uploadInfo.aes_key) {
      throw new Error('[wechat] getUploadUrl returned no upload URL')
    }

    const aesKey = Buffer.from(uploadInfo.aes_key, 'base64')
    const encrypted = encryptAesEcb(fileBuffer, aesKey)

    const uploadRes = await fetch(uploadInfo.url, {
      method: 'PUT',
      body: new Uint8Array(encrypted),
      headers: {
        'Content-Type': 'application/octet-stream',
      },
    })

    if (!uploadRes.ok) {
      throw new Error(`[wechat] CDN upload failed: ${uploadRes.status}`)
    }

    return {
      cdnUrl: uploadInfo.url,
      aesKey: uploadInfo.aes_key,
    }
  }

  // ---- Token validation ----

  /**
   * Test whether a bot_token is valid by calling getUpdates with an empty cursor.
   * Returns true if the server accepts the token.
   */
  async validateToken(botToken: string): Promise<boolean> {
    try {
      const result = await this.getUpdates('', botToken)
      // Success means no errcode
      return !result.errcode
    } catch {
      return false
    }
  }
}
