import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getCredentialManager } from '@craft-agent/shared/credentials'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from './handler-deps'

export const GUI_HANDLED_CHANNELS = [
  RPC_CHANNELS.power.SET_KEEP_AWAKE,
  RPC_CHANNELS.settings.SET_NETWORK_PROXY,
  RPC_CHANNELS.copilot.GET_PREMIUM_USAGE,
  RPC_CHANNELS.copilot.SET_BILLING_PAT,
  RPC_CHANNELS.copilot.CLEAR_BILLING_PAT,
] as const

// ============================================================
// Copilot Premium Request Usage
// ============================================================

interface PremiumUsageResult {
  used: number
  limit: number
  percentRemaining: number
  resetDate: string
  plan?: string
  unlimited?: boolean
  overageEnabled?: boolean
  error?: string
}

let usageCache: { result: PremiumUsageResult; timestamp: number } | null = null
const CACHE_TTL_MS = 30 * 1000 // 30 seconds

async function fetchPremiumUsage(): Promise<PremiumUsageResult> {
  // Read PAT from env var or secure credential store (never plaintext file)
  let pat = process.env.GITHUB_BILLING_PAT
  if (!pat) {
    const manager = getCredentialManager()
    pat = await manager.getLlmApiKey('__copilot-billing') ?? undefined
  }
  if (!pat) {
    return { used: 0, limit: 0, percentRemaining: 100, resetDate: '', error: 'No GitHub billing PAT configured' }
  }

  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${pat}`,
    'User-Agent': 'CraftAgent/1.0',
  }

  try {
    // WARNING: This is an undocumented internal GitHub API (used by VS Code's Copilot
    // extension). There is no public/stable alternative for fetching premium quota
    // snapshots. It could break without notice on any GitHub deployment. Monitor for
    // unexpected 404/403 responses and be prepared to adapt if the endpoint changes.
    const res = await fetch('https://api.github.com/copilot_internal/user', { headers })
    if (!res.ok) {
      return { used: 0, limit: 0, percentRemaining: 100, resetDate: '', error: `Copilot API error: ${res.status}` }
    }

    const data = await res.json()
    const premiumQuota = data.quota_snapshots?.premium_interactions
    const resetDate = data.quota_reset_date_utc ?? data.quota_reset_date ?? ''

    if (!premiumQuota) {
      return { used: 0, limit: 0, percentRemaining: 100, resetDate, error: 'No premium quota data' }
    }

    if (premiumQuota.unlimited) {
      return { used: 0, limit: 0, percentRemaining: 100, resetDate, plan: data.copilot_plan, unlimited: true }
    }

    const entitlement = premiumQuota.entitlement ?? 0
    const remaining = premiumQuota.remaining ?? 0
    const percentRemaining = premiumQuota.percent_remaining ?? 0
    const used = entitlement - remaining

    return {
      used: Math.round(used),
      limit: entitlement,
      percentRemaining,
      resetDate,
      plan: data.copilot_plan,
      overageEnabled: premiumQuota.overage_permitted ?? false,
    }
  } catch (err) {
    return {
      used: 0,
      limit: 0,
      percentRemaining: 100,
      resetDate: '',
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

// ============================================================
// GUI-only settings (require Electron-specific APIs)
// ============================================================

export function registerSettingsGuiHandlers(server: RpcServer, _deps: HandlerDeps): void {
  // Copilot premium request usage (personal feature — reads GITHUB_BILLING_PAT env)
  server.handle(RPC_CHANNELS.copilot.GET_PREMIUM_USAGE, async () => {
    // Check cache
    if (usageCache && Date.now() - usageCache.timestamp < CACHE_TTL_MS) {
      return usageCache.result
    }
    const result = await fetchPremiumUsage()
    if (!result.error) {
      usageCache = { result, timestamp: Date.now() }
    }
    return result
  })

  // Store GitHub billing PAT securely (AES-256-GCM via CredentialManager)
  server.handle(RPC_CHANNELS.copilot.SET_BILLING_PAT, async (_ctx, pat: string) => {
    const manager = getCredentialManager()
    await manager.setLlmApiKey('__copilot-billing', pat)
    usageCache = null // Invalidate cache so next fetch uses the new PAT
    return { success: true }
  })

  // Remove GitHub billing PAT from credential store
  server.handle(RPC_CHANNELS.copilot.CLEAR_BILLING_PAT, async () => {
    const manager = getCredentialManager()
    await manager.deleteLlmApiKey('__copilot-billing')
    usageCache = null
    return { success: true }
  })

  // Set keep awake while running setting (requires Electron power-manager)
  server.handle(RPC_CHANNELS.power.SET_KEEP_AWAKE, async (_ctx, enabled: boolean) => {
    const { setKeepAwakeWhileRunning } = await import('@craft-agent/shared/config/storage')
    const { setKeepAwakeSetting } = await import('../power-manager')
    // Save to config
    setKeepAwakeWhileRunning(enabled)
    // Update the power manager's cached value and power state
    setKeepAwakeSetting(enabled)
  })

  // Set network proxy settings (requires Electron session proxy)
  server.handle(RPC_CHANNELS.settings.SET_NETWORK_PROXY, async (_ctx, settings: import('@craft-agent/shared/config/types').NetworkProxySettings) => {
    const { updateConfiguredProxySettings } = await import('../network-proxy')
    await updateConfiguredProxySettings(settings)
  })
}
