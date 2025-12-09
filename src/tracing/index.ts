import { NodeTracerProvider, SimpleSpanProcessor, BatchSpanProcessor, ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

import { loadTracingConfig } from './config.ts';
import type { TracingConfig } from './config.ts';
import { PiiRedactor } from './pii-redactor.ts';
import { RedactingSpanProcessor } from './span-processor.ts';
import { TraceInstrumentation } from './instrumentation.ts';
import { debug } from '../tui/utils/debug.ts';

export type { TracingConfig, PiiConfig } from './config.ts';
export type { ConversationTurnMetadata, ConversationTurnResult } from './instrumentation.ts';
export { TraceInstrumentation } from './instrumentation.ts';
export { PiiRedactor, BLOCKED_FIELDS, SAFE_FIELDS } from './pii-redactor.ts';

// Singleton tracing manager
export class TracingManager {
  private config: TracingConfig;
  private provider: NodeTracerProvider | null = null;
  private redactor: PiiRedactor;
  private instrumentation: TraceInstrumentation | null = null;
  private initialized = false;

  constructor(config?: TracingConfig) {
    this.config = config || loadTracingConfig();
    this.redactor = new PiiRedactor(this.config.pii);
  }

  // returns false is tracing is disabled
  async initialize(): Promise<boolean> {
    if (this.initialized) {
      return this.config.enabled;
    }

    if (!this.config.enabled) {
      debug('[Tracing] Tracing is disabled');
      this.initialized = true;
      return false;
    }

    debug('[Tracing] Initializing with config:', {
      endpoint: this.config.endpoint,
      exporter: this.config.exporterType,
      serviceName: this.config.serviceName,
    });

    // create exporter based on type
    const exporter = this.createExporter();

    const baseProcessor = this.config.exporterType === 'console'
      ? new SimpleSpanProcessor(exporter)
      : new BatchSpanProcessor(exporter);

    const redactingProcessor = new RedactingSpanProcessor(
      baseProcessor,
      this.redactor
    );

    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: this.config.serviceName,
      [ATTR_SERVICE_VERSION]: '1.0.0',
      ...this.config.resourceAttributes,
    });

    this.provider = new NodeTracerProvider({
      resource,
      spanProcessors: [redactingProcessor],
    });

    this.provider.register();
    this.instrumentation = new TraceInstrumentation(this.redactor);

    this.initialized = true;
    debug('[Tracing] Initialized successfully');

    return true;
  }

  getInstrumentation(): TraceInstrumentation | null {
    if (!this.initialized || !this.config.enabled) {
      return null;
    }
    return this.instrumentation;
  }

  getRedactor(): PiiRedactor {
    return this.redactor;
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  async flush(): Promise<void> {
    if (this.provider) {
      await this.provider.forceFlush();
    }
  }

  async shutdown(): Promise<void> {
    if (this.provider) {
      await this.provider.shutdown();
      this.provider = null;
    }
    this.initialized = false;
    debug('[Tracing] Shutdown complete');
  }

  private createExporter() {
    switch (this.config.exporterType) {
      case 'console':
        return new ConsoleSpanExporter();

      case 'otlp':
      default:
        debug('[Tracing] Creating OTLP exporter with endpoint:', this.config.endpoint);
        return new OTLPTraceExporter({
          url: this.config.endpoint,
          headers: this.config.headers,
        });
    }
  }
}

// singleton instance
let manager: TracingManager | null = null;

export function getTracingManager(): TracingManager {
  if (!manager) {
    manager = new TracingManager();
  }
  return manager;
}

export async function initializeTracing(): Promise<TraceInstrumentation | null> {
  const mgr = getTracingManager();
  await mgr.initialize();
  return mgr.getInstrumentation();
}
