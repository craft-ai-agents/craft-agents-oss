/**
 * Pi SDK Event Adapter
 *
 * Maps Pi Agent Core events (AgentEvent / AgentSessionEvent) to
 * Craft Agent's AgentEvent format for UI compatibility.
 *
 * Pi emits fine-grained lifecycle events. We translate them into
 * the same event vocabulary the renderer already understands from
 * Claude / Codex / Copilot backends.
 */

import type { AgentEvent as CraftAgentEvent } from '@craft-agent/core/types';
import type {
  AgentEvent as PiAgentEvent,
} from '@mariozechner/pi-agent-core';
import type {
  AgentSessionEvent,
} from '@mariozechner/pi-coding-agent';
import type { AssistantMessageEvent } from '@mariozechner/pi-ai';
import { BaseEventAdapter } from '../base-event-adapter.ts';
import { PI_TOOL_NAME_MAP } from './constants.ts';
import { toolMetadataStore } from '../../../interceptor-common.ts';

/**
 * Combined event type the adapter can handle.
 * AgentSessionEvent is a superset of PiAgentEvent (adds auto_compaction_*, auto_retry_*).
 */
type PiEvent = PiAgentEvent | AgentSessionEvent;

/**
 * Maps Pi SDK events to Craft AgentEvents for UI compatibility.
 *
 * Event mapping:
 * - message_update (text_delta in assistantMessageEvent) → text_delta
 * - message_end → text_complete
 * - tool_execution_start → tool_start
 * - tool_execution_end → tool_result
 * - agent_end → complete
 * - auto_compaction_start → status (with "Compacting" keyword)
 * - auto_compaction_end → info/error
 * - auto_retry_start → status
 * - auto_retry_end → status
 */
export class PiEventAdapter extends BaseEventAdapter {
  // Track tool names from execution_start for proper tool_result correlation
  private toolNames: Map<string, string> = new Map();

  // Track whether streaming deltas have been received for the current message
  private hasStreamedDeltas: boolean = false;

  // Track whether a final (non-intermediate) text_complete has been emitted this turn
  private hasEmittedFinalText: boolean = false;

  // Sub-turnId isolation (same pattern as CopilotEventAdapter)
  private subTurnCounter: number = 0;
  private messageSubTurnId: string | null = null;

  // Model context window for usage_update events
  private contextWindow: number | undefined;

  // Mini model ID for call_llm display override (Pi ignores model param, always uses miniModel)
  private miniModel: string | undefined;

  // Track last usage for emitting with complete event
  private lastUsage: { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number; cost: { total: number } } | undefined;

  constructor() {
    super('pi-event');
  }

  /**
   * Set the model's context window size for usage reporting.
   */
  setContextWindow(cw: number): void {
    this.contextWindow = cw;
  }

  /**
   * Set the mini model ID for call_llm display override.
   * Pi ignores the model param in call_llm — always uses miniModel.
   * This ensures the UI shows the actual model used.
   */
  setMiniModel(model: string | undefined): void {
    this.miniModel = model;
  }

  /**
   * Generate a unique sub-turnId for a text block within the current turn.
   */
  private nextSubTurnId(prefix: string): string {
    const base = this.currentTurnId || 'unknown';
    return `${base}__${prefix}${this.subTurnCounter++}`;
  }

  protected onTurnStart(): void {
    this.toolNames.clear();
    this.hasStreamedDeltas = false;
    this.hasEmittedFinalText = false;
    this.subTurnCounter = 0;
    this.messageSubTurnId = null;
    this.log.debug('Turn started', { turnIndex: this.turnIndex });
  }

  /**
   * Adapt a Pi SDK event to zero or more Craft AgentEvents.
   */
  *adaptEvent(event: PiEvent): Generator<CraftAgentEvent> {
    switch (event.type) {
      // ============================================================
      // Agent lifecycle events
      // ============================================================

      case 'agent_start':
        // Internal — agent run has started
        break;

      case 'agent_end':
        if (this.lastUsage) {
          const inputTokens = this.lastUsage.input + (this.lastUsage.cacheRead || 0);
          yield {
            type: 'complete',
            usage: {
              inputTokens,
              outputTokens: this.lastUsage.output,
              cacheReadTokens: this.lastUsage.cacheRead,
              cacheCreationTokens: this.lastUsage.cacheWrite,
              costUsd: this.lastUsage.cost.total,
              contextWindow: this.contextWindow,
            },
          };
        } else {
          yield { type: 'complete' };
        }
        break;

      // ============================================================
      // Turn events
      // ============================================================

      case 'turn_start':
        // Pi SDK turn_start has no ID, so generate one for event correlation
        this.currentTurnId = `pi-turn-${this.turnIndex}`;
        break;

      case 'turn_end':
        // Don't emit 'complete' here — agent_end handles it.
        // Emitting from both causes duplicate messages in session persistence.
        this.currentTurnId = null;
        this.hasStreamedDeltas = false;
        this.hasEmittedFinalText = false;
        this.subTurnCounter = 0;
        this.messageSubTurnId = null;
        break;

      // ============================================================
      // Message events (text streaming)
      // ============================================================

      case 'message_start':
        // Pi SDK emits message_start for user messages too — skip non-assistant
        break;

      case 'message_update': {
        // Pi SDK emits message_update only for assistant messages (streaming deltas)
        const amEvent: AssistantMessageEvent = event.assistantMessageEvent;
        if (amEvent.type === 'text_delta' && amEvent.delta) {
          this.hasStreamedDeltas = true;
          if (!this.messageSubTurnId) {
            this.messageSubTurnId = this.nextSubTurnId('m');
          }
          yield {
            type: 'text_delta',
            text: amEvent.delta,
            turnId: this.messageSubTurnId,
          };
        }
        break;
      }

      case 'message_end': {
        // Pi SDK emits message_end for ALL messages (user, assistant, toolResult).
        // Only process assistant messages — skip user prompts and tool results.
        const msg = event.message as { role?: string; stopReason?: string; errorMessage?: string; usage?: { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number; cost: { total: number } } } | undefined;
        if (msg?.role !== 'assistant') break;

        // Surface API errors — Pi SDK sets stopReason: 'error' and errorMessage on failures
        if (msg.stopReason === 'error' && msg.errorMessage) {
          yield { type: 'error', message: msg.errorMessage };
          break;
        }

        // Extract text content from the final assistant message
        const textContent = this.extractTextFromMessage(event.message);
        // Pi SDK stopReason: 'toolUse' means the model will call tools next (intermediate commentary),
        // 'stop'/'end_turn' means final response. Same logic as Claude's stop_reason === 'tool_use'.
        const isIntermediate = msg.stopReason === 'toolUse';
        if (textContent && (isIntermediate || !this.hasEmittedFinalText)) {
          if (!isIntermediate) this.hasEmittedFinalText = true;

          const mTurnId = this.messageSubTurnId || this.nextSubTurnId('m');
          this.messageSubTurnId = null;

          yield {
            type: 'text_complete',
            text: textContent,
            isIntermediate,
            turnId: mTurnId,
          };
          this.hasStreamedDeltas = false;
        }

        // Emit usage_update if the assistant message includes token usage
        if (msg.usage && typeof msg.usage.input === 'number') {
          this.lastUsage = msg.usage;
          const inputTokens = msg.usage.input + (msg.usage.cacheRead || 0);
          yield {
            type: 'usage_update',
            usage: {
              inputTokens,
              contextWindow: this.contextWindow,
            },
          };
        }
        break;
      }

      // ============================================================
      // Tool events
      // ============================================================

      case 'tool_execution_start': {
        const toolCallId = event.toolCallId;
        const toolName = this.resolveToolName(event.toolName);
        this.toolNames.set(toolCallId, toolName);

        // Normalize Pi field names to Claude Code format for UI compatibility
        // (diff stats, diff overlay, document routing all expect Claude Code format)
        const args = this.normalizeToolInput(toolName, (event.args ?? {}) as Record<string, unknown>);

        // For call_llm, Pi ignores the model param and always uses miniModel.
        // Override the displayed model so the UI shows the actual model used.
        if (toolName.includes('call_llm') && this.miniModel) {
          args.model = this.miniModel;
        }

        // Look up metadata from the store (populated by the interceptor in the Pi subprocess)
        const storedMeta = toolMetadataStore.get(toolCallId, this.sessionDir);
        const intent = storedMeta?.intent
          || (typeof args.description === 'string' ? args.description : undefined);

        // Classify bash commands that are actually file reads
        if (toolName === 'Bash' && typeof args.command === 'string') {
          const readInfo = this.classifyReadCommand(toolCallId, args.command);
          if (readInfo) {
            yield this.createReadToolStart(
              toolCallId,
              readInfo,
              intent,
              'Read File',
            );
            break;
          }
        }

        yield this.createToolStart(
          toolCallId,
          toolName,
          args,
          intent,
          storedMeta?.displayName || this.getToolDisplayName(toolName),
        );
        break;
      }

      case 'tool_execution_update': {
        // Accumulate partial output for streaming tool results
        const partialResult = event.partialResult;
        if (partialResult && typeof partialResult === 'object') {
          const content = (partialResult as { content?: Array<{ type: string; text?: string }> }).content;
          if (Array.isArray(content)) {
            for (const part of content) {
              if (part.type === 'text' && part.text) {
                this.accumulateOutput(event.toolCallId, part.text);
              }
            }
          }
        }
        break;
      }

      case 'tool_execution_end': {
        const toolCallId = event.toolCallId;
        const resolvedToolName = this.toolNames.get(toolCallId) || 'tool';
        this.toolNames.delete(toolCallId);

        // Check for block reason
        const blockReason = this.consumeBlockReason(toolCallId, resolvedToolName);

        // Use accumulated output from partial results if available
        const accumulatedOutput = this.consumeOutput(toolCallId);

        const isError = event.isError;
        let result: string;

        if (accumulatedOutput) {
          result = accumulatedOutput;
        } else if (blockReason) {
          result = blockReason;
        } else {
          result = this.extractToolResult(event.result, isError);
        }

        // After tool completion, the assistant may generate new text
        this.hasEmittedFinalText = false;
        this.messageSubTurnId = null;

        // Check if this was classified as a file read
        const readInfo = this.consumeReadCommand(toolCallId);
        if (readInfo) {
          yield this.createToolResult(toolCallId, 'Read', result, isError);
          break;
        }

        yield this.createToolResult(toolCallId, resolvedToolName, result, isError);
        break;
      }

      // ============================================================
      // Session-level events (AgentSessionEvent extensions)
      // ============================================================

      case 'auto_compaction_start':
        // Use "Compacting" keyword so session handler detects statusType: 'compacting'
        yield { type: 'status', message: 'Compacting context...' };
        break;

      case 'auto_compaction_end': {
        const compactionEvent = event as Extract<AgentSessionEvent, { type: 'auto_compaction_end' }>;
        if (compactionEvent.result && !compactionEvent.aborted) {
          // Use "Compacted" keyword so session handler detects statusType: 'compaction_complete'
          yield { type: 'info', message: 'Compacted context to fit within limits' };
        } else if (compactionEvent.errorMessage) {
          yield { type: 'error', message: `Context compaction failed: ${compactionEvent.errorMessage}` };
        }
        break;
      }

      case 'auto_retry_start': {
        const retryEvent = event as Extract<AgentSessionEvent, { type: 'auto_retry_start' }>;
        yield {
          type: 'status',
          message: `Retrying (attempt ${retryEvent.attempt}/${retryEvent.maxAttempts})...`,
        };
        break;
      }

      case 'auto_retry_end': {
        const retryEndEvent = event as Extract<AgentSessionEvent, { type: 'auto_retry_end' }>;
        if (!retryEndEvent.success && retryEndEvent.finalError) {
          yield { type: 'error', message: `Retry failed: ${retryEndEvent.finalError}` };
        }
        break;
      }

      default:
        this.log.warn(`Unknown Pi event type: ${(event as { type: string }).type}`);
        break;
    }
  }

  // ============================================================
  // Helpers
  // ============================================================

  /**
   * Normalize Pi SDK tool input field names to Claude Code format.
   * Pi uses camelCase (oldText, newText, path) while Claude Code uses
   * snake_case (old_string, new_string, file_path). The UI pipeline expects
   * Claude Code format for diff computation, overlay rendering, and
   * document type detection.
   */
  private normalizeToolInput(
    toolName: string,
    args: Record<string, unknown>,
  ): Record<string, unknown> {
    if (toolName === 'Edit') {
      const normalized = { ...args };
      if ('path' in normalized && !('file_path' in normalized)) {
        normalized.file_path = normalized.path;
        delete normalized.path;
      }
      if ('oldText' in normalized && !('old_string' in normalized)) {
        normalized.old_string = normalized.oldText;
        delete normalized.oldText;
      }
      if ('newText' in normalized && !('new_string' in normalized)) {
        normalized.new_string = normalized.newText;
        delete normalized.newText;
      }
      return normalized;
    }

    if (toolName === 'Write') {
      const normalized = { ...args };
      if ('path' in normalized && !('file_path' in normalized)) {
        normalized.file_path = normalized.path;
        delete normalized.path;
      }
      return normalized;
    }

    if (toolName === 'Read' || toolName === 'Glob' || toolName === 'Grep') {
      const normalized = { ...args };
      if ('path' in normalized && !('file_path' in normalized)) {
        normalized.file_path = normalized.path;
        delete normalized.path;
      }
      return normalized;
    }

    return args;
  }

  /**
   * Resolve Pi tool name to PascalCase for UI consistency.
   * Pi tools use lowercase names (read, write, edit, bash, grep, find, ls).
   */
  private resolveToolName(rawName: string): string {
    return PI_TOOL_NAME_MAP[rawName] || rawName;
  }

  /**
   * Extract text content from a Pi AgentMessage.
   * Pi messages use the pi-ai Message format with content arrays.
   */
  private extractTextFromMessage(message: unknown): string | null {
    if (!message || typeof message !== 'object') return null;

    const msg = message as {
      role?: string;
      content?: string | Array<{ type: string; text?: string }>;
    };

    if (typeof msg.content === 'string') {
      return msg.content || null;
    }

    if (Array.isArray(msg.content)) {
      const textParts = msg.content
        .filter((c) => c.type === 'text' && c.text)
        .map((c) => c.text!);
      return textParts.length > 0 ? textParts.join('') : null;
    }

    return null;
  }

  /**
   * Extract a string result from Pi tool execution result.
   */
  private extractToolResult(result: unknown, isError: boolean): string {
    if (!result) {
      return isError ? 'Tool execution failed' : 'Success';
    }

    if (typeof result === 'string') return result;

    // Pi tool results follow the AgentToolResult shape: { content: [...], details: ... }
    const typed = result as {
      content?: Array<{ type: string; text?: string }>;
      details?: unknown;
    };

    if (Array.isArray(typed.content)) {
      const texts = typed.content
        .filter((c) => c.type === 'text' && c.text)
        .map((c) => c.text!);
      if (texts.length > 0) return texts.join('\n');
    }

    // Fall back to JSON
    try {
      return JSON.stringify(result);
    } catch {
      return String(result);
    }
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
      case 'Find':
        return 'Search Files';
      case 'Grep':
        return 'Search Content';
      case 'Ls':
        return 'List Directory';
      default:
        return undefined;
    }
  }
}
