#!/usr/bin/env bun
/**
 * @craft-agent/server — standalone headless Craft Agent server.
 *
 * Usage:
 *   CRAFT_SERVER_TOKEN=<secret> bun run packages/server/src/index.ts
 *
 * Environment:
 *   CRAFT_SERVER_TOKEN   — required bearer token for client auth
 *   CRAFT_RPC_HOST       — bind address (default: 127.0.0.1)
 *   CRAFT_RPC_PORT       — bind port (default: 9100)
 *   CRAFT_RPC_TLS_CERT   — path to PEM certificate file (enables TLS/wss)
 *   CRAFT_RPC_TLS_KEY    — path to PEM private key file (required with cert)
 *   CRAFT_RPC_TLS_CA     — path to PEM CA chain file (optional)
 *   CRAFT_APP_ROOT       — app root path (default: cwd)
 *   CRAFT_RESOURCES_PATH — resources path (default: cwd/resources)
 *   CRAFT_IS_PACKAGED    — 'true' for production (default: false)
 *   CRAFT_VERSION        — app version (default: 0.0.0-dev)
 *   CRAFT_DEBUG          — 'true' for debug logging
 *   CRAFT_WEBUI_DIR      — path to built web UI assets (enables web UI)
 *   CRAFT_WEBUI_PORT     — HTTP port for web UI (default: 3100)
 *   CRAFT_WEBUI_PASSWORD — optional shorter password for web login (falls back to CRAFT_SERVER_TOKEN)
 */

import { join } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'
import { version as packageVersion } from '../package.json'
import { enableDebug } from '@craft-agent/shared/utils/debug'
import { bootstrapServer, startHealthHttpServer, generateServerToken } from '@craft-agent/server-core/bootstrap'
import { validateSession } from '@craft-agent/server-core/webui'

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

if (process.env.CRAFT_DEBUG === 'true' || process.env.CRAFT_DEBUG === '1') {
  enableDebug()
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
const serverToken = process.env.CRAFT_SERVER_TOKEN

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
      }),
      createSessionManager: () => new SessionManager(),
      createHandlerDeps: ({ sessionManager, platform, oauthFlowStore }) => ({
        sessionManager,
        platform,
        oauthFlowStore,
      }),
      registerAllRpcHandlers: registerCoreRpcHandlers,
      setSessionEventSink: (sessionManager, sink) => {
        sessionManager.setEventSink(sink)
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

// Start HTTP health endpoint if CRAFT_HEALTH_PORT is set
const healthPort = parseInt(process.env.CRAFT_HEALTH_PORT ?? '0', 10)
const healthServer = await startHealthHttpServer({
  port: healthPort,
  deps: { sessionManager: instance.sessionManager },
  wsServer: instance.wsServer,
  platform: instance.platform,
})

// Start Web UI HTTP server if CRAFT_WEBUI_DIR is set
let webuiServer: { stop: () => void } | null = null
if (webuiEnabled && serverToken) {
  const { startWebuiHttpServer } = await import('@craft-agent/server-core/webui')
  const { getHealthCheck } = await import('@craft-agent/server-core/handlers/rpc/server')
  const depsLike = { sessionManager: instance.sessionManager } as any
  const webuiPort = parseInt(process.env.CRAFT_WEBUI_PORT ?? '3100', 10)

  webuiServer = await startWebuiHttpServer({
    port: webuiPort,
    webuiDir: webuiDir!,
    secret: serverToken,
    password: process.env.CRAFT_WEBUI_PASSWORD || undefined,
    secure: instance.protocol === 'wss',
    wsUrl: `${instance.protocol}://${instance.host}:${instance.port}`,
    getHealthCheck: () => getHealthCheck(depsLike),
    logger: instance.platform.logger,
  })

  console.log(`CRAFT_WEBUI_URL=http://0.0.0.0:${webuiPort}`)
}

console.log(`CRAFT_SERVER_URL=${instance.protocol}://${instance.host}:${instance.port}`)
console.log(`CRAFT_SERVER_TOKEN=${instance.token}`)

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
  webuiServer?.stop()
  healthServer?.stop()
  await instance.stop()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
