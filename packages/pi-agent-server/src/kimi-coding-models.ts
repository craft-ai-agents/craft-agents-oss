import type { ModelRegistry as PiModelRegistry } from '@earendil-works/pi-coding-agent'
import type { Api, Model } from '@earendil-works/pi-ai'
import {
  KIMI_CODING_BASE_URL,
  KIMI_CODING_HEADERS,
  KIMI_CODING_MODELS,
} from '../../shared/src/config/kimi-coding.ts'

type ProviderModelConfig = {
  id: string
  name: string
  api?: Api
  baseUrl?: string
  reasoning: boolean
  thinkingLevelMap?: Model<Api>['thinkingLevelMap']
  input: Array<'text' | 'image'>
  cost: Model<Api>['cost']
  contextWindow: number
  maxTokens: number
  headers?: Record<string, string>
  compat?: Model<Api>['compat']
}

function toProviderModelConfig(model: Model<Api>): ProviderModelConfig {
  return {
    id: model.id,
    name: model.name,
    api: model.api,
    baseUrl: model.baseUrl,
    reasoning: model.reasoning,
    thinkingLevelMap: model.thinkingLevelMap,
    input: [...model.input],
    cost: { ...model.cost },
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    headers: model.headers ? { ...model.headers } : undefined,
    compat: model.compat,
  }
}

/**
 * Add current Kimi models while retaining legacy IDs for existing connections.
 */
export function buildKimiCodingProviderModels(existingModels: Model<Api>[]): ProviderModelConfig[] {
  const modelsById = new Map(
    existingModels
      .filter(model => model.provider === 'kimi-coding')
      .map(model => [model.id, toProviderModelConfig(model)]),
  )

  for (const model of KIMI_CODING_MODELS) {
    modelsById.set(model.id, {
      ...model,
      api: 'anthropic-messages',
      baseUrl: KIMI_CODING_BASE_URL,
      input: [...model.input],
      cost: { ...model.cost },
      headers: { ...KIMI_CODING_HEADERS },
    })
  }

  return [...modelsById.values()]
}

/**
 * Register K3 into the pinned Pi 0.80 runtime under the existing Kimi provider.
 */
export function registerKimiCodingModels(
  registry: PiModelRegistry,
  apiKey: string,
): void {
  registry.registerProvider('kimi-coding', {
    name: 'Kimi For Coding',
    baseUrl: KIMI_CODING_BASE_URL,
    apiKey,
    api: 'anthropic-messages',
    headers: { ...KIMI_CODING_HEADERS },
    models: buildKimiCodingProviderModels(registry.getAll()),
  })
}
