/**
 * Message Deduplication
 *
 * Prevents processing duplicate Telegram update events.
 * Telegram may send duplicate updates due to retries, race conditions,
 * or network issues. This module tracks recently seen messages to
 * prevent duplicate processing.
 */

const DEDUPE_TTL_MS = 10 * 60_000 // 10 minutes
const MAX_CACHE_SIZE = 2000

export class MessageDeduplicator {
  private seenMessages = new Map<string, number>()

  /**
   * Check if message was already processed
   * @param updateId - Telegram update_id (unique per update)
   * @param messageId - Message ID within the chat
   * @param chatId - Chat ID where the message was sent
   * @returns true if duplicate (should skip), false if new
   */
  isDuplicate(updateId: number, messageId: number, chatId: number): boolean {
    // Primary key: update_id (unique per Telegram update)
    // Fallback key: chatId:messageId (for edge cases where update_id is reused)
    const primaryKey = `update:${updateId}`
    const fallbackKey = `msg:${chatId}:${messageId}`

    const now = Date.now()

    // Check if seen recently (either key matches = duplicate)
    if (this.checkAndMark(primaryKey, now) || this.checkAndMark(fallbackKey, now)) {
      return true
    }

    // Mark both keys with current timestamp
    this.seenMessages.set(primaryKey, now)
    this.seenMessages.set(fallbackKey, now)

    // Cleanup old entries to prevent unbounded growth
    this.pruneOldEntries(now)
    return false
  }

  /**
   * Check if a key exists and is still valid
   * @returns true if duplicate, false if new or expired
   */
  private checkAndMark(key: string, now: number): boolean {
    const timestamp = this.seenMessages.get(key)
    if (timestamp && now - timestamp < DEDUPE_TTL_MS) {
      return true // Duplicate
    }
    return false
  }

  /**
   * Remove old entries to prevent unbounded memory growth
   * Prunes both expired entries and oldest entries if cache exceeds max size
   */
  private pruneOldEntries(now: number): void {
    if (this.seenMessages.size <= MAX_CACHE_SIZE) {
      return
    }

    // First pass: remove expired entries
    for (const [key, ts] of this.seenMessages) {
      if (now - ts >= DEDUPE_TTL_MS) {
        this.seenMessages.delete(key)
      }
    }

    // Second pass: if still over limit, remove oldest entries
    if (this.seenMessages.size > MAX_CACHE_SIZE) {
      const entries = Array.from(this.seenMessages.entries())
        .sort((a, b) => a[1] - b[1]) // Sort by timestamp (oldest first)

      const toRemove = this.seenMessages.size - MAX_CACHE_SIZE
      for (let i = 0; i < toRemove && i < entries.length; i++) {
        const entry = entries[i]
        if (entry) {
          this.seenMessages.delete(entry[0])
        }
      }
    }
  }

  /**
   * Get current cache size (for monitoring/debugging)
   */
  getCacheSize(): number {
    return this.seenMessages.size
  }

  /**
   * Clear all cached entries (for testing)
   */
  clear(): void {
    this.seenMessages.clear()
  }
}
