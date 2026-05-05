/**
 * PendingSendersStore — bounded record of senders the access-control layer
 * recently rejected.
 *
 * Surfaces in the Settings UI as "Pending requests" so the operator can
 * promote a sender to the owners list with one click. Persisted to
 * `messaging/pending.json` per workspace.
 *
 * Bounds:
 *  - LRU 50 entries per workspace (recency wins on overflow).
 *  - 7-day TTL — entries older than that are dropped on read/write.
 *  - File-backed best-effort. Losing the file is harmless: the next
 *    rejected attempt repopulates it.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  MessagingLogger,
  PendingRejectReason,
  PendingSender,
  PlatformType,
} from './types'

const NOOP_LOGGER: MessagingLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => NOOP_LOGGER,
}

const MAX_ENTRIES = 50
const TTL_MS = 7 * 24 * 60 * 60 * 1000

export interface RecordRejectionInput {
  platform: PlatformType
  senderId: string
  senderName?: string
  senderUsername?: string
  /**
   * Why the sender was rejected. Defaults to `'not-owner'` for callers
   * that don't supply it (back-compat with the original signature).
   */
  reason?: PendingRejectReason
  /** Binding context for `'not-on-binding-allowlist'` rejects. */
  bindingId?: string
  sessionId?: string
  channelId?: string
  threadId?: number
}

export class PendingSendersStore {
  private entries: PendingSender[] = []
  private readonly filePath: string
  private readonly dirPath: string
  private readonly log: MessagingLogger
  private changeListener?: () => void

  constructor(storageDir: string, logger: MessagingLogger = NOOP_LOGGER) {
    this.dirPath = storageDir
    this.filePath = join(storageDir, 'pending.json')
    this.log = logger
    this.load()
  }

  /** Register a callback fired after any mutation is persisted. */
  onChange(fn: () => void): void {
    this.changeListener = fn
  }

  // -------------------------------------------------------------------------
  // Query
  // -------------------------------------------------------------------------

  list(platform?: PlatformType): PendingSender[] {
    const now = Date.now()
    return this.entries
      .filter((e) => now - e.lastAttemptAt < TTL_MS)
      .filter((e) => (platform ? e.platform === platform : true))
      .sort((a, b) => b.lastAttemptAt - a.lastAttemptAt)
  }

  // -------------------------------------------------------------------------
  // Mutation
  // -------------------------------------------------------------------------

  /**
   * Record a rejected attempt. Entries are keyed by
   * `(platform, senderId, reason, bindingId)` — same sender hitting
   * different bindings stays on separate rows so the operator can
   * decide each one independently. A repeat attempt against the same
   * key bumps `attemptCount` + `lastAttemptAt` and refreshes display
   * metadata.
   *
   * LRU eviction kicks in on insert overflow. Returns the merged entry
   * so callers can log the current attemptCount without re-querying.
   */
  recordRejection(input: RecordRejectionInput): PendingSender {
    const now = Date.now()
    this.evictExpired(now)

    const reason: PendingRejectReason = input.reason ?? 'not-owner'
    const bindingId = input.bindingId

    const idx = this.entries.findIndex(
      (e) =>
        e.platform === input.platform &&
        e.userId === input.senderId &&
        (e.reason ?? 'not-owner') === reason &&
        (e.bindingId ?? null) === (bindingId ?? null),
    )
    let merged: PendingSender
    if (idx >= 0) {
      const existing = this.entries[idx]!
      merged = {
        ...existing,
        // Refresh metadata if the new attempt brought better info.
        displayName: input.senderName ?? existing.displayName,
        username: input.senderUsername ?? existing.username,
        lastAttemptAt: now,
        attemptCount: existing.attemptCount + 1,
        reason,
        ...(input.bindingId ? { bindingId: input.bindingId } : {}),
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        ...(input.channelId ? { channelId: input.channelId } : {}),
        ...(input.threadId !== undefined ? { threadId: input.threadId } : {}),
      }
      this.entries.splice(idx, 1)
      this.entries.unshift(merged)
    } else {
      merged = {
        platform: input.platform,
        userId: input.senderId,
        displayName: input.senderName,
        username: input.senderUsername,
        lastAttemptAt: now,
        attemptCount: 1,
        reason,
        ...(input.bindingId ? { bindingId: input.bindingId } : {}),
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        ...(input.channelId ? { channelId: input.channelId } : {}),
        ...(input.threadId !== undefined ? { threadId: input.threadId } : {}),
      }
      this.entries.unshift(merged)
      if (this.entries.length > MAX_ENTRIES) {
        this.entries = this.entries.slice(0, MAX_ENTRIES)
      }
    }

    this.save()
    return merged
  }

  /**
   * Drop one or more entries matching the supplied key. With only
   * `(platform, userId)` provided, every reason/binding row for that
   * sender is dropped — used when the sender becomes a workspace owner
   * via "Allow as workspace owner" so we don't leave stale rows behind.
   * Specifying `reason` (and optionally `bindingId`) narrows the dismiss
   * to a single row.
   *
   * Returns true if anything was removed.
   */
  dismiss(
    platform: PlatformType,
    userId: string,
    opts?: { reason?: PendingRejectReason; bindingId?: string },
  ): boolean {
    const before = this.entries.length
    this.entries = this.entries.filter((e) => {
      if (e.platform !== platform || e.userId !== userId) return true
      if (opts?.reason !== undefined && (e.reason ?? 'not-owner') !== opts.reason) return true
      if (opts?.bindingId !== undefined && e.bindingId !== opts.bindingId) return true
      return false
    })
    if (this.entries.length === before) return false
    this.save()
    return true
  }

  /** Drop every entry for the platform. Used after disconnect/forget. */
  clearPlatform(platform: PlatformType): number {
    const before = this.entries.length
    this.entries = this.entries.filter((e) => e.platform !== platform)
    const removed = before - this.entries.length
    if (removed > 0) this.save()
    return removed
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  private evictExpired(now: number): void {
    const cutoff = now - TTL_MS
    const fresh = this.entries.filter((e) => e.lastAttemptAt >= cutoff)
    if (fresh.length !== this.entries.length) {
      this.entries = fresh
      this.save()
    }
  }

  private load(): void {
    try {
      if (!existsSync(this.filePath)) return
      const raw = readFileSync(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return
      const now = Date.now()
      this.entries = parsed
        .filter(isPendingSender)
        .filter((e) => now - e.lastAttemptAt < TTL_MS)
    } catch (err) {
      this.log.error('failed to load pending senders; resetting', {
        event: 'pending_senders_load_failed',
        filePath: this.filePath,
        error: err,
      })
      this.entries = []
    }
  }

  private save(): void {
    try {
      if (!existsSync(this.dirPath)) {
        mkdirSync(this.dirPath, { recursive: true })
      }
      writeFileSync(this.filePath, JSON.stringify(this.entries, null, 2), 'utf-8')
      this.changeListener?.()
    } catch (err) {
      this.log.error('failed to save pending senders', {
        event: 'pending_senders_save_failed',
        filePath: this.filePath,
        error: err,
      })
    }
  }
}

function isPendingSender(value: unknown): value is PendingSender {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    (v.platform === 'telegram' || v.platform === 'whatsapp' || v.platform === 'lark') &&
    typeof v.userId === 'string' &&
    typeof v.lastAttemptAt === 'number' &&
    typeof v.attemptCount === 'number'
  )
}
