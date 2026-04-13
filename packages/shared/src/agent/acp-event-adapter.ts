/**
 * ACP Event Adapter
 *
 * Converts ACP session/update payloads into AgentEvent[] streams.
 * Pure static-method adapter — no state, no side effects.
 *
 * Mapping rules (from execution-brief):
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
  status: 'running' | 'completed' | 'error' | 'cancelled' | string;
  content?: AcpContent[];
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

    // Status-level events (completed / error / cancelled)
    switch (update.status) {
      case 'completed': {
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
    for (const item of update.content ?? []) {
      const adapted = AcpEventAdapter._adaptContent(item);
      events.push(...adapted);
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
