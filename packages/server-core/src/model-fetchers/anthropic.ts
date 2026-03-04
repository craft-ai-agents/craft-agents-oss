/**
 * Anthropic Model Fetcher
 *
 * Provider-agnostic wrapper that delegates model discovery to backend drivers.
 */

import type { ModelFetcher, ModelFetchResult, ModelFetcherCredentials } from '@craft-agent/shared/config'
import type { LlmConnection } from '@craft-agent/shared/config'
import { fetchBackendModels } from '@craft-agent/shared/agent/backend'
import { handlerLog } from './runtime'
import { getHostRuntime } from './runtime'

const ANTHROPIC_TIMEOUT_MS = 30_000

export class AnthropicModelFetcher implements ModelFetcher {
  /** Refresh every 60 minutes */
  readonly refreshIntervalMs = 60 * 60 * 1000

  async fetchModels(
    connection: LlmConnection,
    credentials: ModelFetcherCredentials,
  ): Promise<ModelFetchResult> {
    const result = await fetchBackendModels({
      connection,
      credentials,
      timeoutMs: ANTHROPIC_TIMEOUT_MS,
      hostRuntime: getHostRuntime(),
    })

    handlerLog.info(`Fetched ${result.models.length} Anthropic models: ${result.models.map(m => m.id).join(', ')}`)
    return result
  }
}
