/**
 * Router — routes inbound messages from platform adapters to sessions.
 *
 * Looks up the ChannelBinding for (platform, channelId).
 * If found → resolves any `IncomingAttachment.localPath` entries to
 * `FileAttachment`s via `readFileAttachment()`, then forwards to
 * SessionManager.
 * If not found → delegates to Commands for /bind, /new, etc.
 */

import type { ISessionManager } from '@craft-agent/server-core/handlers'
import { readFileAttachment } from '@craft-agent/shared/utils'
import type { FileAttachment } from '@craft-agent/shared/protocol'
import type { BindingStore } from './binding-store'
import type { Commands } from './commands'
import type { IncomingMessage, PlatformAdapter } from './types'

export class Router {
  constructor(
    private readonly sessionManager: ISessionManager,
    private readonly bindingStore: BindingStore,
    private readonly commands: Commands,
  ) {}

  async route(adapter: PlatformAdapter, msg: IncomingMessage): Promise<void> {
    const binding = this.bindingStore.findByChannel(msg.platform, msg.channelId)

    if (binding) {
      // Bound channel — forward message to session
      try {
        const fileAttachments = this.resolveAttachments(msg)
        await this.sessionManager.sendMessage(
          binding.sessionId,
          msg.text,
          fileAttachments,
          undefined, // storedAttachments (handled by session layer)
          undefined, // SendMessageOptions
        )
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error'
        await adapter.sendText(
          msg.channelId,
          `Failed to send message to session: ${errorMsg}`,
        )
      }
      return
    }

    // Unbound channel — check for commands
    await this.commands.handle(adapter, msg)
  }

  /**
   * Convert adapter-emitted `IncomingAttachment[]` into the session's
   * `FileAttachment[]` shape. Adapters that download the blob to disk
   * populate `localPath`; we wrap it with `readFileAttachment()` which
   * handles image→base64 / pdf→base64 / text→utf-8 encoding.
   *
   * Attachments without a `localPath`, or whose file can't be read, are
   * silently skipped — the upstream adapter already logged/notified on
   * download failure, so re-surfacing here would double up.
   */
  private resolveAttachments(msg: IncomingMessage): FileAttachment[] | undefined {
    if (!msg.attachments?.length) return undefined
    const built: FileAttachment[] = []
    for (const a of msg.attachments) {
      if (!a.localPath) continue
      const att = readFileAttachment(a.localPath) as FileAttachment | null
      if (!att) continue
      if (a.fileName) att.name = a.fileName
      built.push(att)
    }
    return built.length > 0 ? built : undefined
  }
}
