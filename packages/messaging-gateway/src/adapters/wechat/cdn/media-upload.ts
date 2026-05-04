/**
 * Outbound media upload pipeline for WeChat.
 *
 * Three steps for every send:
 *   1. Compute plaintext / ciphertext sizes + MD5 (the iLink server needs the
 *      AES-128-ECB padded ciphertext size up front).
 *   2. Call `getuploadurl` to receive the CDN target params.
 *   3. POST the encrypted bytes to the returned URL; the CDN replies with
 *      the `encrypted_query_param` we embed in the subsequent `sendmessage`
 *      call so the recipient can fetch + decrypt the media.
 *
 * Mirrors openclaw's `uploadMediaToCdn`. We omit thumbnail handling (passes
 * `no_need_thumb: true`) — the server falls back to deriving a thumbnail
 * from the original for images / videos, which is sufficient for MVP.
 *
 * ---------------------------------------------------------------------------
 * Adapted from openclaw-weixin (https://github.com/Tencent/openclaw-weixin),
 * Copyright (C) 2026 Tencent, MIT-licensed. See repository NOTICE.
 * ---------------------------------------------------------------------------
 */

import { Buffer } from 'node:buffer'
import { createHash, randomBytes } from 'node:crypto'

import type { MessagingLogger } from '../../../types'
import { aesEcbPaddedSize } from './aes-ecb'
import { uploadEncrypted } from './transfer'
import { getUploadUrl, type WeixinClientIdentity } from '../protocol/api'
import { UploadMediaType } from '../protocol/types'

/**
 * Result of a successful CDN upload — passed into `buildImageItem`,
 * `buildVideoItem`, `buildFileItem` to construct the outbound MessageItem.
 *
 * `aeskey` is hex-encoded so the receiver's `parseAesKey` finds it via the
 * "32-char hex string" branch (the openclaw send-* helpers wrap it in
 * `Buffer.from(hex).toString('base64')` exactly for that round-trip).
 */
export interface UploadedMedia {
  /** Random 32-char filekey we generated for this upload. */
  filekey: string
  /** CDN-issued query param embedded in the recipient's download URL. */
  downloadEncryptedQueryParam: string
  /** AES-128 key, hex-encoded (32 chars). */
  aeskeyHex: string
  /** Plaintext file size. */
  plainSize: number
  /** Ciphertext size after AES-128-ECB + PKCS7 padding. */
  cipherSize: number
}

export interface UploadMediaParams {
  buffer: Buffer
  toUserId: string
  baseUrl: string
  identity: WeixinClientIdentity
  token: string
  mediaType: (typeof UploadMediaType)[keyof typeof UploadMediaType]
  label: string
  logger?: MessagingLogger
}

/**
 * Encrypt + upload a single media payload, returning everything the caller
 * needs to construct the outbound MessageItem. Best-effort retries on the
 * CDN POST happen inside `uploadEncrypted`.
 */
export async function uploadMedia(params: UploadMediaParams): Promise<UploadedMedia> {
  const { buffer, toUserId, baseUrl, identity, token, mediaType, label, logger } = params

  const plainSize = buffer.length
  const rawfilemd5 = createHash('md5').update(buffer).digest('hex')
  const cipherSize = aesEcbPaddedSize(plainSize)
  const filekey = randomBytes(16).toString('hex')
  const aesKey = randomBytes(16)

  const uploadUrlResp = await getUploadUrl({
    baseUrl,
    identity,
    token,
    filekey,
    media_type: mediaType,
    to_user_id: toUserId,
    rawsize: plainSize,
    rawfilemd5,
    filesize: cipherSize,
    no_need_thumb: true,
    aeskey: aesKey.toString('hex'),
    logger,
  })

  const uploadFullUrl = uploadUrlResp.upload_full_url?.trim() || undefined
  const uploadParam = uploadUrlResp.upload_param || undefined
  if (!uploadFullUrl && !uploadParam) {
    throw new Error(`${label}: getUploadUrl returned no upload URL (no upload_full_url / upload_param)`)
  }

  const { downloadParam } = await uploadEncrypted({
    buf: buffer,
    aesKey,
    uploadFullUrl,
    uploadParam,
    filekey,
    label,
    logger,
  })

  return {
    filekey,
    downloadEncryptedQueryParam: downloadParam,
    aeskeyHex: aesKey.toString('hex'),
    plainSize,
    cipherSize,
  }
}
