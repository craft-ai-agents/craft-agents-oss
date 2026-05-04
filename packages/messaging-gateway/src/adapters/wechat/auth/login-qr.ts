/**
 * WeChat QR-login state machine.
 *
 * Drives one login session for one workspace. Calls the iLink endpoints to
 * fetch a QR code, then long-polls `get_qrcode_status` until the user scans
 * + confirms in WeChat (or the QR expires / the caller cancels). Emits
 * lifecycle events the UI can subscribe to.
 *
 * The polling host can shift mid-flight — when the server returns
 * `scaned_but_redirect`, all subsequent polls go to the new IDC. After
 * `confirmed`, the returned `baseUrl` is the host the bot's `getupdates` /
 * `sendmessage` endpoints must use, not the original QR host.
 *
 * ---------------------------------------------------------------------------
 * Adapted from openclaw-weixin (https://github.com/Tencent/openclaw-weixin),
 * Copyright (C) 2026 Tencent, MIT-licensed. Reworked from openclaw's
 * terminal-driven flow into an event-emitting manager so the QR can render
 * inside an in-app dialog and the lifecycle can be cancelled.
 * ---------------------------------------------------------------------------
 */

import { apiGetFetch, type WeixinClientIdentity } from '../protocol/api'
import type { MessagingLogger } from '../../../types'

/** Tencent-fixed host that issues QR codes. After confirmation the polling
 *  host may shift to an IDC-specific URL — that one is captured in
 *  `WeChatLoginResult.baseUrl` and used by all later API calls. */
export const WECHAT_QR_BASE_URL = 'https://ilinkai.weixin.qq.com'

/** Default `bot_type` for `get_bot_qrcode` / `get_qrcode_status`.
 *  openclaw-weixin pins this to "3"; meaning is undocumented but stable. */
export const DEFAULT_ILINK_BOT_TYPE = '3'

/** Hard ceiling on a single login attempt. openclaw allows 8 minutes; we
 *  match that so users have realistic time to grab their phone + scan. */
const DEFAULT_LOGIN_TIMEOUT_MS = 8 * 60_000

/** Per-poll long-poll timeout. The server typically holds the request up to
 *  this duration before returning `wait`. */
const QR_POLL_TIMEOUT_MS = 35_000

/** Maximum times we'll auto-refresh the QR after it expires before giving up. */
const MAX_QR_REFRESH_COUNT = 3

const NOOP_LOGGER: MessagingLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => NOOP_LOGGER,
}

// ---------------------------------------------------------------------------
// Wire-level shapes returned by the iLink QR endpoints
// ---------------------------------------------------------------------------

interface QRCodeResponse {
  qrcode: string
  qrcode_img_content: string
}

interface StatusResponse {
  status: 'wait' | 'scaned' | 'confirmed' | 'expired' | 'scaned_but_redirect'
  bot_token?: string
  ilink_bot_id?: string
  baseurl?: string
  ilink_user_id?: string
  redirect_host?: string
}

// ---------------------------------------------------------------------------
// Public event + result shapes
// ---------------------------------------------------------------------------

/**
 * Discriminated union of UI-visible events emitted while the login runs.
 *
 *   - `qr`        — initial / refreshed QR payload string; the renderer
 *                   encodes it into a QR image (Tencent's iLink endpoint
 *                   returns the *URL/payload* the QR should encode, not a
 *                   pre-rendered PNG)
 *   - `scaned`    — phone scanned the QR; user must still tap "授权" in WeChat
 *   - `confirmed` — token + IDs in hand, login complete (terminal)
 *   - `expired`   — QR expired N times in a row, giving up (terminal)
 *   - `error`     — unrecoverable error (terminal)
 *   - `cancelled` — caller invoked cancel() (terminal)
 */
export type WeChatLoginEvent =
  | { type: 'qr'; qr: string; refreshCount: number }
  | { type: 'scaned' }
  | {
      type: 'confirmed'
      botToken: string
      ilinkBotId: string
      ilinkUserId?: string
      baseUrl?: string
    }
  | { type: 'expired'; message: string }
  | { type: 'error'; message: string }
  | { type: 'cancelled' }

export type WeChatLoginListener = (event: WeChatLoginEvent) => void

/** Final outcome resolved by `manager.run()`. Useful when the caller wants a
 *  single awaitable rather than wiring an event listener. */
export interface WeChatLoginResult {
  ok: boolean
  /** Present when ok === true. */
  botToken?: string
  ilinkBotId?: string
  ilinkUserId?: string
  baseUrl?: string
  /** Present when ok === false. */
  error?: string
  /** True when `cancel()` ended the run. */
  cancelled?: boolean
}

export interface WeChatLoginOptions {
  /** Identity headers to attach to every iLink request. */
  identity: WeixinClientIdentity
  /** Optional structured logger. */
  logger?: MessagingLogger
  /** Override `bot_type` query param (default "3"). */
  botType?: string
  /** Override total login window (ms). Default 8 minutes. */
  timeoutMs?: number
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

/**
 * Single-shot QR login driver. Construct, attach listeners, call `run()`.
 *
 * `cancel()` is safe to call from any state — it short-circuits the poll loop
 * on the next tick and emits `cancelled`. After `run()` resolves the manager
 * is dead; create a new one for a retry.
 */
export class WeChatLoginManager {
  private readonly listeners = new Set<WeChatLoginListener>()
  private readonly identity: WeixinClientIdentity
  private readonly log: MessagingLogger
  private readonly botType: string
  private readonly timeoutMs: number

  /** Mutable polling state; reset whenever the QR refreshes. */
  private currentApiBaseUrl = WECHAT_QR_BASE_URL
  private currentQrcode = ''
  private cancelRequested = false
  private finished = false

  constructor(opts: WeChatLoginOptions) {
    this.identity = opts.identity
    this.log = (opts.logger ?? NOOP_LOGGER).child({ component: 'wechat-login' })
    this.botType = opts.botType ?? DEFAULT_ILINK_BOT_TYPE
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS
  }

  on(listener: WeChatLoginListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Request cancellation. Idempotent; safe before / during / after run(). */
  cancel(): void {
    this.cancelRequested = true
  }

  isFinished(): boolean {
    return this.finished
  }

  async run(): Promise<WeChatLoginResult> {
    if (this.finished) {
      return { ok: false, error: 'login manager already finished' }
    }

    try {
      const initial = await this.fetchQrCode()
      this.currentQrcode = initial.qrcode
      this.emit({ type: 'qr', qr: initial.qrcode_img_content, refreshCount: 0 })

      return await this.pollUntilTerminal()
    } catch (err) {
      const message = errMessage(err)
      this.log.error('wechat login failed at startup', { event: 'wechat_login_startup_failed', error: message })
      this.emit({ type: 'error', message })
      return this.finalize({ ok: false, error: message })
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private emit(event: WeChatLoginEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch (err) {
        this.log.warn('wechat login listener threw', { event: 'wechat_login_listener_error', error: errMessage(err) })
      }
    }
  }

  private finalize(result: WeChatLoginResult): WeChatLoginResult {
    this.finished = true
    this.listeners.clear()
    return result
  }

  private async fetchQrCode(): Promise<QRCodeResponse> {
    const raw = await apiGetFetch({
      baseUrl: WECHAT_QR_BASE_URL,
      identity: this.identity,
      endpoint: `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(this.botType)}`,
      label: 'getBotQrcode',
      logger: this.log,
    })
    return JSON.parse(raw) as QRCodeResponse
  }

  private async pollOnce(): Promise<StatusResponse> {
    try {
      const raw = await apiGetFetch({
        baseUrl: this.currentApiBaseUrl,
        identity: this.identity,
        endpoint: `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(this.currentQrcode)}`,
        timeoutMs: QR_POLL_TIMEOUT_MS,
        label: 'getQrcodeStatus',
        logger: this.log,
      })
      return JSON.parse(raw) as StatusResponse
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return { status: 'wait' }
      }
      this.log.warn('qr status poll error, treating as wait', {
        event: 'wechat_qr_poll_transient',
        error: errMessage(err),
      })
      return { status: 'wait' }
    }
  }

  private async pollUntilTerminal(): Promise<WeChatLoginResult> {
    const deadline = Date.now() + this.timeoutMs
    let scannedAlreadyEmitted = false
    let qrRefreshCount = 0

    while (Date.now() < deadline) {
      if (this.cancelRequested) {
        this.emit({ type: 'cancelled' })
        return this.finalize({ ok: false, cancelled: true })
      }

      const status = await this.pollOnce()

      switch (status.status) {
        case 'wait':
          break
        case 'scaned':
          if (!scannedAlreadyEmitted) {
            this.emit({ type: 'scaned' })
            scannedAlreadyEmitted = true
          }
          break
        case 'scaned_but_redirect': {
          const host = status.redirect_host
          if (host) {
            this.currentApiBaseUrl = `https://${host}`
            this.log.info('wechat login: IDC redirect', {
              event: 'wechat_login_idc_redirect',
              redirectHost: host,
            })
          }
          break
        }
        case 'expired': {
          qrRefreshCount += 1
          if (qrRefreshCount > MAX_QR_REFRESH_COUNT) {
            const message = `QR expired ${MAX_QR_REFRESH_COUNT} times in a row`
            this.emit({ type: 'expired', message })
            return this.finalize({ ok: false, error: message })
          }
          try {
            const refreshed = await this.fetchQrCode()
            this.currentQrcode = refreshed.qrcode
            scannedAlreadyEmitted = false
            this.emit({
              type: 'qr',
              qr: refreshed.qrcode_img_content,
              refreshCount: qrRefreshCount,
            })
          } catch (err) {
            const message = errMessage(err)
            this.emit({ type: 'error', message })
            return this.finalize({ ok: false, error: message })
          }
          break
        }
        case 'confirmed': {
          if (!status.bot_token || !status.ilink_bot_id) {
            const message = 'login confirmed but bot_token or ilink_bot_id missing'
            this.emit({ type: 'error', message })
            return this.finalize({ ok: false, error: message })
          }
          this.emit({
            type: 'confirmed',
            botToken: status.bot_token,
            ilinkBotId: status.ilink_bot_id,
            ilinkUserId: status.ilink_user_id,
            baseUrl: status.baseurl,
          })
          return this.finalize({
            ok: true,
            botToken: status.bot_token,
            ilinkBotId: status.ilink_bot_id,
            ilinkUserId: status.ilink_user_id,
            baseUrl: status.baseurl,
          })
        }
      }

      await sleepInterruptible(1000, () => this.cancelRequested)
    }

    const message = 'login window timed out'
    this.emit({ type: 'expired', message })
    return this.finalize({ ok: false, error: message })
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** sleep that wakes early if `interrupted()` becomes true so cancel() lands fast. */
function sleepInterruptible(ms: number, interrupted: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    const start = Date.now()
    const tick = () => {
      if (interrupted() || Date.now() - start >= ms) {
        resolve()
      } else {
        setTimeout(tick, Math.min(100, ms - (Date.now() - start)))
      }
    }
    tick()
  })
}
