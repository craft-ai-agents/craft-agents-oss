/**
 * Echo Tracker for Telegram Bot
 *
 * Tracks outbound message IDs to prevent self-reply loops where the bot
 * processes its own messages as incoming messages in edge cases.
 *
 * Features:
 * - Tracks sent message IDs with 5-minute TTL
 * - Max 100 items with automatic pruning
 * - Fast lookup via Map
 */

const ECHO_TTL_MS = 5 * 60_000 // 5 minutes
const MAX_ITEMS = 100

export class EchoTracker {
  private sentMessageIds = new Map<number, number>() // messageId → timestamp

  /**
   * Track an outbound message ID to detect echoes later.
   *
   * Use case: In rare cases, Telegram may echo bot's own messages back as updates.
   * By tracking sent message IDs, we can skip processing them if they appear as incoming.
   *
   * @param messageId - Telegram message ID from bot.sendMessage()
   */
  track(messageId: number): void {
    this.sentMessageIds.set(messageId, Date.now())

    // Prune if too many items (prevent unbounded memory growth)
    if (this.sentMessageIds.size > MAX_ITEMS) {
      // Find and remove the oldest entry (simple LRU)
      let oldestMessageId: number | null = null
      let oldestTimestamp = Infinity

      for (const [messageId, timestamp] of this.sentMessageIds.entries()) {
        if (timestamp < oldestTimestamp) {
          oldestTimestamp = timestamp
          oldestMessageId = messageId
        }
      }

      if (oldestMessageId !== null) {
        this.sentMessageIds.delete(oldestMessageId)
      }
    }
  }

  /**
   * Check if a message ID is an echo of a previously sent message.
   *
   * @param messageId - Telegram message ID to check
   * @returns true if this message was sent by the bot (echo), false otherwise
   */
  isEcho(messageId: number): boolean {
    const timestamp = this.sentMessageIds.get(messageId)
    if (!timestamp) return false

    const now = Date.now()

    // Check if expired
    if (now - timestamp > ECHO_TTL_MS) {
      this.sentMessageIds.delete(messageId)
      return false
    }

    return true
  }

  /**
   * Clear all tracked message IDs.
   * Useful for testing or manual cleanup.
   */
  clear(): void {
    this.sentMessageIds.clear()
  }

  /**
   * Get the number of currently tracked message IDs.
   * Useful for monitoring and debugging.
   */
  size(): number {
    return this.sentMessageIds.size
  }
}
