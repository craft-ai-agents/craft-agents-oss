import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../../handler-deps'

let setupDeferred = false
let setupDeferredReadCount = 0
const setupDeferredCalls: boolean[] = []
let oauthPreparationCalls = 0

mock.module('@craft-agent/shared/auth', () => ({
  getAuthState: async () => ({
    billing: {
      type: null,
      hasCredentials: false,
      apiKey: null,
      claudeOAuthToken: null,
    },
    workspace: { hasWorkspace: false, active: null },
  }),
  getSetupNeeds: (_state: unknown, deferred?: boolean) => ({
    needsBillingConfig: true,
    needsCredentials: false,
    isFullyConfigured: true,
    isSetupDeferred: deferred === true,
    shouldShowOnboardingOnLaunch: false,
  }),
  prepareClaudeOAuth: () => {
    oauthPreparationCalls += 1
    return 'https://example.test/oauth'
  },
  exchangeClaudeCode: async () => ({ accessToken: 'test-token' }),
  hasValidOAuthState: () => false,
  clearOAuthState: () => {},
  prepareMcpOAuth: async () => {
    oauthPreparationCalls += 1
    return {
      authUrl: 'https://example.test/oauth',
      state: 'test-state',
      codeVerifier: 'test-verifier',
      tokenEndpoint: 'https://example.test/token',
      clientId: 'test-client',
      redirectUri: 'http://127.0.0.1/callback',
    }
  },
}))

mock.module('@craft-agent/shared/config/storage', () => ({
  isSetupDeferred: () => {
    setupDeferredReadCount += 1
    return setupDeferred
  },
  setSetupDeferred: (deferred: boolean) => {
    setupDeferredCalls.push(deferred)
    setupDeferred = deferred
  },
}))

mock.module('@craft-agent/shared/credentials', () => ({
  getCredentialManager: () => ({
    setLlmOAuth: async () => {},
    setClaudeOAuthCredentials: async () => {},
  }),
}))

mock.module('@craft-agent/shared/mcp', () => ({
  validateMcpConnection: async () => ({ success: true }),
}))

type Handler = (ctx: unknown, ...args: unknown[]) => unknown | Promise<unknown>

async function createHarness() {
  // This module must load after Bun installs the isolated auth/config seams;
  // a static import would bind the real credential and OAuth implementations.
  const { registerOnboardingHandlers } = await import('../onboarding')
  const handlers = new Map<string, Handler>()
  const server = {
    handle(channel: string, handler: Handler) {
      handlers.set(channel, handler)
    },
  } as unknown as RpcServer
  const deps = {
    platform: {
      logger: { info() {}, error() {}, warn() {}, debug() {} },
    },
  } as HandlerDeps

  registerOnboardingHandlers(server, deps)

  const invoke = (channel: string, ...args: unknown[]) => {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`missing handler for ${channel}`)
    return handler({}, ...args)
  }

  return { invoke }
}

beforeEach(() => {
  setupDeferred = false
  setupDeferredReadCount = 0
  setupDeferredCalls.length = 0
  oauthPreparationCalls = 0
})

describe('onboarding:getAuthState', () => {
  it('reports a fresh install as launchable without setup', async () => {
    const { invoke } = await createHarness()
    const result = await invoke(RPC_CHANNELS.onboarding.GET_AUTH_STATE) as {
      setupNeeds: {
        needsBillingConfig: boolean
        needsCredentials: boolean
        isFullyConfigured: boolean
        shouldShowOnboardingOnLaunch?: boolean
        isSetupDeferred?: boolean
      }
    }

    expect(result.setupNeeds.needsBillingConfig).toBe(true)
    expect(result.setupNeeds.needsCredentials).toBe(false)
    expect(result.setupNeeds.isFullyConfigured).toBe(true)
    expect(result.setupNeeds.shouldShowOnboardingOnLaunch).toBe(false)
    expect(result.setupNeeds.isSetupDeferred).toBe(false)
    expect(setupDeferredReadCount).toBe(1)
    expect(oauthPreparationCalls).toBe(0)
  })

  it('continues to honor persisted setup deferral without a launch wizard', async () => {
    setupDeferred = true
    const { invoke } = await createHarness()
    const result = await invoke(RPC_CHANNELS.onboarding.GET_AUTH_STATE) as {
      setupNeeds: {
        isFullyConfigured: boolean
        shouldShowOnboardingOnLaunch?: boolean
        isSetupDeferred?: boolean
      }
    }

    expect(result.setupNeeds.isFullyConfigured).toBe(true)
    expect(result.setupNeeds.shouldShowOnboardingOnLaunch).toBe(false)
    expect(result.setupNeeds.isSetupDeferred).toBe(true)
    expect(setupDeferredReadCount).toBe(1)
  })

  it('persists explicit setup deferral only when the user chooses it', async () => {
    const { invoke } = await createHarness()

    await invoke(RPC_CHANNELS.onboarding.DEFER_SETUP)

    expect(setupDeferredCalls).toEqual([true])
  })
})
