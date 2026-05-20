import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { ENV_CONNECTION_SLUG } from '@craft-agent/shared/config'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { HandlerFn, RequestContext, RpcServer } from '../../transport/types'
import type { HandlerDeps } from '../handler-deps'

const testBackendConnection = mock(async () => ({ success: true }))

const { registerLlmConnectionsHandlersWithRuntime } = await import('./llm-connections')

function createServer() {
  const handlers = new Map<string, HandlerFn>()
  const server: RpcServer = {
    handle(channel, handler) {
      handlers.set(channel, handler)
    },
    push() {},
    invokeClient: async () => undefined,
  }
  return { server, handlers }
}

function deps(): HandlerDeps {
  return {
    sessionManager: {
      reinitializeAuth: async () => {},
      refreshConnectionRuntime: async () => {},
    } as HandlerDeps['sessionManager'],
    oauthFlowStore: {} as HandlerDeps['oauthFlowStore'],
    platform: {
      appRootPath: '/app',
      resourcesPath: '/resources',
      isPackaged: false,
      appVersion: '0.0.0-test',
      isDebugMode: false,
      imageProcessor: {} as HandlerDeps['platform']['imageProcessor'],
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
    },
  }
}

describe('Environment LLM connection TEST handler', () => {
  const originalEnv = {
    LLM_BASE_URL: process.env.LLM_BASE_URL,
    LLM_MODEL: process.env.LLM_MODEL,
    LLM_CONNECTION_NAME: process.env.LLM_CONNECTION_NAME,
  }

  beforeEach(() => {
    process.env.LLM_BASE_URL = 'https://env.example.test/v1'
    process.env.LLM_MODEL = 'env-model'
    process.env.LLM_CONNECTION_NAME = 'Env Test'
    testBackendConnection.mockClear()
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key as keyof typeof originalEnv]
      } else {
        process.env[key as keyof typeof originalEnv] = value
      }
    }
  })

  it('validates env-provider from process env and the active SSO token', async () => {
    const { server, handlers } = createServer()
    registerLlmConnectionsHandlersWithRuntime(server, deps(), {
      testBackendConnection,
      loadSsoSession: async () => ({
        token: 'active-sso-token',
        expiresAt: Date.now() + 60_000,
      }),
    })

    const handler = handlers.get(RPC_CHANNELS.llmConnections.TEST)
    expect(handler).toBeDefined()

    const result = await handler?.({ clientId: 'test', workspaceId: null, webContentsId: null } satisfies RequestContext, ENV_CONNECTION_SLUG)

    expect(result).toEqual({ success: true })
    expect(testBackendConnection).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'pi',
      apiKey: 'active-sso-token',
      model: 'env-model',
      baseUrl: 'https://env.example.test/v1',
      connection: expect.objectContaining({
        providerType: 'pi_compat',
        piAuthProvider: 'openai',
        customEndpoint: { api: 'openai-completions' },
      }),
    }))
  })
})
