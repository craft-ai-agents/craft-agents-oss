import { trace, type Tracer } from '@opentelemetry/api'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'

interface RuntimeTelemetryState {
  enabled: boolean
  tracer?: Tracer
  forceFlush?: () => Promise<void>
  shutdown?: () => Promise<void>
}

let telemetryState: RuntimeTelemetryState | null = null

function envFlag(name: string, defaultValue = false): boolean {
  const raw = process.env[name]?.trim().toLowerCase()
  if (!raw) return defaultValue
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on'
}

function parseHeaders(raw: string | undefined): Record<string, string> {
  const trimmed = raw?.trim()
  if (!trimmed) return {}

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>
      return Object.fromEntries(
        Object.entries(parsed)
          .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0),
      )
    } catch {
      return {}
    }
  }

  const headers: Record<string, string> = {}
  for (const part of trimmed.split(/[,\n;]/)) {
    const index = part.indexOf('=')
    if (index <= 0) continue
    const key = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()
    if (key && value) headers[key] = value
  }
  return headers
}

function resolveEndpoint(): string {
  const explicit = process.env.CRAFT_OTEL_ENDPOINT?.trim()
  if (explicit) return explicit

  const tracesEndpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim()
  if (tracesEndpoint) return tracesEndpoint

  const baseEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim()
  if (baseEndpoint) return `${baseEndpoint.replace(/\/+$/, '')}/v1/traces`

  return 'http://localhost:6006/v1/traces'
}

function resolveHeaders(): Record<string, string> {
  const headers = parseHeaders(process.env.CRAFT_OTEL_HEADERS ?? process.env.OTEL_EXPORTER_OTLP_HEADERS)
  const phoenixApiKey = process.env.PHOENIX_API_KEY?.trim()
  if (phoenixApiKey && !Object.keys(headers).some((key) => key.toLowerCase() === 'authorization')) {
    headers.authorization = `Bearer ${phoenixApiKey}`
  }
  return headers
}

export function getRuntimeTelemetry(): RuntimeTelemetryState {
  if (telemetryState) return telemetryState

  if (!envFlag('CRAFT_OTEL_ENABLED')) {
    telemetryState = { enabled: false }
    return telemetryState
  }

  try {
    const exporter = new OTLPTraceExporter({
      url: resolveEndpoint(),
      headers: resolveHeaders(),
      timeoutMillis: Number(process.env.CRAFT_OTEL_EXPORT_TIMEOUT_MS ?? 10_000),
    })
    const processor = new BatchSpanProcessor(exporter)
    const provider = new NodeTracerProvider({
      resource: resourceFromAttributes({
        'service.name': process.env.CRAFT_OTEL_SERVICE_NAME?.trim() || 'craft-agent-server',
        'openinference.project.name': process.env.CRAFT_OTEL_PROJECT?.trim() || process.env.PHOENIX_PROJECT_NAME?.trim() || 'craft-prod',
      }),
      spanProcessors: [processor],
    })

    provider.register()
    telemetryState = {
      enabled: true,
      tracer: trace.getTracer('craft-agent-runtime'),
      forceFlush: () => provider.forceFlush(),
      shutdown: () => provider.shutdown(),
    }
  } catch {
    telemetryState = { enabled: false }
  }

  return telemetryState
}

export async function shutdownRuntimeTelemetry(): Promise<void> {
  const shutdown = telemetryState?.shutdown
  telemetryState = null
  if (shutdown) await shutdown()
}

export function shouldForceFlushPerTurn(): boolean {
  return envFlag('CRAFT_OTEL_FORCE_FLUSH_PER_TURN')
}

export function shouldCaptureTraceContent(): boolean {
  return envFlag('CRAFT_OTEL_CAPTURE_CONTENT')
}

export function shouldIncludeRawUserId(): boolean {
  return envFlag('CRAFT_OTEL_INCLUDE_RAW_USER_ID')
}

export function getTraceContentMaxChars(): number {
  const raw = Number(process.env.CRAFT_OTEL_CONTENT_MAX_CHARS ?? 2000)
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 2000
}
