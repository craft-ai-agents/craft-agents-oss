import { trace, type Span, SpanKind, SpanStatusCode, context } from '@opentelemetry/api';
import type { AgentEvent } from '../agent/craft-agent.ts';
import type { PiiRedactor } from './pii-redactor.ts';
import { debug, isDebugEnabled } from '../tui/utils/debug.ts';

const TRACER_NAME = 'craft-terminal-agent';

/**
 * Metadata for starting a conversation turn
 */
export interface ConversationTurnMetadata {
  sessionId: string | null;
  workspaceId: string;
  model: string;
  hasAttachments: boolean;
  attachmentCount: number;
  userMessage?: string;  // DEBUG ONLY: user input message
}

/**
 * Result of a conversation turn
 */
export interface ConversationTurnResult {
  success: boolean;
  reason?: string;
  assistantResponse?: string;  // DEBUG ONLY: assistant response
}

/**
 * Instrumentation for the Craft Agent
 *
 * Creates spans for:
 * - Conversation turns (root span per chat() call)
 * - Tool executions (child spans)
 * - LLM calls (implicit via SDK events)
 */
export class TraceInstrumentation {
  private tracer = trace.getTracer(TRACER_NAME);
  private redactor: PiiRedactor;

  // Active spans for correlation
  private conversationSpan: Span | null = null;
  private toolSpans: Map<string, Span> = new Map();

  // DEBUG ONLY: store tool inputs for when we end the span
  private toolInputs: Map<string, Record<string, unknown>> = new Map();

  // DEBUG ONLY: store user message for conversation span
  private currentUserMessage: string | null = null;

  // Metrics accumulator
  private currentTurnMetrics = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd: 0,
    toolCount: 0,
    startTime: 0,
  };

  constructor(redactor: PiiRedactor) {
    this.redactor = redactor;
  }

  // start new conversation turn span. Called at beginning of chat()
  startConversationTurn(metadata: ConversationTurnMetadata): void {
    // end any existing conversation span
    if (this.conversationSpan) {
      this.endConversationTurn({ success: false, reason: 'interrupted' });
    }

    this.currentTurnMetrics = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: 0,
      toolCount: 0,
      startTime: Date.now(),
    };

    // debug mode only: store user message
    this.currentUserMessage = metadata.userMessage || null;

    const debugMode = isDebugEnabled();
    const userInput = debugMode && metadata.userMessage
      ? metadata.userMessage
      : '[request]';

    this.conversationSpan = this.tracer.startSpan('conversation.turn', {
      kind: SpanKind.CLIENT,
      attributes: {
        // langsmith span classification
        'langsmith.span.kind': 'llm',
        // genai operation name - 'chat' maps to 'llm' run type
        'gen_ai.operation.name': 'chat',
        // traceloop span kind
        'traceloop.span.kind': 'llm',

        debug_mode: debugMode,

        // we still need correlation - in debug mode send raw ids, otherwise hash
        session_id: debugMode
          ? (metadata.sessionId || 'none')
          : (metadata.sessionId ? this.redactor.hash(metadata.sessionId) : 'none'),
        workspace_id: debugMode
          ? metadata.workspaceId
          : this.redactor.hash(metadata.workspaceId),

        // genai semantics for langsmith
        'gen_ai.system': 'anthropic',
        'gen_ai.request.model': metadata.model,
        'gen_ai.response.model': metadata.model,

        // langsmith indexed message format for inputs
        'gen_ai.prompt.0.role': 'user',
        'gen_ai.prompt.0.content': userInput,

        // traceloop input
        'traceloop.entity.input': userInput,

        // custom metadata
        has_attachments: metadata.hasAttachments,
        attachment_count: metadata.attachmentCount,
      },
    });

    debug('[Tracing] Started conversation turn span, debug mode:', debugMode);
  }

  processEvent(event: AgentEvent): void {
    if (!this.conversationSpan) return;

    debug(`[Tracing] processEvent: ${event.type}`, 'toolUseId' in event ? event.toolUseId : '');

    switch (event.type) {
      case 'tool_start':
        this.startToolSpan(event);
        break;

      case 'tool_result':
        debug(`[Tracing] tool_result event received for ${event.toolUseId}`);
        this.endToolSpan(event);
        break;

      case 'complete':
        debug('[Tracing] Complete event received, usage:', event.usage);
        if (event.usage) {
          this.currentTurnMetrics.inputTokens += event.usage.inputTokens;
          this.currentTurnMetrics.outputTokens += event.usage.outputTokens;
          this.currentTurnMetrics.cacheReadTokens += event.usage.cacheReadTokens || 0;
          this.currentTurnMetrics.cacheCreationTokens += event.usage.cacheCreationTokens || 0;
          this.currentTurnMetrics.costUsd += event.usage.costUsd || 0;
          debug('[Tracing] Updated metrics:', this.currentTurnMetrics);
        }
        break;

      case 'error':
        this.conversationSpan.setStatus({
          code: SpanStatusCode.ERROR,
        });
        this.conversationSpan.setAttribute('error_occurred', true);
        break;
    }
  }

  // tool execution span
  private startToolSpan(event: { toolName: string; toolUseId: string; input: Record<string, unknown> }): void {
    if (!this.conversationSpan) return;

    const ctx = trace.setSpan(context.active(), this.conversationSpan);
    const debugMode = isDebugEnabled();

    this.toolInputs.set(event.toolUseId, event.input);

    const toolInput = debugMode
      ? JSON.stringify(event.input, null, 2)
      : '[tool input]';

    const span = this.tracer.startSpan(
      `tool.${event.toolName}`,
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          'gen_ai.tool.name': event.toolName,
          'langsmith.span.kind': 'tool',

          tool_name: event.toolName,
          tool_use_id: debugMode ? event.toolUseId : this.redactor.hash(event.toolUseId),

          'traceloop.entity.input': toolInput,
        },
      },
      ctx
    );

    this.toolSpans.set(event.toolUseId, span);
    this.currentTurnMetrics.toolCount++;

    debug(`[Tracing] Started tool span: ${event.toolName}`);
  }

  // helper to extract actual content from mcp result
  private extractMcpContent(result: string): string {
    try {
      const parsed = JSON.parse(result);

      // MCP content array format: [{ type: "text", text: "..." }]
      if (Array.isArray(parsed)) {
        const texts: string[] = [];
        for (const item of parsed) {
          if (item && typeof item === 'object' && item.type === 'text' && typeof item.text === 'string') {
            // if json, try to parse
            try {
              const innerParsed = JSON.parse(item.text);
              texts.push(JSON.stringify(innerParsed, null, 2));
            } catch {
              texts.push(item.text);
            }
          }
        }
        if (texts.length > 0) {
          return texts.join('\n');
        }
      }

      return JSON.stringify(parsed, null, 2);
    } catch {
      return result;
    }
  }

  private endToolSpan(event: { toolUseId: string; isError: boolean; result?: string }): void {
    const span = this.toolSpans.get(event.toolUseId);
    if (!span) return;

    const debugMode = isDebugEnabled();

    debug(`[Tracing] endToolSpan called, debugMode=${debugMode}, hasResult=${!!event.result}, resultLength=${event.result?.length || 0}`);

    span.setAttribute('success', !event.isError);

    let toolOutput: string;
    if (debugMode && event.result) {
      toolOutput = this.extractMcpContent(event.result);
    } else {
      toolOutput = event.isError ? '[error]' : '[tool output]';
    }
    span.setAttribute('traceloop.entity.output', toolOutput);

    debug(`[Tracing] Tool output set to: ${toolOutput.substring(0, 100)}...`);

    if (event.isError) {
      span.setStatus({ code: SpanStatusCode.ERROR });
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }

    span.end();
    this.toolSpans.delete(event.toolUseId);
    this.toolInputs.delete(event.toolUseId);

    debug(`[Tracing] Ended tool span: ${event.toolUseId}`);
  }

  endConversationTurn(result: ConversationTurnResult): void {
    if (!this.conversationSpan) return;

    const duration = Date.now() - this.currentTurnMetrics.startTime;
    const totalTokens = this.currentTurnMetrics.inputTokens + this.currentTurnMetrics.outputTokens;
    const debugMode = isDebugEnabled();

    const userInput = debugMode && this.currentUserMessage
      ? this.currentUserMessage
      : '[request]';
    const assistantOutput = debugMode && result.assistantResponse
      ? result.assistantResponse
      : '[response]';

    // final metrics using multiple semantic convention formats for compatibility
    this.conversationSpan.setAttributes({
      // langsmith indexed message format for outputs
      'gen_ai.completion.0.role': 'assistant',
      'gen_ai.completion.0.content': assistantOutput,

      // langsmith indexed message format for inputs
      'gen_ai.prompt.0.role': 'user',
      'gen_ai.prompt.0.content': userInput,

      // genai semantic conventions for token usage (primary)
      'gen_ai.usage.input_tokens': this.currentTurnMetrics.inputTokens,
      'gen_ai.usage.output_tokens': this.currentTurnMetrics.outputTokens,
      'gen_ai.usage.total_tokens': totalTokens,

      // LLM token count format (alternative)
      'llm.token_count.prompt': this.currentTurnMetrics.inputTokens,
      'llm.token_count.completion': this.currentTurnMetrics.outputTokens,
      'llm.token_count.total': totalTokens,

      // traceloop format
      'traceloop.entity.input': userInput,
      'traceloop.entity.output': assistantOutput,

      // anthropic-specific: cache tokens
      'gen_ai.usage.cache_read_input_tokens': this.currentTurnMetrics.cacheReadTokens,
      'gen_ai.usage.cache_creation_input_tokens': this.currentTurnMetrics.cacheCreationTokens,

      duration_ms: duration,
      tool_count: this.currentTurnMetrics.toolCount,

      success: result.success,
    });

    this.currentUserMessage = null;

    if (result.success) {
      this.conversationSpan.setStatus({ code: SpanStatusCode.OK });
    } else {
      this.conversationSpan.setStatus({ code: SpanStatusCode.ERROR });
      if (result.reason) {
        this.conversationSpan.setAttribute('failure_reason', result.reason);
      }
    }

    this.conversationSpan.end();
    this.conversationSpan = null;

    // end orphaned tool spans
    for (const [id, span] of this.toolSpans) {
      debug(`[Tracing] Ending orphaned tool span: ${id}`);
      span.setStatus({ code: SpanStatusCode.ERROR });
      span.setAttribute('orphaned', true);
      span.end();
    }
    this.toolSpans.clear();

    debug('[Tracing] Ended conversation turn span');
  }

  isActive(): boolean {
    return this.conversationSpan !== null;
  }
}
