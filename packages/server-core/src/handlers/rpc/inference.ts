/**
 * Inference history RPC handlers (server-core).
 *
 * Reads from the shared `inferenceStore` singleton and returns per-connection
 * inference history to clients for the ProvidersPanel sparkline display.
 *
 * This handler lives in server-core so that remote-server deployments and
 * local Electron instances use the same code path. The `inferenceStore`
 * is a process-wide singleton from `@archstudio/shared/agent/core`.
 */

import { RPC_CHANNELS } from '@archstudio/shared/protocol'
import { inferenceStore } from '@archstudio/shared/agent/core'
import type { RpcServer } from '@archstudio/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const CORE_HANDLED_CHANNELS = [
  RPC_CHANNELS.llmInference.HISTORY,
  RPC_CHANNELS.llmInference.HISTORY_ALL,
] as const

export function registerInferenceHandlers(server: RpcServer, _deps: HandlerDeps): void {
  // Wire the store's push callback to broadcast UPDATED to all connected clients.
  // When an agent backend records a turn or tool-call event, the renderer learns
  // about it immediately instead of waiting for the next 5s poll.
  inferenceStore.onEvent = (slug) => {
    server.push(RPC_CHANNELS.llmInference.UPDATED, { to: 'all' }, { slug })
  }

  server.handle(RPC_CHANNELS.llmInference.HISTORY, async (_ctx, slug: string) => {
    return inferenceStore.getHistoryResult(slug)
  })

  server.handle(RPC_CHANNELS.llmInference.HISTORY_ALL, async () => {
    return inferenceStore.getAllHistory()
  })
}
