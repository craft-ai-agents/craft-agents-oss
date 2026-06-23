import { beforeEach, describe, expect, it } from 'bun:test'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

type HandlerFn = (ctx: { clientId: string; webContentsId?: number }, ...args: any[]) => Promise<any> | any

describe('workspace GUI handlers', () => {
  const handlers = new Map<string, HandlerFn>()
  const createdWindows: any[] = []

  beforeEach(async () => {
    handlers.clear()
    createdWindows.length = 0

    const server: RpcServer = {
      handle(channel, handler) {
        handlers.set(channel, handler as HandlerFn)
      },
      push() {},
      async invokeClient() {
        return null
      },
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
      windowManager: {
        createWindow: (options: unknown) => {
          createdWindows.push(options)
        },
      } as unknown as HandlerDeps['windowManager'],
      oauthFlowStore: {
        store: () => {},
        getByState: () => null,
        remove: () => {},
        cleanup: () => {},
        dispose: () => {},
        get size() { return 0 },
      } as unknown as HandlerDeps['oauthFlowStore'],
    }

    const { registerWorkspaceGuiHandlers } = await import('../workspace')
    registerWorkspaceGuiHandlers(server, deps)
  })

  it('opens a session window directly on the requested session route', async () => {
    const handler = handlers.get(RPC_CHANNELS.window.OPEN_SESSION_IN_NEW_WINDOW)
    expect(handler).toBeTruthy()

    await handler!({ clientId: 'client-1' }, 'workspace-1', 'session-1')

    expect(createdWindows).toHaveLength(1)
    expect(createdWindows[0].workspaceId).toBe('workspace-1')
    expect(createdWindows[0].focused).toBe(true)
    expect(createdWindows[0].restoreUrl).toContain('app://runner/?')

    const url = new URL(createdWindows[0].restoreUrl)
    expect(url.searchParams.get('workspaceId')).toBe('workspace-1')
    expect(url.searchParams.get('focused')).toBe('true')
    expect(url.searchParams.get('route')).toBe('allSessions/session/session-1')
  })
})
