/**
 * Slack Service
 *
 * Main process service for Slack integration using @slack/bolt.
 * Manages Slack App connections, event handling, and message routing.
 */

import { App, LogLevel } from '@slack/bolt';
import { WebClient } from '@slack/web-api';
import { BrowserWindow } from 'electron';
import type {
  SlackAccountConfig,
  SlackServiceState,
  SlackInboundMessage,
  SlackConnectionStatus,
  SlackError,
  SlackErrorCode,
  SlackOutboundMessage,
  SlackThreadContext,
} from '@vesper/shared/slack';
import {
  routeSlackMessage,
  createMessageRouter,
  type MessageRouterConfig,
} from '@vesper/shared/slack/message-router';
import { formatSlackResult, chunkSlackMessage } from '@vesper/shared/slack/message-formatter';
import { setPermissionMode } from '@vesper/shared/agent';
import type { SessionManager } from './sessions';
import type { Message } from '../shared/types';

// Types
interface SlackServiceOptions {
  workspaceId: string;
  accountId: string;
  botToken: string;
  appToken?: string;
  config: SlackAccountConfig;
  onMessage?: (message: SlackInboundMessage) => Promise<void>;
  onError?: (error: SlackError) => void;
  onStatusChange?: (status: SlackConnectionStatus) => void;
}

// Retry configuration
const RETRY_CONFIG = {
  retries: 2,
  factor: 2,
  minTimeout: 500,
  maxTimeout: 3000,
  randomize: true,
};

// Message deduplication
const DEDUPE_TTL_MS = 10 * 60_000; // 10 minutes
const MAX_DEDUPE_CACHE = 2000;

// Inbound debounce
const DEBOUNCE_MS = 1500;

/**
 * Slack Service class
 */
export class SlackService {
  private app: App | null = null;
  private client: WebClient | null = null;
  private state: SlackServiceState;
  private options: SlackServiceOptions;
  private seenMessages = new Map<string, number>();
  private debounceQueues = new Map<string, { messages: SlackInboundMessage[]; timer: NodeJS.Timeout }>();
  private isShuttingDown = false;

  constructor(options: SlackServiceOptions) {
    this.options = options;
    this.state = {
      accountId: options.accountId,
      status: 'disconnected',
    };
  }

  /**
   * Start the Slack service
   */
  async start(): Promise<void> {
    if (this.app) {
      console.warn('[SlackService] Already started');
      return;
    }

    this.updateStatus('connecting');

    try {
      // Initialize Bolt App
      this.app = new App({
        token: this.options.botToken,
        appToken: this.options.appToken,
        socketMode: Boolean(this.options.appToken),
        logLevel: LogLevel.WARN,
        clientOptions: {
          retryConfig: RETRY_CONFIG,
        },
      });

      this.client = this.app.client;

      // Register event handlers
      this.registerEventHandlers();

      // Get bot info
      const authResult = await this.client.auth.test();
      this.state.teamId = authResult.team_id ?? undefined;
      this.state.teamName = authResult.team ?? undefined;
      this.state.botUserId = authResult.user_id ?? undefined;

      // Start the app
      await this.app.start();

      this.state.connectedAt = Date.now();
      this.updateStatus('connected');

      console.log(`[SlackService] Connected to ${this.state.teamName} (${this.state.teamId})`);
    } catch (error) {
      console.error('[SlackService] Failed to start:', error);
      this.handleError(error);
      this.updateStatus('error');
      throw error;
    }
  }

  /**
   * Stop the Slack service
   */
  async stop(): Promise<void> {
    if (!this.app) return;

    this.isShuttingDown = true;
    console.log('[SlackService] Stopping...');

    try {
      // Clear debounce timers
      for (const queue of this.debounceQueues.values()) {
        clearTimeout(queue.timer);
      }
      this.debounceQueues.clear();

      // Stop the app
      await this.app.stop();
    } catch (error) {
      console.error('[SlackService] Error stopping:', error);
    } finally {
      this.app = null;
      this.client = null;
      this.isShuttingDown = false;
      this.updateStatus('disconnected');
    }
  }

  /**
   * Get current service state
   */
  getState(): SlackServiceState {
    return { ...this.state };
  }

  /**
   * Send a message to Slack
   */
  async sendMessage(message: SlackOutboundMessage): Promise<{ ts?: string; error?: SlackError }> {
    if (!this.client) {
      return {
        error: {
          code: 'NETWORK_ERROR' as SlackErrorCode,
          message: 'Slack service not connected',
          recoverable: true,
        },
      };
    }

    try {
      // Chunk message if needed
      const chunks = chunkSlackMessage(message.text);

      let firstTs: string | undefined;
      let threadTs = message.threadTs;

      for (const chunk of chunks) {
        const result = await this.client.chat.postMessage({
          channel: message.channel,
          text: chunk,
          thread_ts: threadTs,
          unfurl_links: message.unfurlLinks ?? false,
          unfurl_media: message.unfurlMedia ?? true,
        });

        if (!firstTs) {
          firstTs = result.ts;
          // If no thread specified, subsequent chunks reply to first
          if (!threadTs && chunks.length > 1) {
            threadTs = result.ts;
          }
        }
      }

      return { ts: firstTs };
    } catch (error) {
      const slackError = this.normalizeError(error);
      return { error: slackError };
    }
  }

  /**
   * Send a formatted result to Slack
   */
  async sendFormattedResult(
    channel: string,
    text: string,
    threadTs?: string
  ): Promise<{ ts?: string; error?: SlackError }> {
    const chunks = formatSlackResult(text);

    let firstTs: string | undefined;
    let currentThreadTs = threadTs;

    for (const chunk of chunks) {
      const result = await this.sendMessage({
        channel,
        text: chunk,
        threadTs: currentThreadTs,
      });

      if (result.error) return result;

      if (!firstTs) {
        firstTs = result.ts;
        if (!currentThreadTs) {
          currentThreadTs = result.ts;
        }
      }
    }

    return { ts: firstTs };
  }

  // --- Private Methods ---

  private registerEventHandlers(): void {
    if (!this.app) return;

    // Message events
    this.app.event('message', async ({ event, context }) => {
      if (this.isShuttingDown) return;
      await this.handleMessageEvent(event as any, context);
    });

    // App mention events (always process)
    this.app.event('app_mention', async ({ event, context }) => {
      if (this.isShuttingDown) return;
      await this.handleMessageEvent(event as any, context, true);
    });

    // Connection events
    this.app.event('app_home_opened', async () => {
      // Could update app home here
    });
  }

  private async handleMessageEvent(
    event: any,
    context: any,
    wasMentioned = false
  ): Promise<void> {
    try {
      // Filter unwanted subtypes
      const allowedSubtypes = [undefined, 'file_share', 'bot_message'];
      if (event.subtype && !allowedSubtypes.includes(event.subtype)) {
        return;
      }

      // Skip bot messages
      if (event.bot_id) return;

      // Skip messages from ourselves
      if (event.user === this.state.botUserId) return;

      // Deduplication check
      const dedupeKey = `${event.channel}:${event.ts}`;
      if (this.isDuplicate(dedupeKey)) return;

      // Build inbound message
      const message: SlackInboundMessage = {
        ts: event.ts,
        text: event.text ?? '',
        channel: event.channel,
        user: event.user,
        botId: event.bot_id,
        threadTs: event.thread_ts,
        parentUserId: event.parent_user_id,
        files: event.files,
        subtype: event.subtype,
        accountId: this.options.accountId,
        teamId: this.state.teamId ?? '',
        wasMentioned: wasMentioned || this.checkMention(event.text),
        isThreadReply: this.isThreadReply(event),
      };

      // Resolve thread context if missing
      if (!message.threadTs && message.parentUserId) {
        message.threadTs = await this.resolveThreadTs(event.channel, event.ts);
      }

      // Add to debounce queue or process immediately
      await this.enqueueMessage(message);
    } catch (error) {
      console.error('[SlackService] Error handling message:', error);
      this.handleError(error);
    }
  }

  private async enqueueMessage(message: SlackInboundMessage): Promise<void> {
    // Don't debounce media or control commands
    const shouldDebounce = !message.files?.length && !this.isControlCommand(message.text);

    if (!shouldDebounce) {
      await this.processMessages([message]);
      return;
    }

    const key = `${message.accountId}:${message.channel}:${message.threadTs ?? 'main'}:${message.user}`;
    const existing = this.debounceQueues.get(key);

    if (existing) {
      clearTimeout(existing.timer);
      existing.messages.push(message);
    } else {
      this.debounceQueues.set(key, { messages: [message], timer: null as any });
    }

    const queue = this.debounceQueues.get(key)!;
    queue.timer = setTimeout(async () => {
      this.debounceQueues.delete(key);
      await this.processMessages(queue.messages);
    }, DEBOUNCE_MS);
  }

  private async processMessages(messages: SlackInboundMessage[]): Promise<void> {
    if (!messages.length) return;

    // Combine debounced messages
    const lastMessage = messages[messages.length - 1];
    const combinedText = messages.map(m => m.text).join('\n');
    const syntheticMessage: SlackInboundMessage = {
      ...lastMessage,
      text: combinedText,
    };

    // Route the message
    const routerConfig: MessageRouterConfig = {
      accountConfig: this.options.config,
      botUserId: this.state.botUserId,
    };

    const routeResult = routeSlackMessage(syntheticMessage, routerConfig);

    if (!routeResult.shouldProcess) {
      console.log(`[SlackService] Skipped message: ${routeResult.reason}`);
      return;
    }

    // Update message with cleaned text
    syntheticMessage.text = routeResult.cleanedText ?? syntheticMessage.text;

    // Emit to handler
    if (this.options.onMessage) {
      try {
        await this.options.onMessage(syntheticMessage);
      } catch (error) {
        console.error('[SlackService] Message handler error:', error);
      }
    }

    // Emit IPC event
    this.emitEvent('slack:message-received', {
      message: syntheticMessage,
      sessionKey: routeResult.sessionKey,
      permissionMode: routeResult.permissionMode,
    });
  }

  private isDuplicate(key: string): boolean {
    const now = Date.now();
    const timestamp = this.seenMessages.get(key);

    if (timestamp && now - timestamp < DEDUPE_TTL_MS) {
      return true;
    }

    this.seenMessages.set(key, now);

    // Prune old entries
    if (this.seenMessages.size > MAX_DEDUPE_CACHE) {
      for (const [k, ts] of this.seenMessages) {
        if (now - ts >= DEDUPE_TTL_MS) {
          this.seenMessages.delete(k);
        }
      }
    }

    return false;
  }

  private checkMention(text: string | undefined): boolean {
    if (!text || !this.state.botUserId) return false;
    return text.includes(`<@${this.state.botUserId}>`);
  }

  private isThreadReply(event: any): boolean {
    const threadTs = event.thread_ts;
    const messageTs = event.ts;
    const hasThreadTs = typeof threadTs === 'string' && threadTs.length > 0;
    return hasThreadTs && (threadTs !== messageTs || Boolean(event.parent_user_id));
  }

  private isControlCommand(text: string): boolean {
    return /^[!/]\s*(stop|cancel|abort)\b/i.test(text);
  }

  private async resolveThreadTs(channel: string, ts: string): Promise<string | undefined> {
    if (!this.client) return undefined;

    try {
      const result = await this.client.conversations.replies({
        channel,
        ts,
        limit: 1,
      });

      return result.messages?.[0]?.thread_ts;
    } catch {
      return undefined;
    }
  }

  private updateStatus(status: SlackConnectionStatus): void {
    this.state.status = status;
    this.options.onStatusChange?.(status);
    this.emitEvent('slack:status-changed', {
      accountId: this.options.accountId,
      status,
      state: this.getState(),
    });
  }

  private handleError(error: unknown): void {
    const slackError = this.normalizeError(error);
    this.state.error = slackError;
    this.options.onError?.(slackError);
    this.emitEvent('slack:error', {
      accountId: this.options.accountId,
      error: slackError,
    });
  }

  private normalizeError(error: unknown): SlackError {
    if (error && typeof error === 'object') {
      const e = error as any;

      // Slack API errors
      if (e.code) {
        const codeMap: Record<string, SlackErrorCode> = {
          'slack_webapi_platform_error': 'PERMISSION_DENIED' as SlackErrorCode,
          'slack_webapi_rate_limited_error': 'RATE_LIMITED' as SlackErrorCode,
          'channel_not_found': 'CHANNEL_NOT_FOUND' as SlackErrorCode,
          'user_not_found': 'USER_NOT_FOUND' as SlackErrorCode,
          'not_authed': 'AUTH_FAILED' as SlackErrorCode,
          'invalid_auth': 'AUTH_FAILED' as SlackErrorCode,
          'token_expired': 'TOKEN_EXPIRED' as SlackErrorCode,
        };

        return {
          code: codeMap[e.code] ?? ('UNKNOWN' as SlackErrorCode),
          message: e.message ?? String(e.code),
          recoverable: e.code === 'slack_webapi_rate_limited_error',
          retryAfter: e.retryAfter,
        };
      }

      if (e.message) {
        return {
          code: 'UNKNOWN' as SlackErrorCode,
          message: e.message,
          recoverable: false,
        };
      }
    }

    return {
      code: 'UNKNOWN' as SlackErrorCode,
      message: String(error),
      recoverable: false,
    };
  }

  private emitEvent(channel: string, data: any): void {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      win.webContents.send(channel, data);
    }
  }
}

// Service registry
const services = new Map<string, SlackService>();

/**
 * Get or create a Slack service for a workspace/account
 */
export async function getSlackService(
  workspaceId: string,
  accountId: string = 'default'
): Promise<SlackService | null> {
  const key = `${workspaceId}:${accountId}`;
  return services.get(key) ?? null;
}

/**
 * Create and start a Slack service
 */
export async function createSlackService(
  options: SlackServiceOptions
): Promise<SlackService> {
  const key = `${options.workspaceId}:${options.accountId}`;

  // Stop existing service if any
  const existing = services.get(key);
  if (existing) {
    await existing.stop();
  }

  const service = new SlackService(options);
  services.set(key, service);

  return service;
}

/**
 * Stop a Slack service
 */
export async function stopSlackService(
  workspaceId: string,
  accountId: string = 'default'
): Promise<void> {
  const key = `${workspaceId}:${accountId}`;
  const service = services.get(key);

  if (service) {
    await service.stop();
    services.delete(key);
  }
}

/**
 * Stop all Slack services
 */
export async function stopAllSlackServices(): Promise<void> {
  const promises = Array.from(services.values()).map(s => s.stop());
  await Promise.all(promises);
  services.clear();
}

/**
 * Session ID mapping for Slack integration
 * Maps session keys to Vesper session IDs to maintain conversation continuity
 */
const slackSessionMapping = new Map<string, string>();

/**
 * Process a Slack message through a Vesper session
 *
 * This integrates Slack messages with the Vesper agent by:
 * 1. Finding or creating a session based on the session key
 * 2. Applying the permission mode from the directive
 * 3. Sending the message to the agent
 * 4. Streaming the response back to Slack
 */
export async function processSlackMessageWithSession(params: {
  service: SlackService;
  message: SlackInboundMessage;
  sessionKey: string;
  permissionMode: 'safe' | 'ask' | 'allow-all';
  workspaceId: string;
  sessionManager: SessionManager;
}): Promise<void> {
  const { service, message, sessionKey, permissionMode, workspaceId, sessionManager } = params;

  try {
    // Step 1: Find or create session
    // Check if we have a mapping for this session key
    let sessionId = slackSessionMapping.get(sessionKey);
    let session = sessionId ? await sessionManager.getSession(sessionId) : null;

    // If mapped session doesn't exist anymore, remove the mapping
    if (sessionId && !session) {
      slackSessionMapping.delete(sessionKey);
      session = null;
    }

    if (!session) {
      // Create new session for this Slack thread/channel
      // Note: Session name is derived from first message preview, not set at creation
      session = await sessionManager.createSession(workspaceId, {
        permissionMode,
        metadata: {
          type: 'slack',
          channel: message.channel,
          channelName: message.channelName,
          teamId: message.teamId,
          threadTs: message.threadTs,
        },
      });

      // Store the mapping
      slackSessionMapping.set(sessionKey, session.id);
    }

    // Step 2: Apply permission mode (may differ from session default if directive changed)
    if (session.permissionMode !== permissionMode) {
      setPermissionMode(session.id, permissionMode);
    }

    // Step 3: Set up completion callback to send response back to Slack
    sessionManager.setSessionCompletionCallback(
      session.id,
      async (_sessionId: string, messages: Message[]) => {
        // Extract the last assistant message
        const assistantMessages = messages
          .filter(m => m.role === 'assistant' && !m.isIntermediate)
          .map(m => m.content);

        const lastMessage = assistantMessages[assistantMessages.length - 1];
        if (lastMessage) {
          // Send response back to Slack
          const replyThreadTs = message.threadTs ?? message.ts;
          await service.sendFormattedResult(message.channel, lastMessage, replyThreadTs);
        }
      }
    );

    // Step 4: Send message to agent (non-blocking)
    // The completion callback will handle sending the response
    await sessionManager.sendMessage(session.id, message.text);

  } catch (error) {
    console.error('[Slack] Session processing error:', error);

    // Send error message to user
    const replyThreadTs = message.threadTs ?? message.ts;
    await service.sendMessage({
      channel: message.channel,
      text: `Sorry, I encountered an error processing your message: ${error instanceof Error ? error.message : String(error)}`,
      threadTs: replyThreadTs,
    });
  }
}
