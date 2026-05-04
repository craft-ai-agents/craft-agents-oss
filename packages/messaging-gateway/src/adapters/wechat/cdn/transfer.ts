/**
 * WeChat CDN transfer helpers.
 *
 * iLink ferries every media payload (image, voice, video, file) through a
 * dedicated CDN at `https://novac2c.cdn.weixin.qq.com/c2c/{download,upload}`
 * with AES-128-ECB at rest. Bot endpoints expose only the encrypted query
 * parameter + AES key — actual byte transport happens here.
 *
 * Two flavours of `aes_key` show up over the wire:
 *   - base64(raw 16 bytes)         → image inbound (`media.aes_key`)
 *   - base64(hex string, 32 chars) → file / voice / video inbound
 *
 * Outbound paths additionally need a content-size precomputation
 * (`aesEcbPaddedSize`) before calling `getuploadurl`, since the iLink server
 * must know the encrypted size up front.
 *
 * ---------------------------------------------------------------------------
 * Adapted from openclaw-weixin (https://github.com/Tencent/openclaw-weixin),
 * Copyright (C) 2026 Tencent, MIT-licensed. See repository NOTICE.
 * ---------------------------------------------------------------------------
 */

import { Buffer } from 'node:buffer'

import type { MessagingLogger } from '../../../types'
import { decryptAesEcb, encryptAesEcb } from './aes-ecb'
import { redactUrl } from '../protocol/redact'

/** Tencent-fixed CDN endpoint used by every iLink bot deployment. */
export const WECHAT_CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c'

/** Retry attempts for CDN POST upload before giving up. */
const UPLOAD_MAX_RETRIES = 3

const NOOP_LOGGER: MessagingLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => NOOP_LOGGER,
}

// ---------------------------------------------------------------------------
// URL builders
// ---------------------------------------------------------------------------

export function buildCdnDownloadUrl(encryptedQueryParam: string, cdnBaseUrl = WECHAT_CDN_BASE_URL): string {
  return `${cdnBaseUrl}/download?encrypted_query_param=${encodeURIComponent(encryptedQueryParam)}`
}

export function buildCdnUploadUrl(params: {
  cdnBaseUrl?: string
  uploadParam: string
  filekey: string
}): string {
  const base = params.cdnBaseUrl ?? WECHAT_CDN_BASE_URL
  return `${base}/upload?encrypted_query_param=${encodeURIComponent(params.uploadParam)}&filekey=${encodeURIComponent(params.filekey)}`
}

// ---------------------------------------------------------------------------
// AES key parsing
// ---------------------------------------------------------------------------

/**
 * Decode the protocol-level `aes_key` field (base64) into a raw 16-byte AES
 * key. Falls back to hex-decoding a 32-char ASCII string when the base64
 * payload is the hex representation rather than the bytes themselves —
 * that happens for non-image media (file/voice/video).
 */
export function parseAesKey(aesKeyBase64: string, label: string): Buffer {
  const decoded = Buffer.from(aesKeyBase64, 'base64')
  if (decoded.length === 16) return decoded
  if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(decoded.toString('ascii'))) {
    return Buffer.from(decoded.toString('ascii'), 'hex')
  }
  throw new Error(
    `${label}: aes_key must decode to 16 raw bytes or a 32-char hex string, got ${decoded.length} bytes`,
  )
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

async function fetchBytes(url: string, label: string, log: MessagingLogger): Promise<Buffer> {
  log.info(`${label}: GET ${redactUrl(url)}`, { event: 'wechat_cdn_request', label })
  const res = await fetch(url)
  log.info(`${label}: status=${res.status}`, { event: 'wechat_cdn_response', label, status: res.status })
  if (!res.ok) {
    const body = await res.text().catch(() => '(unreadable)')
    throw new Error(`${label}: CDN download ${res.status} ${res.statusText}: ${body}`)
  }
  return Buffer.from(await res.arrayBuffer())
}

/**
 * Download an encrypted CDN blob and AES-decrypt it, returning the plaintext
 * Buffer. The `fullUrl` parameter is preferred when the iLink server returned
 * one (`CDNMedia.full_url`); otherwise we fall back to building the URL from
 * `encrypt_query_param` + the static base host.
 */
export async function downloadAndDecrypt(params: {
  encryptedQueryParam: string
  aesKeyBase64: string
  fullUrl?: string
  label: string
  cdnBaseUrl?: string
  logger?: MessagingLogger
}): Promise<Buffer> {
  const log = params.logger ?? NOOP_LOGGER
  const key = parseAesKey(params.aesKeyBase64, params.label)
  const url = params.fullUrl ?? buildCdnDownloadUrl(params.encryptedQueryParam, params.cdnBaseUrl)
  const ciphertext = await fetchBytes(url, params.label, log)
  return decryptAesEcb(ciphertext, key)
}

/** Download a CDN blob without decrypting (used for already-plaintext payloads). */
export async function downloadPlain(params: {
  encryptedQueryParam: string
  fullUrl?: string
  label: string
  cdnBaseUrl?: string
  logger?: MessagingLogger
}): Promise<Buffer> {
  const log = params.logger ?? NOOP_LOGGER
  const url = params.fullUrl ?? buildCdnDownloadUrl(params.encryptedQueryParam, params.cdnBaseUrl)
  return fetchBytes(url, params.label, log)
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

/**
 * Encrypt + POST a buffer to the CDN. Returns the `encrypted_query_param`
 * the bot endpoint needs to reference the upload in subsequent `sendmessage`
 * calls (passed back to recipients verbatim).
 *
 * Retries up to `UPLOAD_MAX_RETRIES` times on 5xx / network errors. 4xx
 * responses abort immediately — they indicate a malformed request that
 * retries won't help.
 */
export async function uploadEncrypted(params: {
  buf: Buffer
  aesKey: Buffer
  uploadFullUrl?: string
  uploadParam?: string
  filekey: string
  label: string
  cdnBaseUrl?: string
  logger?: MessagingLogger
}): Promise<{ downloadParam: string }> {
  const log = params.logger ?? NOOP_LOGGER
  const ciphertext = encryptAesEcb(params.buf, params.aesKey)

  const trimmed = params.uploadFullUrl?.trim()
  const url = trimmed
    ? trimmed
    : params.uploadParam
      ? buildCdnUploadUrl({
          cdnBaseUrl: params.cdnBaseUrl,
          uploadParam: params.uploadParam,
          filekey: params.filekey,
        })
      : null

  if (!url) {
    throw new Error(`${params.label}: CDN upload URL missing (need upload_full_url or upload_param)`)
  }

  let lastError: unknown
  for (let attempt = 1; attempt <= UPLOAD_MAX_RETRIES; attempt += 1) {
    try {
      log.info(`${params.label}: POST ${redactUrl(url)}`, {
        event: 'wechat_cdn_upload',
        label: params.label,
        attempt,
        ciphertextSize: ciphertext.length,
      })
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: new Uint8Array(ciphertext),
      })

      if (res.status >= 400 && res.status < 500) {
        const errMsg = res.headers.get('x-error-message') ?? (await res.text())
        // 4xx — caller bug, no retry.
        throw new Error(`${params.label}: CDN client error ${res.status}: ${errMsg}`)
      }
      if (res.status !== 200) {
        const errMsg = res.headers.get('x-error-message') ?? `status ${res.status}`
        throw new Error(`${params.label}: CDN server error: ${errMsg}`)
      }
      const downloadParam = res.headers.get('x-encrypted-param') ?? undefined
      if (!downloadParam) {
        throw new Error(`${params.label}: CDN response missing x-encrypted-param header`)
      }
      return { downloadParam }
    } catch (err) {
      lastError = err
      // 4xx aborts immediately; everything else falls through to retry.
      if (err instanceof Error && err.message.includes('CDN client error')) throw err
      if (attempt < UPLOAD_MAX_RETRIES) {
        log.warn(`${params.label}: upload attempt ${attempt} failed, retrying`, {
          event: 'wechat_cdn_upload_retry',
          attempt,
          error: errMessage(err),
        })
      } else {
        log.error(`${params.label}: all ${UPLOAD_MAX_RETRIES} upload attempts failed`, {
          event: 'wechat_cdn_upload_failed',
          error: errMessage(err),
        })
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`${params.label}: CDN upload failed after ${UPLOAD_MAX_RETRIES} attempts`)
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
