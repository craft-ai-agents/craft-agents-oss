import { trace, type Tracer } from '@opentelemetry/api'
import { register as registerPhoenix } from '@arizeai/phoenix-otel'

/**
 * Phoenix OTLP tracing setup.
 *
 * 单一 provider 注册走官方 `@arizeai/phoenix-otel` 的 `registerPhoenix`(global),
 * 不再手搓 OTLPExporter/NodeTracerProvider + 一坨 endpoint/header 解析。turn-tracer
 * 用 `trace.getTracer` 自动接上这个全局 provider,逐 turn/tool/llm 的富 span 照常发。
 *
 * 两条初始化路径:
 *  - 编程式 `initRuntimeTelemetry(opts)`：eval / 任何宿主显式开,带 project/url/capture。
 *  - env 兜底 lazy：生产保持 `CRAFT_OTEL_ENABLED` 一开即用,无需改启动代码。
 */

interface RuntimeTelemetryState {
  enabled: boolean
  tracer?: Tracer
  forceFlush?: () => Promise<void>
  shutdown?: () => Promise<void>
}

let telemetryState: RuntimeTelemetryState | null = null
let captureContentFlag = false

function envFlag(name: string, defaultValue = false): boolean {
  const raw = process.env[name]?.trim().toLowerCase()
  if (!raw) return defaultValue
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on'
}

export interface InitRuntimeTelemetryOptions {
  /** Phoenix 项目名(trace 归类),如 'craft-eval' / 'craft-prod'。 */
  projectName: string
  /** Phoenix collector URL;缺省读 PHOENIX_HOST,再缺省 localhost:6006。registerPhoenix 会补 /v1/traces。 */
  url?: string
  /** 鉴权 key;缺省读 PHOENIX_API_KEY。 */
  apiKey?: string
  /** 是否把输入/输出内容写进 span(eval 调试想要;生产默认关)。 */
  captureContent?: boolean
  /** 批量导出(默认 true);eval 传 false → 立即导出,跑完即可读。 */
  batch?: boolean
}

/**
 * 显式初始化 telemetry(幂等)。返回 turn-tracer 消费的 state 形状。
 */
export function initRuntimeTelemetry(opts: InitRuntimeTelemetryOptions): RuntimeTelemetryState {
  if (telemetryState) return telemetryState

  try {
    const provider = registerPhoenix({
      projectName: opts.projectName,
      url: opts.url ?? process.env.PHOENIX_HOST?.trim() ?? 'http://localhost:6006',
      apiKey: opts.apiKey ?? process.env.PHOENIX_API_KEY?.trim(),
      batch: opts.batch ?? true,
    })
    captureContentFlag = opts.captureContent ?? false
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

export function getRuntimeTelemetry(): RuntimeTelemetryState {
  if (telemetryState) return telemetryState

  // 生产 env 兜底:CRAFT_OTEL_ENABLED 一开,首个 turn 触发 lazy 初始化,无需改启动代码。
  if (envFlag('CRAFT_OTEL_ENABLED')) {
    return initRuntimeTelemetry({
      projectName:
        process.env.CRAFT_OTEL_PROJECT?.trim() ||
        process.env.PHOENIX_PROJECT_NAME?.trim() ||
        'craft-prod',
      captureContent: envFlag('CRAFT_OTEL_CAPTURE_CONTENT'),
    })
  }

  telemetryState = { enabled: false }
  return telemetryState
}

export async function shutdownRuntimeTelemetry(): Promise<void> {
  const shutdown = telemetryState?.shutdown
  telemetryState = null
  captureContentFlag = false
  if (shutdown) await shutdown()
}

export function shouldForceFlushPerTurn(): boolean {
  return envFlag('CRAFT_OTEL_FORCE_FLUSH_PER_TURN')
}

export function shouldCaptureTraceContent(): boolean {
  return captureContentFlag || envFlag('CRAFT_OTEL_CAPTURE_CONTENT')
}

export function shouldIncludeRawUserId(): boolean {
  return envFlag('CRAFT_OTEL_INCLUDE_RAW_USER_ID')
}

export function getTraceContentMaxChars(): number {
  const raw = Number(process.env.CRAFT_OTEL_CONTENT_MAX_CHARS ?? 2000)
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 2000
}
