import type {
  SpanProcessor,
  ReadableSpan,
  Span,
} from '@opentelemetry/sdk-trace-base';
import type { Context, Attributes, AttributeValue } from '@opentelemetry/api';
import type { PiiRedactor } from './pii-redactor.ts';
import { BLOCKED_FIELDS, SAFE_FIELDS } from './pii-redactor.ts';
import { debug, isDebugEnabled } from '../tui/utils/debug.ts';

export class RedactingSpanProcessor implements SpanProcessor {
  private delegate: SpanProcessor;
  private redactor: PiiRedactor;

  constructor(delegate: SpanProcessor, redactor: PiiRedactor) {
    this.delegate = delegate;
    this.redactor = redactor;
  }

  onStart(span: Span, parentContext: Context): void {
    // passthrough
    this.delegate.onStart(span, parentContext);
  }

  onEnd(span: ReadableSpan): void {
    // redacted copy of span (or passthrough in debug mode)
    const redactedSpan = this.redactSpan(span);
    debug(`[Tracing] Exporting span: ${span.name}, attributes:`, Object.keys(redactedSpan.attributes));
    this.delegate.onEnd(redactedSpan);
  }

  async forceFlush(): Promise<void> {
    return this.delegate.forceFlush();
  }

  async shutdown(): Promise<void> {
    return this.delegate.shutdown();
  }

  private redactSpan(span: ReadableSpan): ReadableSpan {
    // In debug mode, pass through all attributes without filtering
    if (isDebugEnabled()) {
      debug('[Tracing] Debug mode: skipping PII redaction');
      return span;
    }

    const originalAttributes = span.attributes;
    const redactedAttributes: Attributes = {};

    for (const [key, value] of Object.entries(originalAttributes)) {
      if (BLOCKED_FIELDS.has(key)) {
        debug(`[Tracing] Blocking field: ${key}`);
        // dont include blocked fields at all
        continue;
      }

      // passthrough safe fields
      if (SAFE_FIELDS.has(key)) {
        redactedAttributes[key] = value;
        continue;
      }

      // apply redaction to everything else
      const redactedValue = this.redactor.redactAttribute(key, value);
      if (this.isValidAttributeValue(redactedValue)) {
        redactedAttributes[key] = redactedValue as AttributeValue;
      }
    }

    // return proxy with redacted attributes
    return new RedactedSpan(span, redactedAttributes);
  }

  private isValidAttributeValue(value: unknown): value is AttributeValue {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return true;
    if (Array.isArray(value)) {
      return value.every(v =>
        typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
      );
    }
    return false;
  }
}

class RedactedSpan implements ReadableSpan {
  private original: ReadableSpan;
  readonly attributes: Attributes;

  constructor(original: ReadableSpan, redactedAttributes: Attributes) {
    this.original = original;
    this.attributes = redactedAttributes;
  }

  get name() { return this.original.name; }
  get kind() { return this.original.kind; }
  get parentSpanContext() { return this.original.parentSpanContext; }
  get startTime() { return this.original.startTime; }
  get endTime() { return this.original.endTime; }
  get status() { return this.original.status; }
  get links() { return this.original.links; }
  get events() { return this.original.events; }
  get duration() { return this.original.duration; }
  get ended() { return this.original.ended; }
  get resource() { return this.original.resource; }
  get instrumentationScope() { return this.original.instrumentationScope; }
  get droppedAttributesCount() { return this.original.droppedAttributesCount; }
  get droppedEventsCount() { return this.original.droppedEventsCount; }
  get droppedLinksCount() { return this.original.droppedLinksCount; }

  spanContext() { return this.original.spanContext(); }
}
