/**
 * Pi Model Fetcher
 *
 * Provider-agnostic wrapper that delegates model discovery to backend drivers.
 */

import type { ModelFetcher, ModelFetchResult, ModelFetcherCredentials } from '@craft-agent/shared/config'
import type { LlmConnection } from '@craft-agent/shared/config'
import { fetchBackendModels } from '@craft-agent/shared/agent/backend'
import { getHostRuntime } from './runtime'

export class PiModelFetcher implements ModelFetcher {
  /** No periodic refresh — SDK models are static, updated on app upgrade */
  readonly refreshIntervalMs = 0

  async fetchModels(
    connection: LlmConnection,
    credentials: ModelFetcherCredentials,
  ): Promise<ModelFetchResult> {
    // Copilot OAuth needs longer timeout (CLI startup + API call)
    const isCopilot = connection.piAuthProvider === 'github-copilot'
    return fetchBackendModels({
      connection,
      credentials,
      timeoutMs: isCopilot ? 30_000 : 15_000,
      hostRuntime: getHostRuntime(),
    })
  }
}
