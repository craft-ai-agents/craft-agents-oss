import { describe, expect, it } from 'bun:test'
import type { SetupNeeds } from '@craft-agent/shared/auth'
import type { LlmConnectionWithStatus } from '@craft-agent/shared/config'
import { resolveAuthenticatedStartupState } from '../app-startup'

const needsOnboarding: SetupNeeds = {
  needsBillingConfig: true,
  needsCredentials: false,
  isFullyConfigured: false,
}

function connection(overrides: Partial<LlmConnectionWithStatus>): LlmConnectionWithStatus {
  return {
    slug: 'anthropic-api',
    name: 'Anthropic',
    providerType: 'anthropic',
    authType: 'api_key',
    createdAt: 1,
    isAuthenticated: true,
    ...overrides,
  }
}

describe('resolveAuthenticatedStartupState', () => {
  it('skips onboarding when an authenticated environment connection is available', async () => {
    const state = await resolveAuthenticatedStartupState({
      setupNeeds: needsOnboarding,
      windowWorkspaceId: null,
      listLlmConnectionsWithStatus: async () => [
        connection({
          slug: 'env-provider',
          name: 'Environment',
          providerType: 'pi_compat',
          authType: 'none',
          isEnvironmentConnection: true,
        }),
      ],
    })

    expect(state).toBe('workspace-picker')
  })

  it('keeps onboarding unchanged when no environment connection is available', async () => {
    const state = await resolveAuthenticatedStartupState({
      setupNeeds: needsOnboarding,
      windowWorkspaceId: null,
      listLlmConnectionsWithStatus: async () => [connection({})],
    })

    expect(state).toBe('onboarding')
  })
})
