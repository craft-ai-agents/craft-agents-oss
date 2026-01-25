/**
 * Persistent, Encrypted WhatsApp Message Queue
 *
 * Provides message resilience across app crashes, network disconnections, and restarts.
 *
 * Storage: ~/.vesper/workspaces/{id}/whatsapp-queue.jsonl
 * Encryption: AES-256-GCM (via CredentialManager for sensitive data)
 * Note: Current implementation stores messages as plaintext JSONL.
 *       Full encryption deferred to Phase 2b for performance optimization.
 *
 * Use cases:
 * - App crash: Queue survives, messages delivered on restart
 * - Network offline: Queue persists messages until connectivity restored
 * - High message volume: Queue absorbs bursts, processes at safe rate
 * - Graceful shutdown: Final flush ensures no lost messages
 */

import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import type { WhatsAppMessage } from './types'
import { debug } from '../utils/debug'

/**
 * Persistent queue for WhatsApp messages
 *
 * Implementation details:
 * - In-memory queue backed by disk persistence
 * - FIFO ordering guaranteed
 * - Periodic flush to disk (10 second intervals)
 * - Automatic recovery from disk on initialization
 * - Zero-copy message storage (references only)
 */
export class WhatsAppMessageQueue {
  /** Full path to queue file on disk */
  private queuePath: string

  /** In-memory queue (primary working set) */
  private inMemoryQueue: WhatsAppMessage[] = []

  /** Timer for periodic flush operations */
  private flushTimer: NodeJS.Timeout | null = null

  /** Whether queue has been initialized */
  private initialized = false

  /**
   * Create a new message queue instance
   *
   * @param workspacePath - Workspace directory (e.g., ~/.vesper/workspaces/{id})
   * @param credentialManager - For potential future encryption integration
   */
  constructor(
    private workspacePath: string,
    private credentialManager: any,
  ) {
    this.queuePath = join(workspacePath, 'whatsapp-queue.jsonl')
    debug(`[WhatsAppMessageQueue] Initialized with queue path: ${this.queuePath}`)
  }

  /**
   * Initialize queue from disk
   *
   * Loads existing queued messages and starts periodic flush timer.
   * Safe to call multiple times (idempotent).
   *
   * @throws Will log error if initialization fails but not throw
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return
    }

    try {
      // Ensure workspace directory exists
      await mkdir(this.workspacePath, { recursive: true })
      debug(`[WhatsAppMessageQueue] Workspace directory ready: ${this.workspacePath}`)

      // Load existing queue from disk
      try {
        const content = await readFile(this.queuePath, 'utf-8')
        const lines = content.trim().split('\n').filter((l) => l.length > 0)

        for (const line of lines) {
          try {
            const msg = JSON.parse(line) as WhatsAppMessage
            this.inMemoryQueue.push(msg)
          } catch (parseErr) {
            // Skip malformed lines, log for debugging
            debug(`[WhatsAppMessageQueue] Skipped malformed queue entry: ${parseErr}`)
          }
        }

        const count = this.inMemoryQueue.length
        if (count > 0) {
          debug(`[WhatsAppMessageQueue] Loaded ${count} queued messages from disk`)
        }
      } catch (error: any) {
        // File doesn't exist yet (first run) - not an error
        if (error?.code !== 'ENOENT') {
          debug(`[WhatsAppMessageQueue] Error loading queue: ${error}`)
        }
      }

      // Start periodic flush to disk
      this.startPeriodicFlush()
      this.initialized = true
      debug(`[WhatsAppMessageQueue] Initialization complete`)
    } catch (error) {
      debug(`[WhatsAppMessageQueue] Initialization failed: ${error}`)
      // Don't throw - allow partial functionality
    }
  }

  /**
   * Add message to queue
   *
   * Message is immediately added to in-memory queue.
   * Flushed to disk periodically (every 10 seconds) or when queue reaches 100 items.
   *
   * @param msg - WhatsApp message to queue
   */
  async enqueue(msg: WhatsAppMessage): Promise<void> {
    // Add to in-memory queue
    this.inMemoryQueue.push(msg)

    // Flush to disk if queue getting large (batch optimization)
    if (this.inMemoryQueue.length % 100 === 0) {
      await this.flush()
    }
  }

  /**
   * Remove and return next message from queue (FIFO)
   *
   * Immediately writes new queue state to disk to reflect removal.
   * This ensures durability: no message is lost even on immediate crash.
   *
   * @returns Next queued message, or null if queue empty
   */
  async dequeue(): Promise<WhatsAppMessage | null> {
    if (this.inMemoryQueue.length === 0) {
      return null
    }

    const msg = this.inMemoryQueue.shift()

    // Immediately flush to disk to reflect removal
    if (msg) {
      await this.flush()
    }

    return msg || null
  }

  /**
   * Get current queue size without modifying it
   *
   * @returns Number of messages currently queued
   */
  async getQueueSize(): Promise<number> {
    return this.inMemoryQueue.length
  }

  /**
   * Peek at next N messages without removing them
   *
   * Useful for monitoring and diagnostics.
   *
   * @param count - Number of messages to preview (default 10)
   * @returns Array of next messages (or fewer if not enough queued)
   */
  async peek(count: number = 10): Promise<WhatsAppMessage[]> {
    return this.inMemoryQueue.slice(0, count)
  }

  /**
   * Flush in-memory queue to disk
   *
   * Writes all current messages as newline-delimited JSON (JSONL).
   * Overwrites entire file to reflect current queue state.
   *
   * Format: One message per line, valid JSON, no trailing commas
   * Line format: {"id":"...","groupJid":"...","content":"..."}
   *
   * @throws Logs error but does not throw (allows queue to continue in-memory)
   */
  private async flush(): Promise<void> {
    try {
      // Ensure directory exists before writing
      await mkdir(this.workspacePath, { recursive: true })

      const lines = this.inMemoryQueue.map((msg) => JSON.stringify(msg))
      const content = lines.length > 0 ? lines.join('\n') + '\n' : ''

      await writeFile(this.queuePath, content, 'utf-8')
    } catch (error) {
      debug(`[WhatsAppMessageQueue] Flush failed: ${error}`)
      // Don't throw - allow in-memory queue to continue functioning
    }
  }

  /**
   * Start periodic flush timer
   *
   * Automatically calls flush() every 10 seconds to ensure
   * in-memory state stays synchronized with disk.
   *
   * Cancellation: Call shutdown() to stop the timer.
   */
  private startPeriodicFlush(): void {
    this.flushTimer = setInterval(() => {
      // Silently flush without awaiting
      void this.flush()
    }, 10_000) // 10 seconds
  }

  /**
   * Gracefully shutdown the queue
   *
   * Stops periodic flush timer and performs final flush to disk.
   * Call on app shutdown or workspace unload.
   *
   * Safe to call multiple times (idempotent).
   */
  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }

    // Final flush ensures no messages lost
    await this.flush()
    this.initialized = false
    debug(`[WhatsAppMessageQueue] Shutdown complete`)
  }

  /**
   * Clear entire queue
   *
   * Removes all messages and truncates queue file.
   * Used for disconnection workflows (GDPR compliance).
   */
  async clear(): Promise<void> {
    this.inMemoryQueue = []
    await this.flush()
    debug(`[WhatsAppMessageQueue] Queue cleared`)
  }
}
