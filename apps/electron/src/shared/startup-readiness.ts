import type { SetupNeeds } from '@craft-agent/shared/auth/types'

/** Deferred onboarding is a UI preference, never evidence that a production connection works. */
export function productionSetupBlocker(needs: SetupNeeds): string | null {
  if (!needs || typeof needs.needsBillingConfig !== 'boolean' || typeof needs.needsCredentials !== 'boolean') return '模型配置检查返回无效结果，请重试或联系管理员。'
  if (needs.needsMigration) return '模型连接需要重新认证，请联系管理员更新企业模型授权。'
  if (needs.needsBillingConfig) return '尚未配置企业模型连接，请联系管理员完成部署配置后重试。'
  if (needs.needsCredentials) return '企业模型连接缺少有效凭据，请联系管理员更新授权后重试。'
  return null
}
