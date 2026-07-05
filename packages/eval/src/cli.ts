import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initRuntimeTelemetry, shutdownRuntimeTelemetry } from '@craft-agent/server-core/telemetry'
import type { PermissionMode } from '@craft-agent/shared/agent/mode-types'
import { loadEvalCases } from './cases'
import { getEvaluators, EVALUATOR_SETS } from './evaluators'
import { runPhoenixEval } from './phoenix'

// 默认 = 回归池(发版闸,小而硬)。case 只收黄金数据:真实故障沉淀 + 人工标注参考答案,
// 不收合成/生成的(历史教训:100 条 Base 快照生成 case 随活数据漂移烂掉,已删)。
const DEFAULT_CASES_FILE = fileURLToPath(new URL('../cases/procurement-regressions.yaml', import.meta.url))

interface CliOptions {
  casesFile: string
  filter?: string
  limit?: number
  scenario: string
  datasetName: string
  experimentName?: string
  runner: 'real' | 'dry-run'
  workspaceId?: string
  permissionMode: PermissionMode
  timeoutMs: number
  repetitions: number
  concurrency: number
  phoenixDryRun?: boolean | number
  record: boolean
}

function readArg(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  return args[index + 1]
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name)
}

function readNumber(args: string[], name: string, fallback: number): number {
  const value = readArg(args, name)
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function readPhoenixDryRun(args: string[]): boolean | number | undefined {
  const value = readArg(args, '--phoenix-dry-run')
  if (!value) return hasFlag(args, '--phoenix-dry-run') ? true : undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : true
}

function parseArgs(args: string[]): CliOptions {
  const runner = readArg(args, '--runner') ?? process.env.CRAFT_EVAL_RUNNER ?? 'real'
  if (runner !== 'real' && runner !== 'dry-run') {
    throw new Error(`Invalid --runner ${runner}; expected real or dry-run`)
  }

  const casesFile = readArg(args, '--cases')
    ?? process.env.CRAFT_EVAL_CASES
    ?? DEFAULT_CASES_FILE

  const scenario = readArg(args, '--scenario') ?? 'regression'
  if (!(scenario in EVALUATOR_SETS)) {
    throw new Error(`Unknown --scenario ${scenario}. Available: ${Object.keys(EVALUATOR_SETS).join(', ')}`)
  }

  // real runner 默认并发 3(黄金集小,几分钟出闸)。per-case trace 标签走进程级
  // env,只在串行(concurrency=1)时打;并发时靠 run 输出的 sessionId ↔ span 的
  // session.id 属性互相定位,每 case 独立 SessionManager,互不冲突。
  const concurrency = readNumber(args, '--concurrency', runner === 'real' ? 3 : 1)

  return {
    casesFile: resolve(casesFile),
    filter: readArg(args, '--filter'),
    limit: readNumber(args, '--limit', 0) || undefined,
    scenario,
    datasetName: readArg(args, '--dataset')
      ?? process.env.CRAFT_EVAL_DATASET
      ?? `craft-${scenario}`,
    experimentName: readArg(args, '--experiment'),
    runner,
    workspaceId: readArg(args, '--workspace') ?? process.env.CRAFT_EVAL_WORKSPACE_ID,
    permissionMode: (readArg(args, '--permission-mode') ?? process.env.CRAFT_EVAL_PERMISSION_MODE ?? 'allow-all') as PermissionMode,
    timeoutMs: readNumber(args, '--timeout-ms', Number(process.env.CRAFT_EVAL_TIMEOUT_MS ?? 180_000)),
    repetitions: readNumber(args, '--repetitions', 1),
    concurrency,
    phoenixDryRun: readPhoenixDryRun(args),
    record: !hasFlag(args, '--no-record'),
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.runner === 'real' && !options.workspaceId) {
    throw new Error('real runner requires --workspace or CRAFT_EVAL_WORKSPACE_ID')
  }

  // 自动开 trace:每条 agent turn 的 span 发到 craft-eval 项目,嵌在实验 run 下可下钻。
  // batch=false → 跑完立即可读;无需手设一堆 CRAFT_OTEL_* env。
  if (options.runner === 'real') {
    initRuntimeTelemetry({
      projectName: process.env.CRAFT_EVAL_PROJECT?.trim() || 'craft-eval',
      url: process.env.PHOENIX_HOST?.trim() || 'http://localhost:6006',
      captureContent: true,
      batch: false,
    })
  }

  const cases = loadEvalCases(options.casesFile, options.filter, options.limit)
  if (cases.length === 0) {
    throw new Error('No eval cases matched the provided filters')
  }

  const evaluators = getEvaluators(options.scenario)
  const experiment = await runPhoenixEval({
    cases,
    evaluators,
    datasetName: options.datasetName,
    datasetDescription: `Craft Agent eval dataset generated from ${options.casesFile}`,
    experimentName: options.experimentName,
    experimentDescription: 'Runs Craft Agent cases through Phoenix experiments.',
    runner: options.runner,
    realRunnerOptions: options.runner === 'real'
      ? {
          workspaceId: options.workspaceId!,
          permissionMode: options.permissionMode,
          timeoutMs: options.timeoutMs,
          tagTurnSpans: options.concurrency === 1,
        }
      : undefined,
    repetitions: options.repetitions,
    concurrency: options.concurrency,
    phoenixDryRun: options.phoenixDryRun,
    record: options.record,
  })

  console.log(JSON.stringify({
    experimentId: experiment.id,
    datasetId: experiment.datasetId,
    successfulRunCount: experiment.successfulRunCount,
    failedRunCount: experiment.failedRunCount,
    missingRunCount: experiment.missingRunCount,
  }, null, 2))
}

try {
  await main()
  await shutdownRuntimeTelemetry()
  process.exit(0)
} catch (error) {
  await shutdownRuntimeTelemetry().catch(() => {})
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exit(1)
}
