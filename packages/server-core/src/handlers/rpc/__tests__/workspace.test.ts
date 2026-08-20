import { describe, expect, it, mock } from 'bun:test'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../../handler-deps'

const activeRemoteWorkspace = {
  id: 'ws-remote',
  name: 'Remote',
  slug: 'remote',
  rootPath: '/workspaces/remote',
  createdAt: 1,
  updatedAt: 1,
  kind: 'personal' as const,
  remoteServer: { url: 'wss://remote.example.test', token: 'test-token' },
}

const localWorkspace = {
  id: 'ws-local',
  name: 'Local',
  slug: 'local',
  rootPath: '/workspaces/local',
  createdAt: 1,
  updatedAt: 1,
  kind: 'personal' as const,
}

mock.module('@craft-agent/shared/config', () => ({
  addWorkspace: () => localWorkspace,
  createAndActivateLocalWorkspace: async () => ({
    workspace: localWorkspace,
    activeWorkspaceId: localWorkspace.id,
    session: { id: 'session', createdAt: 1, lastUsedAt: 1 },
  }),
  getActiveWorkspace: () => activeRemoteWorkspace,
  getWorkspaceByNameOrId: () => null,
  setActiveWorkspace: () => {},
  updateWorkspaceRemoteServer: () => {},
}))

mock.module('@craft-agent/shared/config/paths', () => ({
  CONFIG_DIR: '/config',
}))

mock.module('@craft-agent/shared/utils', () => ({
  perf: { start: () => () => {} },
}))

mock.module('@craft-agent/server-core/transport', () => ({
  pushTyped: () => {},
}))

type Handler = (
  ctx: { clientId: string; workspaceId?: string; webContentsId: number | null },
  ...args: unknown[]
) => unknown | Promise<unknown>

describe('window:getWorkspace', () => {
  it('binds an unmapped window to the available local workspace before remote fallback', async () => {
    const { registerWorkspaceCoreHandlers } = await import('../workspace')
    const handlers = new Map<string, Handler>()
    const watcherCalls: Array<[string, string]> = []
    const clientWorkspaceUpdates: Array<[string, string]> = []
    const windowWorkspaceUpdates: Array<[number, string]> = []
    const server = {
      handle(channel: string, handler: Handler) {
        handlers.set(channel, handler)
      },
      updateClientWorkspace(clientId: string, workspaceId: string) {
        clientWorkspaceUpdates.push([clientId, workspaceId])
      },
    } as unknown as RpcServer
    const deps = {
      sessionManager: {
        getWorkspaces: () => [localWorkspace],
        setupConfigWatcher(rootPath: string, workspaceId: string) {
          watcherCalls.push([rootPath, workspaceId])
        },
      },
      windowManager: {
        getWorkspaceForWindow: () => undefined,
        updateWindowWorkspace(webContentsId: number, workspaceId: string) {
          windowWorkspaceUpdates.push([webContentsId, workspaceId])
          return true
        },
      },
      platform: { logger: { info() {}, error() {}, warn() {}, debug() {} } },
    } as unknown as HandlerDeps

    registerWorkspaceCoreHandlers(server, deps)
    const handler = handlers.get(RPC_CHANNELS.window.GET_WORKSPACE)
    if (!handler) throw new Error('window:getWorkspace handler was not registered')

    const workspaceId = await handler({
      clientId: 'client-1',
      webContentsId: 42,
    })

    expect(workspaceId).toBe(localWorkspace.id)
    expect(watcherCalls).toEqual([[localWorkspace.rootPath, localWorkspace.id]])
    expect(windowWorkspaceUpdates).toEqual([[42, localWorkspace.id]])
    expect(clientWorkspaceUpdates).toEqual([['client-1', localWorkspace.id]])
  })
})
