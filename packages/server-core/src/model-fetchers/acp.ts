/**
 * ACP Model Fetcher
 *
 * Fetches models from ACP (Agent Client Protocol) connections on startup.
 * Delegates to the ACP driver's fetchModels which probes the ACP server
 * via initialize + session/new, falling back to --list-models if needed.
 */

import type { ModelFetcher, ModelFetchResult, ModelFetcherCredentials } from '@craft-agent/shared/config'
import type { LlmConnection } from '@craft-agent/shared/config'
import { fetchBackendModels } from '@craft-agent/shared/agent/backend'
import { getHostRuntime } from './runtime'

export class AcpModelFetcher implements ModelFetcher {
  /** No periodic refresh — model list is static per ACP server */
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
