import { describe, expect, it } from 'bun:test'
import type { RpcClient } from '@craft-agent/server-core/transport'
import { RPC_CHANNELS, type UnreadSummary } from '../../shared/types'
import { WorkspaceTransportBroker } from '../workspace-transport-broker'
import { buildRemoteWorkspaceTargetId } from '@craft-agent/shared/workspaces'

function createFakeRpcClient(options?: {
  localWorkspaces?: Array<Record<string, unknown>>
  remoteProfiles?: Array<Record<string, unknown>>
  remoteAuthMaterials?: Array<Record<string, unknown>>
  homeDir?: string
}) {
  const calls: Array<{ channel: string; args: unknown[] }> = []

  const unreadSummary: UnreadSummary = {
    totalUnreadSessions: 0,
    byWorkspace: {},
    hasUnreadByWorkspace: {},
  }

  const client = {
    invoke: async (channel: string, ...args: unknown[]) => {
      calls.push({ channel, args })

      switch (channel) {
        case RPC_CHANNELS.workspaces.GET:
          return options?.localWorkspaces ?? [{ id: 'ws-local', name: 'Local Workspace', rootPath: '/tmp/local', createdAt: Date.now() }]
        case RPC_CHANNELS.sessions.GET_UNREAD_SUMMARY:
          return unreadSummary
        case RPC_CHANNELS.remoteServers.LIST:
          return options?.remoteProfiles ?? []
        case RPC_CHANNELS.remoteServers.GET_AUTH_MATERIAL:
          return options?.remoteAuthMaterials ?? []
        case RPC_CHANNELS.workspaces.CHECK_SLUG:
          return { exists: false, path: `/tmp/${String(args[0] ?? '')}` }
        case RPC_CHANNELS.fs.SEARCH:
          return []
        case RPC_CHANNELS.system.HOME_DIR:
          return options?.homeDir ?? '/Users/local'
        default:
          return null
      }
    },
    on: () => () => {},
    onConnectionStateChanged: () => () => {},
    reconnectNow: () => {},
    destroy: () => {},
    connect: () => {},
    getConnectionState: () => ({
      mode: 'local' as const,
      status: 'connected' as const,
      url: 'ws://local',
      attempt: 0,
      updatedAt: Date.now(),
    }),
  }

  return {
    client: client as unknown as RpcClient & {
      onConnectionStateChanged(callback: (state: ReturnType<typeof client.getConnectionState>) => void): () => void
      reconnectNow(): void
      destroy(): void
      connect(): void
      getConnectionState(): ReturnType<typeof client.getConnectionState>
    },
    calls,
  }
}

describe('WorkspaceTransportBroker', () => {
  it('forwards searchFiles arguments in basePath, query order', async () => {
    const { client, calls } = createFakeRpcClient()
    const api = {} as any
    const broker = new WorkspaceTransportBroker(api, client as any, 'ws-local')

    broker.install()
    await api.getWorkspaces()

    calls.length = 0
    await api.searchFiles('/tmp/project', 'needle')

    expect(calls).toContainEqual({
      channel: RPC_CHANNELS.fs.SEARCH,
      args: ['/tmp/project', 'needle'],
    })
  })

  it('falls back to the latest local workspace when the restored remote workspace is missing', async () => {
    const restoredRemoteWorkspaceId = buildRemoteWorkspaceTargetId('server-1', 'ws-remote-missing')
    const unreadSummary: UnreadSummary = {
      totalUnreadSessions: 0,
      byWorkspace: {},
      hasUnreadByWorkspace: {},
    }
    const { client, calls } = createFakeRpcClient({
      localWorkspaces: [
        { id: 'ws-local-old', name: 'Older Workspace', rootPath: '/tmp/older', createdAt: 10, lastAccessedAt: 20 },
        { id: 'ws-local-new', name: 'Latest Workspace', rootPath: '/tmp/latest', createdAt: 11, lastAccessedAt: 30 },
      ],
      remoteProfiles: [
        { id: 'server-1', name: 'Remote Server', url: 'wss://example.test', enabled: true, hasToken: true, createdAt: 1, updatedAt: 1 },
      ],
      remoteAuthMaterials: [
        { id: 'server-1', name: 'Remote Server', url: 'wss://example.test', enabled: true, token: 'token' },
      ],
    })

    const api = {} as any
    const broker = new WorkspaceTransportBroker(api, client as any, restoredRemoteWorkspaceId)

    ;(broker as any).createRemoteConnection = function (profile: any, auth: any) {
      const remoteClient = {
        invoke: async (channel: string) => {
          if (channel === RPC_CHANNELS.workspaces.GET) {
            return [{ id: 'ws-remote-other', name: 'Other Remote Workspace', rootPath: '/remote/other', createdAt: 1 }]
          }
          if (channel === RPC_CHANNELS.sessions.GET_UNREAD_SUMMARY) {
            return unreadSummary
          }
          if (channel === RPC_CHANNELS.window.SWITCH_WORKSPACE) {
            return null
          }
          return null
        },
        on: () => () => {},
        onConnectionStateChanged: () => () => {},
        reconnectNow: () => {},
        destroy: () => {},
        connect: () => {},
        getConnectionState: () => ({
          mode: 'remote' as const,
          status: 'connected' as const,
          url: auth.url,
          attempt: 0,
          updatedAt: Date.now(),
        }),
      }

      const connection = {
        profile,
        auth,
        client: remoteClient,
        workspaces: [],
        unreadSummary,
        runtime: {
          serverId: profile.id,
          status: 'connected' as const,
          workspaceCount: 0,
          updatedAt: Date.now(),
        },
        selectedWorkspaceId: null,
        dispose: () => {},
      }

      ;(this as any).remoteConnections.set(profile.id, connection)
      return connection
    }

    broker.install()

    const resolvedWorkspaceId = await api.getWindowWorkspace()

    expect(resolvedWorkspaceId).toBe('ws-local-new')
    expect(calls).toContainEqual({
      channel: RPC_CHANNELS.window.SWITCH_WORKSPACE,
      args: ['ws-local-new'],
    })
  })

  it('includes reachable remote workspaces on the first load', async () => {
    const { client } = createFakeRpcClient({
      localWorkspaces: [
        { id: 'ws-local', name: 'Local Workspace', rootPath: '/tmp/local', createdAt: 10 },
      ],
      remoteProfiles: [
        { id: 'server-1', name: 'Remote Server', url: 'wss://example.test', enabled: true, hasToken: true, createdAt: 1, updatedAt: 1 },
      ],
      remoteAuthMaterials: [
        { id: 'server-1', name: 'Remote Server', url: 'wss://example.test', enabled: true, token: 'token' },
      ],
    })

    const api = {} as any
    const broker = new WorkspaceTransportBroker(api, client as any, 'ws-local')

    ;(broker as any).createRemoteConnection = function (profile: any, auth: any) {
      const remoteClient = {
        invoke: async (channel: string) => {
          if (channel === RPC_CHANNELS.workspaces.GET) {
            return [{ id: 'ws-remote', name: 'Remote Workspace', rootPath: '/remote/workspace', createdAt: 1 }]
          }
          if (channel === RPC_CHANNELS.sessions.GET_UNREAD_SUMMARY) {
            return { totalUnreadSessions: 0, byWorkspace: {}, hasUnreadByWorkspace: {} }
          }
          if (channel === RPC_CHANNELS.window.SWITCH_WORKSPACE) {
            return null
          }
          return null
        },
        on: () => () => {},
        onConnectionStateChanged: () => () => {},
        reconnectNow: () => {},
        destroy: () => {},
        connect: () => {},
        getConnectionState: () => ({
          mode: 'remote' as const,
          status: 'connected' as const,
          url: auth.url,
          attempt: 0,
          updatedAt: Date.now(),
        }),
      }

      const connection = {
        profile,
        auth,
        client: remoteClient,
        workspaces: [],
        unreadSummary: { totalUnreadSessions: 0, byWorkspace: {}, hasUnreadByWorkspace: {} },
        runtime: {
          serverId: profile.id,
          status: 'connected' as const,
          workspaceCount: 0,
          updatedAt: Date.now(),
        },
        selectedWorkspaceId: null,
        dispose: () => {},
      }

      ;(this as any).remoteConnections.set(profile.id, connection)
      return connection
    }

    broker.install()

    const workspaces = await api.getWorkspaces()

    expect(workspaces.map((workspace: any) => workspace.id)).toEqual([
      'ws-local',
      buildRemoteWorkspaceTargetId('server-1', 'ws-remote'),
    ])
  })

  it('blocks insecure ws remote servers unless explicitly allowed', async () => {
    const { client } = createFakeRpcClient({
      localWorkspaces: [
        { id: 'ws-local', name: 'Local Workspace', rootPath: '/tmp/local', createdAt: 10 },
      ],
      remoteProfiles: [
        { id: 'server-1', name: 'Remote Server', url: 'ws://10.0.0.1:9100', enabled: true, allowInsecureWs: false, hasToken: true, createdAt: 1, updatedAt: 1 },
      ],
      remoteAuthMaterials: [
        { id: 'server-1', name: 'Remote Server', url: 'ws://10.0.0.1:9100', enabled: true, token: 'token' },
      ],
    })

    const api = {} as any
    const broker = new WorkspaceTransportBroker(api, client as any, 'ws-local')

    broker.install()

    const workspaces = await api.getWorkspaces()
    const runtimes = await api.getRemoteServerRuntimeStates()

    expect(workspaces.map((workspace: any) => workspace.id)).toEqual(['ws-local'])
    expect(runtimes['server-1']).toMatchObject({
      status: 'failed',
      workspaceCount: 0,
    })
    expect(runtimes['server-1']?.error).toContain('Allow insecure ws://')
  })

  it('falls back to the latest local workspace when the active remote server profile is removed', async () => {
    const remoteTargetId = buildRemoteWorkspaceTargetId('server-1', 'ws-remote')
    const remoteProfiles = [
      { id: 'server-1', name: 'Remote Server', url: 'wss://example.test', enabled: true, hasToken: true, createdAt: 1, updatedAt: 1 },
    ]
    const remoteAuthMaterials = [
      { id: 'server-1', name: 'Remote Server', url: 'wss://example.test', enabled: true, token: 'token' },
    ]
    const { client, calls } = createFakeRpcClient({
      localWorkspaces: [
        { id: 'ws-local-old', name: 'Older Workspace', rootPath: '/tmp/older', createdAt: 10, lastAccessedAt: 20 },
        { id: 'ws-local-new', name: 'Latest Workspace', rootPath: '/tmp/latest', createdAt: 11, lastAccessedAt: 30 },
      ],
      remoteProfiles,
      remoteAuthMaterials,
    })

    let disposed = false
    const api = {} as any
    const broker = new WorkspaceTransportBroker(api, client as any, remoteTargetId)

    ;(broker as any).createRemoteConnection = function (profile: any, auth: any) {
      const remoteClient = {
        invoke: async (channel: string) => {
          if (channel === RPC_CHANNELS.workspaces.GET) {
            return [{ id: 'ws-remote', name: 'Remote Workspace', rootPath: '/remote/workspace', createdAt: 1 }]
          }
          if (channel === RPC_CHANNELS.sessions.GET_UNREAD_SUMMARY) {
            return { totalUnreadSessions: 0, byWorkspace: {}, hasUnreadByWorkspace: {} }
          }
          return null
        },
        on: () => () => {},
        onConnectionStateChanged: () => () => {},
        reconnectNow: () => {},
        destroy: () => {},
        connect: () => {},
        getConnectionState: () => ({
          mode: 'remote' as const,
          status: 'connected' as const,
          url: auth.url,
          attempt: 0,
          updatedAt: Date.now(),
        }),
      }

      const connection = {
        profile,
        auth,
        client: remoteClient,
        workspaces: [],
        unreadSummary: { totalUnreadSessions: 0, byWorkspace: {}, hasUnreadByWorkspace: {} },
        runtime: {
          serverId: profile.id,
          status: 'connected' as const,
          workspaceCount: 0,
          updatedAt: Date.now(),
        },
        selectedWorkspaceId: null,
        dispose: () => {
          disposed = true
        },
      }

      ;(this as any).remoteConnections.set(profile.id, connection)
      return connection
    }

    broker.install()
    expect(await api.getWindowWorkspace()).toBe(remoteTargetId)

    remoteProfiles.length = 0
    remoteAuthMaterials.length = 0

    await (broker as any).reloadRemoteServers()

    expect(disposed).toBe(true)
    expect(await api.getWindowWorkspace()).toBe('ws-local-new')
    expect(calls).toContainEqual({
      channel: RPC_CHANNELS.window.SWITCH_WORKSPACE,
      args: ['ws-local-new'],
    })
  })

  it('drops insecure ws connections immediately when opt-in is revoked', async () => {
    const remoteTargetId = buildRemoteWorkspaceTargetId('server-1', 'ws-remote')
    const remoteProfiles = [
      { id: 'server-1', name: 'Remote Server', url: 'ws://10.0.0.1:9100', enabled: true, allowInsecureWs: true, hasToken: true, createdAt: 1, updatedAt: 1 },
    ]
    const remoteAuthMaterials = [
      { id: 'server-1', name: 'Remote Server', url: 'ws://10.0.0.1:9100', enabled: true, token: 'token' },
    ]
    const { client, calls } = createFakeRpcClient({
      localWorkspaces: [
        { id: 'ws-local-old', name: 'Older Workspace', rootPath: '/tmp/older', createdAt: 10, lastAccessedAt: 20 },
        { id: 'ws-local-new', name: 'Latest Workspace', rootPath: '/tmp/latest', createdAt: 11, lastAccessedAt: 30 },
      ],
      remoteProfiles,
      remoteAuthMaterials,
    })

    let disposed = false
    const api = {} as any
    const broker = new WorkspaceTransportBroker(api, client as any, remoteTargetId)

    ;(broker as any).createRemoteConnection = function (profile: any, auth: any) {
      const remoteClient = {
        invoke: async (channel: string) => {
          if (channel === RPC_CHANNELS.workspaces.GET) {
            return [{ id: 'ws-remote', name: 'Remote Workspace', rootPath: '/remote/workspace', createdAt: 1 }]
          }
          if (channel === RPC_CHANNELS.sessions.GET_UNREAD_SUMMARY) {
            return { totalUnreadSessions: 0, byWorkspace: {}, hasUnreadByWorkspace: {} }
          }
          return null
        },
        on: () => () => {},
        onConnectionStateChanged: () => () => {},
        reconnectNow: () => {},
        destroy: () => {},
        connect: () => {},
        getConnectionState: () => ({
          mode: 'remote' as const,
          status: 'connected' as const,
          url: auth.url,
          attempt: 0,
          updatedAt: Date.now(),
        }),
      }

      const connection = {
        profile,
        auth,
        client: remoteClient,
        workspaces: [],
        unreadSummary: { totalUnreadSessions: 0, byWorkspace: {}, hasUnreadByWorkspace: {} },
        runtime: {
          serverId: profile.id,
          status: 'connected' as const,
          workspaceCount: 0,
          updatedAt: Date.now(),
        },
        selectedWorkspaceId: null,
        dispose: () => {
          disposed = true
        },
      }

      ;(this as any).remoteConnections.set(profile.id, connection)
      return connection
    }

    broker.install()
    expect(await api.getWindowWorkspace()).toBe(remoteTargetId)

    remoteProfiles[0] = {
      ...remoteProfiles[0],
      allowInsecureWs: false,
    }

    await (broker as any).reloadRemoteServers()

    const workspaces = await api.getWorkspaces()
    const runtimes = await api.getRemoteServerRuntimeStates()

    expect(disposed).toBe(true)
    expect(await api.getWindowWorkspace()).toBe('ws-local-new')
    expect(workspaces.map((workspace: any) => workspace.id)).toEqual(['ws-local-old', 'ws-local-new'])
    expect(runtimes['server-1']).toMatchObject({
      status: 'failed',
      workspaceCount: 0,
    })
    expect(runtimes['server-1']?.error).toContain('Allow insecure ws://')
    expect(calls).toContainEqual({
      channel: RPC_CHANNELS.window.SWITCH_WORKSPACE,
      args: ['ws-local-new'],
    })
  })

  it('maps remote session payloads back to federated workspace ids', async () => {
    const remoteTargetId = buildRemoteWorkspaceTargetId('server-1', 'ws-remote')
    const { client } = createFakeRpcClient({
      localWorkspaces: [
        { id: 'ws-local', name: 'Local Workspace', rootPath: '/tmp/local', createdAt: 10 },
      ],
      remoteProfiles: [
        { id: 'server-1', name: 'Remote Server', url: 'wss://example.test', enabled: true, hasToken: true, createdAt: 1, updatedAt: 1 },
      ],
      remoteAuthMaterials: [
        { id: 'server-1', name: 'Remote Server', url: 'wss://example.test', enabled: true, token: 'token' },
      ],
    })

    const remoteCalls: Array<{ channel: string; args: unknown[] }> = []
    const api = {} as any
    const broker = new WorkspaceTransportBroker(api, client as any, remoteTargetId)

    ;(broker as any).createRemoteConnection = function (profile: any, auth: any) {
      const remoteClient = {
        invoke: async (channel: string, ...args: unknown[]) => {
          remoteCalls.push({ channel, args })
          if (channel === RPC_CHANNELS.workspaces.GET) {
            return [{ id: 'ws-remote', name: 'Remote Workspace', rootPath: '/remote/workspace', createdAt: 1 }]
          }
          if (channel === RPC_CHANNELS.sessions.GET_UNREAD_SUMMARY) {
            return { totalUnreadSessions: 0, byWorkspace: {}, hasUnreadByWorkspace: {} }
          }
          if (channel === RPC_CHANNELS.sessions.GET) {
            return [{ id: 'session-1', workspaceId: 'ws-remote', createdAt: 1, lastUsedAt: 1 }]
          }
          if (channel === RPC_CHANNELS.sessions.GET_MESSAGES) {
            return { id: 'session-1', workspaceId: 'ws-remote', createdAt: 1, lastUsedAt: 1, messages: [] }
          }
          if (channel === RPC_CHANNELS.sessions.CREATE) {
            return { id: 'session-2', workspaceId: 'ws-remote', createdAt: 2, lastUsedAt: 2, messages: [] }
          }
          if (channel === RPC_CHANNELS.sessions.COMMAND) {
            return null
          }
          return null
        },
        on: () => () => {},
        onConnectionStateChanged: () => () => {},
        reconnectNow: () => {},
        destroy: () => {},
        connect: () => {},
        getConnectionState: () => ({
          mode: 'remote' as const,
          status: 'connected' as const,
          url: auth.url,
          attempt: 0,
          updatedAt: Date.now(),
        }),
      }

      const connection = {
        profile,
        auth,
        client: remoteClient,
        workspaces: [],
        unreadSummary: { totalUnreadSessions: 0, byWorkspace: {}, hasUnreadByWorkspace: {} },
        runtime: {
          serverId: profile.id,
          status: 'connected' as const,
          workspaceCount: 0,
          updatedAt: Date.now(),
        },
        selectedWorkspaceId: null,
        dispose: () => {},
      }

      ;(this as any).remoteConnections.set(profile.id, connection)
      return connection
    }

    broker.install()

    const sessions = await api.getSessions()
    const fullSession = await api.getSessionMessages('session-1')
    const created = await api.createSession(remoteTargetId, { name: 'Remote Session' })
    await api.sessionCommand('session-1', { type: 'setActiveViewing', workspaceId: remoteTargetId })

    expect(sessions).toEqual([
      expect.objectContaining({ id: 'session-1', workspaceId: remoteTargetId }),
    ])
    expect(fullSession).toEqual(expect.objectContaining({ id: 'session-1', workspaceId: remoteTargetId }))
    expect(created).toEqual(expect.objectContaining({ id: 'session-2', workspaceId: remoteTargetId }))
    expect(remoteCalls).toContainEqual({
      channel: RPC_CHANNELS.sessions.CREATE,
      args: ['ws-remote', { name: 'Remote Session' }],
    })
    expect(remoteCalls).toContainEqual({
      channel: RPC_CHANNELS.sessions.COMMAND,
      args: ['session-1', { type: 'setActiveViewing', workspaceId: 'ws-remote' }],
    })
  })

  it('routes add-workspace helpers to the active remote server', async () => {
    const remoteTargetId = buildRemoteWorkspaceTargetId('server-1', 'ws-remote')
    const { client } = createFakeRpcClient({
      localWorkspaces: [
        { id: 'ws-local', name: 'Local Workspace', rootPath: '/tmp/local', createdAt: 10 },
      ],
      remoteProfiles: [
        { id: 'server-1', name: 'Remote Server', url: 'wss://example.test', enabled: true, hasToken: true, createdAt: 1, updatedAt: 1 },
      ],
      remoteAuthMaterials: [
        { id: 'server-1', name: 'Remote Server', url: 'wss://example.test', enabled: true, token: 'token' },
      ],
    })

    let createdRemoteWorkspace = false
    const remoteCalls: Array<{ channel: string; args: unknown[] }> = []
    const api = {} as any
    const broker = new WorkspaceTransportBroker(api, client as any, remoteTargetId)

    ;(broker as any).createRemoteConnection = function (profile: any, auth: any) {
      const remoteClient = {
        invoke: async (channel: string, ...args: unknown[]) => {
          remoteCalls.push({ channel, args })
          if (channel === RPC_CHANNELS.workspaces.GET) {
            return createdRemoteWorkspace
              ? [
                  { id: 'ws-remote', name: 'Remote Workspace', rootPath: '/remote/workspace', createdAt: 1 },
                  { id: 'ws-created', name: 'Created Remote', rootPath: '/remote/created', createdAt: 2 },
                ]
              : [{ id: 'ws-remote', name: 'Remote Workspace', rootPath: '/remote/workspace', createdAt: 1 }]
          }
          if (channel === RPC_CHANNELS.sessions.GET_UNREAD_SUMMARY) {
            return { totalUnreadSessions: 0, byWorkspace: {}, hasUnreadByWorkspace: {} }
          }
          if (channel === RPC_CHANNELS.system.HOME_DIR) {
            return '/home/remote'
          }
          if (channel === RPC_CHANNELS.workspaces.CHECK_SLUG) {
            return { exists: false, path: '/home/remote/.craft-agent/workspaces/remote-space' }
          }
          if (channel === RPC_CHANNELS.workspaces.CREATE) {
            createdRemoteWorkspace = true
            return { id: 'ws-created', name: 'Created Remote', rootPath: '/remote/created', createdAt: 2 }
          }
          return null
        },
        on: () => () => {},
        onConnectionStateChanged: () => () => {},
        reconnectNow: () => {},
        destroy: () => {},
        connect: () => {},
        getConnectionState: () => ({
          mode: 'remote' as const,
          status: 'connected' as const,
          url: auth.url,
          attempt: 0,
          updatedAt: Date.now(),
        }),
      }

      const connection = {
        profile,
        auth,
        client: remoteClient,
        workspaces: [],
        unreadSummary: { totalUnreadSessions: 0, byWorkspace: {}, hasUnreadByWorkspace: {} },
        runtime: {
          serverId: profile.id,
          status: 'connected' as const,
          workspaceCount: 0,
          updatedAt: Date.now(),
        },
        selectedWorkspaceId: null,
        dispose: () => {},
      }

      ;(this as any).remoteConnections.set(profile.id, connection)
      return connection
    }

    broker.install()

    expect(await api.getHomeDir()).toBe('/home/remote')
    expect(await api.checkWorkspaceSlug('remote-space')).toEqual({
      exists: false,
      path: '/home/remote/.craft-agent/workspaces/remote-space',
    })

    const created = await api.createWorkspace('/srv/remote-space', 'Created Remote')

    expect(created).toEqual(expect.objectContaining({
      id: buildRemoteWorkspaceTargetId('server-1', 'ws-created'),
      isRemote: true,
      remoteServerId: 'server-1',
      remoteWorkspaceId: 'ws-created',
    }))
    expect(remoteCalls).toContainEqual({
      channel: RPC_CHANNELS.workspaces.CREATE,
      args: ['/srv/remote-space', 'Created Remote'],
    })
  })

  it('routes workspace deletion to the owning remote server and removes it from the aggregated list', async () => {
    const remoteTargetId = buildRemoteWorkspaceTargetId('server-1', 'ws-remote')
    const { client } = createFakeRpcClient({
      localWorkspaces: [
        { id: 'ws-local', name: 'Local Workspace', rootPath: '/tmp/local', createdAt: 1 },
      ],
      remoteProfiles: [
        { id: 'server-1', name: 'Remote Server', url: 'wss://example.test', enabled: true, hasToken: true, createdAt: 1, updatedAt: 1 },
      ],
      remoteAuthMaterials: [
        { id: 'server-1', name: 'Remote Server', url: 'wss://example.test', enabled: true, token: 'token' },
      ],
    })

    let deletedRemoteWorkspace = false
    const remoteCalls: Array<{ channel: string; args: unknown[] }> = []
    const api = {} as any
    const broker = new WorkspaceTransportBroker(api, client as any, 'ws-local')

    ;(broker as any).createRemoteConnection = function (profile: any, auth: any) {
      const remoteClient = {
        invoke: async (channel: string, ...args: unknown[]) => {
          remoteCalls.push({ channel, args })
          if (channel === RPC_CHANNELS.workspaces.GET) {
            return deletedRemoteWorkspace
              ? []
              : [{ id: 'ws-remote', name: 'Remote Workspace', rootPath: '/remote/workspace', createdAt: 1 }]
          }
          if (channel === RPC_CHANNELS.sessions.GET_UNREAD_SUMMARY) {
            return { totalUnreadSessions: 0, byWorkspace: {}, hasUnreadByWorkspace: {} }
          }
          if (channel === RPC_CHANNELS.workspaces.DELETE) {
            deletedRemoteWorkspace = true
            return true
          }
          return null
        },
        on: () => () => {},
        onConnectionStateChanged: () => () => {},
        reconnectNow: () => {},
        destroy: () => {},
        connect: () => {},
        getConnectionState: () => ({
          mode: 'remote' as const,
          status: 'connected' as const,
          url: auth.url,
          attempt: 0,
          updatedAt: Date.now(),
        }),
      }

      const connection = {
        profile,
        auth,
        client: remoteClient,
        workspaces: [],
        unreadSummary: { totalUnreadSessions: 0, byWorkspace: {}, hasUnreadByWorkspace: {} },
        runtime: {
          serverId: profile.id,
          status: 'connected' as const,
          workspaceCount: 0,
          updatedAt: Date.now(),
        },
        selectedWorkspaceId: null,
        dispose: () => {},
      }

      ;(this as any).remoteConnections.set(profile.id, connection)
      return connection
    }

    broker.install()
    expect((await api.getWorkspaces()).map((workspace: any) => workspace.id)).toContain(remoteTargetId)

    expect(await api.deleteWorkspace(remoteTargetId)).toBe(true)
    expect(remoteCalls).toContainEqual({
      channel: RPC_CHANNELS.workspaces.DELETE,
      args: ['ws-remote'],
    })
    expect((await api.getWorkspaces()).map((workspace: any) => workspace.id)).not.toContain(remoteTargetId)
  })

  it('switches to the latest available local workspace when deleting the active workspace', async () => {
    const { client, calls } = createFakeRpcClient({
      localWorkspaces: [
        { id: 'ws-local-old', name: 'Old Workspace', rootPath: '/tmp/old', createdAt: 10, lastAccessedAt: 20 },
        { id: 'ws-local-new', name: 'New Workspace', rootPath: '/tmp/new', createdAt: 11, lastAccessedAt: 40 },
      ],
    })

    let localWorkspaces = [
      { id: 'ws-local-old', name: 'Old Workspace', rootPath: '/tmp/old', createdAt: 10, lastAccessedAt: 20 },
      { id: 'ws-local-new', name: 'New Workspace', rootPath: '/tmp/new', createdAt: 11, lastAccessedAt: 40 },
    ]

    const localClient = {
      ...client,
      invoke: async (channel: string, ...args: unknown[]) => {
        calls.push({ channel, args })

        switch (channel) {
          case RPC_CHANNELS.workspaces.GET:
            return localWorkspaces
          case RPC_CHANNELS.sessions.GET_UNREAD_SUMMARY:
            return { totalUnreadSessions: 0, byWorkspace: {}, hasUnreadByWorkspace: {} }
          case RPC_CHANNELS.remoteServers.LIST:
            return []
          case RPC_CHANNELS.remoteServers.GET_AUTH_MATERIAL:
            return []
          case RPC_CHANNELS.workspaces.DELETE:
            localWorkspaces = localWorkspaces.filter(workspace => workspace.id !== args[0])
            return true
          case RPC_CHANNELS.window.SWITCH_WORKSPACE:
            return null
          default:
            return null
        }
      },
    }

    const api = {} as any
    const broker = new WorkspaceTransportBroker(api, localClient as any, 'ws-local-old')

    broker.install()
    await api.getWorkspaces()

    calls.length = 0
    expect(await api.deleteWorkspace('ws-local-old')).toBe(true)

    expect(calls).toContainEqual({
      channel: RPC_CHANNELS.window.SWITCH_WORKSPACE,
      args: ['ws-local-new'],
    })
    expect((await api.getWorkspaces()).map((workspace: any) => workspace.id)).toEqual(['ws-local-new'])
  })
})
