#!/usr/bin/env bun
/**
 * @craft-agent/server — standalone headless Craft Agent server.
 *
 * Usage:
 *   CRAFT_SERVER_TOKEN=<secret> bun run packages/server/src/index.ts
 *
 * Environment:
 *   CRAFT_SERVER_TOKEN         — required bearer token for client auth
 *   CRAFT_RPC_HOST             — bind address (default: 127.0.0.1)
 *   CRAFT_RPC_PORT             — bind port (default: 9100)
 *   CRAFT_RPC_TLS_CERT         — path to PEM certificate file (enables TLS/wss)
 *   CRAFT_RPC_TLS_KEY          — path to PEM private key file (required with cert)
 *   CRAFT_RPC_TLS_CA           — path to PEM CA chain file (optional)
 *   CRAFT_APP_ROOT             — app root path (default: cwd)
 *   CRAFT_RESOURCES_PATH       — resources path (default: cwd/resources)
 *   CRAFT_IS_PACKAGED          — 'true' for production (default: false)
 *   CRAFT_VERSION              — app version (default: 0.0.0-dev)
 *   CRAFT_DEBUG                — 'true' for debug logging
 *   CRAFT_WEBUI_DIR            — path to built web UI assets (enables web UI on RPC port)
 *   CRAFT_WEBUI_PASSWORD       — optional shorter password for web login (falls back to CRAFT_SERVER_TOKEN)
 *   CRAFT_WEBUI_SECURE_COOKIE  — optional true/false override for the session cookie Secure flag
 *   CRAFT_WEBUI_WS_URL         — optional browser-facing ws:// or wss:// URL returned by /api/config
 *
 * Self-hosted conversation sharing (opt-in; serves the open-source viewer +
 * /s/api store on its own HTTP port so shared transcripts stay on your infra):
 *   CRAFT_SHARE_PORT           — bind port for the share server (default 0 = disabled)
 *   CRAFT_SHARE_HOST           — bind address (default 0.0.0.0)
 *   CRAFT_SHARE_VIEWER_DIR     — path to the built viewer (apps/viewer/dist); required to enable
 *   CRAFT_SHARE_ID_MODE        — 'hash' (default, unguessable copy) or 'session' (zero-copy live)
 *   CRAFT_SHARE_PUBLIC_URL     — absolute base URL for share links (e.g. https://share.example.com)
 *   CRAFT_SHARE_BASIC_AUTH     — optional 'user:password' to gate all /s/* behind HTTP Basic auth
 *   CRAFT_SHARE_MAX_BYTES      — max upload size before 413 (default 10485760 = 10 MiB)
 *   (point the client at this server with CRAFT_VIEWER_URL=http(s)://<host>:<port>)
 *
 *   CRAFT_MESSAGING_WA_WORKER  — absolute path to worker.cjs (default: packages/messaging-whatsapp-worker/dist/worker.cjs)
 *   CRAFT_MESSAGING_NODE_BIN   — Node binary used to spawn the WhatsApp worker (default: node)
 */

import { join } from 'node:path'
import { homedir } from 'node:os'
import { readFileSync, existsSync } from 'node:fs'
import { version as packageVersion } from '../package.json'
import { enableDebug } from '@craft-agent/shared/utils/debug'
import { bootstrapServer, startHealthHttpServer, generateServerToken } from '@craft-agent/server-core/bootstrap'
import { validateSession, createWebuiHandler, nodeHttpAdapter } from '@craft-agent/server-core/webui'
import type { WebuiHandler } from '@craft-agent/server-core/webui'
import { startShareHttpServer, createShareStore, type ShareIdMode, type BasicAuthCredentials } from '@craft-agent/server-core/share'
import { getCredentialManager } from '@craft-agent/shared/credentials'
import { getWorkspaces } from '@craft-agent/shared/config'
import { createMessagingBootstrap, type MessagingBootstrapHandle } from '@craft-agent/messaging-gateway'

// --generate-token: print a crypto-random token and exit
if (process.argv.includes('--generate-token')) {
  console.log(generateServerToken())
  process.exit(0)
}
import type { WsRpcTlsOptions } from '@craft-agent/server-core/transport'
import { registerCoreRpcHandlers, cleanupSessionFileWatchForClient } from '@craft-agent/server-core/handlers/rpc'
import { SessionManager, setSessionPlatform, setSessionRuntimeHooks } from '@craft-agent/server-core/sessions'
import { initModelRefreshService, setFetcherPlatform } from '@craft-agent/server-core/model-fetchers'
import { setSearchPlatform, setImageProcessor } from '@craft-agent/server-core/services'
import type { HandlerDeps } from '@craft-agent/server-core/handlers'

process.env.CRAFT_IS_PACKAGED ??= 'false'

// Prevent unhandled rejections from crashing the server.
// SDK subprocess abort can reject promises that propagate up unhandled;
// Bun (unlike Node) terminates the process on unhandled rejections by default.
process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason)
  console.error(`[server] Unhandled rejection (caught, not crashing): ${msg}`)
})

if (process.env.CRAFT_DEBUG === 'true' || process.env.CRAFT_DEBUG === '1') {
  enableDebug()
}

function parseOptionalBooleanEnv(name: string, value: string | undefined): boolean | undefined {
  if (value == null || value.trim() === '') return undefined

  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false

  console.error(`Invalid ${name}: expected one of true/false/1/0/yes/no/on/off.`)
  process.exit(1)
}

function parseOptionalWebSocketUrl(name: string, value: string | undefined): string | undefined {
  if (value == null || value.trim() === '') return undefined

  try {
    const url = new URL(value)
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
      throw new Error('must use ws:// or wss://')
    }
    return value
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Invalid ${name}: ${message}`)
    process.exit(1)
  }
}

function parseShareIdMode(value: string | undefined): ShareIdMode {
  const normalized = (value ?? 'hash').trim().toLowerCase()
  if (normalized === 'hash' || normalized === 'session') return normalized
  console.error(`Invalid CRAFT_SHARE_ID_MODE: expected 'hash' or 'session'.`)
  process.exit(1)
}

function parseShareBasicAuth(value: string | undefined): BasicAuthCredentials | undefined {
  if (value == null || value.trim() === '') return undefined
  const idx = value.indexOf(':')
  if (idx <= 0 || idx === value.length - 1) {
    console.error(`Invalid CRAFT_SHARE_BASIC_AUTH: expected 'user:password'.`)
    process.exit(1)
  }
  return { user: value.slice(0, idx), pass: value.slice(idx + 1) }
}

// In dev (monorepo), bundled assets root is the repo root (4 levels up from this file).
// In packaged mode, use CRAFT_BUNDLED_ASSETS_ROOT env or cwd.
const bundledAssetsRoot = process.env.CRAFT_BUNDLED_ASSETS_ROOT
  ?? join(import.meta.dir, '..', '..', '..', '..')

// TLS configuration — when cert + key paths are provided, server listens on wss://
let tls: WsRpcTlsOptions | undefined
const tlsCertPath = process.env.CRAFT_RPC_TLS_CERT
const tlsKeyPath = process.env.CRAFT_RPC_TLS_KEY
if (tlsCertPath || tlsKeyPath) {
  if (!tlsCertPath || !tlsKeyPath) {
    console.error('TLS requires both CRAFT_RPC_TLS_CERT and CRAFT_RPC_TLS_KEY.')
    process.exit(1)
  }
  tls = {
    cert: readFileSync(tlsCertPath),
    key: readFileSync(tlsKeyPath),
    ...(process.env.CRAFT_RPC_TLS_CA ? { ca: readFileSync(process.env.CRAFT_RPC_TLS_CA) } : {}),
  }
}

// Web UI configuration
const webuiDir = process.env.CRAFT_WEBUI_DIR || undefined
const webuiEnabled = webuiDir && existsSync(webuiDir)
const webuiSecureCookies = parseOptionalBooleanEnv('CRAFT_WEBUI_SECURE_COOKIE', process.env.CRAFT_WEBUI_SECURE_COOKIE)
const webuiWsUrl = parseOptionalWebSocketUrl('CRAFT_WEBUI_WS_URL', process.env.CRAFT_WEBUI_WS_URL)
const serverToken = process.env.CRAFT_SERVER_TOKEN

// ---------------------------------------------------------------------------
// Create WebUI handler early so it can be embedded in the WsRpcServer.
// The handler is a pure function — it doesn't need the session manager yet
// because health checks are injected lazily via getHealthCheck().
// ---------------------------------------------------------------------------

let webuiHandler: WebuiHandler | null = null
let webuiNodeHandler: ReturnType<typeof nodeHttpAdapter> | undefined

// Health check is injected lazily — the session manager isn't ready until
// after bootstrap completes, but the handler captures the closure.
let healthCheckFn: (() => { status: string }) | null = null

if (webuiEnabled && serverToken) {
  const rpcPort = parseInt(process.env.CRAFT_RPC_PORT ?? '9100', 10)
  const rpcProtocol = tls ? 'wss' as const : 'ws' as const

  webuiHandler = createWebuiHandler({
    webuiDir: webuiDir!,
    secret: serverToken,
    password: process.env.CRAFT_WEBUI_PASSWORD || undefined,
    secureCookies: webuiSecureCookies,
    publicWsUrl: webuiWsUrl,
    wsProtocol: rpcProtocol,
    // WebUI is served on the same port as WS — wsPort matches the RPC port
    wsPort: rpcPort,
    getHealthCheck: () => healthCheckFn?.() ?? { status: 'starting' },
    logger: { info: console.log, warn: console.warn, error: console.error } as any,
  })

  webuiNodeHandler = nodeHttpAdapter(webuiHandler.fetch)
}

// Resolve WhatsApp worker paths up-front so the helper + Docker env stay in sync.
// The worker is a Node subprocess — Bun cannot run it directly — so we must
// pass an explicit `nodeBin` (Electron defaults nodeBin to process.execPath
// which is correct there but wrong under Bun).
const waWorkerEntry = process.env.CRAFT_MESSAGING_WA_WORKER
  ?? join(bundledAssetsRoot, 'packages', 'messaging-whatsapp-worker', 'dist', 'worker.cjs')
const waNodeBin = process.env.CRAFT_MESSAGING_NODE_BIN ?? 'node'

// Built inside createHandlerDeps (needs sessionManager), populated with the WS
// publisher after bootstrapServer resolves.
let messagingHandle: MessagingBootstrapHandle | null = null

const instance = await (async () => {
  try {
    return await bootstrapServer<SessionManager, HandlerDeps>({
      bundledAssetsRoot,
      serverVersion: process.env.CRAFT_VERSION ?? packageVersion,
      tls,
      // When web UI is enabled, accept JWT session cookies on WebSocket upgrade
      validateSessionCookie: webuiEnabled && serverToken
        ? async (cookieHeader) => {
            const session = await validateSession(cookieHeader, serverToken)
            return session !== null
          }
        : undefined,
      // Embed the WebUI HTTP handler on the WS server's port
      httpHandler: webuiNodeHandler,
      applyPlatformToSubsystems: (platform) => {
        setFetcherPlatform(platform)
        setSessionPlatform(platform)
        setSessionRuntimeHooks({
          updateBadgeCount: () => {},
          captureException: (error) => {
            const err = error instanceof Error ? error : new Error(String(error))
            platform.captureError?.(err)
          },
        })
        setSearchPlatform(platform)
        setImageProcessor(platform.imageProcessor)
      },
      initModelRefreshService: () => initModelRefreshService(async (slug: string) => {
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
      }),
      createSessionManager: () => new SessionManager(),
      bindRpcServer: (sm, server) => sm.setRpcServer(server),
      createHandlerDeps: ({ sessionManager, platform, oauthFlowStore }) => {
        messagingHandle = createMessagingBootstrap({
          sessionManager,
          credentialManager: getCredentialManager(),
          getMessagingDir: (wsId: string) =>
            join(homedir(), '.craft-agent', 'workspaces', wsId, 'messaging'),
          // Headless has no legacy messaging dir — workspaces start clean.
          whatsapp: {
            workerEntry: waWorkerEntry,
            nodeBin: waNodeBin,
            pairingMode: 'qr',
          },
        })
        return {
          sessionManager,
          platform,
          oauthFlowStore,
          messagingRegistry: messagingHandle.registry,
        }
      },
      registerAllRpcHandlers: registerCoreRpcHandlers,
      setSessionEventSink: (sessionManager, sink) => {
        if (!messagingHandle) {
          // createHandlerDeps always runs before setSessionEventSink, but be
          // defensive in case bootstrapServer's ordering ever changes.
          sessionManager.setEventSink(sink)
          return
        }
        sessionManager.setEventSink(messagingHandle.wrapSink(sink))
      },
      initializeSessionManager: async (sessionManager) => {
        await sessionManager.initialize()
      },
      cleanupSessionManager: async (sessionManager) => {
        try {
          await sessionManager.flushAllSessions()
        } finally {
          sessionManager.cleanup()
        }
      },
      cleanupClientResources: cleanupSessionFileWatchForClient,
    })
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
})()

// ---------------------------------------------------------------------------
// Messaging post-bootstrap: bind the WS publisher and initialize local
// workspaces. Remote-owned workspaces are skipped because their messaging
// runs on the remote server.
// ---------------------------------------------------------------------------
// CRAFT_DISABLE_MESSAGING lets a dev/test server share a config dir with a live app
// without both processes fighting over the same Telegram/WhatsApp connections (409s).
const messagingDisabled = process.env.CRAFT_DISABLE_MESSAGING === 'true' || process.env.CRAFT_DISABLE_MESSAGING === '1'
if (messagingHandle !== null && !messagingDisabled) {
  const handle: MessagingBootstrapHandle = messagingHandle
  handle.setPublisher(instance.wsServer.push.bind(instance.wsServer))
  try {
    const localWorkspaceIds = getWorkspaces()
      .filter((ws) => !ws.remoteServer)
      .map((ws) => ws.id)
    await handle.initializeWorkspaces(localWorkspaceIds)
  } catch (error) {
    console.error('[messaging] Workspace initialization failed:', error)
  }
} else if (messagingDisabled) {
  console.log('[messaging] Disabled via CRAFT_DISABLE_MESSAGING — skipping workspace messaging init')
}

// Wire up the lazy health check now that the session manager is ready
if (webuiHandler) {
  const { getHealthCheck } = await import('@craft-agent/server-core/handlers/rpc/server')
  const depsLike = { sessionManager: instance.sessionManager } as any
  healthCheckFn = () => getHealthCheck(depsLike)

  // Wire up OAuth callback deps so /api/oauth/callback works
  const { getSourceCredentialManager, loadWorkspaceSources } = await import('@craft-agent/shared/sources')
  const { getWorkspaceByNameOrId } = await import('@craft-agent/shared/config')
  const { pushTyped } = await import('@craft-agent/server-core/transport')
  const { RPC_CHANNELS } = await import('@craft-agent/shared/protocol')

  webuiHandler.setOAuthCallbackDeps({
    flowStore: instance.oauthFlowStore,
    credManager: getSourceCredentialManager(),
    sessionManager: instance.sessionManager,
    pushSourcesChanged: (workspaceId: string) => {
      const ws = getWorkspaceByNameOrId(workspaceId)
      const sources = ws ? loadWorkspaceSources(ws.rootPath) : []
      pushTyped(instance.wsServer, RPC_CHANNELS.sources.CHANGED, { to: 'workspace', workspaceId }, workspaceId, sources)
    },
  })
}

// Start HTTP health endpoint if CRAFT_HEALTH_PORT is set
const healthPort = parseInt(process.env.CRAFT_HEALTH_PORT ?? '0', 10)
const healthServer = await startHealthHttpServer({
  port: healthPort,
  deps: { sessionManager: instance.sessionManager },
  wsServer: instance.wsServer,
  platform: instance.platform,
})

// Start the self-hosted conversation-share server if CRAFT_SHARE_PORT is set.
// It binds its own HTTP port (separate from the RPC/WSS port) and serves the
// open-source viewer + /s/api store, keeping shared transcripts on this host.
const sharePort = parseInt(process.env.CRAFT_SHARE_PORT ?? '0', 10)
const shareViewerDir = process.env.CRAFT_SHARE_VIEWER_DIR
  ?? join(bundledAssetsRoot, 'apps', 'viewer', 'dist')
let shareServer: { port: number; stop: () => void } | null = null
if (Number.isFinite(sharePort) && sharePort > 0) {
  if (!existsSync(shareViewerDir)) {
    console.error(
      `[share] CRAFT_SHARE_PORT is set but the viewer build was not found at ${shareViewerDir}.\n` +
      `        Build it (bun run --cwd apps/viewer build) or set CRAFT_SHARE_VIEWER_DIR.`,
    )
    process.exit(1)
  }
  const shareIdMode = parseShareIdMode(process.env.CRAFT_SHARE_ID_MODE)
  const shareMaxBytes = parseInt(process.env.CRAFT_SHARE_MAX_BYTES ?? '10485760', 10)
  shareServer = await startShareHttpServer({
    port: sharePort,
    host: process.env.CRAFT_SHARE_HOST ?? '0.0.0.0',
    viewerDir: shareViewerDir,
    store: createShareStore(shareIdMode),
    publicBaseUrl: process.env.CRAFT_SHARE_PUBLIC_URL || undefined,
    basicAuth: parseShareBasicAuth(process.env.CRAFT_SHARE_BASIC_AUTH),
    maxBodyBytes: Number.isFinite(shareMaxBytes) && shareMaxBytes > 0 ? shareMaxBytes : 10485760,
    logger: { info: console.log, warn: console.warn, error: console.error } as any,
  })
  console.log(`CRAFT_SHARE_URL=${process.env.CRAFT_SHARE_PUBLIC_URL || `http://0.0.0.0:${shareServer.port}`}`)
}

const serverProto = instance.protocol === 'wss' ? 'https' : 'http'
console.log(`CRAFT_SERVER_URL=${instance.protocol}://${instance.host}:${instance.port}`)
console.log(`CRAFT_SERVER_TOKEN=${instance.token}`)
if (webuiHandler) {
  console.log(`CRAFT_WEBUI_URL=${serverProto}://0.0.0.0:${instance.port}`)
}

// Block binding to a non-localhost address without TLS — tokens would be sent in cleartext.
// Override with --allow-insecure-bind for explicitly trusted networks.
const isLocalBind = instance.host === '127.0.0.1' || instance.host === 'localhost' || instance.host === '::1'
if (!isLocalBind && instance.protocol === 'ws') {
  if (process.argv.includes('--allow-insecure-bind')) {
    console.warn(
      '\n⚠️  WARNING: Server is listening on a network address without TLS.\n' +
      '   Authentication tokens will be sent in cleartext.\n' +
      '   Set CRAFT_RPC_TLS_CERT and CRAFT_RPC_TLS_KEY to enable wss://.\n'
    )
  } else {
    console.error(
      '\n❌  Refusing to bind to a network address without TLS.\n' +
      '   Authentication tokens would be sent in cleartext.\n\n' +
      '   Options:\n' +
      '     1. Set CRAFT_RPC_TLS_CERT and CRAFT_RPC_TLS_KEY to enable wss://\n' +
      '     2. Pass --allow-insecure-bind to override (NOT recommended for production)\n'
    )
    await instance.stop()
    process.exit(1)
  }
}

const shutdown = async () => {
  webuiHandler?.dispose()
  healthServer?.stop()
  shareServer?.stop()
  if (messagingHandle) {
    try {
      await messagingHandle.dispose()
    } catch (error) {
      console.error('[messaging] dispose failed:', error)
    }
  }
  await instance.stop()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
