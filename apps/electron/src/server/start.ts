/**
 * Headless server startup logic.
 * Imported dynamically by index.ts after virtual module shims are registered.
 */

import { join } from 'node:path'
import { WsRpcServer } from '../transport/server'
import { registerAllRpcHandlers } from '../main/handlers/index'
import { cleanupSessionFileWatchForClient } from '../main/handlers/sessions'
import { createHeadlessPlatform } from '../runtime/platform-headless'
import { SessionManager, setSessionPlatform } from '../main/sessions'
import { OAuthFlowStore } from '@craft-agent/shared/auth'
import { initModelRefreshService } from '../main/model-fetchers'
import { setFetcherPlatform } from '../main/model-fetchers/runtime'
import { setSearchPlatform } from '../main/search'
import { setImageProcessor } from '../main/image-utils'
import { ensureConfigDir, loadStoredConfig, saveConfig } from '@craft-agent/shared/config'
import { setBundledAssetsRoot } from '@craft-agent/shared/utils'
import type { HandlerDeps } from '../main/handlers/handler-deps'

// Validate required env
const serverToken = process.env.CRAFT_SERVER_TOKEN
if (!serverToken) {
  console.error('CRAFT_SERVER_TOKEN is required. Generate one with: uuidgen or openssl rand -hex 32')
  process.exit(1)
}

// Build headless platform (console logger, sharp for images, no GUI)
const platform = createHeadlessPlatform()

// Ensure bundled assets (docs, defaults, tool-icons, themes) resolve regardless cwd.
// src/server -> src -> app root (apps/electron)
const bundledAssetsRoot = join(import.meta.dir, '..', '..')
setBundledAssetsRoot(bundledAssetsRoot)

function bootstrapConfigArtifacts(): void {
  ensureConfigDir()
  platform.logger.info('[headless] Config artifacts initialized')
}

function ensureGlobalConfigExists(): void {
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

// Inject platform into subsystems
setFetcherPlatform(platform)
setSessionPlatform(platform)
setSearchPlatform(platform)
setImageProcessor(platform.imageProcessor)

// Ensure config artifacts + global config exist before handlers/session init.
// addWorkspace() requires config.json, and workspace creation requires config-defaults.
bootstrapConfigArtifacts()
ensureGlobalConfigExists()

// Initialize model refresh service (same as Electron, without credential resolver for now)
const modelRefreshService = initModelRefreshService(async (slug: string) => {
  const { getCredentialManager } = await import('@craft-agent/shared/credentials')
  const manager = getCredentialManager()
  const [apiKey, oauth] = await Promise.all([
    manager.getLlmApiKey(slug).catch(() => null),
    manager.getLlmOAuth(slug).catch(() => null),
  ])
  return {
    apiKey: apiKey ?? undefined,
    oauthAccessToken: oauth?.accessToken,
    oauthRefreshToken: oauth?.refreshToken,
    oauthIdToken: oauth?.idToken,
  }
})

// Create session manager
const sessionManager = new SessionManager()

// Create WS RPC server
const rpcHost = process.env.CRAFT_RPC_HOST ?? '0.0.0.0'
const rpcPort = parseInt(process.env.CRAFT_RPC_PORT ?? '9100', 10)

const wsServer = new WsRpcServer({
  host: rpcHost,
  port: rpcPort,
  requireAuth: true,
  validateToken: async (t) => t === serverToken,
  serverId: 'headless',
  onClientDisconnected: (clientId) => {
    cleanupSessionFileWatchForClient(clientId)
  },
})

await wsServer.listen()

const oauthFlowStore = new OAuthFlowStore()

const deps: HandlerDeps = {
  sessionManager,
  platform,
  // windowManager: undefined — headless, no GUI windows
  // browserPaneManager: undefined — headless, no browser automation
  oauthFlowStore,
}

// Register all RPC handlers
registerAllRpcHandlers(wsServer, deps)

// Wire EventSink so SessionManager pushes events via the RPC server
sessionManager.setEventSink(wsServer.push.bind(wsServer))

// Initialize sessions (loads workspace data, starts watchers)
await sessionManager.initialize()

// Start periodic model refresh
modelRefreshService.startAll()

// Print connection details
platform.logger.info(`Craft Agent headless server listening on ${rpcHost}:${wsServer.port}`)
console.log(`CRAFT_SERVER_URL=ws://${rpcHost}:${wsServer.port}`)
console.log(`CRAFT_SERVER_TOKEN=${serverToken}`)

// Graceful shutdown
const shutdown = async () => {
  platform.logger.info('Shutting down...')
  wsServer.close()
  oauthFlowStore.dispose()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
