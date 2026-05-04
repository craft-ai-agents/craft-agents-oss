/**
 * WeChat (Weixin) iLink bot HTTP client.
 *
 * Wraps the five JSON endpoints under `<baseUrl>/ilink/bot/`:
 *   - `getupdates`    — long-poll for inbound messages
 *   - `sendmessage`   — outbound text/media
 *   - `getuploadurl`  — pre-signed CDN upload parameters
 *   - `getconfig`     — fetch typing_ticket and per-user config
 *   - `sendtyping`    — typing indicator
 *
 * Each call sets the `AuthorizationType: ilink_bot_token` header and a random
 * `X-WECHAT-UIN` header, both required by the upstream service.
 *
 * ---------------------------------------------------------------------------
 * Ported from openclaw-weixin (https://github.com/Tencent/openclaw-weixin),
 * Copyright (C) 2026 Tencent, MIT-licensed. See repository NOTICE for full
 * attribution. Adapted to use Craft Agents' MessagingLogger and to take
 * client-identity parameters explicitly instead of reading openclaw's
 * package.json.
 * ---------------------------------------------------------------------------
 */

import { randomBytes } from 'node:crypto'
import { Buffer } from 'node:buffer'

import type { MessagingLogger } from '../../../types'
import { redactBody, redactUrl } from './redact'
import type {
  BaseInfo,
  GetConfigResp,
  GetUpdatesReq,
  GetUpdatesResp,
  GetUploadUrlReq,
  GetUploadUrlResp,
  SendMessageReq,
  SendTypingReq,
} from './types'

// ---------------------------------------------------------------------------
// Client identity
// ---------------------------------------------------------------------------

/**
 * Static identifiers the iLink endpoint expects every request to carry. The
 * upstream service validates `iLink-App-Id` against an allow-list and uses
 * `iLink-App-ClientVersion` for telemetry. Both are baked into the adapter at
 * construction time so the protocol layer never needs to read package.json.
 */
export interface WeixinClientIdentity {
  /** iLink app id assigned to the client (same value across all requests). */
  appId: string
  /** Channel version string echoed in BaseInfo (e.g. "0.9.0"). */
  channelVersion: string
  /**
   * iLink-App-ClientVersion header — encoded as `(major<<16) | (minor<<8) | patch`
   * with the high 8 bits zero. Use {@link encodeClientVersion} to compute.
   */
  clientVersion: number
  /** Optional SKRouteTag header (set after login when the server pins an IDC). */
  routeTag?: string
}

/**
 * Encode a semver-ish "MAJOR.MINOR.PATCH" string into the uint32 layout the
 * iLink-App-ClientVersion header expects: `0x00MMNNPP`.
 */
export function encodeClientVersion(version: string): number {
  const [major = 0, minor = 0, patch = 0] = version
    .split('.')
    .map((p) => Number.parseInt(p, 10) || 0)
  return ((major & 0xff) << 16) | ((minor & 0xff) << 8) | (patch & 0xff)
}

// ---------------------------------------------------------------------------
// Per-call options
// ---------------------------------------------------------------------------

export interface WeixinApiOptions {
  baseUrl: string
  identity: WeixinClientIdentity
  token?: string
  timeoutMs?: number
  /** Long-poll timeout for getUpdates (server may hold the request up to this). */
  longPollTimeoutMs?: number
  /** Optional logger for protocol-level traces. */
  logger?: MessagingLogger
}

/** Default timeout for long-poll getUpdates requests. */
const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000
/** Default timeout for regular API requests (sendMessage, getUploadUrl). */
const DEFAULT_API_TIMEOUT_MS = 15_000
/** Default timeout for lightweight API requests (getConfig, sendTyping). */
const DEFAULT_CONFIG_TIMEOUT_MS = 10_000

const NOOP_LOGGER: MessagingLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => NOOP_LOGGER,
}

// ---------------------------------------------------------------------------
// Header construction
// ---------------------------------------------------------------------------

/** Build the `base_info` payload included in every API request. */
export function buildBaseInfo(identity: WeixinClientIdentity): BaseInfo {
  return { channel_version: identity.channelVersion }
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`
}

/** X-WECHAT-UIN header: random uint32 → decimal string → base64. */
function randomWechatUin(): string {
  const uint32 = randomBytes(4).readUInt32BE(0)
  return Buffer.from(String(uint32), 'utf-8').toString('base64')
}

function buildCommonHeaders(identity: WeixinClientIdentity): Record<string, string> {
  const headers: Record<string, string> = {
    'iLink-App-Id': identity.appId,
    'iLink-App-ClientVersion': String(identity.clientVersion),
  }
  if (identity.routeTag) {
    headers.SKRouteTag = identity.routeTag
  }
  return headers
}

function buildPostHeaders(identity: WeixinClientIdentity, body: string, token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    'Content-Length': String(Buffer.byteLength(body, 'utf-8')),
    'X-WECHAT-UIN': randomWechatUin(),
    ...buildCommonHeaders(identity),
  }
  const trimmed = token?.trim()
  if (trimmed) {
    headers.Authorization = `Bearer ${trimmed}`
  }
  return headers
}

// ---------------------------------------------------------------------------
// Low-level fetch wrappers
// ---------------------------------------------------------------------------

/**
 * GET wrapper used by the QR-login endpoints (`get_bot_qrcode`, `get_qrcode_status`).
 * Returns the raw response text on success; throws on HTTP error or abort.
 */
export async function apiGetFetch(params: {
  baseUrl: string
  identity: WeixinClientIdentity
  endpoint: string
  timeoutMs?: number
  label: string
  logger?: MessagingLogger
}): Promise<string> {
  const log = params.logger ?? NOOP_LOGGER
  const url = new URL(params.endpoint, ensureTrailingSlash(params.baseUrl))
  log.info(`GET ${redactUrl(url.toString())}`, { event: 'wechat_api_request', label: params.label })

  const controller = params.timeoutMs && params.timeoutMs > 0 ? new AbortController() : undefined
  const timer = controller ? setTimeout(() => controller.abort(), params.timeoutMs) : undefined
  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: buildCommonHeaders(params.identity),
      ...(controller ? { signal: controller.signal } : {}),
    })
    const body = await res.text()
    log.info(`${params.label} status=${res.status}`, {
      event: 'wechat_api_response',
      label: params.label,
      status: res.status,
      body: redactBody(body),
    })
    if (!res.ok) {
      throw new Error(`${params.label} ${res.status}: ${body}`)
    }
    return body
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * POST JSON wrapper for the bot endpoints. Returns the raw response text on
 * success; throws on HTTP error or abort.
 */
async function apiPostFetch(params: {
  baseUrl: string
  identity: WeixinClientIdentity
  endpoint: string
  body: string
  token?: string
  timeoutMs: number
  label: string
  logger?: MessagingLogger
}): Promise<string> {
  const log = params.logger ?? NOOP_LOGGER
  const url = new URL(params.endpoint, ensureTrailingSlash(params.baseUrl))
  const headers = buildPostHeaders(params.identity, params.body, params.token)
  log.info(`POST ${redactUrl(url.toString())}`, {
    event: 'wechat_api_request',
    label: params.label,
    body: redactBody(params.body),
  })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), params.timeoutMs)
  try {
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers,
      body: params.body,
      signal: controller.signal,
    })
    const body = await res.text()
    log.info(`${params.label} status=${res.status}`, {
      event: 'wechat_api_response',
      label: params.label,
      status: res.status,
      body: redactBody(body),
    })
    if (!res.ok) {
      throw new Error(`${params.label} ${res.status}: ${body}`)
    }
    return body
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// Bot endpoints
// ---------------------------------------------------------------------------

/**
 * Long-poll getUpdates. Server holds the request until new messages arrive or
 * the long-poll timeout elapses.
 *
 * On client-side timeout (no server response within `timeoutMs`), returns an
 * empty `{ ret: 0, msgs: [], get_updates_buf }` so the caller can simply retry —
 * this is normal for long-poll.
 */
export async function getUpdates(
  params: GetUpdatesReq & WeixinApiOptions,
): Promise<GetUpdatesResp> {
  const timeout = params.timeoutMs ?? params.longPollTimeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS
  try {
    const rawText = await apiPostFetch({
      baseUrl: params.baseUrl,
      identity: params.identity,
      endpoint: 'ilink/bot/getupdates',
      body: JSON.stringify({
        get_updates_buf: params.get_updates_buf ?? '',
        base_info: buildBaseInfo(params.identity),
      }),
      token: params.token,
      timeoutMs: timeout,
      label: 'getUpdates',
      logger: params.logger,
    })
    return JSON.parse(rawText) as GetUpdatesResp
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ret: 0, msgs: [], get_updates_buf: params.get_updates_buf }
    }
    throw err
  }
}

/** Get pre-signed CDN upload parameters for a file. */
export async function getUploadUrl(
  params: GetUploadUrlReq & WeixinApiOptions,
): Promise<GetUploadUrlResp> {
  const rawText = await apiPostFetch({
    baseUrl: params.baseUrl,
    identity: params.identity,
    endpoint: 'ilink/bot/getuploadurl',
    body: JSON.stringify({
      filekey: params.filekey,
      media_type: params.media_type,
      to_user_id: params.to_user_id,
      rawsize: params.rawsize,
      rawfilemd5: params.rawfilemd5,
      filesize: params.filesize,
      thumb_rawsize: params.thumb_rawsize,
      thumb_rawfilemd5: params.thumb_rawfilemd5,
      thumb_filesize: params.thumb_filesize,
      no_need_thumb: params.no_need_thumb,
      aeskey: params.aeskey,
      base_info: buildBaseInfo(params.identity),
    }),
    token: params.token,
    timeoutMs: params.timeoutMs ?? DEFAULT_API_TIMEOUT_MS,
    label: 'getUploadUrl',
    logger: params.logger,
  })
  return JSON.parse(rawText) as GetUploadUrlResp
}

/** Send a single message downstream. */
export async function sendMessage(
  params: WeixinApiOptions & { body: SendMessageReq },
): Promise<void> {
  await apiPostFetch({
    baseUrl: params.baseUrl,
    identity: params.identity,
    endpoint: 'ilink/bot/sendmessage',
    body: JSON.stringify({ ...params.body, base_info: buildBaseInfo(params.identity) }),
    token: params.token,
    timeoutMs: params.timeoutMs ?? DEFAULT_API_TIMEOUT_MS,
    label: 'sendMessage',
    logger: params.logger,
  })
}

/** Fetch bot config (includes typing_ticket) for a given user. */
export async function getConfig(
  params: WeixinApiOptions & { ilinkUserId: string; contextToken?: string },
): Promise<GetConfigResp> {
  const rawText = await apiPostFetch({
    baseUrl: params.baseUrl,
    identity: params.identity,
    endpoint: 'ilink/bot/getconfig',
    body: JSON.stringify({
      ilink_user_id: params.ilinkUserId,
      context_token: params.contextToken,
      base_info: buildBaseInfo(params.identity),
    }),
    token: params.token,
    timeoutMs: params.timeoutMs ?? DEFAULT_CONFIG_TIMEOUT_MS,
    label: 'getConfig',
    logger: params.logger,
  })
  return JSON.parse(rawText) as GetConfigResp
}

/** Send a typing indicator to a user. */
export async function sendTyping(
  params: WeixinApiOptions & { body: SendTypingReq },
): Promise<void> {
  await apiPostFetch({
    baseUrl: params.baseUrl,
    identity: params.identity,
    endpoint: 'ilink/bot/sendtyping',
    body: JSON.stringify({ ...params.body, base_info: buildBaseInfo(params.identity) }),
    token: params.token,
    timeoutMs: params.timeoutMs ?? DEFAULT_CONFIG_TIMEOUT_MS,
    label: 'sendTyping',
    logger: params.logger,
  })
}
