/**
 * Copilot Model Fetcher
 *
 * Provider-agnostic wrapper that delegates model discovery to backend drivers.
 */

import { app } from 'electron'
import type { ModelFetcher, ModelFetchResult, ModelFetcherCredentials } from '@craft-agent/shared/config'
import type { LlmConnection } from '@craft-agent/shared/config'
import { fetchBackendModels } from '@craft-agent/shared/agent/backend'
import { ipcLog } from '../logger'

const COPILOT_TIMEOUT_MS = 30_000

export class CopilotModelFetcher implements ModelFetcher {
  /** No periodic refresh — fetch on auth only */
  readonly refreshIntervalMs = 0

  async fetchModels(
    connection: LlmConnection,
    credentials: ModelFetcherCredentials,
  ): Promise<ModelFetchResult> {
    const result = await fetchBackendModels({
      connection,
      credentials,
      timeoutMs: COPILOT_TIMEOUT_MS,
      hostRuntime: {
        appRootPath: app.isPackaged ? app.getAppPath() : process.cwd(),
        resourcesPath: process.resourcesPath,
        isPackaged: app.isPackaged,
      },
    })

    ipcLog.info(`Fetched ${result.models.length} Copilot models: ${result.models.map(m => m.id).join(', ')}`)
    return result
  }
}
