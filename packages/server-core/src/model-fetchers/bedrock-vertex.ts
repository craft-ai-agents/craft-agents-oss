/**
 * Bedrock/Vertex Model Fetcher (stub)
 *
 * Provider-agnostic wrapper that delegates model discovery to backend drivers.
 */

import type { ModelFetcher, ModelFetchResult, ModelFetcherCredentials } from '@archstudio/shared/config'
import type { LlmConnection } from '@archstudio/shared/config'
import { fetchBackendModels } from '@archstudio/shared/agent/backend'
import { getHostRuntime } from './runtime'

export class BedrockVertexModelFetcher implements ModelFetcher {
  /** No periodic refresh — models come from persisted cache / registry only */
  readonly refreshIntervalMs = 0

  async fetchModels(
    connection: LlmConnection,
    credentials: ModelFetcherCredentials,
  ): Promise<ModelFetchResult> {
    return fetchBackendModels({
      connection,
      credentials,
      timeoutMs: 15_000,
      hostRuntime: getHostRuntime(),
    })
  }
}
