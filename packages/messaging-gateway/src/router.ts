/**
 * Router — routes inbound messages from platform adapters to sessions.
 *
 * Looks up the ChannelBinding for (platform, channelId).
 * If found → access-control gate, then resolves any `IncomingAttachment.localPath`
 * entries to `FileAttachment`s via `readFileAttachment()` and forwards to
 * SessionManager.
 * If not found → delegates to Commands for /bind, /new, etc. (Commands
 * applies its own pre-binding access gate.)
 */

import type { ISessionManager } from '@craft-agent/server-core/handlers'
import { readFileAttachment } from '@craft-agent/shared/utils'
import type { FileAttachment } from '@craft-agent/shared/protocol'
import {
  evaluateBindingAccess,
  executeRejection,
  type AccessRejectReason,
} from './access-control'
import type { BindingStore } from './binding-store'
import type { Commands } from './commands'
import type { PendingSendersStore } from './pending-senders'
import type {
  IncomingMessage,
  MessagingConfig,
  MessagingLogger,
  PlatformAdapter,
} from './types'

const NOOP_LOGGER: MessagingLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => NOOP_LOGGER,
}

export interface RouterDeps {
  /** Reads the workspace's current MessagingConfig. Called per-message
   *  so config edits take effect without restart. */
  getWorkspaceConfig: () => MessagingConfig
  /** Optional pending-senders store; rejected attempts are recorded here so
   *  the Settings UI can surface them with one-click "Allow" buttons. */
  pendingStore?: PendingSendersStore
}

export class Router {
  private readonly deps: RouterDeps
  private readonly recentRejectReplies = new Map<string, number>()

  constructor(
    private readonly sessionManager: ISessionManager,
    private readonly bindingStore: BindingStore,
    private readonly commands: Commands,
    private readonly log: MessagingLogger = NOOP_LOGGER,
    deps: RouterDeps = { getWorkspaceConfig: () => ({ enabled: false, platforms: {} }) },
  ) {
    this.deps = deps
  }

  async route(adapter: PlatformAdapter, msg: IncomingMessage): Promise<void> {
    // Threads (Telegram supergroup forum topics) participate in the binding
    // lookup key, so two topics in the same supergroup route to different
    // sessions even though they share `chat.id`.
    const binding = this.bindingStore.findByChannel(msg.platform, msg.channelId, msg.threadId)

    if (binding) {
      const verdict = evaluateBindingAccess({
        msg,
        workspaceConfig: this.deps.getWorkspaceConfig(),
        binding,
      })
      if (!verdict.allow) {
        await this.handleReject(adapter, msg, verdict.reason, {
          bindingId: binding.id,
          sessionId: binding.sessionId,
        })
        return
      }

      try {
        const fileAttachments = this.resolveAttachments(msg)
        this.log.info('routing inbound chat message to session', {
          event: 'message_routed',
          platform: msg.platform,
          channelId: msg.channelId,
          threadId: msg.threadId,
          sessionId: binding.sessionId,
          bindingId: binding.id,
          attachmentCount: fileAttachments?.length ?? 0,
        })
        await this.sessionManager.sendMessage(
          binding.sessionId,
          msg.text,
          fileAttachments,
          undefined, // storedAttachments (handled by session layer)
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
   * Common reject path for both bound (this file) and pre-binding (Commands)
   * gating. Delegates to the shared `executeRejection` so text and button
   * paths behave identically.
   */
  async handleReject(
    adapter: PlatformAdapter,
    msg: IncomingMessage,
    reason: AccessRejectReason,
    extra?: { bindingId?: string; sessionId?: string },
  ): Promise<void> {
    await executeRejection(
      adapter,
      msg,
      reason,
      {
        recentRejectReplies: this.recentRejectReplies,
        ...(this.deps.pendingStore ? { pendingStore: this.deps.pendingStore } : {}),
      },
      this.log,
      extra,
    )
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
