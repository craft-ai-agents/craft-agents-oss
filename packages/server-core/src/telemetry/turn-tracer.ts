import {
  context as otelContext,
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
  type Context,
  type Span,
  type Tracer,
} from '@opentelemetry/api'
import type { AgentEvent, AgentEventUsage } from '@craft-agent/core/types'
import {
  getRuntimeTelemetry,
  getTraceContentMaxChars,
  shouldCaptureTraceContent,
  shouldForceFlushPerTurn,
  shouldIncludeRawUserId,
} from './otel'
import type { TurnTraceContext } from './trace-context'

interface ToolSpanState {
  span: Span
  toolName: string
}

export interface StartTurnTracerInput {
  traceContext: TurnTraceContext
  input?: string
  attachmentCount?: number
}

const OI_SPAN_KIND = 'openinference.span.kind'
const OI_INPUT = 'input.value'
const OI_OUTPUT = 'output.value'
const OI_TOOL_NAME = 'tool.name'
const OI_MODEL = 'llm.model_name'
const OI_TOK_PROMPT = 'llm.token_count.prompt'
const OI_TOK_COMPLETION = 'llm.token_count.completion'
const OI_TOK_TOTAL = 'llm.token_count.total'
const OI_TOK_CACHE_READ = 'llm.token_count.prompt_details.cache_read'

function truncate(value: string, maxChars = getTraceContentMaxChars()): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars)}...(+${value.length - maxChars})`
}

function serialize(value: unknown): string {
  if (typeof value === 'string') return truncate(value)
  try {
    return truncate(JSON.stringify(value))
  } catch {
    return truncate(String(value))
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function setUsageAttributes(span: Span, usage: Partial<AgentEventUsage>): Attributes {
  const attrs: Attributes = {}
  if (isFiniteNumber(usage.inputTokens)) {
    attrs[OI_TOK_PROMPT] = usage.inputTokens
    span.setAttribute(OI_TOK_PROMPT, usage.inputTokens)
  }
  if (isFiniteNumber(usage.outputTokens)) {
    attrs[OI_TOK_COMPLETION] = usage.outputTokens
    span.setAttribute(OI_TOK_COMPLETION, usage.outputTokens)
  }
  if (isFiniteNumber(usage.inputTokens) || isFiniteNumber(usage.outputTokens)) {
    const total = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
    attrs[OI_TOK_TOTAL] = total
    span.setAttribute(OI_TOK_TOTAL, total)
  }
  if (isFiniteNumber(usage.cacheReadTokens)) {
    attrs[OI_TOK_CACHE_READ] = usage.cacheReadTokens
    span.setAttribute(OI_TOK_CACHE_READ, usage.cacheReadTokens)
  }
  if (isFiniteNumber(usage.cacheCreationTokens)) {
    attrs['llm.token_count.prompt_details.cache_creation'] = usage.cacheCreationTokens
    span.setAttribute('llm.token_count.prompt_details.cache_creation', usage.cacheCreationTokens)
  }
  if (isFiniteNumber(usage.costUsd)) {
    attrs['llm.cost.total'] = usage.costUsd
    span.setAttribute('llm.cost.total', usage.costUsd)
  }
  if (isFiniteNumber(usage.contextWindow)) {
    attrs['llm.context_window'] = usage.contextWindow
    span.setAttribute('llm.context_window', usage.contextWindow)
  }
  return attrs
}

export class TurnTracer {
  private readonly traceContext: TurnTraceContext
  private readonly captureContent: boolean
  private readonly telemetry = getRuntimeTelemetry()
  private readonly toolSpans = new Map<string, ToolSpanState>()
  private rootSpan: Span | null = null
  private parentContext: Context | null = null
  private tracer: Tracer | null = null
  private currentModel: string | undefined
  private outcome: string | null = null
  private failed = false
  private ended = false

  private constructor(input: StartTurnTracerInput, disabled = false) {
    this.traceContext = input.traceContext
    this.captureContent = shouldCaptureTraceContent()

    if (disabled) return
    if (!this.telemetry.enabled || !this.telemetry.tracer) return

    this.tracer = this.telemetry.tracer
    this.rootSpan = this.tracer.startSpan('agent.turn', {
      kind: SpanKind.INTERNAL,
      attributes: this.buildRootAttributes(input),
    })
    this.parentContext = trace.setSpan(otelContext.active(), this.rootSpan)
  }

  static start(input: StartTurnTracerInput): TurnTracer {
    try {
      return new TurnTracer(input)
    } catch {
      return new TurnTracer(input, true)
    }
  }

  setModel(model: string | undefined): void {
    this.safe(() => {
      if (!model || !this.rootSpan) return
      this.currentModel = model
      this.rootSpan.setAttribute(OI_MODEL, model)
      this.rootSpan.setAttribute('craft.llm.model', model)
    })
  }

  observe(event: AgentEvent): void {
    this.safe(() => {
      if (!this.rootSpan) return
      if ('turnId' in event && event.turnId) {
        this.rootSpan.setAttribute('craft.sdk.turn.id', event.turnId)
      }

      switch (event.type) {
        case 'tool_start':
          this.startToolSpan(event)
          break
        case 'tool_result':
          this.endToolSpan(event)
          break
        case 'usage_update':
          this.recordUsageAttributes(event.usage)
          break
        case 'complete':
          if (event.usage) this.emitLlmSpan(event.usage)
          break
        case 'text_complete':
          if (this.captureContent && !event.isIntermediate) {
            this.rootSpan.setAttribute(OI_OUTPUT, serialize(event.text))
          }
          break
        case 'error':
          this.markFailure(event.message)
          break
        case 'typed_error':
          this.markFailure(event.error.message, event.error.code)
          break
      }
    })
  }

  complete(outcome = 'complete'): void {
    this.safe(() => {
      if (!this.rootSpan || this.ended) return
      this.outcome = outcome
      this.rootSpan.setAttribute('craft.turn.outcome', outcome)
      if (!this.failed) {
        this.rootSpan.setStatus({ code: SpanStatusCode.OK })
      }
    })
  }

  abort(reason: string): void {
    this.safe(() => {
      if (!this.rootSpan || this.ended) return
      this.outcome = 'interrupted'
      this.rootSpan.setAttribute('craft.turn.outcome', 'interrupted')
      this.rootSpan.setAttribute('craft.turn.abort_reason', reason)
      if (!this.failed) {
        this.rootSpan.setStatus({ code: SpanStatusCode.OK })
      }
    })
  }

  fail(error: unknown): void {
    this.safe(() => {
      if (!this.rootSpan || this.ended) return
      this.markFailure(errorMessage(error))
      if (error instanceof Error) {
        this.rootSpan.recordException(error)
      }
    })
  }

  async end(): Promise<void> {
    try {
      if (!this.rootSpan || this.ended) return
      this.closeOpenToolSpans()
      if (!this.outcome) {
        this.rootSpan.setAttribute('craft.turn.outcome', this.failed ? 'error' : 'unknown')
      }
      this.rootSpan.end()
      this.ended = true
      if (shouldForceFlushPerTurn() && this.telemetry.forceFlush) {
        await this.telemetry.forceFlush()
      }
    } catch {
      // Telemetry must never affect the chat path.
    }
  }

  private buildRootAttributes(input: StartTurnTracerInput): Attributes {
    const ctx = input.traceContext
    const attrs: Attributes = {
      [OI_SPAN_KIND]: 'CHAIN',
      'craft.telemetry.schema_version': ctx.schemaVersion,
      'craft.turn.id': ctx.turnId,
      'craft.user_message.id': ctx.userMessageId,
      'craft.user.identity_source': ctx.userIdSource,
      'user.id': ctx.userId,
      'enduser.id': ctx.userId,
      'workspace.id': ctx.workspaceId,
      'craft.workspace.id': ctx.workspaceId,
      'craft.workspace.root_hash': ctx.workspaceRootHash,
      'session.id': ctx.sessionId,
      'craft.session.id': ctx.sessionId,
    }

    if (ctx.authProvider) attrs['auth.provider'] = ctx.authProvider
    if (ctx.feishuOpenIdHash) attrs['craft.feishu.open_id_hash'] = ctx.feishuOpenIdHash
    if (ctx.feishuOpenId && shouldIncludeRawUserId()) attrs['craft.feishu.open_id'] = ctx.feishuOpenId
    if (ctx.connectionSlug) attrs['craft.llm.connection_slug'] = ctx.connectionSlug
    if (ctx.model) attrs[OI_MODEL] = ctx.model
    if (isFiniteNumber(input.attachmentCount)) attrs['craft.turn.attachment_count'] = input.attachmentCount

    if (this.captureContent) {
      if (input.input) attrs[OI_INPUT] = serialize(input.input)
      if (ctx.sessionName) attrs['session.name'] = serialize(ctx.sessionName)
    }

    return attrs
  }

  private startToolSpan(event: Extract<AgentEvent, { type: 'tool_start' }>): void {
    if (!this.tracer || !this.parentContext) return

    const existing = this.toolSpans.get(event.toolUseId)
    if (existing) {
      existing.span.setAttribute('craft.tool.duplicate_start', true)
      existing.span.end()
    }

    const attrs: Attributes = {
      [OI_SPAN_KIND]: 'TOOL',
      [OI_TOOL_NAME]: event.toolName,
      'tool.call.id': event.toolUseId,
      'craft.turn.id': this.traceContext.turnId,
    }
    if (event.intent) attrs['tool.intent'] = serialize(event.intent)
    if (event.displayName) attrs['tool.display_name'] = event.displayName
    if (this.captureContent) attrs[OI_INPUT] = serialize(event.input)

    const span = this.tracer.startSpan(`tool.${event.toolName}`, {
      kind: SpanKind.INTERNAL,
      attributes: attrs,
    }, this.parentContext)
    this.toolSpans.set(event.toolUseId, { span, toolName: event.toolName })
  }

  private endToolSpan(event: Extract<AgentEvent, { type: 'tool_result' }>): void {
    const state = this.toolSpans.get(event.toolUseId)
    if (!state) {
      this.rootSpan?.addEvent('tool_result_without_start', {
        'tool.call.id': event.toolUseId,
        'tool.name': event.toolName ?? 'unknown',
        'error': event.isError,
      })
      return
    }

    if (event.toolName && event.toolName !== state.toolName) {
      state.span.setAttribute('tool.name', event.toolName)
      state.span.setAttribute(OI_TOOL_NAME, event.toolName)
    }
    state.span.setAttribute('tool.call.id', event.toolUseId)
    state.span.setAttribute('error', event.isError)
    if (event.isError) {
      state.span.setStatus({ code: SpanStatusCode.ERROR })
    } else {
      state.span.setStatus({ code: SpanStatusCode.OK })
    }
    if (this.captureContent) {
      if (event.input) state.span.setAttribute(OI_INPUT, serialize(event.input))
      state.span.setAttribute(OI_OUTPUT, serialize(event.result))
    }
    state.span.end()
    this.toolSpans.delete(event.toolUseId)
  }

  private recordUsageAttributes(usage: Partial<AgentEventUsage>): void {
    if (!this.rootSpan) return
    setUsageAttributes(this.rootSpan, usage)
  }

  private emitLlmSpan(usage: Partial<AgentEventUsage>): void {
    if (!this.tracer || !this.parentContext || !this.rootSpan) return

    setUsageAttributes(this.rootSpan, usage)

    const now = Date.now()
    const attrs: Attributes = {
      [OI_SPAN_KIND]: 'LLM',
    }
    if (this.currentModel) attrs[OI_MODEL] = this.currentModel
    if (isFiniteNumber(usage.inputTokens)) attrs[OI_TOK_PROMPT] = usage.inputTokens
    if (isFiniteNumber(usage.outputTokens)) attrs[OI_TOK_COMPLETION] = usage.outputTokens
    if (isFiniteNumber(usage.inputTokens) || isFiniteNumber(usage.outputTokens)) {
      attrs[OI_TOK_TOTAL] = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
    }
    if (isFiniteNumber(usage.cacheReadTokens)) attrs[OI_TOK_CACHE_READ] = usage.cacheReadTokens
    if (isFiniteNumber(usage.cacheCreationTokens)) {
      attrs['llm.token_count.prompt_details.cache_creation'] = usage.cacheCreationTokens
    }
    if (isFiniteNumber(usage.costUsd)) attrs['llm.cost.total'] = usage.costUsd
    if (isFiniteNumber(usage.contextWindow)) attrs['llm.context_window'] = usage.contextWindow

    const span = this.tracer.startSpan('llm.generation', {
      kind: SpanKind.INTERNAL,
      attributes: attrs,
      startTime: now,
    }, this.parentContext)
    span.setStatus({ code: SpanStatusCode.OK })
    span.end(now)
  }

  private markFailure(message: string, code?: string): void {
    if (!this.rootSpan) return
    this.failed = true
    this.outcome = 'error'
    this.rootSpan.setAttribute('craft.turn.outcome', 'error')
    this.rootSpan.setAttribute('error', true)
    this.rootSpan.setStatus({
      code: SpanStatusCode.ERROR,
      message,
    })
    this.rootSpan.addEvent('error', {
      'exception.message': message,
      ...(code ? { 'exception.type': code } : {}),
    })
  }

  private closeOpenToolSpans(): void {
    for (const [toolUseId, state] of this.toolSpans.entries()) {
      state.span.setAttribute('tool.call.id', toolUseId)
      state.span.setAttribute('craft.tool.incomplete', true)
      if (this.failed) {
        state.span.setStatus({ code: SpanStatusCode.ERROR })
      }
      state.span.end()
      this.toolSpans.delete(toolUseId)
    }
  }

  private safe(fn: () => void): void {
    try {
      fn()
    } catch {
      // Telemetry must never affect the chat path.
    }
  }
}
