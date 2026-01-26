/**
 * Inbound Message Debouncing for Telegram
 *
 * Combines rapid sequential messages from the same user within a configurable window.
 * Improves UX by treating burst typing as a single request instead of fragmenting context.
 *
 * Example: User sends 5 messages in 1 second → combined into one request with double newlines.
 *
 * Skip debouncing for:
 * - Commands starting with "/"
 * - Messages with media attachments
 */

import type { TelegramMessage } from './types'

/**
 * Result of debouncing: original messages + combined content
 */
export interface DebouncedMessage {
  /** Original messages that were combined */
  messages: TelegramMessage[]
  /** Combined content with double newlines between messages */
  combinedContent: string
}

/**
 * Inbound debouncer for Telegram messages.
 *
 * Buffers messages by (chatId, userId) key and flushes them after a delay.
 * This prevents rapid sequential messages from creating separate agent requests.
 */
export class InboundDebouncer {
  private buffer = new Map<string, {
    entries: TelegramMessage[]
    timer: NodeJS.Timeout
  }>()

  private debounceMs: number
  private onFlush: (msg: DebouncedMessage) => Promise<void>

  constructor(opts: {
    /** Debounce window in milliseconds (recommended: 1500ms) */
    debounceMs: number
    /** Callback invoked when messages are flushed */
    onFlush: (msg: DebouncedMessage) => Promise<void>
  }) {
    this.debounceMs = opts.debounceMs
    this.onFlush = opts.onFlush
  }

  /**
   * Add a message to the debounce buffer.
   *
   * If the message should skip debouncing (command, media), it's flushed immediately.
   * Otherwise, it's buffered and flushed after the debounce window.
   */
  async add(msg: TelegramMessage): Promise<void> {
    // Don't debounce commands or media
    if (this.shouldSkipDebounce(msg)) {
      await this.onFlush({ messages: [msg], combinedContent: msg.content })
      return
    }

    const key = `${msg.chatId}:${msg.userId}`
    const existing = this.buffer.get(key)

    if (existing) {
      clearTimeout(existing.timer)
      existing.entries.push(msg)
    } else {
      this.buffer.set(key, { entries: [msg], timer: null as any })
    }

    const queue = this.buffer.get(key)!
    queue.timer = setTimeout(async () => {
      this.buffer.delete(key)
      const combined = queue.entries.map(m => m.content).join('\n\n')
      await this.onFlush({
        messages: queue.entries,
        combinedContent: combined
      })
    }, this.debounceMs)
  }

  /**
   * Check if a message should skip debouncing.
   *
   * Skip for:
   * - Commands starting with "/"
   * - Messages with media attachments
   */
  private shouldSkipDebounce(msg: TelegramMessage): boolean {
    const text = msg.content.trim()
    // Skip debounce for commands
    if (text.startsWith('/')) return true
    // Skip for media (when implemented)
    if (msg.attachments?.length) return true
    return false
  }

  /**
   * Cleanup: clear all pending timers.
   * Call this when shutting down the service.
   */
  cleanup(): void {
    for (const [key, queue] of Array.from(this.buffer.entries())) {
      clearTimeout(queue.timer)
      this.buffer.delete(key)
    }
  }
}
