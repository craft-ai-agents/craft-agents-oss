import { createHash } from 'node:crypto'
import { createClient } from '@arizeai/phoenix-client'
import { createDataset, getDatasetExamples, getDatasetInfo } from '@arizeai/phoenix-client/datasets'
import { runExperiment } from '@arizeai/phoenix-client/experiments'
import type { ExperimentTask } from '@arizeai/phoenix-client/types/experiments'
import type { ExperimentEvaluatorLike } from '@arizeai/phoenix-client/types/experiments'
import type { Example } from '@arizeai/phoenix-client/types/datasets'
import { casesToPhoenixExamples } from './cases'
import { runCraftAgentCase, type CraftAgentRunnerOptions } from './runner/craft-agent'
import { runDryCase } from './runner/dry-run'
import type { CraftEvalOutput, EvalCase, EvalTaskInput } from './types'

export interface RunPhoenixEvalOptions {
  cases: EvalCase[]
  evaluators: ExperimentEvaluatorLike[]
  datasetName: string
  datasetDescription: string
  experimentName?: string
  experimentDescription?: string
  runner: 'real' | 'dry-run'
  realRunnerOptions?: CraftAgentRunnerOptions
  repetitions: number
  concurrency: number
  phoenixDryRun?: boolean | number
  record: boolean
}

/**
 * dataset 复用语义(治"每跑一次建一个 dataset,列表全是碎片"):
 * - 同名 dataset 存在且 case **内容**(input+expected)完全一致 → 直接复用,零新建。
 *   判据必须是内容哈希而非 id 集合——id 没变、expected 改了的 case 若复用旧集,
 *   实验会拿旧断言判新行为(第 4 跑实锤翻车过)。
 * - 内容变了 → 建 `<name>@YYYY-MM-DDTHH-mm` 新 dataset(显式、可追溯),旧的留历史。
 * - 不存在 → 按原名新建。
 */
/** 键序无关的规范化序列化——Phoenix 返回的 JSON 键序和本地不同,裸 stringify 永不相等,
 *  会导致每跑都误判"内容变了"而新建 dataset(dataset 3→4 实锤过)。 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object') {
    return '{' + Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
      .join(',') + '}'
  }
  return JSON.stringify(value)
}

function exampleFingerprint(input: unknown, output: unknown): string {
  return createHash('sha1')
    .update(canonical(input) + '\u0000' + canonical(output))
    .digest('hex')
}

async function ensureDataset(
  client: ReturnType<typeof createClient>,
  name: string,
  description: string,
  examples: Example[],
): Promise<string> {
  const wanted = new Set(examples.map((e) => exampleFingerprint(e.input, e.output)))
  try {
    const info = await getDatasetInfo({ client, dataset: { datasetName: name } })
    const existing = await getDatasetExamples({ client, dataset: { datasetId: info.id } })
    const existingFps = new Set(existing.examples.map((e) => exampleFingerprint(e.input, e.output)))
    const identical = existingFps.size === wanted.size && [...wanted].every((fp) => existingFps.has(fp))
    if (identical) return info.id

    const datedName = `${name}@${new Date().toISOString().slice(0, 16).replace(':', '-')}`
    const { datasetId } = await createDataset({ client, name: datedName, description, examples })
    return datasetId
  } catch {
    const { datasetId } = await createDataset({ client, name, description, examples })
    return datasetId
  }
}

export async function runPhoenixEval(options: RunPhoenixEvalOptions) {
  const client = createClient()
  const examples = casesToPhoenixExamples(options.cases)
  const datasetId = await ensureDataset(client, options.datasetName, options.datasetDescription, examples)

  const task: ExperimentTask = async (example): Promise<CraftEvalOutput> => {
    const input = example.input as unknown as EvalTaskInput
    if (options.runner === 'dry-run') {
      return runDryCase(input)
    }
    if (!options.realRunnerOptions) {
      throw new Error('real runner requires workspace configuration')
    }
    return runCraftAgentCase(input, options.realRunnerOptions)
  }

  return runExperiment({
    client,
    dataset: { datasetId },
    experimentName: options.experimentName,
    experimentDescription: options.experimentDescription,
    experimentMetadata: {
      runner: options.runner,
      caseCount: options.cases.length,
      workspaceId: options.realRunnerOptions?.workspaceId ?? null,
    },
    task,
    evaluators: options.evaluators,
    repetitions: options.repetitions,
    concurrency: options.concurrency,
    dryRun: options.phoenixDryRun,
    record: options.record,
  })
}
