/**
 * Inference history IPC handlers.
 *
 * Reads from the singleton `inferenceStore` (shared across all agent backends)
 * and returns per-connection inference history to the renderer for the
 * ProvidersPanel sparkline display.
 */

import { RPC_CHANNELS } from '@archstudio/shared/protocol'
import { inferenceStore } from '@archstudio/shared/agent/core'
import type { RpcServer } from '@archstudio/server-core/transport'
import type { HandlerDeps } from './handler-deps'

export const CORE_HANDLED_CHANNELS = [
  RPC_CHANNELS.llmInference.HISTORY,
  RPC_CHANNELS.llmInference.HISTORY_ALL,
] as const

export function registerInferenceHandlers(server: RpcServer, _deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.llmInference.HISTORY, async (_ctx, slug: string) => {
    return inferenceStore.getHistoryResult(slug)
  })

  server.handle(RPC_CHANNELS.llmInference.HISTORY_ALL, async () => {
    return inferenceStore.getAllHistory()
  })
}
