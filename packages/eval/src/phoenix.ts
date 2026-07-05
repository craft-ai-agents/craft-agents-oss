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
 * - 同名 dataset 存在且 case id 集合完全一致 → 直接复用,零新建。
 * - case 集合变了 → 建 `<name>@YYYY-MM-DD` 新 dataset(显式、可追溯),旧的留作历史。
 * - 不存在 → 按原名新建。
 */
async function ensureDataset(
  client: ReturnType<typeof createClient>,
  name: string,
  description: string,
  examples: Example[],
): Promise<string> {
  const wantedIds = new Set(examples.map((e) => String(e.metadata?.id ?? '')))
  try {
    const info = await getDatasetInfo({ client, dataset: { datasetName: name } })
    const existing = await getDatasetExamples({ client, dataset: { datasetId: info.id } })
    const existingIds = new Set(existing.examples.map((e) => String((e.metadata as Record<string, unknown>)?.id ?? '')))
    const identical = existingIds.size === wantedIds.size && [...wantedIds].every((id) => existingIds.has(id))
    if (identical) return info.id

    const datedName = `${name}@${new Date().toISOString().slice(0, 10)}`
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
