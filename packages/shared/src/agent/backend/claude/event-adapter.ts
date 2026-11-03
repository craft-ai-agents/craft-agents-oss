/**
 * Claude Event Adapter
 *
 * Maps Claude SDK messages (SDKMessage) to Craft Agent's AgentEvent format.
 * Extracted from ClaudeAgent.convertSDKMessage() for testability and to share
 * lifecycle scaffolding with PiEventAdapter via BaseEventAdapter.
 *
 * Key Claude-specific behavior:
 * - Uses extractToolStarts/extractToolResults from tool-matching.ts (stateless, ID-based)
 * - Handles stream_event for real-time text deltas and tool start detection
 * - Manages pendingText for deferred text_complete (waits for stop_reason from message_delta)
 * - Tracks usage per-message (not cumulative) for accurate context window display
 * - Takes back the frames of a reply the model's safeguards stopped (refusal fallback)
 */

import type { SDKMessage, SDKAssistantMessageError } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent, ContextUsageSnapshot } from '@craft-agent/core/types';
import { contextAfterCompaction, contextFromClaude } from '../../context-usage.ts';
import { createAgentError, type AgentError } from '../../errors.ts';
import { BaseEventAdapter } from '../base-event-adapter.ts';
import { ToolIndex, extractToolStarts, extractToolResults, isParentTaskTool, type ContentBlock, type ToolResultBlock, type ToolUseBlock } from '../../tool-matching.ts';
import { classifyClaudeTaskNotification, classifyClaudeTaskProgress } from './task-notification.ts';

/**
 * Callbacks injected by ClaudeAgent for operations that depend on agent state.
 */
export interface ClaudeAdapterCallbacks {
  /** Debug logger — wired to ClaudeAgent.onDebug */
  onDebug?: (msg: string) => void;
  /** Maps SDK error codes to typed AgentErrors (depends on debug log parsing) */
  mapSDKError: (errorCode: SDKAssistantMessageError) => Promise<{ type: 'typed_error'; error: AgentError }>;
  /** Session directory for tool metadata (prevents cross-session race condition) */
  sessionDir?: string;
}

/**
 * Pure function: build a typed_error event for Windows SDK setup issues.
 * Returns null if the error doesn't match the pattern.
 */
export function buildWindowsSkillsDirError(errorText: string): { type: 'typed_error'; error: AgentError } | null {
  if (!errorText.includes('ENOENT') || !errorText.includes('skills')) {
    return null;
  }

  const pathMatch = errorText.match(/scandir\s+'([^']+)'/);
  const missingPath = pathMatch?.[1] || 'C:\\ProgramData\\ClaudeCode\\.claude\\skills';

  return {
    type: 'typed_error',
    error: {
      code: 'unknown_error',
      title: 'Windows Setup Required',
      message: `The SDK requires a directory that doesn't exist: ${missingPath} — Create this folder in File Explorer, then restart the app.`,
      details: [
        `PowerShell (run as Administrator):`,
        `New-Item -ItemType Directory -Force -Path "${missingPath}"`,
      ],
      actions: [],
      canRetry: true,
      originalError: errorText,
    },
  };
}

/**
 * Per-message usage snapshot for accurate context window display.
 * result.modelUsage is cumulative; we need per-message granularity.
 */
interface AssistantUsage {
  input_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

/** SDK keep-alive progress for a long-running tool: `<tool_use_id>-heartbeat-<n>` under that tool. */
export function isToolHeartbeat(progress: { tool_use_id: string; parent_tool_use_id: string | null }): boolean {
  return /-heartbeat-\d+$/.test(progress.tool_use_id)
    && (!progress.parent_tool_use_id || progress.tool_use_id.startsWith(`${progress.parent_tool_use_id}-heartbeat-`));
}

export class ClaudeEventAdapter extends BaseEventAdapter {
  // Per-turn state (reset on each startTurn)
  private toolIndex = new ToolIndex();
  private emittedToolStarts = new Set<string>();
  private activeParentTools = new Set<string>();
  private pendingText: string | null = null;
  /** Turn of `pendingText` (the API message its text came from). */
  private pendingTextTurnId: string | undefined;
  /** The session agent's last API message ended with stop_reason "refusal" (until the next one starts). */
  private refusalStopped = false;
  private manualCompactionRequested = false;
  private manualCompactionBoundarySeen = false;

  // Session-persistent state (survives across turns)
  /**
   * What each SDK frame put in the transcript, by the frame's uuid: the turn its text went to, the
   * tool calls it made (assistant frame) or answered (user frame). Read when the CLI takes frames
   * back (`retract`). Bounded; oldest entries drop first.
   */
  private frames = new Map<string, { textTurnId?: string; toolUseIds: string[] }>();
  /** Tool calls the CLI took back: a result that still arrives for one is dropped. Bounded. */
  private retractedToolUseIds = new Set<string>();
  /**
   * Tool calls made by the session's own agent (top-level, no parent tool use), and the tasks they
   * started. Background-task completions are attributed through these: a subagent's own background
   * work is not the session's to report. Bounded; oldest entries drop first.
   */
  private topLevelToolUseIds = new Set<string>();
  private mainAgentTasks = new Map<string, { toolUseId: string; taskType?: string; description?: string; announced?: boolean }>();
  private lastAssistantUsage: AssistantUsage | null = null;
  private cachedContextWindow?: number;
  private contextUsage?: ContextUsageSnapshot;
  private _sdkTools: string[] = [];

  private callbacks: ClaudeAdapterCallbacks;

  constructor(callbacks: ClaudeAdapterCallbacks) {
    super('claude-adapter');
    this.callbacks = callbacks;
  }

  // ============================================================
  // Turn Lifecycle
  // ============================================================

  protected onTurnStart(): void {
    this.toolIndex = new ToolIndex();
    this.emittedToolStarts = new Set();
    this.activeParentTools = new Set();
    this.pendingText = null;
    this.pendingTextTurnId = undefined;
    this.refusalStopped = false;
    this.lastAssistantUsage = null;
    this.manualCompactionRequested = false;
    this.manualCompactionBoundarySeen = false;
  }

  // ============================================================
  // Public API
  // ============================================================

  /**
   * Whether a background task was started by the session's own agent: its starting tool call (from
   * the notification, or remembered from task_started) was a top-level one. False for a subagent's
   * own tasks and for anything this adapter never saw start.
   */
  wasLaunchedByMainAgent(taskId: string, toolUseId?: string): boolean {
    if (toolUseId) return this.topLevelToolUseIds.has(toolUseId);
    return this.mainAgentTasks.has(taskId);
  }

  /** Called only for our explicit /compact command, after startTurn(). */
  expectManualCompaction(): void {
    this.manualCompactionRequested = true;
  }

  /** True from expectManualCompaction() until the next turn starts. */
  isManualCompactionRequested(): boolean {
    return this.manualCompactionRequested;
  }

  setContextUsage(snapshot: ContextUsageSnapshot): void {
    this.contextUsage = snapshot;
  }

  getContextUsage(): ContextUsageSnapshot | undefined {
    return this.contextUsage;
  }

  /**
   * Convert an SDK message to AgentEvents.
   * Main entry point called from ClaudeAgent's for-await loop.
   */
  async adapt(message: SDKMessage): Promise<AgentEvent[]> {
    const events: AgentEvent[] = [];

    // Debug: log non-streaming SDK message types (stream_event is too frequent)
    if (this.callbacks.onDebug && message.type !== 'stream_event') {
      const msgInfo = message.type === 'user' && 'tool_use_result' in message
        ? `user (tool_result for ${(message as any).parent_tool_use_id})`
        : message.type;
      this.callbacks.onDebug(`SDK message: ${msgInfo}`);
    }

    switch (message.type) {
      case 'assistant':
        await this.adaptAssistant(message, events);
        break;

      case 'stream_event':
        this.adaptStreamEvent(message, events);
        break;

      case 'user':
        this.adaptUser(message, events);
        break;

      case 'tool_progress':
        this.adaptToolProgress(message, events);
        break;

      case 'result':
        this.adaptResult(message, events);
        break;

      case 'system':
        this.adaptSystem(message, events);
        break;

      case 'auth_status':
        this.adaptAuthStatus(message, events);
        break;

      default:
        if (this.callbacks.onDebug) {
          this.callbacks.onDebug(`Unhandled SDK message type: ${(message as any).type}`);
        }
        break;
    }

    return events;
  }

  /**
   * Flush any pending text that hasn't been emitted.
   * Called after the for-await loop exits to handle edge cases
   * (e.g., SDK sends assistant message with text but skips message_delta).
   */
  flushPending(): AgentEvent | null {
    if (this.pendingText) {
      const event: AgentEvent = {
        type: 'text_complete',
        text: this.pendingText,
        isIntermediate: false,
        turnId: this.pendingTextTurnId ?? (this.currentTurnId || undefined),
      };
      this.pendingText = null;
      return event;
    }
    return null;
  }

  /**
   * Get SDK tools captured from init message.
   */
  get sdkTools(): string[] {
    return this._sdkTools;
  }

  /**
   * Get the tool index (for agent-level operations like inactive source detection).
   */
  getToolIndex(): ToolIndex {
    return this.toolIndex;
  }

  /**
   * Get the set of active parent tools (exposed for source activation detection).
   */
  getActiveParentTools(): Set<string> {
    return this.activeParentTools;
  }

  /**
   * Update the session directory for tool metadata lookups.
   */
  updateSessionDir(sessionDir: string): void {
    this.callbacks.sessionDir = sessionDir;
  }

  // ============================================================
  // Per-message-type Handlers
  // ============================================================

  private async adaptAssistant(message: SDKMessage, events: AgentEvent[]): Promise<void> {
    // Check for SDK-level errors FIRST (auth, network, rate limits, etc.)
    if ('error' in message && message.error) {
      const refusal = refusalError(message);
      if (refusal) {
        // It arrives before the stopped reply's message_delta: show that text first
        const stopped = this.flushPending();
        if (stopped) events.push(stopped);
        events.push(refusal);
        return;
      }
      const errorEvent = await this.callbacks.mapSDKError(
        message.error as SDKAssistantMessageError,
      );
      events.push(errorEvent);
      return;
    }

    // Skip replayed messages when resuming a session
    if ('isReplay' in message && message.isReplay) {
      return;
    }

    // A fallback model's answer names the stopped reply's frames it replaces
    this.retract((message as { supersedes?: unknown }).supersedes, events);

    // Track usage from non-sidechain assistant messages
    const isSidechain = (message as any).parent_tool_use_id !== null;
    const structuredContextUsage = !isSidechain ? contextFromClaude((message as any).context_usage) : undefined;
    if (structuredContextUsage) {
      this.contextUsage = structuredContextUsage;
      events.push({ type: 'context_usage', contextUsage: structuredContextUsage });
    }
    if (!isSidechain && (message as any).message?.usage) {
      const usage = (message as any).message.usage;
      this.lastAssistantUsage = {
        input_tokens: usage.input_tokens,
        cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
        cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
      };

      const currentInputTokens =
        this.lastAssistantUsage.input_tokens +
        this.lastAssistantUsage.cache_read_input_tokens +
        this.lastAssistantUsage.cache_creation_input_tokens;

      events.push({
        type: 'usage_update',
        usage: {
          inputTokens: currentInputTokens,
          contextWindow: this.cachedContextWindow,
        },
      });

      // Local command replies carry synthetic zero usage, not fresh occupancy.
      // Never let those overwrite a compact boundary or the previous snapshot.
      if (!this.manualCompactionRequested && !structuredContextUsage) {
        const estimate = contextFromClaude({
          totalTokens: currentInputTokens + (usage.output_tokens ?? 0),
          rawMaxTokens: this.contextUsage?.limitTokens ?? this.cachedContextWindow,
          isAutoCompactEnabled: this.contextUsage?.limitKind === 'compaction',
        });
        if (estimate) {
          this.contextUsage = estimate;
          events.push({ type: 'context_usage', contextUsage: estimate });
        }
      }
    }

    // Full assistant message with content blocks
    const content = (message as any).message?.content ?? [];

    // Extract text from content blocks
    let textContent = '';
    for (const block of content) {
      if (block.type === 'text') {
        textContent += block.text;
      }
    }

    // Stateless tool start extraction
    const sdkParentId = (message as any).parent_tool_use_id;
    if (sdkParentId == null) this.rememberTopLevelToolUses(content as ContentBlock[]);
    const toolStartEvents = extractToolStarts(
      content as ContentBlock[],
      sdkParentId,
      this.toolIndex,
      this.emittedToolStarts,
      this.currentTurnId || undefined,
      this.activeParentTools,
      this.callbacks.sessionDir,
    );

    // Track active Task tools for fallback parent assignment
    for (const event of toolStartEvents) {
      if (event.type === 'tool_start' && isParentTaskTool(event.toolName)) {
        this.activeParentTools.add(event.toolUseId);
      }
    }

    events.push(...toolStartEvents);

    const turnId = this.currentTurnId || undefined;
    this.rememberFrame(message, {
      textTurnId: textContent ? turnId : undefined,
      toolUseIds: (content as ContentBlock[]).flatMap(block => block.type === 'tool_use' ? [(block as ToolUseBlock).id] : []),
    });

    if (textContent) {
      // Don't emit text_complete yet — wait for message_delta to get stop_reason
      this.pendingText = textContent;
      this.pendingTextTurnId = turnId;
    }
  }

  private adaptStreamEvent(message: SDKMessage, events: AgentEvent[]): void {
    const event = (message as any).event;

    // Debug: log key stream events only (skip per-chunk deltas and frequent pings)
    if (this.callbacks.onDebug && (event.type === 'message_start' || event.type === 'message_stop')) {
      this.callbacks.onDebug(
        `stream_event: ${event.type}`,
      );
    }

    const isSessionAgent = !(message as any).parent_tool_use_id;

    // Capture turn ID from message_start
    if (event.type === 'message_start') {
      const messageId = event.message?.id;
      if (messageId) {
        this.currentTurnId = messageId;
      }
      if (isSessionAgent) this.refusalStopped = false;
    }

    // message_delta contains the actual stop_reason — emit pending text now
    if (event.type === 'message_delta') {
      const stopReason = event.delta?.stop_reason;
      if (stopReason === 'refusal' && isSessionAgent) this.refusalStopped = true;
      if (this.pendingText) {
        const isIntermediate = stopReason === 'tool_use';
        events.push({
          type: 'text_complete',
          text: this.pendingText,
          isIntermediate,
          turnId: this.pendingTextTurnId ?? (this.currentTurnId || undefined),
          parentToolUseId: (message as any).parent_tool_use_id || undefined,
        });
        this.pendingText = null;
      }
    }

    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      events.push({
        type: 'text_delta',
        text: event.delta.text,
        turnId: this.currentTurnId || undefined,
        parentToolUseId: (message as any).parent_tool_use_id || undefined,
      });
    } else if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
      // Stream events arrive with empty input — the full input comes later
      const toolBlock = event.content_block;
      const sdkParentId = (message as any).parent_tool_use_id;
      const streamBlocks: ContentBlock[] = [{
        type: 'tool_use' as const,
        id: toolBlock.id,
        name: toolBlock.name,
        input: (toolBlock.input ?? {}) as Record<string, unknown>,
      }];
      const streamEvents = extractToolStarts(
        streamBlocks,
        sdkParentId,
        this.toolIndex,
        this.emittedToolStarts,
        this.currentTurnId || undefined,
        this.activeParentTools,
        this.callbacks.sessionDir,
      );

      // Track active Task/Agent tools for fallback parent assignment
      for (const evt of streamEvents) {
        if (evt.type === 'tool_start' && isParentTaskTool(evt.toolName)) {
          this.activeParentTools.add(evt.toolUseId);
        }
      }

      events.push(...streamEvents);
    }
  }

  private adaptUser(message: SDKMessage, events: AgentEvent[]): void {
    // Skip replayed messages when resuming
    if ('isReplay' in message && message.isReplay) {
      return;
    }

    // Tool result matching
    if ((message as any).tool_use_result !== undefined || ('message' in message && (message as any).message)) {
      const msgContent = ('message' in message && (message as any).message)
        ? (((message as any).message as { content?: unknown[] }).content ?? [])
        : [];
      const contentBlocks = (Array.isArray(msgContent) ? msgContent : []) as ContentBlock[];

      const sdkParentId = (message as any).parent_tool_use_id;
      const toolUseResultValue = (message as any).tool_use_result;

      this.rememberFrame(message, {
        toolUseIds: contentBlocks.flatMap(block => block.type === 'tool_result' ? [(block as ToolResultBlock).tool_use_id] : []),
      });
      const resultEvents = extractToolResults(
        contentBlocks,
        sdkParentId,
        toolUseResultValue,
        this.toolIndex,
        this.currentTurnId || undefined,
      ).filter(event => event.type !== 'tool_result' || !this.retractedToolUseIds.has(event.toolUseId));

      // Remove completed Task/Agent tools from activeParentTools
      for (const event of resultEvents) {
        if (event.type === 'tool_result' && isParentTaskTool(event.toolName ?? '')) {
          this.activeParentTools.delete(event.toolUseId);
        }
      }

      if (isDetachedToolCallResult(toolUseResultValue)) {
        // The SDK moved this call (WebFetch/WebSearch) to the background for a message the user
        // sent mid-turn; its tool_result text is a model-directed placeholder, and the real
        // result reaches the model later as a queued task notification Craft never sees.
        for (const event of resultEvents) {
          if (event.type === 'tool_result') {
            event.result = DETACHED_TOOL_CALL_RESULT;
            event.isError = false;
          }
        }
      }

      events.push(...resultEvents);
    }
  }

  private adaptToolProgress(message: SDKMessage, events: AgentEvent[]): void {
    const progress = message as unknown as {
      tool_use_id: string;
      tool_name: string;
      parent_tool_use_id: string | null;
      elapsed_time_seconds?: number;
    };

    // Forward elapsed time for live progress updates
    if (progress.elapsed_time_seconds !== undefined) {
      events.push({
        type: 'task_progress',
        toolUseId: progress.parent_tool_use_id || progress.tool_use_id,
        elapsedSeconds: progress.elapsed_time_seconds,
        turnId: this.currentTurnId || undefined,
      });
    }

    // Emit tool_start for tools discovered through progress events. Not for heartbeats: the SDK
    // sends one every 30 s for a long-running tool (`<tool_use_id>-heartbeat-<n>`, parent = that
    // tool) with nothing but elapsed time, and a tool_start for each would add a row that never
    // finishes ("Running …").
    if (!this.emittedToolStarts.has(progress.tool_use_id) && !isToolHeartbeat(progress)) {
      const progressBlocks: ContentBlock[] = [{
        type: 'tool_use' as const,
        id: progress.tool_use_id,
        name: progress.tool_name,
        input: {},
      }];
      const progressEvents = extractToolStarts(
        progressBlocks,
        progress.parent_tool_use_id,
        this.toolIndex,
        this.emittedToolStarts,
        this.currentTurnId || undefined,
        this.activeParentTools,
        this.callbacks.sessionDir,
      );

      // Track active Task/Agent tools discovered via progress events
      for (const evt of progressEvents) {
        if (evt.type === 'tool_start' && isParentTaskTool(evt.toolName)) {
          this.activeParentTools.add(evt.toolUseId);
        }
      }

      events.push(...progressEvents);
    }
  }

  private adaptResult(message: SDKMessage, events: AgentEvent[]): void {
    const msg = message as any;

    // Debug logging
    console.error(
      `[ClaudeAdapter] result message: subtype=${msg.subtype}, errors=${'errors' in msg ? JSON.stringify(msg.errors) : 'none'}`,
    );

    // Get contextWindow from modelUsage
    const modelUsageEntries = Object.values(msg.modelUsage || {});
    const primaryModelUsage = modelUsageEntries[0] as any;

    if (primaryModelUsage?.contextWindow) {
      this.cachedContextWindow = primaryModelUsage.contextWindow;
    }

    // Use lastAssistantUsage for per-message context display (not cumulative)
    let inputTokens: number;
    let cacheRead: number;
    let cacheCreation: number;

    if (this.lastAssistantUsage) {
      inputTokens = this.lastAssistantUsage.input_tokens +
                    this.lastAssistantUsage.cache_read_input_tokens +
                    this.lastAssistantUsage.cache_creation_input_tokens;
      cacheRead = this.lastAssistantUsage.cache_read_input_tokens;
      cacheCreation = this.lastAssistantUsage.cache_creation_input_tokens;
    } else {
      cacheRead = msg.usage.cache_read_input_tokens ?? 0;
      cacheCreation = msg.usage.cache_creation_input_tokens ?? 0;
      inputTokens = msg.usage.input_tokens + cacheRead + cacheCreation;
    }

    const usage = {
      inputTokens,
      outputTokens: msg.usage.output_tokens,
      cacheReadTokens: cacheRead,
      cacheCreationTokens: cacheCreation,
      costUsd: msg.total_cost_usd,
      contextWindow: primaryModelUsage?.contextWindow,
      // `total_cost_usd` and `modelUsage` are running totals for the SDK session (subagents
      // included), not this turn's spend; `usage` covers the main loop only.
      runningTotals: {
        costUsd: msg.total_cost_usd ?? 0,
        outputTokens: modelUsageEntries.reduce((sum: number, entry: any) => sum + (entry?.outputTokens ?? 0), 0),
      },
    };

    if (this.manualCompactionRequested) {
      // The installed CLI returns result(success, is_error:false) even for
      // too-small/API-failed /compact commands. Only a correlated boundary
      // proves success, and plan readiness waits until this terminal result.
      if (this.manualCompactionBoundarySeen && msg.subtype === 'success' && !msg.is_error) {
        events.push({ type: 'info', message: 'Compacted Conversation', compactionTrigger: 'manual' });
      } else {
        events.push({ type: 'compaction_failed' });
      }
    }

    if (msg.subtype === 'success') {
      events.push({ type: 'complete', usage });
    } else {
      const errorMsg = 'errors' in msg ? msg.errors.join(', ') : 'Query failed';

      const windowsError = buildWindowsSkillsDirError(errorMsg);
      if (windowsError) {
        events.push(windowsError);
      } else {
        events.push({ type: 'error', message: errorMsg });
      }
      events.push({ type: 'complete', usage });
    }
  }

  private adaptSystem(message: SDKMessage, events: AgentEvent[]): void {
    const msg = message as any;

    if (msg.subtype === 'init') {
      // Capture tools list from SDK init message
      if ('tools' in msg && Array.isArray(msg.tools)) {
        this._sdkTools = msg.tools;
        this.callbacks.onDebug?.(`SDK init: captured ${this._sdkTools.length} tools`);
      }
    } else if (msg.subtype === 'compact_boundary') {
      this.contextUsage = contextAfterCompaction(msg.compact_metadata?.post_tokens, this.contextUsage);
      events.push({ type: 'context_usage', contextUsage: this.contextUsage });
      if (this.manualCompactionRequested && msg.compact_metadata?.trigger === 'manual') {
        this.manualCompactionBoundarySeen = true;
      } else {
        events.push({ type: 'info', message: 'Compacted Conversation', compactionTrigger: 'auto' });
      }
    } else if (msg.subtype === 'status' && msg.status === 'compacting') {
      events.push({ type: 'status', message: 'Compacting conversation...' });
    } else if (msg.subtype === 'task_notification') {
      const classification = classifyClaudeTaskNotification(message);
      if (classification.kind === 'missing-task-id') {
        this.callbacks.onDebug?.('[EventAdapter] task_notification missing task_id, skipping');
        return;
      }
      if (classification.kind === 'valid') {
        const { taskId, toolUseId } = classification.notification;
        events.push({
          type: 'task_completed',
          taskId,
          status: classification.notification.status,
          outputFile: classification.notification.outputFile,
          summary: classification.notification.summary,
          turnId: this.currentTurnId || undefined,
          ...(toolUseId ? { toolUseId } : {}),
          launchedHere: this.wasLaunchedByMainAgent(taskId, toolUseId),
        });
      }
    } else if (msg.subtype === 'task_progress') {
      // What one of the session's own background tasks is doing (a subagent's nested tasks have no chip)
      const activity = classifyClaudeTaskProgress(message);
      if (activity && this.wasLaunchedByMainAgent(activity.taskId, activity.toolUseId)) {
        events.push({ type: 'task_activity', ...activity, turnId: this.currentTurnId || undefined });
      }
    } else if (msg.subtype === 'task_started') {
      // Remember the session's own tasks (structured, unlike tool-result text) and announce a
      // background one; a foreground task is announced if it later moves to the background.
      if (typeof msg.task_id === 'string' && typeof msg.tool_use_id === 'string' && this.topLevelToolUseIds.has(msg.tool_use_id)) {
        this.mainAgentTasks.set(msg.task_id, {
          toolUseId: msg.tool_use_id,
          ...(typeof msg.task_type === 'string' ? { taskType: msg.task_type } : {}),
          ...(typeof msg.description === 'string' && msg.description ? { description: msg.description } : {}),
        });
        trimOldest(this.mainAgentTasks, 500);
        if (msg.is_backgrounded === true) this.pushBackgroundedTask(msg.task_id, events);
      }
    } else if (msg.subtype === 'task_updated') {
      if (typeof msg.task_id === 'string' && msg.patch?.is_backgrounded === true) this.pushBackgroundedTask(msg.task_id, events);
    } else if (msg.subtype === 'informational') {
      // The CLI's notice after a stopped reply ("…'s safeguards stopped the response above ·
      // continuing once with that noted"); its other notices are not shown
      const notice = typeof msg.content === 'string' ? msg.content.trim() : '';
      if (this.refusalStopped && notice) {
        this.refusalStopped = false;
        events.push({ type: 'model_refusal', message: notice });
      }
    } else if (msg.subtype === 'model_refusal_fallback') {
      // A stopped reply is answered again on a fallback model (`scope` 'local': only a subagent's
      // answer, the session's model stays)
      this.retract(msg.retracted_message_uuids, events);
      const fallbackModel = msg.scope !== 'local' && typeof msg.fallback_model === 'string' && msg.fallback_model
        ? msg.fallback_model
        : undefined;
      const notice = typeof msg.content === 'string' && msg.content.trim()
        ? msg.content.trim()
        : `The model's safeguards stopped its reply. ${msg.fallback_model ?? 'Another model'} answers instead.`;
      events.push({ type: 'model_refusal', message: notice, ...(fallbackModel ? { fallbackModel } : {}) });
    }
  }

  /** Remember what a frame put in the transcript, for `retract`. */
  private rememberFrame(message: SDKMessage, frame: { textTurnId?: string; toolUseIds: string[] }): void {
    const uuid = (message as { uuid?: unknown }).uuid;
    if (typeof uuid !== 'string' || (!frame.textTurnId && frame.toolUseIds.length === 0)) return;
    this.frames.set(uuid, frame);
    trimOldest(this.frames, 500);
  }

  /**
   * The CLI took back frames it sent: a reply the model's safeguards stopped, which a fallback model
   * answers instead (`supersedes` on the answer's first frame, `retracted_message_uuids` on its
   * notice; both name the same frames, and a frame is taken back once). Unfinished text is discarded,
   * finished text and the tool calls are removed, and a result that still comes for one is dropped.
   */
  private retract(uuids: unknown, events: AgentEvent[]): void {
    if (!Array.isArray(uuids)) return;
    const turnIds = new Set<string>();
    const toolUseIds = new Set<string>();
    for (const uuid of uuids) {
      const frame = typeof uuid === 'string' ? this.frames.get(uuid) : undefined;
      if (!frame) continue;
      this.frames.delete(uuid);
      if (frame.textTurnId) turnIds.add(frame.textTurnId);
      for (const id of frame.toolUseIds) toolUseIds.add(id);
    }
    if (turnIds.size === 0 && toolUseIds.size === 0) return;
    if (this.pendingText !== null && this.pendingTextTurnId && turnIds.has(this.pendingTextTurnId)) {
      this.pendingText = null;
      events.push({ type: 'text_discard', turnId: this.pendingTextTurnId });
    }
    for (const id of toolUseIds) {
      this.retractedToolUseIds.add(id);
      this.activeParentTools.delete(id);
    }
    trimOldest(this.retractedToolUseIds, 500);
    events.push({ type: 'messages_retracted', turnIds: [...turnIds], toolUseIds: [...toolUseIds] });
  }

  /** Remember top-level tool calls so later task events can be attributed to the session's agent. */
  private rememberTopLevelToolUses(content: ContentBlock[]): void {
    for (const block of content) {
      if (block.type === 'tool_use' && typeof (block as { id?: unknown }).id === 'string') {
        this.topLevelToolUseIds.add((block as { id: string }).id);
      }
    }
    trimOldest(this.topLevelToolUseIds, 2000);
  }

  /**
   * Announce one of the session's own tasks as backgrounded, once. Agents and workflows are
   * detected from their tool result (which carries the workflow id); everything else (Bash,
   * Monitor, MCP tasks...) is announced from here.
   */
  private pushBackgroundedTask(taskId: string, events: AgentEvent[]): void {
    const task = this.mainAgentTasks.get(taskId);
    if (!task || task.announced) return;
    task.announced = true;
    if (task.taskType === 'local_agent' || task.taskType === 'local_workflow') return;
    const input = this.toolIndex.getInput(task.toolUseId);
    const intent = task.description
      ?? (typeof input?._intent === 'string' ? input._intent : undefined)
      ?? (typeof input?.description === 'string' ? input.description : undefined);
    const turnId = this.currentTurnId || undefined;
    if (task.taskType === 'local_bash') {
      events.push({
        type: 'shell_backgrounded',
        toolUseId: task.toolUseId,
        shellId: taskId,
        turnId,
        ...(intent ? { intent } : {}),
        ...(typeof input?.command === 'string' ? { command: input.command } : {}),
      });
      return;
    }
    events.push({ type: 'task_backgrounded', toolUseId: task.toolUseId, taskId, turnId, kind: 'task', ...(intent ? { intent } : {}) });
  }

  private adaptAuthStatus(message: SDKMessage, events: AgentEvent[]): void {
    const msg = message as any;
    if (msg.error) {
      events.push({
        type: 'error',
        message: `Auth error: ${msg.error}. Try running /auth to re-authenticate.`,
      });
    }
  }
}

/**
 * The assistant error frame that ends a turn whose reply the model's safeguards stopped when no
 * model answers it instead (stop_reason "refusal"; the SDK's `model_refusal_no_fallback` notice just
 * before it has no text). Its text is Anthropic's explanation ("API Error: Opus 5.5's safeguards
 * flagged this session (…). …\n\nTry rephrasing …\n\nLearn more: …\n\nRequest ID: …"): the prose
 * becomes the message, the labelled lines at its end the details. Null for any other error frame.
 */
export function refusalError(message: SDKMessage): { type: 'typed_error'; error: AgentError } | null {
  const frame = (message as { message?: { stop_reason?: unknown; content?: unknown } }).message;
  if (frame?.stop_reason !== 'refusal') return null;
  const blocks: unknown[] = Array.isArray(frame.content) ? frame.content : [];
  const text = blocks
    .map(block => (block as { type?: unknown }).type === 'text' ? String((block as { text?: unknown }).text ?? '') : '')
    .join('');
  const paragraphs = text.trim().replace(/^API Error:\s*/, '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  let prose = paragraphs.length;
  while (prose > 0 && /^[A-Z][\w ]{0,24}: \S/.test(paragraphs[prose - 1]!) && !paragraphs[prose - 1]!.includes('\n')) prose--;
  const error = createAgentError('model_refusal');
  if (prose > 0) error.message = paragraphs.slice(0, prose).join(' ');
  if (prose < paragraphs.length) error.details = paragraphs.slice(prose);
  return { type: 'typed_error', error };
}

/** Shown for a tool call the SDK moved to the background (see `isDetachedToolCallResult`). */
export const DETACHED_TOOL_CALL_RESULT =
  'Still running in the background — the result goes straight to the agent when it finishes.';

/**
 * `tool_use_result` of a call that stepped aside for a mid-turn user message (SDK >=0.3.287,
 * WebFetch/WebSearch only). Craft's matcher-less PostToolUse hook keeps the CLI from detaching
 * calls at all (`claude-agent.ts`), so this only guards against that hook ever being narrowed.
 */
export function isDetachedToolCallResult(value: unknown): boolean {
  return typeof value === 'object' && value !== null
    && (value as { detachedToolCall?: unknown }).detachedToolCall === true;
}

/** Drop the oldest entries (insertion order) beyond `max`. */
function trimOldest(collection: Set<string> | Map<string, unknown>, max: number): void {
  for (const key of collection.keys()) {
    if (collection.size <= max) return;
    collection.delete(key);
  }
}
