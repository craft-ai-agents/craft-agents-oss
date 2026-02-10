/**
 * Copilot SDK Event Adapter
 *
 * Maps Copilot SDK session events to Craft Agent's AgentEvent format.
 * This enables the CopilotAgent to emit events compatible with the existing UI.
 *
 * The Copilot SDK uses SessionEvent types with discriminated unions on the `type` field.
 */

import type { AgentEvent, TypedError } from '@craft-agent/core/types';
import type { SessionEvent } from '@github/copilot-sdk';
import { parseReadCommand, type ReadCommandInfo } from '../codex/read-patterns.ts';
import { createLogger } from '../../../utils/debug.ts';
import { COPILOT_TOOL_NAME_MAP } from '../../copilot-agent.ts';
import { toolMetadataStore } from '../../../interceptor-common.ts';

/**
 * Maps Copilot SDK session events to AgentEvents for UI compatibility.
 *
 * Event mapping:
 * - session.start → status
 * - session.resume → status
 * - session.idle → complete
 * - session.error → error
 * - session.compaction_complete → status
 * - session.usage_info → (internal, usage tracking)
 * - assistant.message_delta → text_delta
 * - assistant.message → text_complete
 * - assistant.reasoning_delta → text_delta (intermediate)
 * - assistant.reasoning → text_complete (intermediate)
 * - assistant.turn_start → (internal, turn tracking)
 * - assistant.turn_end → complete
 * - assistant.usage → (usage tracking)
 * - tool.execution_start → tool_start
 * - tool.execution_complete → tool_result
 * - tool.execution_progress → status
 */
export class CopilotEventAdapter {
  private log = createLogger('copilot-event');
  private turnIndex: number = 0;

  // Track tool names from execution_start for proper tool_result correlation
  private toolNames: Map<string, string> = new Map();

  // Track command output for tool results (accumulated from partial results)
  private commandOutput: Map<string, string> = new Map();

  // Track commands detected as file reads (for Read tool display)
  private readCommands: Map<string, ReadCommandInfo> = new Map();

  // Track block reasons for declined tool calls (set by PreToolUse hook)
  private blockReasons: Map<string, string> = new Map();

  // Current turn ID for event correlation
  private currentTurnId: string | null = null;

  // Track whether streaming deltas have been received for the current message
  private hasStreamedDeltas: boolean = false;

  // Track whether a final (non-intermediate) text_complete has been emitted this turn
  // Guards against duplicate assistant.message events from the SDK
  private hasEmittedFinalText: boolean = false;

  // Track whether we're currently in a reasoning block (for styling reasoning deltas differently)
  private inReasoning: boolean = false;

  // Deduplication: track last emitted intermediate text to skip identical re-emissions
  private lastIntermediateText: string | null = null;

  /**
   * Store the block reason for a tool call that will be declined.
   * Called from copilot-agent when PreToolUse hook blocks a tool.
   */
  setBlockReason(toolCallId: string, reason: string): void {
    this.log.warn('Tool call block reason recorded', { toolCallId, reason });
    this.blockReasons.set(toolCallId, reason);
  }

  /**
   * Start a new turn - resets indexing and streaming state.
   */
  startTurn(): void {
    this.turnIndex++;
    this.toolNames.clear();
    this.commandOutput.clear();
    this.readCommands.clear();
    this.blockReasons.clear();
    this.currentTurnId = null;
    this.hasStreamedDeltas = false;
    this.hasEmittedFinalText = false;
    this.inReasoning = false;
    this.lastIntermediateText = null;
    this.log.debug('Turn started', { turnIndex: this.turnIndex });
  }

  /**
   * Adapt a Copilot SDK SessionEvent to zero or more AgentEvents.
   */
  *adaptEvent(event: SessionEvent): Generator<AgentEvent> {
    switch (event.type) {
      // ============================================================
      // Session lifecycle events
      // ============================================================

      case 'session.start':
        // Internal - session initialized
        break;

      case 'session.resume':
        // Internal — fires on every reconnect/resume, too noisy for UI.
        this.log.debug('Session resumed', { eventCount: event.data.eventCount });
        break;

      case 'session.idle':
        yield { type: 'complete' };
        break;

      case 'session.error': {
        const typedError = this.mapSessionError(event.data);
        if (typedError) {
          yield { type: 'typed_error', error: typedError };
        } else {
          yield { type: 'error', message: event.data.message };
        }
        break;
      }

      case 'session.compaction_start':
        // Use "Compacting" keyword so session handler detects statusType: 'compacting'
        yield { type: 'status', message: 'Compacting context...' };
        break;

      case 'session.compaction_complete':
        if (event.data.success) {
          const tokenInfo = event.data.preCompactionTokens && event.data.postCompactionTokens
            ? ` (${event.data.preCompactionTokens} → ${event.data.postCompactionTokens} tokens)`
            : '';
          // Use "Compacted" keyword so session handler detects statusType: 'compaction_complete'
          yield { type: 'info', message: `Compacted context to fit within limits${tokenInfo}` };
        } else {
          yield { type: 'error', message: `Context compaction failed: ${event.data.error || 'unknown error'}` };
        }
        break;

      case 'session.usage_info':
        // Emit usage_update so the UI can show context window utilization
        yield {
          type: 'usage_update',
          usage: {
            inputTokens: event.data.currentTokens,
            contextWindow: event.data.tokenLimit,
          },
        };
        break;

      case 'session.info':
        yield { type: 'status', message: event.data.message };
        break;

      case 'session.model_change':
        yield { type: 'status', message: `Model changed to ${event.data.newModel}` };
        break;

      case 'session.truncation':
        yield {
          type: 'status',
          message: `Context truncated: ${event.data.messagesRemovedDuringTruncation} messages removed`,
        };
        break;

      case 'session.shutdown':
        // Internal shutdown tracking
        break;

      case 'session.snapshot_rewind':
        // Internal snapshot management
        break;

      case 'session.handoff':
        yield { type: 'status', message: `Session handoff: ${event.data.summary || 'transferring'}` };
        break;

      // ============================================================
      // Assistant events
      // ============================================================

      case 'assistant.turn_start':
        this.currentTurnId = event.data.turnId;
        break;

      case 'assistant.turn_end':
        // Don't emit 'complete' here — session.idle handles it.
        // Emitting from both causes duplicate messages in session persistence.
        this.currentTurnId = null;
        this.hasStreamedDeltas = false;
        this.hasEmittedFinalText = false;
        this.inReasoning = false;
        this.lastIntermediateText = null;
        break;

      case 'assistant.message_delta':
        if (event.data.deltaContent) {
          this.hasStreamedDeltas = true;
          this.inReasoning = false; // Exited reasoning block
          yield {
            type: 'text_delta',
            text: event.data.deltaContent,
            turnId: this.currentTurnId || undefined,
            parentToolUseId: event.data.parentToolCallId || undefined,
          };
        }
        break;

      case 'assistant.message': {
        // The SDK always emits assistant.message with the full content, even when streaming.
        // Only emit text_complete here — deltas were just for streaming display.
        // The session handler uses text_complete to create the canonical persisted message.
        // Guard: only emit once per turn to prevent duplicate messages.
        if (event.data.content && !this.hasEmittedFinalText) {
          // Mark as intermediate when inside a subagent OR when tool calls follow
          const isIntermediate = !!(event.data.parentToolCallId || event.data.toolRequests?.length);

          // Skip duplicate intermediate text (same reasoning re-emitted across tool retries)
          if (isIntermediate && event.data.content === this.lastIntermediateText) {
            break;
          }

          this.hasEmittedFinalText = true;
          if (isIntermediate) {
            this.lastIntermediateText = event.data.content;
          } else {
            this.lastIntermediateText = null; // Final response clears the slate
          }

          yield {
            type: 'text_complete',
            text: event.data.content,
            isIntermediate,
            turnId: this.currentTurnId || undefined,
            parentToolUseId: event.data.parentToolCallId || undefined,
          };
          this.hasStreamedDeltas = false;
        }

        // NOTE: toolRequests are intentionally NOT extracted here.
        // assistant.message contains ALL upcoming tool calls in toolRequests[],
        // but yielding them here would batch all tool_start events at once.
        // Instead, we let individual tool.execution_start events drive tool_start
        // emissions — they arrive one-at-a-time from the SDK as each tool begins
        // executing, giving proper streaming UX (tools appear progressively).
        break;
      }

      case 'assistant.reasoning_delta':
        if (event.data.deltaContent) {
          this.inReasoning = true;
          yield {
            type: 'text_delta',
            text: event.data.deltaContent,
            turnId: this.currentTurnId || undefined,
            // Note: isIntermediate is set on text_complete (assistant.reasoning),
            // deltas are always partial. The inReasoning flag distinguishes these from
            // regular message deltas for consumers that need the distinction.
          };
        }
        break;

      case 'assistant.reasoning':
        this.inReasoning = false; // Reasoning block complete
        if (event.data.content && event.data.content !== this.lastIntermediateText) {
          this.lastIntermediateText = event.data.content;
          yield {
            type: 'text_complete',
            text: event.data.content,
            isIntermediate: true,
            turnId: this.currentTurnId || undefined,
          };
        }
        break;

      case 'assistant.intent':
        if (event.data.intent && event.data.intent !== this.lastIntermediateText) {
          this.lastIntermediateText = event.data.intent;
          yield {
            type: 'text_complete',
            text: event.data.intent,
            isIntermediate: true,
            turnId: this.currentTurnId || undefined,
          };
        }
        break;

      case 'assistant.usage': {
        // Emit usage_update with computed input tokens for context window display
        const inputTokens = (event.data.inputTokens || 0)
          + (event.data.cacheReadTokens || 0);
        if (inputTokens > 0) {
          yield {
            type: 'usage_update',
            usage: { inputTokens },
          };
        }
        break;
      }

      // ============================================================
      // Tool events
      // ============================================================

      case 'tool.execution_start': {
        const toolCallId = event.data.toolCallId;
        const toolName = this.resolveToolName(event.data);
        // assistant.message toolRequests may have already emitted tool_start for this call
        const alreadyEmitted = this.toolNames.has(toolCallId);
        this.toolNames.set(toolCallId, toolName);
        const parentToolUseId = event.data.parentToolCallId || undefined;

        const args = this.normalizeToolArgs(
          toolName,
          (event.data.arguments ?? {}) as Record<string, unknown>
        );

        // Look up metadata captured by the network interceptor (cross-process via file)
        const storedMeta = toolMetadataStore.get(toolCallId);
        const intent = storedMeta?.intent
          || (event.data as { description?: string }).description
          || undefined;
        const displayName = storedMeta?.displayName
          || this.getToolDisplayName(toolName);

        // Classify bash commands that are actually file reads
        if (toolName === 'Bash' && typeof args.command === 'string') {
          const readInfo = parseReadCommand(args.command);
          if (readInfo) {
            this.readCommands.set(toolCallId, readInfo);
            if (!alreadyEmitted) {
              yield {
                type: 'tool_start',
                toolName: 'Read',
                toolUseId: toolCallId,
                input: {
                  file_path: readInfo.filePath,
                  offset: readInfo.startLine,
                  limit: readInfo.endLine
                    ? readInfo.endLine - (readInfo.startLine || 1) + 1
                    : undefined,
                  _command: readInfo.originalCommand,
                },
                intent,
                displayName: 'Read File',
                turnId: this.currentTurnId || undefined,
                parentToolUseId,
              };
            }
            break;
          }
        }

        if (!alreadyEmitted) {
          yield {
            type: 'tool_start',
            toolName,
            toolUseId: toolCallId,
            input: args,
            intent,
            displayName,
            turnId: this.currentTurnId || undefined,
            parentToolUseId,
          };
        }
        break;
      }

      case 'tool.execution_complete': {
        const toolCallId = event.data.toolCallId;
        const parentToolUseId = event.data.parentToolCallId || undefined;

        // Resolve original tool name from execution_start
        const resolvedToolName = this.toolNames.get(toolCallId) || 'tool';
        this.toolNames.delete(toolCallId);

        // Block reasons are keyed by mapped tool name (e.g. "Bash") because
        // the PreToolUse hook doesn't have access to the tool call ID
        const blockReason = this.blockReasons.get(toolCallId) || this.blockReasons.get(resolvedToolName);
        if (blockReason) {
          this.blockReasons.delete(toolCallId);
          this.blockReasons.delete(resolvedToolName);
        }

        // Use accumulated output from partial results if available
        const accumulatedOutput = this.commandOutput.get(toolCallId);
        this.commandOutput.delete(toolCallId);

        const isError = !event.data.success;
        let result: string;

        if (accumulatedOutput) {
          result = accumulatedOutput;
        } else if (event.data.error) {
          // Include error code for richer context when available
          const errorCode = event.data.error.code ? `[${event.data.error.code}] ` : '';
          result = blockReason || `${errorCode}${event.data.error.message}`;
        } else if (event.data.result) {
          // Prefer detailedContent when available (provides more context)
          result = event.data.result.detailedContent || event.data.result.content;
        } else {
          result = blockReason || (isError ? 'Tool execution failed' : 'Success');
        }

        // After tool completion, the assistant may generate new text in response
        // to tool results. Reset the guard so the next assistant.message emits text_complete.
        this.hasEmittedFinalText = false;

        // Check if this was classified as a file read
        const readInfo = this.readCommands.get(toolCallId);
        if (readInfo) {
          this.readCommands.delete(toolCallId);
          yield {
            type: 'tool_result',
            toolUseId: toolCallId,
            toolName: 'Read',
            result,
            isError,
            turnId: this.currentTurnId || undefined,
            parentToolUseId,
          };
          break;
        }

        yield {
          type: 'tool_result',
          toolUseId: toolCallId,
          toolName: resolvedToolName,
          result,
          isError,
          turnId: this.currentTurnId || undefined,
          parentToolUseId,
        };
        break;
      }

      case 'tool.execution_progress':
        yield { type: 'status', message: event.data.progressMessage };
        break;

      case 'tool.execution_partial_result': {
        const id = event.data.toolCallId;
        const content = event.data.partialOutput || '';
        const existing = this.commandOutput.get(id) || '';
        this.commandOutput.set(id, existing + content);
        break;
      }

      case 'tool.user_requested':
        // User-initiated tool call
        break;

      // ============================================================
      // Other events
      // ============================================================

      case 'user.message':
        // User messages don't need events
        break;

      case 'pending_messages.modified':
        // Internal queue management
        break;

      case 'abort':
        yield { type: 'status', message: `Aborted: ${event.data.reason}` };
        break;

      case 'skill.invoked':
        yield { type: 'status', message: `Skill invoked: ${event.data.name}` };
        break;

      case 'subagent.started':
        yield {
          type: 'tool_start',
          toolName: `SubAgent:${event.data.agentName}`,
          toolUseId: event.data.toolCallId,
          input: { description: event.data.agentDescription },
          turnId: this.currentTurnId || undefined,
        };
        break;

      case 'subagent.completed':
        yield {
          type: 'tool_result',
          toolUseId: event.data.toolCallId,
          toolName: `SubAgent:${event.data.agentName}`,
          result: 'Sub-agent task completed',
          isError: false,
          turnId: this.currentTurnId || undefined,
        };
        break;

      case 'subagent.failed':
        yield {
          type: 'tool_result',
          toolUseId: event.data.toolCallId,
          toolName: `SubAgent:${event.data.agentName}`,
          result: event.data.error,
          isError: true,
          turnId: this.currentTurnId || undefined,
        };
        break;

      case 'subagent.selected':
        yield { type: 'status', message: `Agent selected: ${event.data.agentDisplayName}` };
        break;

      case 'hook.start':
      case 'hook.end':
        // Internal hook lifecycle
        break;

      case 'system.message':
        // System messages are internal
        break;

      default:
        // TODO: If Copilot SDK emits plan events (e.g., 'plan.updated'),
        // map them to todos_updated events with status normalization
        this.log.warn(`Unknown Copilot event type: ${(event as { type: string }).type}`);
        break;
    }
  }

  /**
   * Normalize Copilot-native tool arguments to match Claude Code conventions.
   * Copilot CLI tools (str_replace_editor subcommands) use different param names
   * than Claude Code (e.g., `path` instead of `file_path`).
   */
  private normalizeToolArgs(
    toolName: string,
    args: Record<string, unknown>
  ): Record<string, unknown> {
    // Copilot native tools use `path` instead of `file_path`.
    // Replace (not duplicate) so the UI doesn't show the path twice.
    if ((toolName === 'Read' || toolName === 'Write' || toolName === 'Edit') && args.path && !args.file_path) {
      const { path: filePath, ...rest } = args;
      return { ...rest, file_path: filePath };
    }
    return args;
  }

  /**
   * Resolve the display tool name from execution_start event data.
   * Maps MCP tool calls to mcp__server__tool format, and normalizes
   * built-in tool names from lowercase to PascalCase for UI consistency.
   */
  private resolveToolName(data: {
    toolName: string;
    mcpServerName?: string;
    mcpToolName?: string;
  }): string {
    if (data.mcpServerName && data.mcpToolName) {
      return `mcp__${data.mcpServerName}__${data.mcpToolName}`;
    }
    // Normalize lowercase tool names to PascalCase (bash → Bash, etc.)
    return COPILOT_TOOL_NAME_MAP[data.toolName] || data.toolName;
  }

  /**
   * Map session.error data to a TypedError when the error type/status code is recognized.
   * Returns null for unknown errors (caller falls back to plain error event).
   */
  private mapSessionError(data: {
    errorType: string;
    message: string;
    statusCode?: number;
  }): TypedError | null {
    const { errorType, message, statusCode } = data;

    // Auth errors (401, 403)
    if (statusCode === 401 || statusCode === 403 || errorType === 'authentication' || errorType === 'authorization') {
      return {
        code: 'invalid_credentials',
        title: 'Authentication Required',
        message: message || 'Your GitHub credentials are invalid or expired.',
        actions: [{ key: 'r', label: 'Retry', action: 'retry' }],
        canRetry: true,
        originalError: message,
      };
    }

    // Rate limiting (429)
    if (statusCode === 429 || errorType === 'rate_limit') {
      return {
        code: 'rate_limited',
        title: 'Rate Limited',
        message: message || 'Too many requests. Please wait a moment.',
        actions: [{ key: 'r', label: 'Retry', action: 'retry' }],
        canRetry: true,
        retryDelayMs: 5000,
        originalError: message,
      };
    }

    // Server errors (5xx)
    if (statusCode && statusCode >= 500) {
      return {
        code: 'service_error',
        title: 'Service Error',
        message: message || 'The AI service is temporarily unavailable.',
        actions: [{ key: 'r', label: 'Retry', action: 'retry' }],
        canRetry: true,
        retryDelayMs: 2000,
        originalError: message,
      };
    }

    // Network errors
    if (errorType === 'network' || errorType === 'connection') {
      return {
        code: 'network_error',
        title: 'Connection Error',
        message: message || 'Could not connect to the server.',
        actions: [{ key: 'r', label: 'Retry', action: 'retry' }],
        canRetry: true,
        retryDelayMs: 1000,
        originalError: message,
      };
    }

    return null;
  }

  /**
   * Get a human-readable display name for a tool.
   */
  private getToolDisplayName(toolName: string): string | undefined {
    switch (toolName) {
      case 'Bash':
        return 'Run Command';
      case 'Read':
        return 'Read File';
      case 'Write':
        return 'Write File';
      case 'Edit':
        return 'Edit File';
      case 'Glob':
        return 'Search Files';
      case 'Grep':
        return 'Search Content';
      default:
        return undefined;
    }
  }
}
