/**
 * Event Adapter (App-Server v2 Protocol)
 *
 * Maps Codex app-server v2 notifications to Craft Agent's AgentEvent format.
 * This enables the CodexBackend to emit events compatible with the existing UI.
 *
 * The v2 protocol uses ServerNotification types with structured item/turn events,
 * which provide more granular control than the previous ThreadEvent format.
 */

import type { AgentEvent, AgentEventUsage } from '@craft-agent/core/types';
import { createLogger } from '../../../utils/debug.ts';

import { parseReadCommand, type ReadCommandInfo } from './read-patterns';

/** Max chars for command/MCP tool output before truncation (~25K tokens, matches Claude SDK behavior) */
const MAX_COMMAND_OUTPUT_CHARS = 100_000;

// Import v2 types from generated codex-types
import type {
  ThreadItem,
  ItemStartedNotification,
  ItemCompletedNotification,
  AgentMessageDeltaNotification,
  TurnStartedNotification,
  TurnCompletedNotification,
  TurnPlanUpdatedNotification,
  TurnPlanStep,
  ThreadStartedNotification,
  FileUpdateChange,
  CommandAction,
  // Kept notifications
  ErrorNotification,
  ContextCompactedNotification,
  McpToolCallProgressNotification,
  ConfigWarningNotification,
  WindowsWorldWritableWarningNotification,
} from '@craft-agent/codex-types/v2';

// Simplified notification types for delta events
interface OutputDeltaNotification {
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
}

/**
 * Maps Codex app-server v2 events to AgentEvents for UI compatibility.
 *
 * Event mapping:
 * - thread/started → (internal, thread ID captured in backend)
 * - turn/started → status event
 * - item/started → tool_start (for tool items)
 * - item/agentMessage/delta → text_delta (with turnId)
 * - item/reasoning/textDelta → text_delta (streamed as intermediate thinking)
 * - item/commandExecution/outputDelta → (streaming output, captured for tool_result)
 * - item/completed → tool_result / text_complete (with turnId)
 * - turn/completed → complete with usage
 */
export class EventAdapter {
  private log = createLogger('codex-event');
  private turnIndex: number = 0;
  private itemIndex: number = 0;

  // Track command output for tool results
  private commandOutput: Map<string, string> = new Map();

  // Track commands detected as file reads (for Read tool display)
  private readCommands: Map<string, ReadCommandInfo> = new Map();

  // Track block reasons for declined commands (set by PreToolUse handler)
  private blockReasons: Map<string, string> = new Map();

  // Current turn ID for event correlation
  private currentTurnId: string | null = null;

  /**
   * Store the block reason for a command that will be declined.
   * Called from codex-agent when PreToolUse blocks a command.
   */
  setBlockReason(itemId: string, reason: string): void {
    this.log.warn('Command block reason recorded', { itemId, reason });
    this.blockReasons.set(itemId, reason);
  }

  /**
   * Start a new turn - resets item indexing and streaming state.
   * @param turnId - The turn ID for event correlation
   */
  startTurn(turnId?: string): void {
    this.turnIndex++;
    this.itemIndex = 0;
    this.commandOutput.clear();
    this.readCommands.clear();
    this.blockReasons.clear();
    this.currentTurnId = turnId || null;
    this.log.debug('Turn started', { turnId: this.currentTurnId });
  }

  /**
   * Adapt thread/started notification.
   */
  *adaptThreadStarted(notification: ThreadStartedNotification): Generator<AgentEvent> {
    // Internal event - no UI event emitted, thread ID captured in backend
  }

  /**
   * Adapt turn/started notification.
   */
  *adaptTurnStarted(notification: TurnStartedNotification): Generator<AgentEvent> {
    // Capture turn ID for event correlation
    // Note: No status event emitted - TurnCard shows "Thinking..." automatically
    // via shouldShowThinkingIndicator() based on turn phase
    this.currentTurnId = notification.turn?.id || null;
  }

  /**
   * Adapt turn/completed notification.
   */
  *adaptTurnCompleted(_notification: TurnCompletedNotification): Generator<AgentEvent> {
    // Turn completed - emit complete event
    // Note: Usage tracking is handled by the backend separately
    yield { type: 'complete' };
  }

  /**
   * Adapt turn/plan/updated notification.
   * Converts Codex's native task list to todos_updated events for TurnCard display.
   */
  *adaptTurnPlanUpdated(notification: TurnPlanUpdatedNotification): Generator<AgentEvent> {
    // Guard against null/undefined plan
    const plan = notification.plan ?? [];
    if (plan.length === 0) {
      return; // Skip emitting event for empty plans
    }

    const todos = plan.map((step: TurnPlanStep) => ({
      content: step.step || '',
      status: this.normalizePlanStatus(step.status),
      // For Codex, activeForm is the same as content (no verb-to-ing conversion)
      activeForm: step.status === 'inProgress' ? step.step : undefined,
    }));

    yield {
      type: 'todos_updated',
      todos,
      turnId: notification.turnId,
      explanation: notification.explanation,
    } as AgentEvent;
  }

  /**
   * Normalize Codex plan status to TodoItem status.
   * Codex: "pending" | "inProgress" | "completed"
   * UI:    "pending" | "in_progress" | "completed"
   */
  private normalizePlanStatus(status: string): 'pending' | 'in_progress' | 'completed' {
    switch (status) {
      case 'inProgress':
        return 'in_progress';
      case 'pending':
      case 'completed':
        return status;
      default:
        // Log unexpected status for debugging, default to 'pending'
        console.warn(`[EventAdapter] Unexpected plan status: ${status}, defaulting to 'pending'`);
        return 'pending';
    }
  }

  /**
   * Adapt item/started notification.
   */
  *adaptItemStarted(notification: ItemStartedNotification): Generator<AgentEvent> {
    this.itemIndex++;
    const item = notification.item;

    switch (item.type) {
      case 'commandExecution': {
        // First: Check Codex's built-in commandActions for read classification
        const readAction = item.commandActions.find(
          (a): a is CommandAction & { type: 'read' } => a.type === 'read'
        );

        if (readAction) {
          // Use Codex's classification directly
          const readInfo: ReadCommandInfo = {
            filePath: readAction.path,
            originalCommand: item.command,
          };
          this.readCommands.set(item.id, readInfo);
          yield this.createToolStart(
            item.id,
            'Read',
            { file_path: readAction.path, _command: item.command },
            item.description ?? undefined,
            item.displayName ?? 'Read File',
          );
          break;
        }

        // Fallback: Parse command ourselves for edge cases Codex doesn't classify
        const parsedReadInfo = parseReadCommand(item.command);
        if (parsedReadInfo) {
          this.readCommands.set(item.id, parsedReadInfo);
          yield this.createToolStart(
            item.id,
            'Read',
            {
              file_path: parsedReadInfo.filePath,
              offset: parsedReadInfo.startLine,
              limit: parsedReadInfo.endLine
                ? parsedReadInfo.endLine - (parsedReadInfo.startLine || 1) + 1
                : undefined,
              _command: parsedReadInfo.originalCommand,
            },
            item.description ?? undefined,
            item.displayName ?? 'Read File',
          );
          break;
        }

        // Use LLM-provided displayName from Codex, fall back to commandActions classification
        const displayName = item.displayName ?? this.getCommandDisplayName(item.commandActions);

        yield this.createToolStart(
          item.id,
          'Bash',
          {
            command: item.command,
            cwd: item.cwd,
            description: item.description,
          },
          item.description ?? undefined,  // intent from Codex description (convert null to undefined)
          displayName ?? undefined,       // displayName from LLM or commandActions
        );
        break;
      }

      case 'fileChange':
        yield this.createToolStart(item.id, 'Edit', {
          changes: item.changes,
        });
        break;

      case 'mcpToolCall': {
        // Extract intent/displayName from arguments if available (MCP tools may include these)
        const args = item.arguments as Record<string, unknown>;
        const mcpIntent = typeof args?._intent === 'string' ? args._intent : undefined;
        const mcpDisplayName = typeof args?._displayName === 'string' ? args._displayName : undefined;
        yield this.createToolStart(
          item.id,
          `mcp__${item.server}__${item.tool}`,
          args,
          mcpIntent,
          mcpDisplayName,
        );
        break;
      }

      case 'webSearch':
        yield this.createToolStart(
          item.id,
          'WebSearch',
          { query: item.query },
          `Searching for: ${item.query}`,
          'Web Search',
        );
        break;

      case 'imageView':
        yield this.createToolStart(
          item.id,
          'ImageView',
          { path: item.path },
          `Viewing image: ${item.path}`,
          'View Image',
        );
        break;

      case 'collabAgentToolCall':
        // Collaborative agent tool call (multi-agent orchestration)
        yield this.createToolStart(item.id, `CollabAgent:${item.tool}`, {
          tool: item.tool,
          prompt: item.prompt,
          senderThreadId: item.senderThreadId,
        });
        break;

      // User messages and reasoning don't emit tool_start
      case 'userMessage':
      case 'reasoning':
      case 'agentMessage':
        break;

      // Review mode transitions are status events
      case 'enteredReviewMode':
        yield { type: 'status', message: `Entered review mode: ${item.review}` };
        break;

      case 'exitedReviewMode':
        yield { type: 'status', message: `Exited review mode: ${item.review}` };
        break;

      default:
        // Log unknown types for debugging instead of silent drop
        console.warn(`[EventAdapter] Unknown item type in started: ${(item as { type: string }).type}`);
        break;
    }
  }

  /**
   * Adapt item/agentMessage/delta notification - streaming text.
   */
  *adaptAgentMessageDelta(notification: AgentMessageDeltaNotification): Generator<AgentEvent> {
    const delta = notification.delta;
    if (delta) {
      yield {
        type: 'text_delta',
        text: delta,
        turnId: this.currentTurnId || undefined,
      };
    }
  }

  /**
   * Adapt item/reasoning/textDelta notification - streaming thinking.
   * Streams reasoning as intermediate text_delta events for real-time visibility.
   */
  *adaptReasoningDelta(notification: OutputDeltaNotification): Generator<AgentEvent> {
    const { delta } = notification;
    if (delta) {
      // Stream reasoning as intermediate text for real-time thinking visibility
      // The UI should render these with appropriate styling (e.g., italics, collapsible)
      yield {
        type: 'text_delta',
        text: delta,
        turnId: this.currentTurnId || undefined,
        // Note: isIntermediate is set on text_complete, deltas are always partial
      };
    }
  }

  /**
   * Adapt item/commandExecution/outputDelta - accumulate for tool result.
   * Caps accumulation at MAX_COMMAND_OUTPUT_CHARS to prevent OOM from unbounded growth
   * (e.g., rg matching inside large session JSONL files).
   */
  adaptCommandOutputDelta(notification: OutputDeltaNotification): void {
    const { itemId, delta } = notification;
    const current = this.commandOutput.get(itemId) || '';
    // Stop accumulating once we've hit the limit — further deltas are silently dropped.
    // The truncation message is added in createCommandResult when the result is emitted.
    if (current.length >= MAX_COMMAND_OUTPUT_CHARS) return;
    const next = current + delta;
    this.commandOutput.set(itemId, next.length > MAX_COMMAND_OUTPUT_CHARS
      ? next.slice(0, MAX_COMMAND_OUTPUT_CHARS)
      : next);
  }

  /**
   * Adapt item/completed notification.
   */
  *adaptItemCompleted(notification: ItemCompletedNotification): Generator<AgentEvent> {
    const item = notification.item;

    switch (item.type) {
      case 'commandExecution':
        yield this.createCommandResult(item);
        break;

      case 'fileChange':
        yield this.createFileChangeResult(item);
        break;

      case 'mcpToolCall':
        yield this.createMcpResult(item);
        break;

      case 'agentMessage':
        yield this.createTextCompleteEvent(item);
        break;

      case 'reasoning':
        // Reasoning is emitted as intermediate text_complete
        yield this.createReasoningEvent(item);
        break;

      case 'webSearch':
        // Surface actual search results to the UI
        yield this.createWebSearchResult(item);
        break;

      case 'imageView':
        yield {
          type: 'tool_result',
          toolUseId: item.id,
          toolName: 'ImageView',
          result: `Viewed image: ${item.path}`,
          isError: false,
          turnId: this.currentTurnId || undefined,
        };
        break;

      case 'collabAgentToolCall':
        yield {
          type: 'tool_result',
          toolUseId: item.id,
          toolName: `CollabAgent:${item.tool}`,
          result: item.status === 'completed' ? 'Collaborative task completed' : `Status: ${item.status}`,
          isError: item.status === 'failed',
          turnId: this.currentTurnId || undefined,
        };
        break;

      case 'userMessage':
        // User messages don't need completion events
        break;

      case 'enteredReviewMode':
      case 'exitedReviewMode':
        // Review mode transitions already handled in started
        break;

      default:
        // Log unknown types for debugging instead of silent drop
        console.warn(`[EventAdapter] Unknown item type in completed: ${(item as { type: string }).type}`);
        break;
    }
  }

  /**
   * Create a tool_start event.
   */
  private createToolStart(
    id: string,
    toolName: string,
    input: Record<string, unknown>,
    intent?: string,
    displayName?: string,
  ): AgentEvent {
    return {
      type: 'tool_start',
      toolName,
      toolUseId: id,
      input,
      intent,
      displayName,
      turnId: this.currentTurnId || undefined,
    };
  }

  /**
   * Derive a semantic display name from Codex commandActions.
   * Maps command action types to human-readable names.
   */
  private getCommandDisplayName(commandActions: CommandAction[]): string | undefined {
    const firstAction = commandActions[0];
    if (!firstAction) return undefined;

    switch (firstAction.type) {
      case 'read':
        return 'Read File';
      case 'listFiles':
        return 'List Files';
      case 'search':
        return 'Search';
      default:
        return undefined; // Keep as "Bash" for unknown actions
    }
  }

  /**
   * Create tool result for command execution.
   * If the command was detected as a file read, emits as Read tool result.
   */
  private createCommandResult(item: ThreadItem & { type: 'commandExecution' }): AgentEvent {
    // Handle declined status explicitly (command was blocked by permission policy)
    const isDeclined = item.status === 'declined';
    // Fix: use != null to properly handle null exitCode (null !== undefined is true!)
    const isError =
      item.status === 'failed' || isDeclined || (item.exitCode != null && item.exitCode !== 0);

    // Use accumulated output from deltas, or fallback to item output
    const rawOutput = this.commandOutput.get(item.id) || item.aggregatedOutput || '';
    this.commandOutput.delete(item.id); // Clean up accumulated deltas

    // Truncate massive output to prevent OOM (e.g., rg matching inside session JSONL files)
    const output = rawOutput.length > MAX_COMMAND_OUTPUT_CHARS
      ? rawOutput.slice(0, MAX_COMMAND_OUTPUT_CHARS) +
        `\n\n[Output truncated: ${rawOutput.length.toLocaleString()} chars total, showing first ${MAX_COMMAND_OUTPUT_CHARS.toLocaleString()}]`
      : rawOutput;

    // Get stored block reason if available (set by PreToolUse handler)
    const blockReason = this.blockReasons.get(item.id);
    if (blockReason) {
      this.blockReasons.delete(item.id); // Clean up
    }

    if (isDeclined) {
      this.log.warn('Command declined by permission policy', {
        itemId: item.id,
        command: item.command,
        status: item.status,
        exitCode: item.exitCode,
        blockReason,
        output: output ? '[output present]' : '',
      });
    }

    // Determine appropriate result message
    const getResultMessage = (isRead: boolean): string => {
      if (output) return output;
      if (isDeclined && blockReason) return blockReason;
      if (isDeclined) return 'Command blocked by permission policy';
      if (isError && item.exitCode != null) return `Exit code: ${item.exitCode}`;
      if (isError) return 'Command failed';
      return isRead ? '' : 'Success';
    };

    // Check if this was detected as a file read
    const readInfo = this.readCommands.get(item.id);
    if (readInfo) {
      this.readCommands.delete(item.id);
      return {
        type: 'tool_result',
        toolUseId: item.id,
        toolName: 'Read',
        result: getResultMessage(true),
        isError,
        turnId: this.currentTurnId || undefined,
      };
    }

    return {
      type: 'tool_result',
      toolUseId: item.id,
      toolName: 'Bash',
      result: getResultMessage(false),
      isError,
      turnId: this.currentTurnId || undefined,
    };
  }

  /**
   * Create tool result for file changes.
   */
  private createFileChangeResult(item: ThreadItem & { type: 'fileChange' }): AgentEvent {
    const isError = item.status === 'failed';
    const summary = item.changes.map((c: FileUpdateChange) => `${c.kind.type}: ${c.path}`).join('\n');

    return {
      type: 'tool_result',
      toolUseId: item.id,
      toolName: 'Edit',
      result: isError ? `Patch failed:\n${summary}` : `Applied:\n${summary}`,
      isError,
      turnId: this.currentTurnId || undefined,
    };
  }

  /**
   * Create tool result for MCP tool calls.
   */
  private createMcpResult(item: ThreadItem & { type: 'mcpToolCall' }): AgentEvent {
    const isError = item.status === 'failed' || item.error != null;
    let result: string;

    if (item.error) {
      result = item.error.message;
    } else if (item.result) {
      // Extract text from MCP result
      // The v2 McpToolCallResult has a different structure
      const rawResult = typeof item.result === 'string' ? item.result : JSON.stringify(item.result);
      // Truncate massive MCP results to prevent OOM
      result = rawResult.length > MAX_COMMAND_OUTPUT_CHARS
        ? rawResult.slice(0, MAX_COMMAND_OUTPUT_CHARS) +
          `\n\n[Output truncated: ${rawResult.length.toLocaleString()} chars total, showing first ${MAX_COMMAND_OUTPUT_CHARS.toLocaleString()}]`
        : rawResult;
    } else {
      result = 'Success';
    }

    return {
      type: 'tool_result',
      toolUseId: item.id,
      toolName: `mcp__${item.server}__${item.tool}`,
      result,
      isError,
      turnId: this.currentTurnId || undefined,
    };
  }

  /**
   * Create tool result for web search with actual results.
   */
  private createWebSearchResult(item: ThreadItem & { type: 'webSearch' }): AgentEvent {
    // WebSearch items currently only have `query` - the actual results would need
    // to come from a different field if Codex provides them. For now, we indicate
    // the search was performed. Once Codex exposes results, update this.
    // TODO: Extract actual results when Codex provides them in the item
    const result = `Web search completed for: "${item.query}"`;

    return {
      type: 'tool_result',
      toolUseId: item.id,
      toolName: 'WebSearch',
      result,
      isError: false,
      turnId: this.currentTurnId || undefined,
    };
  }

  /**
   * Create text_complete event for agent message.
   */
  private createTextCompleteEvent(item: ThreadItem & { type: 'agentMessage' }): AgentEvent {
    return {
      type: 'text_complete',
      text: item.text,
      turnId: this.currentTurnId || undefined,
    };
  }

  /**
   * Create text_complete event for reasoning (marked as intermediate).
   */
  private createReasoningEvent(item: ThreadItem & { type: 'reasoning' }): AgentEvent {
    // v2 reasoning has summary array instead of single text
    const text = item.summary?.join('\n') || item.content?.join('\n') || '';
    return {
      type: 'text_complete',
      text,
      isIntermediate: true,
      turnId: this.currentTurnId || undefined,
    };
  }

  // ============================================================
  // Phase 1: Extended Protocol Coverage (using existing UI patterns)
  // ============================================================

  /**
   * Adapt error notification to AgentEvent.
   * Surfaces Codex server errors to the UI.
   */
  *adaptError(notification: ErrorNotification): Generator<AgentEvent> {
    // ErrorNotification has { error: TurnError, ... } where TurnError has { message: string, ... }
    const errorMessage = notification.error?.message || 'An error occurred';
    yield {
      type: 'error',
      message: errorMessage,
    };
  }

  /**
   * Adapt context compacted notification.
   * Shows status message when Codex auto-compacts context.
   */
  *adaptContextCompacted(_notification: ContextCompactedNotification): Generator<AgentEvent> {
    yield {
      type: 'status',
      message: 'Context compacted to fit within limits',
    };
  }

  /**
   * Adapt MCP tool call progress notification.
   * Shows progress for long-running MCP operations.
   */
  *adaptMcpToolCallProgress(notification: McpToolCallProgressNotification): Generator<AgentEvent> {
    if (notification.message) {
      yield {
        type: 'status',
        message: notification.message,
      };
    }
  }

  /**
   * Adapt config warning notification.
   * Shows info message about configuration issues.
   */
  *adaptConfigWarning(notification: ConfigWarningNotification): Generator<AgentEvent> {
    yield {
      type: 'info',
      message: `Config warning: ${notification.summary || 'Configuration issue'}`,
    };
  }

  /**
   * Adapt Windows world-writable warning notification.
   * Shows info message about security concerns.
   */
  *adaptWindowsWarning(notification: WindowsWorldWritableWarningNotification): Generator<AgentEvent> {
    const paths = notification.samplePaths.slice(0, 3).join(', ');
    const extra = notification.extraCount > 0 ? ` (+${notification.extraCount} more)` : '';
    yield {
      type: 'info',
      message: `Security: World-writable paths found: ${paths}${extra}`,
    };
  }
}
