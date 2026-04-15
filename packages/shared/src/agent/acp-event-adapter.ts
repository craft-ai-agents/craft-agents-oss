/**
 * ACP Event Adapter
 *
 * Converts ACP session/update payloads into AgentEvent[] streams.
 * Pure static-method adapter — no state, no side effects.
 *
 * Handles two ACP wire formats:
 *
 * 1. Standard ACP (e.g. claude-agent-acp):
 *    { status: "running"|"completed"|"error"|"cancelled", content: AcpContent[] }
 *    Completion is signalled by status === "completed".
 *
 * 2. Cursor ACP:
 *    { sessionUpdate: "agent_message_chunk", content: AcpContent }  (single object)
 *    Completion is signalled by the session/prompt response { stopReason: "end_turn" }
 *    (handled in AcpAgent.chatImpl — adapter only produces content events here).
 *
 * Mapping rules:
 *
 * content.type | condition              | produces
 * -------------|------------------------|------------------
 * text         | is_final !== true      | text_delta
 * text         | is_final === true      | text_complete
 * tool_call    | no result field        | tool_start
 * tool_call    | has result field       | tool_result
 * embedded_resource | —                 | info
 * diff         | —                     | tool_start + tool_result
 * <unknown>    | —                     | info (placeholder)
 * status=completed  | —                | complete
 * status=error      | —                | typed_error
 * status=cancelled  | —                | complete (no error)
 */

import type { AgentEvent } from '@craft-agent/core/types';
import { parseError } from './errors.ts';

// ============================================================
// ACP Protocol Types (incoming)
// ============================================================

interface AcpTextContent {
  type: 'text';
  text: string;
  is_final?: boolean;
}

interface AcpToolCallContent {
  type: 'tool_call';
  id: string;
  name: string;
  input: Record<string, unknown>;
  result?: string;
  is_error?: boolean;
}

interface AcpEmbeddedResourceContent {
  type: 'embedded_resource';
  name: string;
  resource_type: string;
}

interface AcpDiffContent {
  type: 'diff';
  path: string;
  diff: string;
}

interface AcpUnknownContent {
  type: string;
  [key: string]: unknown;
}

type AcpContent =
  | AcpTextContent
  | AcpToolCallContent
  | AcpEmbeddedResourceContent
  | AcpDiffContent
  | AcpUnknownContent;

export interface AcpSessionUpdate {
  // Standard ACP format (e.g. claude-agent-acp)
  status?: 'running' | 'completed' | 'error' | 'cancelled' | string;
  // Cursor ACP format — discriminator field
  sessionUpdate?: string;
  // content is an array in standard ACP, a single object in Cursor ACP
  content?: AcpContent | AcpContent[];
  error?: { message?: string };
  usage?: { input_tokens?: number; output_tokens?: number };
}

// ============================================================
// AcpEventAdapter
// ============================================================

export class AcpEventAdapter {
  /**
   * Convert one ACP session/update payload into zero or more AgentEvents.
   *
   * @param update - The raw ACP session update object
   * @returns Array of AgentEvent (may be empty for ignored updates)
   */
  static adapt(update: AcpSessionUpdate): AgentEvent[] {
    const events: AgentEvent[] = [];

    // ── Cursor ACP format (sessionUpdate discriminator) ──────────────────────
    // Cursor uses { sessionUpdate: "agent_message_chunk", content: <single object> }
    // instead of the standard { status, content: <array> } format.
    if (update.sessionUpdate !== undefined) {
      switch (update.sessionUpdate) {
        case 'agent_message_chunk': {
          // content is a single AcpContent object (not an array)
          if (update.content && !Array.isArray(update.content)) {
            events.push(...AcpEventAdapter._adaptContent(update.content as AcpContent));
          }
          break;
        }
        // Other Cursor-specific updates (available_commands_update, turn_complete, etc.)
        // are informational — produce no AgentEvents
        default:
          break;
      }
      return events;
    }

    // ── Standard ACP format (status discriminator) ───────────────────────────
    switch (update.status) {
      case 'completed': {
        // Process content first — some ACP servers (e.g. Claude Code) send the
        // final text chunk in the same notification as status="completed".
        const completedContent = Array.isArray(update.content)
          ? update.content
          : update.content
            ? [update.content as AcpContent]
            : [];
        for (const item of completedContent) {
          events.push(...AcpEventAdapter._adaptContent(item));
        }
        const usage = update.usage
          ? {
              inputTokens: update.usage.input_tokens ?? 0,
              outputTokens: update.usage.output_tokens ?? 0,
            }
          : undefined;
        events.push({ type: 'complete', usage });
        return events;
      }
      case 'error': {
        const errMsg = update.error?.message ?? 'ACP agent error';
        const typedError = parseError(new Error(errMsg));
        events.push({ type: 'typed_error', error: typedError });
        return events;
      }
      case 'cancelled': {
        events.push({ type: 'complete' });
        return events;
      }
    }

    // Content-level events (status === 'running' or other streaming status)
    // Normalise: standard ACP sends content as an array, guard against single object
    const contentItems = Array.isArray(update.content)
      ? update.content
      : update.content
        ? [update.content as AcpContent]
        : [];
    for (const item of contentItems) {
      events.push(...AcpEventAdapter._adaptContent(item));
    }

    return events;
  }

  private static _adaptContent(item: AcpContent): AgentEvent[] {
    switch (item.type) {
      case 'text': {
        const text = (item as AcpTextContent).text;
        if ((item as AcpTextContent).is_final === true) {
          return [{ type: 'text_complete', text }];
        }
        return [{ type: 'text_delta', text }];
      }

      case 'tool_call': {
        const tc = item as AcpToolCallContent;
        if ('result' in tc) {
          return [{
            type: 'tool_result',
            toolUseId: tc.id,
            toolName: tc.name,
            result: tc.result ?? '',
            isError: tc.is_error ?? false,
          }];
        }
        return [{
          type: 'tool_start',
          toolName: tc.name,
          toolUseId: tc.id,
          input: tc.input,
        }];
      }

      case 'embedded_resource': {
        const er = item as AcpEmbeddedResourceContent;
        return [{ type: 'info', message: `${er.name} (${er.resource_type})` }];
      }

      case 'diff': {
        const d = item as AcpDiffContent;
        const toolUseId = crypto.randomUUID();
        return [
          {
            type: 'tool_start',
            toolName: 'WriteFile',
            toolUseId,
            input: { path: d.path, diff: d.diff },
          },
          {
            type: 'tool_result',
            toolUseId,
            result: `Diff for ${d.path}`,
            isError: false,
          },
        ];
      }

      default: {
        return [{ type: 'info', message: `[ACP unknown event: ${item.type}]` }];
      }
    }
  }
}
