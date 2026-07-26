/**
 * LlmInferenceStore — rolling window of inference results per connection slug.
 *
 * Records actual LLM turn completions and tool-call outcomes (success or
 * failure) as they happen in the agent backends. The ProvidersPanel fetches
 * this data via IPC and renders it as a sparkline, replacing the previous
 * health-check-ping data with real inference history.
 *
 * Each entry records a single inference event:
 * - `turn`: a full model turn completed (or failed)
 * - `tool_call`: a tool execution succeeded or errored
 *
 * The store keeps a rolling window of the last MAX_ENTRIES per slug and
 * prunes entries older than RETENTION_MS.
 */

// ============================================================
// Types
// ============================================================

export type InferenceEventType = 'turn' | 'tool_call'

/**
 * A single recorded inference event.
 */
export interface InferenceEvent {
  /** Connection slug this event belongs to. */
  slug: string
  /** Whether the inference or tool call completed successfully. */
  success: boolean
  /** The type of event — turn completion or tool call. */
  type: InferenceEventType
  /** When the event occurred. */
  timestamp: number
  /** Human-readable description (tool name, model, or error message). */
  label?: string
  /** Token count for turn completions (input + output). */
  totalTokens?: number
  /** Response time in milliseconds for the inference request. */
  latencyMs?: number
}

/**
 * Aggregated inference stats for a single connection slug, returned by the
 * getInferenceHistory IPC handler. Used by the ProvidersPanel sparkline.
 */
export interface InferenceHistoryResult {
  /** Connection slug. */
  slug: string
  /** Recent inference events in reverse chronological order (newest first). */
  events: InferenceEvent[]
  /** Aggregated reliability over the window: ratio of successful events. */
  reliability: number
  /** Total events recorded in the window. */
  totalEvents: number
  /** Successful events. */
  successCount: number
  /** Failed events. */
  failureCount: number
}

// ============================================================
// Configuration
// ============================================================

/** Maximum events stored per slug. */
const MAX_ENTRIES_PER_SLUG = 200

/** Retention window — events older than this are pruned. 1 hour. */
const RETENTION_MS = 60 * 60 * 1000

// ============================================================
// Store
// ============================================================

class LlmInferenceStore {
  /** Map of slug → rolling array of events (newest first). */
  private eventsBySlug = new Map<string, InferenceEvent[]>()

  /**
   * Optional callback fired on every `push()` call.
   * The server-core handler sets this to `server.push(UPDATED, ...)` so that
   * connected renderers learn about new inference events immediately instead
   * of polling every 5 seconds.
   */
  onEvent?: (slug: string, event: Omit<InferenceEvent, 'slug' | 'timestamp'>) => void

  /**
   * Record a single inference event.
   * Called by the agent backends on turn completion or tool-call result.
   */
  push(slug: string, event: Omit<InferenceEvent, 'slug' | 'timestamp'>): void {
    const entry: InferenceEvent = {
      slug,
      timestamp: Date.now(),
      ...event,
    }

    let events = this.eventsBySlug.get(slug)
    if (!events) {
      events = []
      this.eventsBySlug.set(slug, events)
    }

    events.unshift(entry)

    // Prune to max size
    if (events.length > MAX_ENTRIES_PER_SLUG) {
      events.length = MAX_ENTRIES_PER_SLUG
    }

    // Notify listeners about the new event (fire-and-forget — safe to call
    // even if no handler is registered).
    this.onEvent?.(slug, event)
  }

  /**
   * Get history for a single slug, with automatic pruning of stale entries.
   * Returns events in reverse chronological order (newest first).
   */
  getHistory(slug: string, limit?: number): InferenceEvent[] {
    this.prune()
    const events = this.eventsBySlug.get(slug) ?? []
    return limit ? events.slice(0, limit) : events
  }

  /**
   * Get the full inference history result for a slug, including aggregate stats.
   * Used by the IPC handler to return data to the renderer.
   */
  getHistoryResult(slug: string, limit = 60): InferenceHistoryResult {
    const events = this.getHistory(slug, limit)
    const successCount = events.filter(e => e.success).length
    const totalEvents = events.length

    return {
      slug,
      events,
      reliability: totalEvents > 0 ? successCount / totalEvents : 1,
      totalEvents,
      successCount,
      failureCount: totalEvents - successCount,
    }
  }

  /**
   * Get history for all known slugs (for batch fetch).
   */
  getAllHistory(limit = 60): Record<string, InferenceHistoryResult> {
    this.prune()
    const result: Record<string, InferenceHistoryResult> = {}
    for (const slug of this.eventsBySlug.keys()) {
      result[slug] = this.getHistoryResult(slug, limit)
    }
    return result
  }

  /**
   * Clear all events for a specific slug (e.g., when a connection is deleted).
   */
  clearSlug(slug: string): void {
    this.eventsBySlug.delete(slug)
  }

  /**
   * Clear all events (e.g., on app reset).
   */
  clearAll(): void {
    this.eventsBySlug.clear()
  }

  /**
   * Prune entries older than RETENTION_MS across all slugs.
   * Called on every read to keep the store bounded without a timer.
   */
  private prune(): void {
    const cutoff = Date.now() - RETENTION_MS
    for (const [slug, events] of this.eventsBySlug) {
      const filtered = events.filter(e => e.timestamp >= cutoff)
      if (filtered.length === 0) {
        this.eventsBySlug.delete(slug)
      } else if (filtered.length < events.length) {
        this.eventsBySlug.set(slug, filtered)
      }
    }
  }
}

/**
 * Singleton inference store. Import this wherever you need to record or query
 * inference events — the same instance is shared across all agent backends and
 * IPC handlers.
 */
export const inferenceStore = new LlmInferenceStore()
