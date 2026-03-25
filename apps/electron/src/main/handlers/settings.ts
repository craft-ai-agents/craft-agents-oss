import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from './handler-deps'

export const GUI_HANDLED_CHANNELS = [
  RPC_CHANNELS.power.SET_KEEP_AWAKE,
  RPC_CHANNELS.settings.SET_NETWORK_PROXY,
  RPC_CHANNELS.copilot.GET_PREMIUM_USAGE,
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
  // Read PAT from config file or env var
  let pat = process.env.GITHUB_BILLING_PAT
  try {
    const os = await import('os')
    const fs = await import('fs')
    const path = await import('path')
    const configPath = path.join(os.homedir(), '.craft-agent', 'github-billing.json')
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    if (!pat) pat = config.pat
  } catch { /* file doesn't exist or is invalid */ }
  if (!pat) {
    return { used: 0, limit: 0, percentRemaining: 100, resetDate: '', error: 'No GitHub billing PAT configured' }
  }

  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${pat}`,
    'User-Agent': 'CraftAgent/1.0',
  }

  try {
    // Use the same internal API that VS Code uses — returns exact quota snapshots
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
