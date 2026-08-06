/**
 * Stateless tool matching for SDK message → AgentEvent conversion.
 *
 * This module extracts tool_start and tool_result events from SDK message
 * content blocks using DIRECT ID matching instead of FIFO queues.
 *
 * Key principle: Every output is derived from the current message + an
 * append-only tool index. No mutable queues, stacks, or order-dependent state.
 *
 * The SDK provides:
 * - `parent_tool_use_id` on every message — identifies the subagent context (Task ID or null)
 * - `tool_use_id` on each tool_result content block — directly identifies which tool the result is for
 *
 * Together these eliminate the need for FIFO matching, parent stacks, and orphan recovery.
 */

import type { AgentEvent } from '@craft-agent/core/types';
import { toolMetadataStore } from '../interceptor-common.ts';
import { createLogger } from '../utils/debug.ts';
import { isParentTaskTool } from '../utils/toolNames.ts';

const log = createLogger('tool-matching');

// Re-export from browser-safe module (no Node deps) for backward compatibility
export { PARENT_TASK_TOOLS, isParentTaskTool } from '../utils/toolNames.ts';

/**
 * Parse the workflow run id (`wf_...`) from a subagent transcript path (or any
 * string containing one). Workflow sub-agent transcripts live under
 * `.../subagents/workflows/<wf_id>/agent-<id>.jsonl`, so this both (a) extracts
 * the id from the Workflow tool result's "Transcript dir:" line and (b) attributes
 * a SubagentStop's transcript path to the owning workflow. Returns null for
 * non-workflow paths (ordinary sub-agents live under `.../subagents/agent-*`).
 */
export function parseWorkflowIdFromTranscriptPath(path: string | undefined): string | null {
  if (!path) return null;
  // The id charset [A-Za-z0-9_-] naturally bounds the match (it stops at `/`,
  // `.`, whitespace or newline), so no explicit terminator is needed — and adding
  // one breaks the "Transcript dir:" tail case where the id is followed by \n.
  const m = path.match(/\/workflows\/(wf_[A-Za-z0-9_-]+)/);
  return m?.[1] ?? null;
}

// ============================================================================
// Tool Index — append-only, order-independent lookup
// ============================================================================

export interface ToolEntry {
  name: string;
  input: Record<string, unknown>;
}

/**
 * Append-only index of tool metadata, built from tool_start events.
 * Order-independent: inserting A then B = inserting B then A.
 * Used to look up tool name/input when processing tool_result blocks
 * (which carry tool_use_id but not tool_name).
 */
export class ToolIndex {
  private entries = new Map<string, ToolEntry>();

  /** Register a tool (idempotent — same ID always maps to same entry) */
  register(toolUseId: string, name: string, input: Record<string, unknown>): void {
    // Update input if we now have more complete data (stream events start with empty input)
    const existing = this.entries.get(toolUseId);
    if (existing && Object.keys(existing.input).length === 0 && Object.keys(input).length > 0) {
      this.entries.set(toolUseId, { name, input });
    } else if (!existing) {
      this.entries.set(toolUseId, { name, input });
    }
  }

  getName(toolUseId: string): string | undefined {
    return this.entries.get(toolUseId)?.name;
  }

  getInput(toolUseId: string): Record<string, unknown> | undefined {
    return this.entries.get(toolUseId)?.input;
  }

  getEntry(toolUseId: string): ToolEntry | undefined {
    return this.entries.get(toolUseId);
  }

  has(toolUseId: string): boolean {
    return this.entries.has(toolUseId);
  }

  get size(): number {
    return this.entries.size;
  }
}

// ============================================================================
// Content block types (subset of Anthropic SDK types we need)
// ============================================================================

/** Represents a tool_use content block from an assistant message */
export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** Represents a tool_result content block from a user message */
export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content?: unknown;
  is_error?: boolean;
}

/** Represents a text content block */
export interface TextBlock {
  type: 'text';
  text: string;
}

/** Union of content blocks we handle */
export type ContentBlock = ToolUseBlock | ToolResultBlock | TextBlock | { type: string };

// ============================================================================
// Pure extraction functions
// ============================================================================

/** Strip internal metadata fields (_displayName, _intent) from tool input */
function stripInternalFields(input: unknown): Record<string, unknown> {
  const { _displayName, _intent, ...clean } = input as Record<string, unknown>;
  return clean;
}

/**
 * Extract tool_start events from assistant message content blocks.
 *
 * Each tool_use block in the content becomes a tool_start event.
 * Parent assignment comes directly from the SDK's parent_tool_use_id field
 * on the message — no stacks or FIFO needed.
 *
 * Fallback: When SDK's parent_tool_use_id is null AND exactly one Task is active,
 * we assign that Task as the parent. This handles cases where the SDK doesn't
 * provide parent info for subagent child tools.
 *
 * @param contentBlocks - Content blocks from SDKAssistantMessage.message.content
 * @param sdkParentToolUseId - parent_tool_use_id from the SDK message (null = top-level)
 * @param toolIndex - Append-only index to register new tools in
 * @param emittedToolStartIds - Set of tool IDs already emitted (for stream/assistant dedup)
 * @param turnId - Current turn correlation ID
 * @param activeParentTools - Set of currently active Task tool IDs (for fallback parent assignment)
 * @param sessionDir - Session directory for reading tool metadata (prevents race when concurrent sessions clobber singleton)
 * @returns Array of tool_start AgentEvents
 */
export function extractToolStarts(
  contentBlocks: ContentBlock[],
  sdkParentToolUseId: string | null,
  toolIndex: ToolIndex,
  emittedToolStartIds: Set<string>,
  turnId?: string,
  activeParentTools?: Set<string>,
  sessionDir?: string,
): AgentEvent[] {
  const events: AgentEvent[] = [];

  for (const block of contentBlocks) {
    if (block.type !== 'tool_use') continue;
    const toolBlock = block as ToolUseBlock;

    // Register in index (idempotent — handles both stream and assistant events)
    toolIndex.register(toolBlock.id, toolBlock.name, toolBlock.input);

    // Determine parent: SDK's parent_tool_use_id is authoritative when present.
    // Fallback: if SDK provides null AND exactly one Task is active, use that Task.
    // This handles subagent child tools when SDK doesn't provide parent info.
    let parentToolUseId: string | undefined;
    if (sdkParentToolUseId) {
      // SDK provided explicit parent — use it
      parentToolUseId = sdkParentToolUseId;
    } else if (activeParentTools && activeParentTools.size === 1) {
      // Fallback: exactly one active Task, assign it as parent for child tools.
      // We can't safely assign when multiple Tasks are active (ambiguous).
      // Don't assign if this tool IS the Task (would create self-reference).
      const [singleActiveParent] = activeParentTools;
      if (toolBlock.id !== singleActiveParent) {
        parentToolUseId = singleActiveParent;
      }
    }

    // Dedup: stream_event arrives before assistant message, both have the same tool_use block.
    // The Set is append-only and order-independent (same ID always deduplicates the same way).
    if (emittedToolStartIds.has(toolBlock.id)) {
      // Already emitted via stream — re-emit only when we have newly useful data.
      // 1) Complete input arrived on assistant message (stream starts with {})
      // 2) Metadata became available later in toolMetadataStore (race-safe)
      const hasNewInput = Object.keys(toolBlock.input).length > 0;
      const { intent, displayName } = extractToolMetadata(toolBlock, sessionDir);
      const hasMetadataUpdate = !!intent || !!displayName;
      if (hasNewInput || hasMetadataUpdate) {
        events.push({
          type: 'tool_start',
          toolName: toolBlock.name,
          toolUseId: toolBlock.id,
          input: stripInternalFields(toolBlock.input),
          intent,
          displayName,
          turnId,
          parentToolUseId,
        });
      }
      continue;
    }

    emittedToolStartIds.add(toolBlock.id);

    const { intent, displayName } = extractToolMetadata(toolBlock, sessionDir);

    events.push({
      type: 'tool_start',
      toolName: toolBlock.name,
      toolUseId: toolBlock.id,
      input: stripInternalFields(toolBlock.input),
      intent,
      displayName,
      turnId,
      parentToolUseId,
    });
  }

  return events;
}

/**
 * Extract tool_result events from user message content blocks.
 *
 * Each tool_result content block carries an explicit `tool_use_id` that
 * directly identifies which tool the result belongs to. No FIFO matching needed.
 *
 * Falls back to the convenience field `tool_use_result` + `parent_tool_use_id`
 * when content blocks don't contain tool_result entries (e.g., some MCP tools).
 *
 * @param contentBlocks - Content blocks from SDKUserMessage.message.content (may be empty)
 * @param sdkParentToolUseId - parent_tool_use_id from the SDK message
 * @param toolUseResultValue - Convenience field tool_use_result from SDK message
 * @param toolIndex - Read-only lookup for tool name/input
 * @param turnId - Current turn correlation ID
 * @returns Array of tool_result AgentEvents (and background task events)
 */
export function extractToolResults(
  contentBlocks: ContentBlock[],
  sdkParentToolUseId: string | null,
  toolUseResultValue: unknown,
  toolIndex: ToolIndex,
  turnId?: string,
): AgentEvent[] {
  const events: AgentEvent[] = [];

  // Primary path: extract tool_use_id directly from content blocks
  const toolResultBlocks = contentBlocks.filter(
    (b): b is ToolResultBlock => b.type === 'tool_result'
  );

  if (toolResultBlocks.length > 0) {
    // Direct ID matching — each block explicitly identifies its tool
    for (const block of toolResultBlocks) {
      const toolUseId = block.tool_use_id;
      const entry = toolIndex.getEntry(toolUseId);

      const resultStr = serializeResult(block.content);
      const isError = block.is_error ?? isToolResultError(block.content);

      events.push({
        type: 'tool_result',
        toolUseId,
        toolName: entry?.name,
        result: resultStr,
        isError,
        input: entry?.input,
        turnId,
        parentToolUseId: sdkParentToolUseId ?? undefined,
      });

      // Detect background tasks/shells from results
      if (entry) {
        const bgEvents = detectBackgroundEvents(toolUseId, entry, resultStr, isError, turnId);
        events.push(...bgEvents);
      }
    }
  } else if (toolUseResultValue !== undefined) {
    // Fallback: use convenience fields when content blocks are unavailable.
    // This handles edge cases like in-process MCP tools that don't provide
    // tool_result content blocks.
    //
    // When sdkParentToolUseId is set, it points to the tool's own ID (for
    // regular tools using the convenience API) — so we use it as toolUseId.
    // When null (top-level tools without content blocks), we generate a
    // synthetic ID so the result isn't silently dropped.
    //
    // parentToolUseId is intentionally set to undefined here because in the
    // fallback path we only have one ID — using it as BOTH toolUseId and
    // parentToolUseId would create a self-referencing loop. The safe default
    // is to treat the tool as top-level when parent is ambiguous.
    const toolUseId = sdkParentToolUseId ?? `fallback-${turnId ?? 'unknown'}`;
    const entry = toolIndex.getEntry(toolUseId);

    const resultStr = serializeResult(toolUseResultValue);
    const isError = isToolResultError(toolUseResultValue);

    events.push({
      type: 'tool_result',
      toolUseId,
      toolName: entry?.name,
      result: resultStr,
      isError,
      input: entry?.input,
      turnId,
      parentToolUseId: undefined,
    });

    if (entry) {
      const bgEvents = detectBackgroundEvents(toolUseId, entry, resultStr, isError, turnId);
      events.push(...bgEvents);
    }
  }

  return events;
}

// ============================================================================
// Helpers (pure)
// ============================================================================

/**
 * Extract intent and displayName metadata for a tool call.
 *
 * Sources (checked in priority order):
 * 1. toolMetadataStore — populated by the SSE stripping stream in unified-network-interceptor.ts
 * 2. toolBlock.input._intent / _displayName — fallback for Codex backend or if SSE interception didn't run
 * 3. Bash description field — fallback for intent on Bash tools
 */
function extractToolMetadata(toolBlock: ToolUseBlock, sessionDir?: string): { intent?: string; displayName?: string } {
  // 1. Check the metadata store first (populated by SSE interceptor)
  // Pass sessionDir to ensure we read from the correct session's file even when
  // the singleton _sessionDir has been clobbered by a concurrent session.
  const idCandidates = new Set<string>([toolBlock.id]);
  if (toolBlock.id.includes('|')) {
    const [base] = toolBlock.id.split('|');
    if (base) idCandidates.add(base);
  }

  for (const candidate of idCandidates) {
    const stored = toolMetadataStore.get(candidate, sessionDir);
    if (!stored) continue;

    let intent = stored.intent;
    const displayName = stored.displayName;

    // Bash description fallback for intent
    if (!intent && toolBlock.name === 'Bash') {
      intent = (toolBlock.input as { description?: string }).description;
    }

    return { intent, displayName };
  }

  // Log when metadata store misses — helps diagnose cross-process sync issues
  const argsHasIntent = typeof toolBlock.input._intent === 'string';
  const argsHasDisplayName = typeof toolBlock.input._displayName === 'string';
  log.debug(
    `extractToolMetadata: store miss for ${toolBlock.name} (${toolBlock.id}); candidates=${Array.from(idCandidates).join(' -> ')}; argsIntent=${argsHasIntent}; argsDisplayName=${argsHasDisplayName}`,
  );

  // 2. Fallback: read directly from tool input (Codex backend, non-streaming, etc.)
  let intent = toolBlock.input._intent as string | undefined;
  const displayName = toolBlock.input._displayName as string | undefined;

  // 3. Bash description fallback for intent
  if (!intent && toolBlock.name === 'Bash') {
    intent = (toolBlock.input as { description?: string }).description;
  }

  return { intent, displayName };
}

/** Serialize a tool result value to string, handling circular references */
export function serializeResult(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '[Result contains non-serializable data]';
  }
}

/** Check if a tool result indicates an error */
export function isToolResultError(result: unknown): boolean {
  if (typeof result === 'string') {
    // Check for common error patterns
    return /^\s*(\[ERROR\]|Error:|error:)/.test(result);
  }
  if (result && typeof result === 'object') {
    // Check for error flag in result object
    if ('is_error' in result && (result as { is_error: boolean }).is_error) return true;
    if ('error' in result) return true;
  }
  return false;
}

/** Detect background task/shell events from tool results */
function detectBackgroundEvents(
  toolUseId: string,
  entry: ToolEntry,
  resultStr: string,
  isError: boolean,
  turnId?: string,
): AgentEvent[] {
  const events: AgentEvent[] = [];

  // Background Task detection — Task/Agent tool with agentId in result.
  //
  // Two launch shapes both produce a real background agent:
  //  1. Explicit `run_in_background: true` in the tool input.
  //  2. Async-by-default: the SDK backgrounds the Agent/Task automatically and
  //     returns a launch acknowledgement WITHOUT the caller ever setting
  //     `run_in_background`. That result has a distinctive signature — an
  //     `agentId:` plus "working in the background" / `output_file:` /
  //     "Async agent launched" — which lets us detect it safely.
  //
  // The signature requirement is what prevents false positives: a *foreground*
  // Agent whose result text merely mentions "agentId:" (e.g. quoting a value it
  // found) has neither the background phrasing nor an output_file, so it is not
  // marked backgrounded. This mirrors the renderer's signature check in
  // App.tsx (`isBackgroundingResult`). For both shapes a real task_completed
  // notification eventually arrives; the WS3 registry + turn-end orphan backstop
  // cover the case where it does not.
  const wasRunInBackground = entry.input?.run_in_background === true;
  const looksAsyncLaunched =
    /agentId:\s*[a-zA-Z0-9_-]+/.test(resultStr) &&
    (/working in the background/i.test(resultStr) ||
      /output_file:/i.test(resultStr) ||
      /async agent launched/i.test(resultStr));
  if (isParentTaskTool(entry.name) && (wasRunInBackground || looksAsyncLaunched) && !isError && resultStr) {
    const agentIdMatch = resultStr.match(/agentId:\s*([a-zA-Z0-9_-]+)/);
    if (agentIdMatch?.[1]) {
      // Prefer explicit `_intent` metadata; the built-in Agent/Task tool doesn't
      // set it, so fall back to its concise `description` param (the "3-5 word
      // description of the task") — this is what the chip shows instead of the
      // opaque agent ID. Mirrors the Bash background-shell path below.
      const intentValue = (typeof entry.input._intent === 'string' && entry.input._intent)
        || (typeof entry.input.description === 'string' && entry.input.description)
        || undefined;
      events.push({
        type: 'task_backgrounded',
        toolUseId,
        taskId: agentIdMatch[1],
        turnId,
        ...(intentValue && { intent: intentValue }),
      });
    }
  }

  // Background Shell detection — Bash tool with shell_id or backgroundTaskId
  if (entry.name === 'Bash' && !isError && resultStr) {
    const shellIdMatch = resultStr.match(/shell_id:\s*([a-zA-Z0-9_-]+)/)
      || resultStr.match(/"backgroundTaskId":\s*"([a-zA-Z0-9_-]+)"/);
    if (shellIdMatch?.[1]) {
      const intentValue = (typeof entry.input._intent === 'string' && entry.input._intent)
        || (typeof entry.input.description === 'string' && entry.input.description)
        || undefined;
      const commandValue = typeof entry.input.command === 'string' ? entry.input.command : undefined;
      events.push({
        type: 'shell_backgrounded',
        toolUseId,
        shellId: shellIdMatch[1],
        turnId,
        ...(intentValue && { intent: intentValue }),
        ...(commandValue && { command: commandValue }),
      });
    }
  }

  // Background Workflow detection — the Workflow tool always launches in the
  // background and returns immediately. Its result has a distinct signature:
  //   "Workflow launched in background. Task ID: <id>\nSummary: <...>\nTranscript
  //    dir: .../workflows/wf_XXX"
  // It is NOT a parent-task tool and its result lacks the async-agent signature
  // (agentId/output_file), so it needs its own detector. We surface it as a
  // background task with kind 'workflow' + the workflow run id (wf_XXX, parsed
  // from the transcript dir) so SubagentStop events can attribute completed
  // agents to this chip (see parseWorkflowIdFromTranscriptPath).
  if (entry.name === 'Workflow' && !isError && resultStr) {
    const taskIdMatch = resultStr.match(/Workflow launched in background\.?\s*Task ID:\s*(\S+)/i);
    if (taskIdMatch?.[1]) {
      const summaryMatch = resultStr.match(/Summary:\s*(.+)/);
      const workflowId = parseWorkflowIdFromTranscriptPath(resultStr);
      const intentValue = (typeof entry.input._intent === 'string' && entry.input._intent)
        || (summaryMatch?.[1]?.trim())
        || undefined;
      events.push({
        type: 'task_backgrounded',
        toolUseId,
        taskId: taskIdMatch[1],
        turnId,
        kind: 'workflow',
        ...(intentValue && { intent: intentValue }),
        ...(workflowId && { workflowId }),
      });
    }
  }

  // Shell killed detection — KillShell tool
  if (entry.name === 'KillShell') {
    const shellId = entry.input.shell_id as string;
    if (shellId) {
      events.push({
        type: 'shell_killed',
        shellId,
        turnId,
      });
    }
  }

  return events;
}
