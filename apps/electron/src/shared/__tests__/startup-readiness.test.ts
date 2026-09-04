import { describe, expect, test } from 'bun:test'
import { productionSetupBlocker } from '../startup-readiness'

describe('production setup readiness', () => {
  test('does not accept deferred onboarding as configured credentials', () => {
    expect(productionSetupBlocker({ isFullyConfigured: true, needsBillingConfig: true, needsCredentials: false })).toContain('尚未配置')
    expect(productionSetupBlocker({ isFullyConfigured: true, needsBillingConfig: false, needsCredentials: true })).toContain('凭据')
  })
  test('blocks migration and accepts configured state without claiming connectivity', () => {
    expect(productionSetupBlocker({} as any)).toContain('无效结果')
    expect(productionSetupBlocker({ isFullyConfigured: true, needsBillingConfig: false, needsCredentials: false, needsMigration: { reason: 'legacy_token', message: 'old' } })).toContain('重新认证')
    expect(productionSetupBlocker({ isFullyConfigured: true, needsBillingConfig: false, needsCredentials: false })).toBeNull()
  })
})
