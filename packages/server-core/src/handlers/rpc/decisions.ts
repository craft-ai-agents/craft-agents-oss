/**
 * Decision layer (Jev / TypeSafe System One) RPC handlers.
 *
 * Settings + key management + one-shot connectivity test for the Settings > AI
 * card. Everything here is opt-in configuration; no handler runs a decision
 * that affects permissions or session behaviour.
 */

import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { isDecisionProviderId, type DecisionProviderId } from '@craft-agent/shared/decisions/types'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.decisions.GET_SETTINGS,
  RPC_CHANNELS.decisions.SET_SETTINGS,
  RPC_CHANNELS.decisions.GET_STATUS,
  RPC_CHANNELS.decisions.SET_API_KEY,
  RPC_CHANNELS.decisions.DELETE_API_KEY,
  RPC_CHANNELS.decisions.TEST,
  RPC_CHANNELS.decisions.PROBE_SERVER,
  RPC_CHANNELS.decisions.GET_USAGE,
] as const

/** Settings shows what each feature did over this window. */
const USAGE_WINDOW_MS = 7 * 24 * 3_600_000

function assertProvider(provider: unknown): asserts provider is DecisionProviderId {
  if (!isDecisionProviderId(provider)) {
    throw new Error(`Invalid decision provider: ${String(provider)}`)
  }
}

export function registerDecisionsHandlers(server: RpcServer, _deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.decisions.GET_SETTINGS, async () => {
    const { getDecisionLayerSettings } = await import('@craft-agent/shared/config/storage')
    return getDecisionLayerSettings()
  })

  server.handle(RPC_CHANNELS.decisions.SET_SETTINGS, async (_ctx, patch: Record<string, unknown>) => {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new Error('Decision settings patch must be an object')
    }
    const { setDecisionLayerSettings } = await import('@craft-agent/shared/config/storage')
    return setDecisionLayerSettings(patch)
  })

  server.handle(RPC_CHANNELS.decisions.GET_STATUS, async () => {
    const { getDecisionLayerStatus } = await import('@craft-agent/shared/decisions')
    return getDecisionLayerStatus()
  })

  server.handle(RPC_CHANNELS.decisions.SET_API_KEY, async (_ctx, provider: string, apiKey: string) => {
    assertProvider(provider)
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      throw new Error('API key must not be empty')
    }
    const { getCredentialManager } = await import('@craft-agent/shared/credentials')
    await getCredentialManager().setDecisionApiKey(provider, apiKey.trim())
  })

  server.handle(RPC_CHANNELS.decisions.DELETE_API_KEY, async (_ctx, provider: string) => {
    assertProvider(provider)
    const { getCredentialManager } = await import('@craft-agent/shared/credentials')
    return getCredentialManager().deleteDecisionApiKey(provider)
  })

  // Local servers (Laya, custom): GET {baseUrl}/health so the Settings card can say whether
  // the server is up and which checkpoints it loaded. Never throws; no key is sent.
  server.handle(RPC_CHANNELS.decisions.PROBE_SERVER, async (_ctx, options?: { baseUrl?: string }) => {
    const { probeConfiguredDecisionServer } = await import('@craft-agent/shared/decisions')
    return probeConfiguredDecisionServer(undefined, {
      baseUrlOverride: typeof options?.baseUrl === 'string' ? options.baseUrl : undefined,
    })
  })

  // Per-toggle checks, failures and changes from decisions.jsonl (and its rotated copy).
  server.handle(RPC_CHANNELS.decisions.GET_USAGE, async () => {
    const { readDecisionToggleUsage } = await import('@craft-agent/shared/decisions')
    return readDecisionToggleUsage(new Date(Date.now() - USAGE_WINDOW_MS))
  })

  server.handle(RPC_CHANNELS.decisions.TEST, async (_ctx, options?: { settings?: Record<string, unknown>; apiKey?: string }) => {
    const { testDecisionConnection } = await import('@craft-agent/shared/decisions')
    return testDecisionConnection({
      settings: options?.settings as import('@craft-agent/shared/decisions').DecisionLayerSettingsPatch | undefined,
      apiKey: typeof options?.apiKey === 'string' ? options.apiKey : undefined,
    })
  })
}
