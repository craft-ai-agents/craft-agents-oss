/**
 * Media-attachment extraction for WhatsApp messages.
 *
 * Pure helper, intentionally separated from worker.ts so unit tests can
 * exercise the variant fan-out and size guards without booting the worker
 * (worker.ts installs stdin and signal handlers at module load).
 */

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import type { Buffer as BufferType } from 'node:buffer'
import type { BaileysModule } from './worker'
import type { WorkerIncomingAttachment } from './protocol'

/** Mirrors Telegram's adapter cap so behavior is consistent across platforms. */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

const EXT_BY_MIME: Record<string, string> = {
  'audio/ogg': '.ogg',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/aac': '.aac',
  'audio/wav': '.wav',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'application/pdf': '.pdf',
}

function pickExtension(mime: string | undefined, fallback = '.bin'): string {
  if (!mime) return fallback
  return EXT_BY_MIME[mime] ?? fallback
}

interface VariantSpec {
  key: 'audioMessage' | 'imageMessage' | 'videoMessage' | 'documentMessage'
  type: WorkerIncomingAttachment['type']
  defaultMime: string
}

const VARIANTS: VariantSpec[] = [
  { key: 'audioMessage', type: 'voice', defaultMime: 'audio/ogg' },
  { key: 'imageMessage', type: 'photo', defaultMime: 'image/jpeg' },
  { key: 'videoMessage', type: 'video', defaultMime: 'video/mp4' },
  { key: 'documentMessage', type: 'document', defaultMime: 'application/octet-stream' },
]

/**
 * Walk the supported media variants on a Baileys message and return one
 * `WorkerIncomingAttachment` per recognised variant. Variants whose declared
 * size exceeds the cap, whose download throws, or whose buffer is over-cap
 * after download are skipped (logged, never thrown).
 */
export async function extractAttachments(
  baileys: BaileysModule,
  msg: Record<string, unknown>,
  log: (...args: unknown[]) => void,
): Promise<WorkerIncomingAttachment[]> {
  const m = msg.message as Record<string, unknown> | undefined
  if (!m) return []

  const out: WorkerIncomingAttachment[] = []
  for (const v of VARIANTS) {
    const node = m[v.key] as Record<string, unknown> | undefined
    if (!node) continue

    // audioMessage with ptt=true is a push-to-talk voice note. Without ptt
    // it's an audio file (forwarded music, recording from another app).
    let type = v.type
    if (v.key === 'audioMessage' && node.ptt !== true) type = 'audio'

    const declaredSize = Number(node.fileLength ?? 0)
    if (declaredSize > MAX_ATTACHMENT_BYTES) {
      log(`media skip: ${v.key} declared ${declaredSize} bytes exceeds cap`)
      continue
    }

    let buffer: BufferType
    try {
      buffer = await baileys.downloadMediaMessage(
        msg as Parameters<typeof baileys.downloadMediaMessage>[0],
        'buffer',
        {},
      )
    } catch (err) {
      log(`media download failed for ${v.key}:`, err instanceof Error ? err.message : String(err))
      continue
    }

    if (buffer.byteLength > MAX_ATTACHMENT_BYTES) {
      log(`media skip: ${v.key} buffer ${buffer.byteLength} exceeds cap`)
      continue
    }

    const mimeType = (node.mimetype as string | undefined) ?? v.defaultMime
    const ext = pickExtension(mimeType)
    const fileName =
      (node.fileName as string | undefined) ?? `${type}-${Date.now()}${ext}`
    const localPath = join(tmpdir(), `craft-wa-${randomUUID()}${ext}`)

    try {
      await writeFile(localPath, buffer)
    } catch (err) {
      log(`media write failed for ${v.key}:`, err instanceof Error ? err.message : String(err))
      continue
    }

    out.push({ type, fileName, mimeType, fileSize: buffer.byteLength, localPath })
  }
  return out
}
