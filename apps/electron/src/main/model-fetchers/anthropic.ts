/**
 * Anthropic Model Fetcher
 *
 * Provider-agnostic wrapper that delegates model discovery to backend drivers.
 */

import { app } from 'electron'
import type { ModelFetcher, ModelFetchResult, ModelFetcherCredentials } from '@craft-agent/shared/config'
import type { LlmConnection } from '@craft-agent/shared/config'
import { fetchBackendModels } from '@craft-agent/shared/agent/backend'
import { ipcLog } from '../logger'

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
      hostRuntime: {
        appRootPath: app.isPackaged ? app.getAppPath() : process.cwd(),
        resourcesPath: process.resourcesPath,
        isPackaged: app.isPackaged,
      },
    })

    ipcLog.info(`Fetched ${result.models.length} Anthropic models: ${result.models.map(m => m.id).join(', ')}`)
    return result
  }
}
