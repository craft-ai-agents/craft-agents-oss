import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { RPC_CHANNELS } from '../../../shared/types'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { defaultThinkingSettingsStorage, registerSettingsHandlers } from '@craft-agent/server-core/handlers/rpc/settings'

type HandlerFn = (ctx: { clientId: string }, ...args: any[]) => Promise<any> | any

const getDefaultThinkingEnabledMock = mock(() => true)
const setDefaultThinkingEnabledMock = mock((_enabled: boolean) => true)

describe('settings default thinking RPC handlers', () => {
  const handlers = new Map<string, HandlerFn>()

  beforeEach(async () => {
    handlers.clear()
    getDefaultThinkingEnabledMock.mockClear()
    setDefaultThinkingEnabledMock.mockClear()
    defaultThinkingSettingsStorage.getDefaultThinkingEnabled = getDefaultThinkingEnabledMock
    defaultThinkingSettingsStorage.setDefaultThinkingEnabled = setDefaultThinkingEnabledMock

    const server: RpcServer = {
      handle(channel, handler) {
        handlers.set(channel, handler as HandlerFn)
      },
      push() {},
      async invokeClient() {
        return null
      },
      hasClientCapability() { return false },
      findClientsWithCapability() { return [] },
    }

    const deps: HandlerDeps = {
      sessionManager: {} as HandlerDeps['sessionManager'],
      platform: {
        appRootPath: '',
        resourcesPath: '',
        isPackaged: false,
        appVersion: '0.0.0-test',
        isDebugMode: true,
        logger: {
          info: () => {},
          warn: () => {},
          error: () => {},
          debug: () => {},
        },
        imageProcessor: {
          getMetadata: async () => null,
          process: async () => Buffer.from(''),
        },
      },
      oauthFlowStore: {
        store: () => {},
        getByState: () => null,
        remove: () => {},
        cleanup: () => {},
        dispose: () => {},
        get size() { return 0 },
      } as unknown as HandlerDeps['oauthFlowStore'],
    }

    registerSettingsHandlers(server, deps)
  })

  it('returns persisted default thinking toggle', async () => {
    const getHandler = handlers.get(RPC_CHANNELS.settings.GET_DEFAULT_THINKING_ENABLED)
    expect(getHandler).toBeTruthy()

    const result = await getHandler!({ clientId: 'client-1' })
    expect(result).toBe(true)
    expect(getDefaultThinkingEnabledMock).toHaveBeenCalledTimes(1)
  })

  it('persists valid thinking toggle values', async () => {
    const setHandler = handlers.get(RPC_CHANNELS.settings.SET_DEFAULT_THINKING_ENABLED)
    expect(setHandler).toBeTruthy()

    const result = await setHandler!({ clientId: 'client-1' }, false)
    expect(result).toEqual({ success: true })
    expect(setDefaultThinkingEnabledMock).toHaveBeenCalledWith(false)
    expect(setDefaultThinkingEnabledMock).toHaveBeenCalledTimes(1)
  })

  it('rejects invalid thinking toggle values before persistence', async () => {
    const setHandler = handlers.get(RPC_CHANNELS.settings.SET_DEFAULT_THINKING_ENABLED)
    expect(setHandler).toBeTruthy()

    await expect(setHandler!({ clientId: 'client-1' }, 'ultra')).rejects.toThrow('Invalid thinking toggle')
    expect(setDefaultThinkingEnabledMock).not.toHaveBeenCalled()
  })
})
