import { createDataset } from '@arizeai/phoenix-client/datasets'
import { runExperiment } from '@arizeai/phoenix-client/experiments'
import type { ExperimentTask } from '@arizeai/phoenix-client/types/experiments'
import { casesToPhoenixExamples } from './cases'
import { defaultEvaluators } from './evaluators'
import { runCraftAgentCase, type CraftAgentRunnerOptions } from './runner/craft-agent'
import { runDryCase } from './runner/dry-run'
import type { CraftEvalOutput, EvalCase, EvalTaskInput } from './types'

export interface RunPhoenixEvalOptions {
  cases: EvalCase[]
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

export async function runPhoenixEval(options: RunPhoenixEvalOptions) {
  const examples = casesToPhoenixExamples(options.cases)
  const { datasetId } = await createDataset({
    name: options.datasetName,
    description: options.datasetDescription,
    examples,
  })

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
    dataset: { datasetId },
    experimentName: options.experimentName,
    experimentDescription: options.experimentDescription,
    experimentMetadata: {
      runner: options.runner,
      caseCount: options.cases.length,
      workspaceId: options.realRunnerOptions?.workspaceId ?? null,
    },
    task,
    evaluators: defaultEvaluators,
    repetitions: options.repetitions,
    concurrency: options.concurrency,
    dryRun: options.phoenixDryRun,
    record: options.record,
  })
}

