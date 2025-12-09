import { createHash } from 'crypto';
import type { PiiConfig } from './config.ts';

// completely blocked fields - never sent
export const BLOCKED_FIELDS = new Set([
  // user content
  'user_message',
  'message_content',
  'prompt',
  'input_text',

  // file content
  'file_content',
  'attachment_data',
  'file_base64',

  // tool results
  'tool_result',
  'tool_output',
  'api_response',
  'mcp_result',

  // error details
  'error_context',
  'stack_trace',
]);

export const SAFE_FIELDS = new Set([
  'langsmith.span.kind',

  // genai semantic conventions
  'gen_ai.system',
  'gen_ai.operation.name',
  'gen_ai.request.model',
  'gen_ai.response.model',
  'gen_ai.tool.name',
  'gen_ai.usage.input_tokens',
  'gen_ai.usage.output_tokens',
  'gen_ai.usage.prompt_tokens',
  'gen_ai.usage.completion_tokens',
  'gen_ai.usage.total_tokens',
  'gen_ai.usage.cache_read_input_tokens',
  'gen_ai.usage.cache_creation_input_tokens',
  'gen_ai.usage.cache_read_tokens',
  'gen_ai.usage.cache_creation_tokens',
  'gen_ai.usage.cost',

  // langsmith indexed message format (values are placeholder in non-debug mode)
  'gen_ai.prompt.0.role',
  'gen_ai.prompt.0.content',
  'gen_ai.completion.0.role',
  'gen_ai.completion.0.content',

  // traceloop format (values are placeholder in non-debug mode)
  'traceloop.span.kind',
  'traceloop.entity.input',
  'traceloop.entity.output',

  // llm token count format
  'llm.token_count.prompt',
  'llm.token_count.completion',
  'llm.token_count.total',

  // legacy token fields (keep for backwards compat)
  'input_tokens',
  'output_tokens',
  'cache_read_tokens',
  'cache_creation_tokens',
  'total_tokens',
  'cost_usd',

  // timing
  'duration_ms',
  'time_to_first_token_ms',
  'start_time',
  'end_time',

  // model (legacy)
  'model',
  'model_version',

  // tool names, metadata
  'tool_name',
  'tool_count',
  'tool_duration_ms',

  // status
  'status',
  'success',
  'error_type',
  'error_occurred',
  'orphaned',
  'failure_reason',
  'debug_mode',

  // counts
  'message_count',
  'turn_count',
  'attachment_count',
  'has_attachments',

  // these are hashed but included here as safe for completeness
  'session_id',
  'workspace_id',
  'tool_use_id',
]);

export class PiiRedactor {
  private hashSalt: string;
  private blockPatternRegexes: RegExp[];
  private hashFields: Set<string>;
  private maxLength: number;

  constructor(config: PiiConfig, hashSalt?: string) {
    this.hashSalt = hashSalt || 'craft-tracing-v1';
    this.hashFields = new Set(config.hashFields);
    this.maxLength = config.maxAttributeLength;

    // compile for perf
    this.blockPatternRegexes = config.blockPatterns.map(
      pattern => new RegExp(pattern, 'gi')
    );
  }

  hash(value: string): string {
    const hash = createHash('sha256')
      .update(this.hashSalt + value)
      .digest('hex');
    return hash.substring(0, 16);
  }

  applyBlockPatterns(text: string): string {
    let result = text;
    for (const pattern of this.blockPatternRegexes) {
      pattern.lastIndex = 0;
      result = result.replace(pattern, '[REDACTED]');
    }
    return result;
  }

  redactAttribute(key: string, value: unknown): unknown {
    if (value === null || value === undefined) {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((v, i) => this.redactAttribute(`${key}[${i}]`, v));
    }

    if (typeof value === 'object') {
      return this.redactObject(value as Record<string, unknown>);
    }

    if (typeof value === 'string') {
      if (this.hashFields.has(key)) {
        return this.hash(value);
      }

      let result = this.applyBlockPatterns(value);

      if (result.length > this.maxLength) {
        result = result.substring(0, this.maxLength) + '...[truncated]';
      }

      return result;
    }

    return value;
  }

  redactObject(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = this.redactAttribute(key, value);
    }
    return result;
  }

  block(_value: unknown): string {
    return '[blocked]';
  }

  containsBlockedPattern(text: string): boolean {
    for (const pattern of this.blockPatternRegexes) {
      pattern.lastIndex = 0;
      if (pattern.test(text)) {
        return true;
      }
    }
    return false;
  }

  isBlockedField(key: string): boolean {
    return BLOCKED_FIELDS.has(key);
  }

  isSafeField(key: string): boolean {
    return SAFE_FIELDS.has(key);
  }

  isHashField(key: string): boolean {
    return this.hashFields.has(key);
  }
}
