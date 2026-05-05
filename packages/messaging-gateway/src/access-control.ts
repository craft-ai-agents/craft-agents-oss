/**
 * Access-control evaluator — single source of truth for "may this sender
 * route to this binding / run this pre-binding command?"
 *
 * Lives as a pure function so router and commands can call it identically
 * and so unit tests can exhaustively cover the permission matrix without
 * standing up a full gateway. Returns a discriminated verdict the caller
 * uses to decide between routing, replying, and recording a pending sender.
 */

import type { PendingSendersStore } from './pending-senders'
import type {
  BindingConfig,
  IncomingMessage,
  MessagingConfig,
  MessagingLogger,
  PlatformAccessMode,
  PlatformAdapter,
  PlatformOwner,
  PlatformType,
} from './types'

/**
 * Cooldown window for friendly rejection replies. A non-owner who pings
 * the bot every second shouldn't get a reply every second — the reply
 * itself becomes spam, and a malicious sender can use it to wedge the
 * bot's own outgoing pipeline.
 */
export const REJECT_REPLY_COOLDOWN_MS = 60 * 60 * 1000

export type AccessDecision =
  | { allow: true }
  | { allow: false; reason: AccessRejectReason }

export type AccessRejectReason =
  /** The sender is a bot (Telegram `from.is_bot`). Always silent-drop. */
  | 'bot-sender'
  /** Workspace mode is `'owner-only'` and sender is not on the owners list. */
  | 'not-owner'
  /** Binding mode is `'allow-list'` and sender is not on `allowedSenderIds`. */
  | 'not-on-binding-allowlist'

export interface PreBindingAccessInput {
  /** The inbound message about to be handled by Commands. */
  msg: IncomingMessage
  /** Workspace messaging config (for `accessMode` + `owners`). */
  workspaceConfig: MessagingConfig
}

/**
 * Decide whether `msg` may run a pre-binding command (`/new`, `/bind`, etc.)
 * — i.e. one that operates on the workspace before any binding exists.
 *
 * Rules:
 *  - Bot senders are always rejected (silent-drop expected upstream).
 *  - When the platform's `accessMode` is missing or `'open'`, allow.
 *  - When `'owner-only'`, allow iff the sender is on `owners`.
 */
export function evaluatePreBindingAccess(
  input: PreBindingAccessInput,
): AccessDecision {
  const { msg, workspaceConfig } = input
  if (msg.senderIsBot) return { allow: false, reason: 'bot-sender' }

  const mode = readPlatformAccessMode(workspaceConfig, msg.platform)
  if (mode === 'open') return { allow: true }

  const owners = readPlatformOwners(workspaceConfig, msg.platform)
  if (owners.some((o) => o.userId === msg.senderId)) return { allow: true }
  return { allow: false, reason: 'not-owner' }
}

export interface BindingAccessInput {
  msg: IncomingMessage
  workspaceConfig: MessagingConfig
  binding: { config: BindingConfig }
}

/**
 * Decide whether `msg` may route to an existing binding.
 *
 * Resolution order:
 *  1. Bot sender → reject.
 *  2. Binding `accessMode === 'open'` → allow.
 *  3. Binding `accessMode === 'allow-list'` → allow iff sender is in
 *     `allowedSenderIds`.
 *  4. Binding `accessMode === 'inherit'` → defer to workspace policy:
 *     `'open'` allows; `'owner-only'` requires sender on `owners`.
 *
 * Note: a `'open'` workspace + `'inherit'` binding is the legacy/migration
 * path. It deliberately allows traffic so existing prod workspaces don't
 * silently break the day this code ships.
 */
export function evaluateBindingAccess(input: BindingAccessInput): AccessDecision {
  const { msg, workspaceConfig, binding } = input
  if (msg.senderIsBot) return { allow: false, reason: 'bot-sender' }

  const mode = binding.config.accessMode
  if (mode === 'open') return { allow: true }

  if (mode === 'allow-list') {
    return binding.config.allowedSenderIds.includes(msg.senderId)
      ? { allow: true }
      : { allow: false, reason: 'not-on-binding-allowlist' }
  }

  // mode === 'inherit'
  const wsMode = readPlatformAccessMode(workspaceConfig, msg.platform)
  if (wsMode === 'open') return { allow: true }
  const owners = readPlatformOwners(workspaceConfig, msg.platform)
  return owners.some((o) => o.userId === msg.senderId)
    ? { allow: true }
    : { allow: false, reason: 'not-owner' }
}

/**
 * Read the workspace's platform-level access mode, defaulting to `'open'`
 * for back-compat with configs that predate this field.
 */
export function readPlatformAccessMode(
  config: MessagingConfig,
  platform: PlatformType,
): PlatformAccessMode {
  if (platform !== 'telegram') return 'open'
  return config.platforms.telegram?.accessMode ?? 'open'
}

/** Read the platform's owners list (empty when not configured). */
export function readPlatformOwners(
  config: MessagingConfig,
  platform: PlatformType,
): PlatformOwner[] {
  if (platform !== 'telegram') return []
  return config.platforms.telegram?.owners ?? []
}

/**
 * Inbound stimulus identity. Subset of `IncomingMessage` / `ButtonPress`
 * that the rejection helper needs — extracting the common shape avoids a
 * "fake an IncomingMessage" pattern at the button callsite.
 */
export interface RejectableSender {
  platform: PlatformType
  channelId: string
  threadId?: number
  senderId: string
  senderName?: string
  senderUsername?: string
}

export interface RejectionExecutionContext {
  /** Per-(platform, senderId) cooldown map. Mutated. */
  recentRejectReplies: Map<string, number>
  /** Optional pending-senders store. Records non-bot rejections. */
  pendingStore?: PendingSendersStore
}

/**
 * Shared rejection path: log, record in pending store, send the friendly
 * reply with cooldown. Used by `Router.handleReject` (text path),
 * `Commands.sendRejection` (pre-binding text path), and
 * `MessagingGateway.handleButtonPress` (callback button path) so all
 * three entry points behave identically.
 */
export async function executeRejection(
  adapter: PlatformAdapter,
  sender: RejectableSender,
  reason: AccessRejectReason,
  ctx: RejectionExecutionContext,
  log: MessagingLogger,
  extra: { bindingId?: string; sessionId?: string } = {},
): Promise<void> {
  log.info('access-control rejected stimulus', {
    event: 'access_rejected',
    reason,
    platform: sender.platform,
    channelId: sender.channelId,
    threadId: sender.threadId,
    senderId: sender.senderId,
    senderUsername: sender.senderUsername,
    bindingId: extra.bindingId,
    sessionId: extra.sessionId,
  })

  if (reason !== 'bot-sender') {
    // Map the access verdict reason into the pending-store reason. The
    // store only cares about the two "user-facing" reasons (workspace vs.
    // binding) — bot-sender is silent-dropped before reaching here.
    const pendingReason =
      reason === 'not-on-binding-allowlist' ? 'not-on-binding-allowlist' : 'not-owner'
    ctx.pendingStore?.recordRejection({
      platform: sender.platform,
      senderId: sender.senderId,
      senderName: sender.senderName,
      senderUsername: sender.senderUsername,
      reason: pendingReason,
      ...(extra.bindingId ? { bindingId: extra.bindingId } : {}),
      ...(extra.sessionId ? { sessionId: extra.sessionId } : {}),
      ...(sender.channelId ? { channelId: sender.channelId } : {}),
      ...(sender.threadId !== undefined ? { threadId: sender.threadId } : {}),
    })
  }

  const replyText = buildRejectionReply(reason)
  if (!replyText) return

  const key = `${sender.platform}:${sender.senderId}`
  const last = ctx.recentRejectReplies.get(key) ?? 0
  if (Date.now() - last < REJECT_REPLY_COOLDOWN_MS) return
  ctx.recentRejectReplies.set(key, Date.now())

  try {
    await adapter.sendText(sender.channelId, replyText, {
      ...(sender.threadId !== undefined ? { threadId: sender.threadId } : {}),
    })
  } catch (err) {
    log.warn('failed to send rejection reply (non-fatal)', {
      event: 'reject_reply_failed',
      platform: sender.platform,
      channelId: sender.channelId,
      error: err,
    })
  }
}

/**
 * Friendly reply text for a rejected sender. Returns null when the verdict
 * was `bot-sender` (no reply — bot loops are a hazard).
 */
export function buildRejectionReply(reason: AccessRejectReason): string | null {
  switch (reason) {
    case 'bot-sender':
      return null
    case 'not-owner':
      return 'This bot is private. Ask the owner to invite you in the Craft Agent app.'
    case 'not-on-binding-allowlist':
      return "You're not on the allow-list for this conversation. Ask the owner to add you."
  }
}
