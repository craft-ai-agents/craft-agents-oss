/**
 * Amp Event Adapter
 *
 * Maps Amp CLI streaming JSON messages to Craft Agent's AgentEvent format.
 * This enables the AmpAgent to emit events compatible with the existing UI.
 *
 * Amp CLI outputs one JSON object per line when using --stream-json flag.
 * Message types include: user, assistant, system, result
 * Content block types: text, tool_use, tool_result, thinking
 */

import type { AgentEvent } from '@craft-agent/core/types';
import { BaseEventAdapter } from '../base-event-adapter.ts';

// ============================================================
// Types
// ============================================================

/**
 * Amp streaming JSON message structure.
 */
export interface AmpStreamMessage {
  type: 'user' | 'assistant' | 'system' | 'result';
  subtype?: string;
  message?: {
    role: string;
    content: AmpContentBlock[];
    stop_reason?: string;
  };
  session_id?: string;
  cost_usd?: number;
  duration_ms?: number;
  is_delta?: boolean;
  is_error?: boolean;
  num_turns?: number;
  result?: string;
  error?: {
    code: string;
    message: string;
  } | string;
}

export interface AmpContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
  thinking?: string;
}

/**
 * Map Amp tool names to PascalCase names used by our UI.
 */
const AMP_TOOL_NAME_MAP: Record<string, string> = {
  bash: 'Bash',
  read: 'Read',
  write: 'Write',
  edit: 'Edit',
  glob: 'Glob',
  grep: 'Grep',
  web_fetch: 'WebFetch',
  web_search: 'WebSearch',
  task: 'Task',
  mcp: 'Mcp',
  oracle: 'Oracle',
  librarian: 'Librarian',
  painter: 'Painter',
};

// ============================================================
// AmpEventAdapter
// ============================================================

/**
 * Adapts Amp CLI streaming JSON messages to AgentEvent format.
 */
export class AmpEventAdapter extends BaseEventAdapter {
  // track active tool calls by ID
  private activeToolCalls: Map<string, { name: string; input: Record<string, unknown> }> = new Map();

  // accumulated text for delta messages
  private accumulatedText: string = '';

  // turn tracking
  private turnStartEmitted: boolean = false;

  constructor() {
    super('AmpEventAdapter');
  }

  /**
   * Subclass hook called during startTurn() for resetting provider-specific state.
   */
  protected override onTurnStart(): void {
    this.activeToolCalls.clear();
    this.accumulatedText = '';
    this.turnStartEmitted = false;
  }

  /**
   * Map a single Amp streaming message to AgentEvents.
   */
  *adaptMessage(msg: AmpStreamMessage): Generator<AgentEvent> {
    // handle errors (can be object or string)
    if (msg.error) {
      const errorMessage = typeof msg.error === 'string' ? msg.error : msg.error.message;
      yield {
        type: 'error',
        message: errorMessage,
      };
      return;
    }

    // handle result messages - check for errors
    if (msg.type === 'result') {
      if (msg.is_error || msg.subtype === 'error_during_execution') {
        // parse error message for credit/payment issues
        const errorStr = typeof msg.error === 'string' ? msg.error : (msg.result || 'Unknown error');

        // check for paid credits requirement
        if (errorStr.includes('paid credits') || errorStr.includes('402') || errorStr.includes('ampcode.com/pay')) {
          yield {
            type: 'typed_error',
            error: {
              code: 'insufficient_credits',
              title: 'Amp Credits Required',
              message: 'Amp\'s execute mode requires paid credits. The free tier only works in interactive mode.',
              details: [
                'Add credits at ampcode.com/pay',
                'Or use Amp interactively in your terminal',
              ],
              actions: [
                { key: 'o', label: 'Open Amp Pay', action: 'open_url', url: 'https://ampcode.com/pay' },
              ],
              canRetry: false,
            },
          };
        } else {
          yield {
            type: 'error',
            message: errorStr,
          };
        }
      }
      yield { type: 'complete' };
      return;
    }

    // handle system messages (usually session info)
    if (msg.type === 'system') {
      // system messages don't produce UI events
      return;
    }

    // handle assistant messages with content
    if (msg.type === 'assistant' && msg.message?.content) {
      for (const block of msg.message.content) {
        yield* this.adaptContentBlock(block, msg.is_delta);
      }

      // check for stop reason (turn complete)
      if (msg.message.stop_reason === 'end_turn') {
        yield { type: 'complete' };
      }
    }
  }

  /**
   * Adapt a single content block to AgentEvents.
   */
  private *adaptContentBlock(block: AmpContentBlock, isDelta?: boolean): Generator<AgentEvent> {
    switch (block.type) {
      case 'text':
        if (block.text) {
          if (isDelta) {
            // streaming delta - emit as text_delta
            yield {
              type: 'text_delta',
              text: block.text,
            };
            this.accumulatedText += block.text;
          } else {
            // complete text block
            yield {
              type: 'text_complete',
              text: block.text,
            };
          }
        }
        break;

      case 'thinking':
        if (block.thinking) {
          // thinking blocks are emitted as text_delta with a prefix
          // the UI will render them differently based on context
          yield {
            type: 'text_delta',
            text: block.thinking,
          };
        }
        break;

      case 'tool_use':
        if (block.id && block.name) {
          const normalizedName = this.normalizeToolName(block.name);
          const input = block.input || {};

          // track active tool call
          this.activeToolCalls.set(block.id, { name: normalizedName, input });

          yield this.createToolStart(
            block.id,
            normalizedName,
            input,
            undefined, // intent
            normalizedName, // displayName
          );
        }
        break;

      case 'tool_result':
        if (block.tool_use_id) {
          const toolCall = this.activeToolCalls.get(block.tool_use_id);
          const toolName = toolCall?.name || 'Unknown';

          yield this.createToolResult(
            block.tool_use_id,
            toolName,
            block.content || '',
            block.is_error || false,
          );

          // clean up tracked tool call
          this.activeToolCalls.delete(block.tool_use_id);
        }
        break;
    }
  }

  /**
   * Normalize Amp tool names to our PascalCase convention.
   */
  private normalizeToolName(name: string): string {
    const lower = name.toLowerCase();

    // check direct mapping
    if (AMP_TOOL_NAME_MAP[lower]) {
      return AMP_TOOL_NAME_MAP[lower];
    }

    // handle MCP tool names (format: mcp__servername__toolname)
    if (lower.startsWith('mcp__')) {
      const parts = name.split('__');
      if (parts.length >= 3) {
        return `MCP:${parts[1]}:${parts[2]}`;
      }
    }

    // fallback: capitalize first letter
    return name.charAt(0).toUpperCase() + name.slice(1);
  }

  /**
   * Get accumulated text from delta messages.
   */
  getAccumulatedText(): string {
    return this.accumulatedText;
  }

  /**
   * Reset accumulated text.
   */
  resetAccumulatedText(): void {
    this.accumulatedText = '';
  }
}