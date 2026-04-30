/**
 * WorkspaceEventBus - Typed Event Bus for Automations System
 *
 * Per-workspace event bus that enables loose coupling between:
 * - Event producers (ConfigWatcher, SchedulerService)
 * - Event consumers (CommandHandler, PromptHandler, EventLogHandler)
 *
 * Benefits over the current callback-based approach:
 * - No global state - each workspace has its own bus instance
 * - Type-safe events with payload validation
 * - Easy to add/remove handlers dynamically
 * - Testable in isolation
 */

import { createLogger } from '../utils/debug.ts';
import type { AppEvent, AgentEvent, AutomationEvent } from './types.ts';

const log = createLogger('event-bus');

// ============================================================================
// Event Payload Types
// ============================================================================

/** Base event payload with common fields */
export interface BaseEventPayload {
  sessionId?: string;
  sessionName?: string;
  workspaceId: string;
  timestamp: number;
  labels?: string[];
}

/** Label events payload */
export interface LabelEventPayload extends BaseEventPayload {
  label: string;
}

/** Permission mode change payload */
export interface PermissionModeChangePayload extends BaseEventPayload {
  oldMode: string;
  newMode: string;
}

/** Flag change payload */
export interface FlagChangePayload extends BaseEventPayload {
  isFlagged: boolean;
}

/** Session status change payload */
export interface SessionStatusChangePayload extends BaseEventPayload {
  oldState: string;
  newState: string;
}

/** Scheduler tick payload */
export interface SchedulerTickPayload extends BaseEventPayload {
  localTime: string;
  utcTime: string;
}

/** Label config change payload */
export interface LabelConfigChangePayload extends BaseEventPayload {
  // No additional fields - just signals that config changed
}

/** Generic event payload for agent events */
export interface GenericEventPayload extends BaseEventPayload {
  data: Record<string, unknown>;
}

/**
 * FileWatch payload — fired when a watched file is added, modified, or removed.
 * Routing is per-matcher (each matcher has its own watchPath/watchGlob), so
 * the FileWatch service stamps the matcher ID into the payload and the event
 * bus's matcher-iteration uses it to dispatch only to the matcher that fired.
 */
export interface FileWatchPayload extends BaseEventPayload {
  /** ID of the FileWatch matcher that fired this event */
  matcherId: string;
  /** Absolute path to the changed file */
  path: string;
  /** Path relative to the watcher's watchPath (e.g. "notes/idea.md") */
  relativePath: string;
  /** Type of change */
  changeType: 'add' | 'change' | 'remove';
  /** File size in bytes (0 for `remove` events) */
  size: number;
  /** True when the path is a directory */
  isDirectory: boolean;
}

/**
 * PollUrl payload — fired when a polled HTTP endpoint's fingerprint changes.
 * Routing is per-matcher (each matcher has its own URL/interval), so the
 * Poll service stamps the matcher ID into the payload.
 */
export interface PollUrlPayload extends BaseEventPayload {
  /** ID of the PollUrl matcher that fired this event */
  matcherId: string;
  /** The URL that was polled (post env-var expansion) */
  url: string;
  /** HTTP status of the latest response */
  status: number;
  /** Type of fingerprint that detected the change */
  fingerprintKind: 'body' | 'etag' | 'last-modified' | 'status';
  /** New fingerprint value (truncated for body kind) */
  fingerprint: string;
  /** Previous fingerprint value, or null on first run */
  previousFingerprint: string | null;
  /** Response body (truncated to 4 KB) — null when fingerprint kind is not `body` */
  body: string | null;
  /** Selected response headers (lowercased keys) */
  headers: Record<string, string>;
}

/**
 * MessageReceive payload — fired when a chat message arrives on a configured
 * messaging adapter (WhatsApp, Telegram, etc.). Fires for every inbound
 * message, regardless of whether the channel is bound to a session.
 *
 * Use the `bound`/`wasBound` field in conditions to filter:
 *   { condition: 'state', field: 'bound', value: false }   // un-bound only
 *
 * `text` is also exposed as the matcher's match value, so a regex `matcher`
 * field can filter by message body directly.
 */
export interface MessageReceivePayload extends BaseEventPayload {
  /** Source platform — 'telegram' | 'whatsapp' | future adapters */
  platform: string;
  /** Adapter-specific channel/chat ID */
  channelId: string;
  /** Adapter-specific message ID (for dedup / reply targeting) */
  messageId: string;
  /** Sender ID (phone number, user ID, etc. — adapter specific) */
  senderId: string;
  /** Display name when the adapter provides one */
  senderName: string | null;
  /** Message text body */
  text: string;
  /** True when the message arrived on a channel already bound to a session */
  bound: boolean;
  /** Same semantics as bound; explicit name survives bind/unbind command side effects */
  wasBound: boolean;
  /** True when the channel is bound after command handling and routing complete */
  boundAfterRoute: boolean;
  /** Number of attachments in the message */
  attachmentCount: number;
  /** True when at least one attachment is present */
  hasAttachment: boolean;
  /** When the message was sent on the platform (epoch ms) */
  sentAt: number;
}

/**
 * Inbound webhook payload — fired when an external system POSTs to /v1/triggers/:workspaceId/:slug.
 * The body is parsed as JSON when Content-Type is application/json; otherwise the raw string is in bodyRaw.
 */
export interface WebhookReceivePayload extends BaseEventPayload {
  /** The matcher slug from the URL path */
  slug: string;
  /** HTTP method (uppercase) */
  method: string;
  /** HTTP headers (lowercased keys) */
  headers: Record<string, string>;
  /** URL query parameters */
  query: Record<string, string>;
  /** Parsed JSON body when Content-Type is application/json; otherwise null */
  body: unknown;
  /** Raw body as a string (truncated to bodyMaxBytes) */
  bodyRaw: string;
  /** Remote IP address as observed by the trigger server */
  remoteIp: string;
}

// ============================================================================
// Event Payload Map
// ============================================================================

/**
 * Maps event types to their payload types for type safety.
 */
export interface EventPayloadMap {
  // App events
  LabelAdd: LabelEventPayload;
  LabelRemove: LabelEventPayload;
  LabelConfigChange: LabelConfigChangePayload;
  PermissionModeChange: PermissionModeChangePayload;
  FlagChange: FlagChangePayload;
  SessionStatusChange: SessionStatusChangePayload;
  SchedulerTick: SchedulerTickPayload;
  WebhookReceive: WebhookReceivePayload;
  FileWatch: FileWatchPayload;
  PollUrl: PollUrlPayload;
  MessageReceive: MessageReceivePayload;

  // Agent events (generic payload)
  PreToolUse: GenericEventPayload;
  PostToolUse: GenericEventPayload;
  PostToolUseFailure: GenericEventPayload;
  Notification: GenericEventPayload;
  UserPromptSubmit: GenericEventPayload;
  SessionStart: GenericEventPayload;
  SessionEnd: GenericEventPayload;
  Stop: GenericEventPayload;
  SubagentStart: GenericEventPayload;
  SubagentStop: GenericEventPayload;
  PreCompact: GenericEventPayload;
  PermissionRequest: GenericEventPayload;
  Setup: GenericEventPayload;
}

// ============================================================================
// Handler Types
// ============================================================================

export type EventHandler<T extends AutomationEvent> = (
  payload: EventPayloadMap[T]
) => void | Promise<void>;

export type AnyEventHandler = (
  event: AutomationEvent,
  payload: BaseEventPayload
) => void | Promise<void>;

export type EventDeliveryResult =
  | { status: 'accepted'; handlerCount: number; anyHandlerCount: number }
  | { status: 'rate_limited'; limit: number; count: number; windowStart: number }
  | { status: 'disposed' };

// ============================================================================
// Rate Limiting
// ============================================================================

interface RateWindow {
  count: number;
  windowStart: number;
}

const DEFAULT_RATE_LIMIT = 10;
const SCHEDULER_RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000; // 1 minute

function getRateLimit(event: AutomationEvent): number {
  return event === 'SchedulerTick' ? SCHEDULER_RATE_LIMIT : DEFAULT_RATE_LIMIT;
}

// ============================================================================
// EventBus Interface
// ============================================================================

export interface EventBus {
  /** Emit an event to all registered handlers */
  emit<T extends AutomationEvent>(event: T, payload: EventPayloadMap[T]): Promise<void>;

  /** Emit an event and return whether the bus accepted or dropped it */
  emitWithResult<T extends AutomationEvent>(
    event: T,
    payload: EventPayloadMap[T]
  ): Promise<EventDeliveryResult>;

  /** Register a handler for a specific event type */
  on<T extends AutomationEvent>(event: T, handler: EventHandler<T>): void;

  /** Unregister a handler for a specific event type */
  off<T extends AutomationEvent>(event: T, handler: EventHandler<T>): void;

  /** Register a handler for all events (useful for logging) */
  onAny(handler: AnyEventHandler): void;

  /** Unregister an all-events handler */
  offAny(handler: AnyEventHandler): void;

  /** Clean up all handlers */
  dispose(): void;
}

// ============================================================================
// WorkspaceEventBus Implementation
// ============================================================================

export class WorkspaceEventBus implements EventBus {
  private readonly workspaceId: string;
  private readonly handlers: Map<AutomationEvent, Set<EventHandler<AutomationEvent>>> = new Map();
  private readonly anyHandlers: Set<AnyEventHandler> = new Set();
  private readonly rateCounts: Map<AutomationEvent, RateWindow> = new Map();
  private disposed = false;

  constructor(workspaceId: string) {
    this.workspaceId = workspaceId;
    log.debug(`[EventBus] Created for workspace: ${workspaceId}`);
  }

  /**
   * Emit an event to all registered handlers.
   * Handlers are called in parallel, errors are caught and logged.
   */
  async emit<T extends AutomationEvent>(event: T, payload: EventPayloadMap[T]): Promise<void> {
    await this.emitWithResult(event, payload);
  }

  /**
   * Emit an event to all registered handlers and return a minimal delivery result.
   * Handlers are still called in parallel, errors are caught and logged.
   */
  async emitWithResult<T extends AutomationEvent>(
    event: T,
    payload: EventPayloadMap[T]
  ): Promise<EventDeliveryResult> {
    if (this.disposed) {
      log.warn(`[EventBus] Attempted to emit after disposal: ${event}`);
      return { status: 'disposed' };
    }

    // Rate limiting: prevent runaway event loops (sync and async)
    const now = Date.now();
    const rateWindow = this.rateCounts.get(event) ?? { count: 0, windowStart: now };
    if (now - rateWindow.windowStart >= RATE_WINDOW_MS) {
      rateWindow.count = 0;
      rateWindow.windowStart = now;
    }
    const limit = getRateLimit(event);
    if (rateWindow.count >= limit) {
      log.warn(
        `[EventBus] Rate limit: ${event} fired ${rateWindow.count} times in ${Math.round((now - rateWindow.windowStart) / 1000)}s (limit: ${limit}/min), dropping`
      );
      return {
        status: 'rate_limited',
        limit,
        count: rateWindow.count,
        windowStart: rateWindow.windowStart,
      };
    }
    rateWindow.count++;
    this.rateCounts.set(event, rateWindow);

    log.debug(`[EventBus] Emitting: ${event}`);

    // Collect all handlers to call
    const eventHandlers = this.handlers.get(event) ?? new Set();
    const anyHandlersCopy = new Set(this.anyHandlers);

    // Execute event-specific handlers
    const eventPromises = Array.from(eventHandlers).map(async (handler) => {
      try {
        await handler(payload);
      } catch (error) {
        log.error(`[EventBus] Handler error for ${event}:`, error);
      }
    });

    // Execute any-event handlers
    const anyPromises = Array.from(anyHandlersCopy).map(async (handler) => {
      try {
        await handler(event, payload as BaseEventPayload);
      } catch (error) {
        log.error(`[EventBus] Any-handler error for ${event}:`, error);
      }
    });

    // Wait for all handlers to complete
    await Promise.all([...eventPromises, ...anyPromises]);

    log.debug(`[EventBus] Emitted: ${event} (${eventHandlers.size} handlers, ${anyHandlersCopy.size} any-handlers)`);

    return {
      status: 'accepted',
      handlerCount: eventHandlers.size,
      anyHandlerCount: anyHandlersCopy.size,
    };
  }

  /**
   * Register a handler for a specific event type.
   */
  on<T extends AutomationEvent>(event: T, handler: EventHandler<T>): void {
    if (this.disposed) {
      log.warn(`[EventBus] Attempted to register handler after disposal: ${event}`);
      return;
    }

    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler as EventHandler<AutomationEvent>);
    log.debug(`[EventBus] Registered handler for: ${event}`);
  }

  /**
   * Unregister a handler for a specific event type.
   */
  off<T extends AutomationEvent>(event: T, handler: EventHandler<T>): void {
    const eventHandlers = this.handlers.get(event);
    if (eventHandlers) {
      eventHandlers.delete(handler as EventHandler<AutomationEvent>);
      log.debug(`[EventBus] Unregistered handler for: ${event}`);
    }
  }

  /**
   * Register a handler for all events.
   * Useful for logging, metrics, or debugging.
   */
  onAny(handler: AnyEventHandler): void {
    if (this.disposed) {
      log.warn(`[EventBus] Attempted to register any-handler after disposal`);
      return;
    }

    this.anyHandlers.add(handler);
    log.debug(`[EventBus] Registered any-handler`);
  }

  /**
   * Unregister an all-events handler.
   */
  offAny(handler: AnyEventHandler): void {
    this.anyHandlers.delete(handler);
    log.debug(`[EventBus] Unregistered any-handler`);
  }

  /**
   * Clean up all handlers and mark as disposed.
   */
  dispose(): void {
    if (this.disposed) return;

    log.debug(`[EventBus] Disposing for workspace: ${this.workspaceId}`);
    this.handlers.clear();
    this.anyHandlers.clear();
    this.rateCounts.clear();
    this.disposed = true;
  }

  /**
   * Check if the bus has been disposed.
   */
  isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * Get the workspace ID this bus belongs to.
   */
  getWorkspaceId(): string {
    return this.workspaceId;
  }

  /**
   * Get handler count for debugging.
   */
  getHandlerCount(event?: AutomationEvent): number {
    if (event) {
      return this.handlers.get(event)?.size ?? 0;
    }
    let total = this.anyHandlers.size;
    for (const handlers of this.handlers.values()) {
      total += handlers.size;
    }
    return total;
  }
}
