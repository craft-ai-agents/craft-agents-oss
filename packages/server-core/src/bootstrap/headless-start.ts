import { OAuthFlowStore } from '@craft-agent/shared/auth'
import { ensureConfigDir, loadStoredConfig, saveConfig } from '@craft-agent/shared/config'
import { setBundledAssetsRoot } from '@craft-agent/shared/utils'
import { WsRpcServer, type WsRpcTlsOptions } from '../transport/server'
import type { EventSink, RpcServer } from '../transport/types'
import { createHeadlessPlatform } from '../runtime/platform-headless'
import type { PlatformServices } from '../runtime/platform'

interface ModelRefreshServiceLike {
  startAll(): void
  stopAll?(): void
}

export interface HeadlessServerBootstrapOptions<TSessionManager, THandlerDeps> {
  serverToken?: string
  rpcHost?: string
  rpcPort?: number
  bundledAssetsRoot?: string
  platformFactory?: () => PlatformServices
  applyPlatformToSubsystems?: (platform: PlatformServices) => void
  createSessionManager: () => TSessionManager
  createHandlerDeps: (ctx: {
    sessionManager: TSessionManager
    platform: PlatformServices
    oauthFlowStore: OAuthFlowStore
  }) => THandlerDeps
  registerAllRpcHandlers: (server: RpcServer, deps: THandlerDeps) => void
  initializeSessionManager: (sessionManager: TSessionManager) => Promise<void>
  setSessionEventSink: (sessionManager: TSessionManager, sink: EventSink) => void
  initModelRefreshService: () => ModelRefreshServiceLike
  cleanupSessionManager?: (sessionManager: TSessionManager) => Promise<void> | void
  cleanupClientResources?: (clientId: string) => void
  serverId?: string
  /** TLS configuration. When provided, the server listens on wss:// instead of ws://. */
  tls?: WsRpcTlsOptions
}

export interface HeadlessServerInstance<TSessionManager> {
  platform: PlatformServices
  sessionManager: TSessionManager
  wsServer: WsRpcServer
  oauthFlowStore: OAuthFlowStore
  host: string
  port: number
  protocol: 'ws' | 'wss'
  token: string
  stop: () => Promise<void>
}

function bootstrapConfigArtifacts(platform: PlatformServices): void {
  ensureConfigDir()
  platform.logger.info('[headless] Config artifacts initialized')
}

function ensureGlobalConfigExists(platform: PlatformServices): void {
  const config = loadStoredConfig()
  if (config) {
    platform.logger.info('[headless] Global config found')
    return
  }

  saveConfig({
    workspaces: [],
    activeWorkspaceId: null,
    activeSessionId: null,
  })
  platform.logger.info('[headless] Initialized missing global config')
}

export async function startHeadlessServer<TSessionManager, THandlerDeps>(
  options: HeadlessServerBootstrapOptions<TSessionManager, THandlerDeps>,
): Promise<HeadlessServerInstance<TSessionManager>> {
  const serverToken = options.serverToken ?? process.env.CRAFT_SERVER_TOKEN
  if (!serverToken) {
    throw new Error('Server token is required. Pass options.serverToken or set CRAFT_SERVER_TOKEN.')
  }

  const platform = options.platformFactory?.() ?? createHeadlessPlatform()

  const bundledAssetsRoot = options.bundledAssetsRoot
    ?? process.env.CRAFT_BUNDLED_ASSETS_ROOT
    ?? process.cwd()
  setBundledAssetsRoot(bundledAssetsRoot)

  options.applyPlatformToSubsystems?.(platform)

  bootstrapConfigArtifacts(platform)
  ensureGlobalConfigExists(platform)

  const modelRefreshService = options.initModelRefreshService()
  const sessionManager = options.createSessionManager()

  const rpcHost = options.rpcHost ?? process.env.CRAFT_RPC_HOST ?? '127.0.0.1'
  const rpcPortRaw = options.rpcPort ?? parseInt(process.env.CRAFT_RPC_PORT ?? '9100', 10)
  if (!Number.isFinite(rpcPortRaw) || rpcPortRaw < 0 || rpcPortRaw > 65535) {
    throw new Error(`Invalid RPC port: ${rpcPortRaw}`)
  }
  const rpcPort = Math.trunc(rpcPortRaw)

  const wsServer = new WsRpcServer({
    host: rpcHost,
    port: rpcPort,
    requireAuth: true,
    validateToken: async (t) => t === serverToken,
    serverId: options.serverId ?? 'headless',
    tls: options.tls,
    onClientDisconnected: (clientId) => {
      options.cleanupClientResources?.(clientId)
    },
  })

  await wsServer.listen()

  const oauthFlowStore = new OAuthFlowStore()

  const deps = options.createHandlerDeps({
    sessionManager,
    platform,
    oauthFlowStore,
  })

  options.registerAllRpcHandlers(wsServer, deps)

  options.setSessionEventSink(sessionManager, wsServer.push.bind(wsServer))

  await options.initializeSessionManager(sessionManager)

  modelRefreshService.startAll()

  platform.logger.info(`Craft Agent headless server listening on ${wsServer.protocol}://${rpcHost}:${wsServer.port}`)

  let stopped = false
  const stop = async (): Promise<void> => {
    if (stopped) return
    stopped = true

    platform.logger.info('Shutting down...')

    try {
      modelRefreshService.stopAll?.()
    } catch (error) {
      platform.logger.error('[headless] Failed to stop model refresh service:', error)
    }

    try {
      await options.cleanupSessionManager?.(sessionManager)
    } catch (error) {
      platform.logger.error('[headless] Failed to clean up session manager:', error)
    }

    try {
      wsServer.close()
    } catch (error) {
      platform.logger.error('[headless] Failed to close WS server:', error)
    }

    try {
      oauthFlowStore.dispose()
    } catch (error) {
      platform.logger.error('[headless] Failed to dispose OAuth flow store:', error)
    }
  }

  return {
    platform,
    sessionManager,
    wsServer,
    oauthFlowStore,
    host: rpcHost,
    port: wsServer.port,
    protocol: wsServer.protocol,
    token: serverToken,
    stop,
  }
}
