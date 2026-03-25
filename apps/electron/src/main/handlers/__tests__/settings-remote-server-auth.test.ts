import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { RPC_CHANNELS } from '../../../shared/types'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

type HandlerFn = (ctx: { clientId: string; webContentsId: number | null; workspaceId: string | null }, ...args: any[]) => Promise<any> | any

const getRemoteServerTokenMock = mock(async (serverId: string) => `token-for-${serverId}`)

mock.module('@craft-agent/shared/config', () => ({
  getPreferencesPath: () => '/tmp/preferences.json',
  getSessionDraft: () => null,
  setSessionDraft: () => {},
  deleteSessionDraft: () => {},
  getAllSessionDrafts: () => ({}),
  getWorkspaceByNameOrId: () => null,
  getDefaultThinkingLevel: () => 'think',
  setDefaultThinkingLevel: () => true,
  getRemoteServerProfiles: async () => [],
  saveRemoteServerProfile: async () => null,
  deleteRemoteServerProfile: async () => false,
  getStoredRemoteServerProfiles: () => [
    {
      id: 'server-1',
      name: 'Remote Server',
      url: 'wss://example.test',
      enabled: true,
      allowInsecureWs: false,
      createdAt: 1,
      updatedAt: 1,
    },
  ],
}))

mock.module('@craft-agent/shared/credentials', () => ({
  getCredentialManager: () => ({
    getRemoteServerToken: getRemoteServerTokenMock,
    setRemoteServerToken: async () => {},
    deleteRemoteServerToken: async () => true,
  }),
}))

describe('settings remote server auth material RPC handler', () => {
  const handlers = new Map<string, HandlerFn>()

  beforeEach(async () => {
    handlers.clear()
    getRemoteServerTokenMock.mockClear()
  })

  function createServer() {
    const server: RpcServer = {
      handle(channel, handler) {
        handlers.set(channel, handler as HandlerFn)
      },
      push() {},
      async invokeClient() {
        return null
      },
    }
    return server
  }

  function createBaseDeps(): HandlerDeps {
    return {
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
  }

  it('rejects remote or headless clients for remote server auth material', async () => {
    const { registerSettingsHandlers } = await import('@craft-agent/server-core/handlers/rpc/settings')
    registerSettingsHandlers(createServer(), createBaseDeps())

    const handler = handlers.get(RPC_CHANNELS.remoteServers.GET_AUTH_MATERIAL)
    expect(handler).toBeTruthy()

    await expect(
      handler!({ clientId: 'client-1', webContentsId: null, workspaceId: null }),
    ).rejects.toThrow('trusted local desktop clients')
    expect(getRemoteServerTokenMock).not.toHaveBeenCalled()
  })

  it('allows tracked desktop window clients to read remote server auth material', async () => {
    const { registerSettingsHandlers } = await import('@craft-agent/server-core/handlers/rpc/settings')
    registerSettingsHandlers(createServer(), {
      ...createBaseDeps(),
      windowManager: {
        getWorkspaceForWindow: (webContentsId: number) => webContentsId === 101 ? 'ws-local' : null,
        getWindowByWebContentsId: (webContentsId: number) => webContentsId === 101 ? { id: 101 } : null,
        updateWindowWorkspace: () => true,
        registerWindow: () => {},
        getAllWindowsForWorkspace: () => [],
      },
    })

    const handler = handlers.get(RPC_CHANNELS.remoteServers.GET_AUTH_MATERIAL)
    expect(handler).toBeTruthy()

    const result = await handler!({ clientId: 'client-1', webContentsId: 101, workspaceId: 'ws-local' })

    expect(result).toEqual([
      {
        id: 'server-1',
        name: 'Remote Server',
        url: 'wss://example.test',
        enabled: true,
        token: 'token-for-server-1',
      },
    ])
    expect(getRemoteServerTokenMock).toHaveBeenCalledWith('server-1')
  })
})
