/**
 * Router — routes inbound messages from platform adapters to sessions.
 *
 * Looks up the ChannelBinding for (platform, channelId).
 * If found → resolves any `IncomingAttachment.localPath` entries into
 * `FileAttachment[]` (for the model) and `StoredAttachment[]` (for the
 * user-message bubble + persistence), then forwards to SessionManager.
 * If not found → delegates to Commands for /bind, /new, etc.
 */

import { copyFileSync, mkdirSync, unlinkSync } from 'node:fs'
import { join, basename, extname } from 'node:path'
import { randomUUID } from 'node:crypto'

import { sanitizeFilename, type ISessionManager } from '@craft-agent/server-core/handlers'
import { readFileAttachment } from '@craft-agent/shared/utils'
import type { FileAttachment } from '@craft-agent/shared/protocol'
import type { AttachmentType, StoredAttachment } from '@craft-agent/core/types'
import type { BindingStore } from './binding-store'
import type { Commands } from './commands'
import type { IncomingAttachment, IncomingMessage, MessagingLogger, PlatformAdapter } from './types'

/**
 * Above this plaintext byte budget we skip embedding the image as an inline
 * thumbnail — the user message is persisted to session.jsonl line-by-line, so
 * a 5 MB base64 blob would balloon the file. Oversize images fall back to a
 * generic file icon, which is still better than a blank pill.
 */
const INLINE_THUMBNAIL_BYTE_LIMIT = 512 * 1024

/**
 * Map adapter-emitted media kinds onto the `AttachmentType` enum the bubble
 * renderer understands. Only `'image'` triggers the inline-thumbnail UI;
 * everything else renders as a document tile with an icon. We deliberately
 * collapse `'video'` / `'voice'` / `'audio'` into `'unknown'` so the existing
 * file-icon path picks them up — the bubble doesn't have dedicated video /
 * audio thumbnail support today, and `'text'` would mislabel binary blobs.
 */
function deriveAttachmentType(incoming: IncomingAttachment, fallback: AttachmentType): AttachmentType {
  switch (incoming.type) {
    case 'photo':
      return 'image'
    case 'document':
      // Honour `readFileAttachment`'s extension-based mapping for documents
      // (so .pdf still surfaces as 'pdf', .txt as 'text', etc.). Default to
      // 'unknown' if it would otherwise be 'text' but the IncomingAttachment
      // didn't tell us that — safer than mis-rendering a binary as text.
      return fallback
    default:
      return 'unknown'
  }
}

const NOOP_LOGGER: MessagingLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => NOOP_LOGGER,
}

interface ResolvedAttachments {
  fileAttachments: FileAttachment[]
  storedAttachments: StoredAttachment[]
}

export class Router {
  constructor(
    private readonly sessionManager: ISessionManager,
    private readonly bindingStore: BindingStore,
    private readonly commands: Commands,
    private readonly log: MessagingLogger = NOOP_LOGGER,
  ) {}

  async route(adapter: PlatformAdapter, msg: IncomingMessage): Promise<void> {
    // Threads (Telegram supergroup forum topics) participate in the binding
    // lookup key, so two topics in the same supergroup route to different
    // sessions even though they share `chat.id`.
    const binding = this.bindingStore.findByChannel(msg.platform, msg.channelId, msg.threadId)

    if (binding) {
      try {
        const resolved = this.resolveAttachments(msg, binding.sessionId)
        this.log.info('routing inbound chat message to session', {
          event: 'message_routed',
          platform: msg.platform,
          channelId: msg.channelId,
          threadId: msg.threadId,
          sessionId: binding.sessionId,
          bindingId: binding.id,
          attachmentCount: resolved?.fileAttachments.length ?? 0,
        })
        await this.sessionManager.sendMessage(
          binding.sessionId,
          msg.text,
          resolved?.fileAttachments,
          resolved?.storedAttachments,
          undefined, // SendMessageOptions
        )
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error'
        this.log.error('failed to route inbound chat message', {
          event: 'message_route_failed',
          platform: msg.platform,
          channelId: msg.channelId,
          threadId: msg.threadId,
          sessionId: binding.sessionId,
          bindingId: binding.id,
          error: err,
        })
        await adapter.sendText(
          msg.channelId,
          `Failed to send message to session: ${errorMsg}`,
          { threadId: msg.threadId },
        )
      }
      return
    }

    this.log.info('routing inbound chat message to command handler', {
      event: 'message_unbound',
      platform: msg.platform,
      channelId: msg.channelId,
      threadId: msg.threadId,
      messageId: msg.messageId,
    })
    await this.commands.handle(adapter, msg)
  }

  /**
   * For each `IncomingAttachment.localPath`:
   *   1. Promote the file from the adapter's tmp dir into the session's own
   *      `attachments/` dir. Required because the file-open allowlist (see
   *      `validateFilePathSafety`) rejects paths outside the workspace, and
   *      `tmpdir()` files get reaped by the OS over time.
   *   2. Build a `FileAttachment` (the model-bound shape) from the new path.
   *   3. Build a `StoredAttachment` (the persisted-on-message shape) using
   *      the adapter's media-kind hint to avoid `readFileAttachment`'s
   *      extension-based default of mis-labelling binary blobs as `'text'`.
   *
   * Returns `undefined` when no usable attachments survive resolution.
   */
  private resolveAttachments(
    msg: IncomingMessage,
    sessionId: string,
  ): ResolvedAttachments | undefined {
    if (!msg.attachments?.length) return undefined

    const sessionPath = this.sessionManager.getSessionPath(sessionId)
    if (!sessionPath) {
      this.log.warn('cannot resolve attachments — session has no path', {
        event: 'message_route_no_session_path',
        sessionId,
      })
      return undefined
    }
    const attachmentsDir = join(sessionPath, 'attachments')

    const fileAttachments: FileAttachment[] = []
    const storedAttachments: StoredAttachment[] = []

    for (const incoming of msg.attachments) {
      if (!incoming.localPath) continue

      const promoted = this.promoteToSessionDir(incoming.localPath, attachmentsDir, incoming.fileName)
      if (!promoted) continue

      // `readFileAttachment` throws "File too large" for files > 20 MB. WeChat
      // accepts up to 100 MB inbound, so a single oversize photo would otherwise
      // poison the whole route — kill the bubble + sendText fallback fires.
      // Catch here so other attachments / the message text still go through;
      // also unlink the orphan we already copied to keep the session dir clean.
      let fileAttachment: FileAttachment | null = null
      try {
        fileAttachment = readFileAttachment(promoted) as FileAttachment | null
      } catch (err) {
        this.log.warn('inbound attachment rejected by readFileAttachment', {
          event: 'message_route_attachment_rejected',
          sourcePath: incoming.localPath,
          fileName: incoming.fileName,
          error: err instanceof Error ? err.message : String(err),
        })
        try { unlinkSync(promoted) } catch {}
        continue
      }
      if (!fileAttachment) {
        try { unlinkSync(promoted) } catch {}
        continue
      }

      // `readFileAttachment` derives `name` from the promoted path's basename,
      // which now carries the uuid prefix we added in `promoteToSessionDir`.
      // Restore a clean human-readable name from the adapter hint, falling
      // back to the source path's basename — otherwise the bubble (and the
      // model's prompt) sees an opaque uuid-prefixed filename.
      fileAttachment.name = incoming.fileName ?? basename(incoming.localPath)

      const type = deriveAttachmentType(incoming, fileAttachment.type)
      if (type !== fileAttachment.type) {
        // `readFileAttachment` derives type from the extension and falls back
        // to `'text'`, then reads the file as UTF-8 into `attachment.text`.
        // For a video/voice blob that's pure binary garbage — leaving it on
        // the FileAttachment ships it straight into the model's prompt. Drop
        // the side-effect field along with the type correction.
        fileAttachment.type = type
        fileAttachment.text = undefined
        fileAttachment.base64 = undefined
      }

      // Prefer the adapter-supplied MIME (e.g. wechat sets 'video/mp4' on
      // inbound video) over `getMimeType`'s extension lookup, which only
      // knows image/text/pdf/office and falls through to
      // 'application/octet-stream' for everything else. The bubble's
      // `getFileTypeLabel` keys off MIME, so getting this wrong shows the
      // attachment as a generic "File" instead of "MP4".
      const mimeType = incoming.mimeType ?? fileAttachment.mimeType
      fileAttachment.mimeType = mimeType

      const stored: StoredAttachment = {
        id: randomUUID(),
        type,
        name: fileAttachment.name,
        mimeType,
        size: fileAttachment.size,
        storedPath: promoted,
      }
      if (type === 'image' && fileAttachment.base64 && fileAttachment.size <= INLINE_THUMBNAIL_BYTE_LIMIT) {
        stored.thumbnailBase64 = fileAttachment.base64
      }

      fileAttachments.push(fileAttachment)
      storedAttachments.push(stored)
    }

    if (fileAttachments.length === 0) return undefined
    return { fileAttachments, storedAttachments }
  }

  /**
   * Copy the adapter-written file into the session's attachments dir and
   * return the new absolute path. Returns `null` on copy failure (logged) so
   * the caller can skip the attachment without aborting the whole route.
   *
   * The destination filename gets a UUID prefix to avoid collisions when the
   * same source name (e.g. `IMG_20260505.jpg`) arrives twice. The suggested
   * name is sanitized first — it originates from a remote sender and an
   * unsanitized `../../etc/passwd` would let `path.join` resolve out of the
   * session attachments dir.
   */
  private promoteToSessionDir(
    sourcePath: string,
    attachmentsDir: string,
    suggestedName?: string,
  ): string | null {
    try {
      mkdirSync(attachmentsDir, { recursive: true })
      const safeName = sanitizeFilename(suggestedName ?? basename(sourcePath))
      const ext = extname(safeName)
      const stem = safeName.slice(0, safeName.length - ext.length) || 'attachment'
      const destName = `${randomUUID()}_${stem}${ext}`
      const destPath = join(attachmentsDir, destName)
      copyFileSync(sourcePath, destPath)
      return destPath
    } catch (err) {
      this.log.warn('failed to promote inbound attachment into session dir', {
        event: 'message_route_attachment_copy_failed',
        sourcePath,
        attachmentsDir,
        error: err instanceof Error ? err.message : String(err),
      })
      return null
    }
  }
}
