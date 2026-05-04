/**
 * Inbound media downloader for WeChat.
 *
 * Walks a `WeixinMessage.item_list`, fetches every supported media item from
 * the CDN, AES-decrypts it, and writes the plaintext to a tmp file so the
 * router can wrap it as a FileAttachment for the agent. Mirrors openclaw's
 * `downloadMediaFromItem` but tightened to a single async return shape and
 * decoupled from openclaw's plugin SDK.
 *
 * Best-effort by design: a single failed item is logged and skipped, never
 * propagates as an exception that would halt the long-poll loop.
 *
 * ---------------------------------------------------------------------------
 * Adapted from openclaw-weixin (https://github.com/Tencent/openclaw-weixin),
 * Copyright (C) 2026 Tencent, MIT-licensed. See repository NOTICE.
 * ---------------------------------------------------------------------------
 */

import { Buffer } from 'node:buffer'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { randomBytes } from 'node:crypto'

import type { IncomingAttachment, MessagingLogger } from '../../../types'
import { downloadAndDecrypt } from './transfer'
import { MessageItemType, type MessageItem } from '../protocol/types'

const NOOP_LOGGER: MessagingLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => NOOP_LOGGER,
}

/** Hard cap matching @craft-agent/shared/utils/files.MAX_FILE_SIZE. */
const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024

/** Filename → mime fallback when the protocol payload doesn't carry one. */
const EXT_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.txt': 'text/plain',
}

function mimeFromFilename(name: string): string | undefined {
  const ext = extname(name).toLowerCase()
  return EXT_MIME[ext]
}

function writeTmpFile(buffer: Buffer, suggestedExt: string): string {
  const ext = suggestedExt.startsWith('.') ? suggestedExt : `.${suggestedExt}`
  const path = join(tmpdir(), `wechat-${randomBytes(8).toString('hex')}${ext}`)
  writeFileSync(path, buffer)
  return path
}

interface DownloadDeps {
  logger?: MessagingLogger
}

/**
 * Download and decrypt every media item in the list, returning an array of
 * IncomingAttachment with `localPath` already populated. Items the protocol
 * can't address (no encrypt_query_param + no full_url) are silently skipped.
 *
 * Returned array preserves item order — matters because a quoted reply can
 * reference an earlier media item by index in the rendered text.
 */
export async function downloadInboundMedia(
  items: MessageItem[] | undefined,
  deps: DownloadDeps,
): Promise<IncomingAttachment[]> {
  if (!items?.length) return []
  const log = deps.logger ?? NOOP_LOGGER
  const attachments: IncomingAttachment[] = []

  for (const item of items) {
    try {
      const attachment = await downloadOne(item, log)
      if (attachment) attachments.push(attachment)
    } catch (err) {
      log.warn('inbound media item download failed (skipping)', {
        event: 'wechat_inbound_media_failed',
        itemType: item.type,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return attachments
}

async function downloadOne(item: MessageItem, log: MessagingLogger): Promise<IncomingAttachment | null> {
  switch (item.type) {
    case MessageItemType.IMAGE:
      return downloadImage(item, log)
    case MessageItemType.VOICE:
      return downloadVoice(item, log)
    case MessageItemType.FILE:
      return downloadFile(item, log)
    case MessageItemType.VIDEO:
      return downloadVideo(item, log)
    default:
      return null
  }
}

async function downloadImage(item: MessageItem, log: MessagingLogger): Promise<IncomingAttachment | null> {
  const img = item.image_item
  if (!img?.media) return null
  if (!img.media.encrypt_query_param && !img.media.full_url) return null

  // Image AES key shows up in two places: `image_item.aeskey` (hex string)
  // takes precedence over `image_item.media.aes_key` (base64) when both
  // are present — the hex form is observed on freshly-uploaded images.
  const aesKeyBase64 = img.aeskey
    ? Buffer.from(img.aeskey, 'hex').toString('base64')
    : img.media.aes_key
  if (!aesKeyBase64) return null

  const buffer = await downloadAndDecrypt({
    encryptedQueryParam: img.media.encrypt_query_param ?? '',
    aesKeyBase64,
    fullUrl: img.media.full_url,
    label: 'wechat-image',
    logger: log,
  })
  if (buffer.length > MAX_ATTACHMENT_BYTES) {
    log.warn('inbound image exceeds size cap, skipping', {
      event: 'wechat_inbound_image_too_large',
      bytes: buffer.length,
    })
    return null
  }
  const localPath = writeTmpFile(buffer, '.jpg')
  return {
    type: 'photo',
    fileId: localPath,
    fileSize: buffer.length,
    mimeType: 'image/jpeg',
    localPath,
  }
}

async function downloadVoice(item: MessageItem, log: MessagingLogger): Promise<IncomingAttachment | null> {
  const voice = item.voice_item
  if (!voice?.media?.aes_key) return null
  if (!voice.media.encrypt_query_param && !voice.media.full_url) return null

  const buffer = await downloadAndDecrypt({
    encryptedQueryParam: voice.media.encrypt_query_param ?? '',
    aesKeyBase64: voice.media.aes_key,
    fullUrl: voice.media.full_url,
    label: 'wechat-voice',
    logger: log,
  })
  if (buffer.length > MAX_ATTACHMENT_BYTES) return null

  // Voice messages are SILK-encoded; we don't ship a transcoder yet so the
  // raw blob lands as `audio/silk`. The agent receives the server-side
  // transcription via `voice_item.text` (extracted in `extractInboundText`)
  // — this attachment is for completeness when the user wants the original
  // audio.
  const localPath = writeTmpFile(buffer, '.silk')
  return {
    type: 'voice',
    fileId: localPath,
    fileSize: buffer.length,
    mimeType: 'audio/silk',
    localPath,
  }
}

async function downloadFile(item: MessageItem, log: MessagingLogger): Promise<IncomingAttachment | null> {
  const file = item.file_item
  if (!file?.media?.aes_key) return null
  if (!file.media.encrypt_query_param && !file.media.full_url) return null

  const buffer = await downloadAndDecrypt({
    encryptedQueryParam: file.media.encrypt_query_param ?? '',
    aesKeyBase64: file.media.aes_key,
    fullUrl: file.media.full_url,
    label: 'wechat-file',
    logger: log,
  })
  if (buffer.length > MAX_ATTACHMENT_BYTES) return null

  const fileName = file.file_name ?? 'file.bin'
  const ext = extname(fileName) || '.bin'
  const localPath = writeTmpFile(buffer, ext)
  return {
    type: 'document',
    fileId: localPath,
    fileName,
    fileSize: buffer.length,
    mimeType: mimeFromFilename(fileName),
    localPath,
  }
}

async function downloadVideo(item: MessageItem, log: MessagingLogger): Promise<IncomingAttachment | null> {
  const video = item.video_item
  if (!video?.media?.aes_key) return null
  if (!video.media.encrypt_query_param && !video.media.full_url) return null

  const buffer = await downloadAndDecrypt({
    encryptedQueryParam: video.media.encrypt_query_param ?? '',
    aesKeyBase64: video.media.aes_key,
    fullUrl: video.media.full_url,
    label: 'wechat-video',
    logger: log,
  })
  if (buffer.length > MAX_ATTACHMENT_BYTES) return null

  const localPath = writeTmpFile(buffer, '.mp4')
  return {
    type: 'video',
    fileId: localPath,
    fileSize: buffer.length,
    mimeType: 'video/mp4',
    localPath,
  }
}
