import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { shutdownRuntimeTelemetry } from '@craft-agent/server-core/telemetry'
import type { PermissionMode } from '@craft-agent/shared/agent/mode-types'
import { loadEvalCases } from './cases'
import { runPhoenixEval } from './phoenix'

const DEFAULT_CASES_FILE = fileURLToPath(new URL('../cases/procurement.yaml', import.meta.url))

interface CliOptions {
  casesFile: string
  filter?: string
  limit?: number
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

  return {
    casesFile: resolve(casesFile),
    filter: readArg(args, '--filter'),
    limit: readNumber(args, '--limit', 0) || undefined,
    datasetName: readArg(args, '--dataset')
      ?? process.env.CRAFT_EVAL_DATASET
      ?? 'craft-procurement-regression',
    experimentName: readArg(args, '--experiment'),
    runner,
    workspaceId: readArg(args, '--workspace') ?? process.env.CRAFT_EVAL_WORKSPACE_ID,
    permissionMode: (readArg(args, '--permission-mode') ?? process.env.CRAFT_EVAL_PERMISSION_MODE ?? 'allow-all') as PermissionMode,
    timeoutMs: readNumber(args, '--timeout-ms', Number(process.env.CRAFT_EVAL_TIMEOUT_MS ?? 180_000)),
    repetitions: readNumber(args, '--repetitions', 1),
    concurrency: readNumber(args, '--concurrency', 1),
    phoenixDryRun: readPhoenixDryRun(args),
    record: !hasFlag(args, '--no-record'),
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.runner === 'real' && !options.workspaceId) {
    throw new Error('real runner requires --workspace or CRAFT_EVAL_WORKSPACE_ID')
  }

  const cases = loadEvalCases(options.casesFile, options.filter, options.limit)
  if (cases.length === 0) {
    throw new Error('No eval cases matched the provided filters')
  }

  const experiment = await runPhoenixEval({
    cases,
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
