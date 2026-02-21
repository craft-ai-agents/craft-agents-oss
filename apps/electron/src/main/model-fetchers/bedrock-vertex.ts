/**
 * Bedrock/Vertex Model Fetcher (stub)
 *
 * Provider-agnostic wrapper that delegates model discovery to backend drivers.
 */

import { app } from 'electron'
import type { ModelFetcher, ModelFetchResult, ModelFetcherCredentials } from '@craft-agent/shared/config'
import type { LlmConnection } from '@craft-agent/shared/config'
import { fetchBackendModels } from '@craft-agent/shared/agent/backend'

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
      hostRuntime: {
        appRootPath: app.isPackaged ? app.getAppPath() : process.cwd(),
        resourcesPath: process.resourcesPath,
        isPackaged: app.isPackaged,
      },
    })
  }
}
