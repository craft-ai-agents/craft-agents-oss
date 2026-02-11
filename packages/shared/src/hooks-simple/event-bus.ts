/**
 * Event Bus
 *
 * Per-workspace event routing with rate limiting.
 * Events are dispatched to registered handlers based on event type.
 */

import { debug } from '../utils/debug.ts';
import type {
  HookEventType,
  BaseEventPayload,
  EventPayloadMap,
  RateLimitConfig,
  HookHandler,
} from './types.ts';
import { DEFAULT_RATE_LIMITS, GLOBAL_RATE_LIMIT } from './types.ts';

// ============================================================
// Rate Limiter
// ============================================================

class RateLimiter {
  private windows: Map<string, number[]> = new Map();

  /**
   * Check if an event should be allowed through.
   * Uses a sliding window approach.
   */
  check(key: string, config: RateLimitConfig): boolean {
    const now = Date.now();
    const windowStart = now - config.windowMs;

    let timestamps = this.windows.get(key);
    if (!timestamps) {
      timestamps = [];
      this.windows.set(key, timestamps);
    }

    // Remove expired entries
    const filtered = timestamps.filter(t => t > windowStart);
    this.windows.set(key, filtered);

    if (filtered.length >= config.maxEvents) {
      return false;
    }

    filtered.push(now);
    return true;
  }

  /** Clear all rate limit state */
  clear(): void {
    this.windows.clear();
  }
}

// ============================================================
// Event Listener
// ============================================================

export type EventListener<T extends HookEventType = HookEventType> = (
  event: T,
  payload: EventPayloadMap[T],
) => void | Promise<void>;

// ============================================================
// Event Bus
// ============================================================

export class EventBus {
  private workspaceId: string;
  private listeners: Map<HookEventType, Set<EventListener>> = new Map();
  private rateLimiter = new RateLimiter();
  private disposed = false;

  constructor(workspaceId: string) {
    this.workspaceId = workspaceId;
  }

  /**
   * Register a listener for a specific event type.
   * Returns an unsubscribe function.
   */
  on<T extends HookEventType>(
    event: T,
    listener: EventListener<T>,
  ): () => void {
    let listeners = this.listeners.get(event);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(event, listeners);
    }
    listeners.add(listener as EventListener);

    return () => {
      listeners!.delete(listener as EventListener);
      if (listeners!.size === 0) {
        this.listeners.delete(event);
      }
    };
  }

  /**
   * Emit an event to all registered listeners.
   * Applies rate limiting before dispatching.
   */
  async emit<T extends HookEventType>(
    event: T,
    payload: Omit<EventPayloadMap[T], 'workspaceId' | 'timestamp'>,
  ): Promise<void> {
    if (this.disposed) {
      debug(`[EventBus] Ignoring emit after dispose: ${event}`);
      return;
    }

    // Apply rate limiting
    const rateLimitConfig = DEFAULT_RATE_LIMITS[event] ?? GLOBAL_RATE_LIMIT;
    const rateLimitKey = `${this.workspaceId}:${event}`;
    if (!this.rateLimiter.check(rateLimitKey, rateLimitConfig)) {
      debug(`[EventBus] Rate limited: ${event} for workspace ${this.workspaceId}`);
      return;
    }

    // Build full payload with workspaceId and timestamp
    const fullPayload = {
      ...payload,
      workspaceId: this.workspaceId,
      timestamp: Date.now(),
    } as EventPayloadMap[T];

    const listeners = this.listeners.get(event);
    if (!listeners || listeners.size === 0) {
      return;
    }

    debug(`[EventBus] Emitting ${event} to ${listeners.size} listener(s) [workspace=${this.workspaceId}]`);

    // Fire all listeners concurrently, don't let one failure block others
    const promises: Promise<void>[] = [];
    for (const listener of listeners) {
      try {
        const result = listener(event, fullPayload);
        if (result instanceof Promise) {
          promises.push(
            result.catch(err => {
              debug(`[EventBus] Listener error for ${event}: ${err instanceof Error ? err.message : err}`);
            })
          );
        }
      } catch (err) {
        debug(`[EventBus] Sync listener error for ${event}: ${err instanceof Error ? err.message : err}`);
      }
    }

    if (promises.length > 0) {
      await Promise.allSettled(promises);
    }
  }

  /**
   * Remove all listeners for a specific event type.
   */
  off(event: HookEventType): void {
    this.listeners.delete(event);
  }

  /**
   * Remove all listeners.
   */
  removeAllListeners(): void {
    this.listeners.clear();
  }

  /**
   * Get the number of listeners for an event type.
   */
  listenerCount(event: HookEventType): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  /**
   * Dispose the event bus. No more events will be emitted.
   */
  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
    this.rateLimiter.clear();
  }
}
