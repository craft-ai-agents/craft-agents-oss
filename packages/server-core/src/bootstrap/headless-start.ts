import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { OAuthFlowStore } from '@craft-agent/shared/auth'
import { ensureConfigDir, loadStoredConfig, saveConfig } from '@craft-agent/shared/config'
import { CONFIG_DIR } from '@craft-agent/shared/config/paths'
import { setBundledAssetsRoot } from '@craft-agent/shared/utils'
import { WsRpcServer, type WsRpcTlsOptions } from '../transport/server'
import type { EventSink, RpcServer } from '../transport/types'
import { createHeadlessPlatform } from '../runtime/platform-headless'
import type { PlatformServices } from '../runtime/platform'

interface ModelRefreshServiceLike {
  startAll(): void
  stopAll?(): void
}

export interface ServerBootstrapOptions<TSessionManager, THandlerDeps> {
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
  registerAllRpcHandlers: (server: RpcServer, deps: THandlerDeps, serverCtx: ServerHandlerContext) => void
  initializeSessionManager: (sessionManager: TSessionManager) => Promise<void>
  setSessionEventSink: (sessionManager: TSessionManager, sink: EventSink) => void
  initModelRefreshService: () => ModelRefreshServiceLike
  cleanupSessionManager?: (sessionManager: TSessionManager) => Promise<void> | void
  cleanupClientResources?: (clientId: string) => void
  onClientConnected?: (info: { clientId: string; webContentsId: number | null; workspaceId: string | null }) => void
  serverId?: string
  /** App version string, included in handshake_ack for client compatibility checks. */
  serverVersion?: string
  /** TLS configuration. When provided, the server listens on wss:// instead of ws://. */
  tls?: WsRpcTlsOptions
  /** Cookie-based session validator for web UI auth on WebSocket upgrade. */
  validateSessionCookie?: (cookieHeader: string | null) => Promise<boolean>
  /**
   * Optional HTTP request handler for non-WebSocket requests on the RPC port.
   * When provided, the WsRpcServer serves HTTP (e.g. WebUI) on the same port.
   */
  httpHandler?: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void
}

export interface ServerHandlerContext {
  getConnectedClientCount: () => number
  serverId: string
  startedAt: number
}

export interface ServerInstance<TSessionManager> {
  platform: PlatformServices
  sessionManager: TSessionManager
  wsServer: WsRpcServer
  oauthFlowStore: OAuthFlowStore
  host: string
  port: number
  protocol: 'ws' | 'wss'
  token: string
  /** Context for server-level RPC handlers (status, health, active sessions). */
  serverHandlerContext: ServerHandlerContext
  stop: () => Promise<void>
}

// ---------------------------------------------------------------------------
// Token entropy validation
// ---------------------------------------------------------------------------

const MIN_TOKEN_LENGTH = 16

/**
 * Reject tokens that are trivially weak. Runs at startup before the server
 * accepts connections so a bad token never reaches the wire.
 */
function validateTokenEntropy(token: string): { ok: boolean; warning?: string; error?: string } {
  if (token.length < MIN_TOKEN_LENGTH) {
    return { ok: false, error: `Token too short (${token.length} chars, minimum ${MIN_TOKEN_LENGTH}). Use a cryptographically random value.` }
  }

  // Reject single-character repeats ("aaaaaaaaaaaaaaaa")
  if (new Set(token).size === 1) {
    return { ok: false, error: 'Token has zero entropy (single repeated character).' }
  }

  // Warn (but allow) low-uniqueness tokens — fewer than 8 unique characters
  // in a 16+ char token suggests a pattern like "abcabcabc..."
  const uniqueChars = new Set(token).size
  if (uniqueChars < 8) {
    return { ok: true, warning: `Token has low entropy (${uniqueChars} unique characters). Consider using a stronger token.` }
  }

  return { ok: true }
}

/**
 * Generate a cryptographically random token suitable for server auth.
 * Returns a 48-character hex string (192 bits of entropy).
 */
export function generateServerToken(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

// ---------------------------------------------------------------------------
// Startup lock file
// ---------------------------------------------------------------------------

const LOCK_FILE = join(CONFIG_DIR, '.server.lock')

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function acquireServerLock(logger: PlatformServices['logger']): void {
  if (existsSync(LOCK_FILE)) {
    try {
      const content = readFileSync(LOCK_FILE, 'utf-8').trim()
      const pid = parseInt(content, 10)
      if (!isNaN(pid) && isProcessAlive(pid)) {
        throw new Error(
          `Another server instance is already running (PID ${pid}). ` +
          `If this is stale, delete ${LOCK_FILE} and retry.`
        )
      }
      logger.warn(`[bootstrap] Stale lock file found (PID ${content}), overwriting`)
    } catch (err) {
      if (err instanceof Error && err.message.includes('Another server instance')) throw err
      logger.warn('[bootstrap] Could not read lock file, overwriting')
    }
  }
  writeFileSync(LOCK_FILE, String(process.pid), 'utf-8')
}

function releaseServerLock(): void {
  try {
    if (existsSync(LOCK_FILE)) {
      const content = readFileSync(LOCK_FILE, 'utf-8').trim()
      // Only delete if it's our lock
      if (parseInt(content, 10) === process.pid) {
        unlinkSync(LOCK_FILE)
      }
    }
  } catch {
    // Best-effort cleanup
  }
}

// ---------------------------------------------------------------------------
// Config artifacts
// ---------------------------------------------------------------------------

function bootstrapConfigArtifacts(platform: PlatformServices): void {
  ensureConfigDir()
  platform.logger.info('[bootstrap] Config artifacts initialized')
}

function ensureGlobalConfigExists(platform: PlatformServices): void {
  const config = loadStoredConfig()
  if (config) {
    platform.logger.info('[bootstrap] Global config found')
    return
  }

  saveConfig({
    workspaces: [],
    activeWorkspaceId: null,
    activeSessionId: null,
  })
  platform.logger.info('[bootstrap] Initialized missing global config')
}

export async function bootstrapServer<TSessionManager, THandlerDeps>(
  options: ServerBootstrapOptions<TSessionManager, THandlerDeps>,
): Promise<ServerInstance<TSessionManager>> {
  const serverToken = options.serverToken ?? process.env.CRAFT_SERVER_TOKEN
  if (!serverToken) {
    throw new Error('Server token is required. Pass options.serverToken or set CRAFT_SERVER_TOKEN.')
  }

  const entropy = validateTokenEntropy(serverToken)
  if (!entropy.ok) {
    throw new Error(`Weak server token: ${entropy.error}`)
  }

  const platform = options.platformFactory?.() ?? createHeadlessPlatform({ appVersion: options.serverVersion })

  const bundledAssetsRoot = options.bundledAssetsRoot
    ?? process.env.CRAFT_BUNDLED_ASSETS_ROOT
    ?? process.cwd()
  setBundledAssetsRoot(bundledAssetsRoot)

  if (entropy.warning) {
    platform.logger.warn(`[bootstrap] ${entropy.warning}`)
  }

  options.applyPlatformToSubsystems?.(platform)

  bootstrapConfigArtifacts(platform)
  ensureGlobalConfigExists(platform)
  acquireServerLock(platform.logger)

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
    validateSessionCookie: options.validateSessionCookie,
    serverId: options.serverId ?? 'headless',
    serverVersion: options.serverVersion,
    tls: options.tls,
    httpHandler: options.httpHandler,
    onClientConnected: options.onClientConnected,
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

  const startedAt = Date.now()
  const serverHandlerContext: ServerHandlerContext = {
    getConnectedClientCount: () => wsServer.getConnectedClientCount(),
    serverId: options.serverId ?? 'headless',
    startedAt,
  }

  options.registerAllRpcHandlers(wsServer, deps, serverHandlerContext)

  options.setSessionEventSink(sessionManager, wsServer.push.bind(wsServer))

  await options.initializeSessionManager(sessionManager)

  modelRefreshService.startAll()

  platform.logger.info(`Craft Agent server listening on ${wsServer.protocol}://${rpcHost}:${wsServer.port}`)

  let stopped = false
  const stop = async (): Promise<void> => {
    if (stopped) return
    stopped = true

    platform.logger.info('Shutting down...')

    // Notify connected clients before closing connections
    try {
      wsServer.push('server:shuttingDown', { to: 'all' }, {
        reason: 'shutdown',
        graceMs: 2000,
        timestamp: Date.now(),
      })
      // Brief drain period so clients receive the notification
      await new Promise(resolve => setTimeout(resolve, 2000))
    } catch (error) {
      platform.logger.error('[bootstrap] Failed to send shutdown notification:', error)
    }

    try {
      modelRefreshService.stopAll?.()
    } catch (error) {
      platform.logger.error('[bootstrap] Failed to stop model refresh service:', error)
    }

    try {
      await options.cleanupSessionManager?.(sessionManager)
    } catch (error) {
      platform.logger.error('[bootstrap] Failed to clean up session manager:', error)
    }

    try {
      wsServer.close()
    } catch (error) {
      platform.logger.error('[bootstrap] Failed to close WS server:', error)
    }

    try {
      oauthFlowStore.dispose()
    } catch (error) {
      platform.logger.error('[bootstrap] Failed to dispose OAuth flow store:', error)
    }

    releaseServerLock()
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
    serverHandlerContext,
    stop,
  }
}

// ---------------------------------------------------------------------------
// HTTP Health Endpoint (opt-in, for load balancers / k8s probes)
// ---------------------------------------------------------------------------

export interface HealthHttpServerOptions {
  port: number
  deps: { sessionManager: { getWorkspaces(): unknown[] } }
  wsServer: WsRpcServer
  platform: PlatformServices
}

/**
 * Start a minimal HTTP server for health/status probes.
 * Only starts if port > 0. Returns a cleanup function.
 */
export async function startHealthHttpServer(options: HealthHttpServerOptions): Promise<{ stop: () => void } | null> {
  if (options.port <= 0) return null

  // Dynamic import — getHealthCheck uses HandlerDeps shape
  const { getHealthCheck } = await import('../handlers/rpc/server')

  const depsLike = { sessionManager: options.deps.sessionManager } as any

  // Use Bun.serve if available, otherwise skip (Node.js/Electron doesn't need HTTP health)
  if (typeof globalThis.Bun !== 'undefined') {
    const server = Bun.serve({
      port: options.port,
      fetch(req: Request) {
        const path = new URL(req.url).pathname
        if (path === '/health') {
          const health = getHealthCheck(depsLike)
          return Response.json(health, {
            status: health.status === 'ok' ? 200 : 503,
          })
        }
        return new Response('Not Found', { status: 404 })
      },
    })

    options.platform.logger.info(`[bootstrap] Health endpoint listening on http://0.0.0.0:${options.port}/health`)

    return {
      stop: () => server.stop(),
    }
  }

  return null
}
