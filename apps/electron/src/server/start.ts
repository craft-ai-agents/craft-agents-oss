/**
 * Headless server startup logic.
 * Imported dynamically by index.ts after virtual module shims are registered.
 */

import { join } from 'node:path'
import { startHeadlessServer } from '@craft-agent/server-core/bootstrap'
import { registerCoreRpcHandlers } from '../main/handlers/index'
import { cleanupSessionFileWatchForClient } from '@craft-agent/server-core/handlers/rpc'
import { SessionManager, setSessionPlatform, setSessionRuntimeHooks } from '@craft-agent/server-core/sessions'
import { initModelRefreshService, setFetcherPlatform } from '@craft-agent/server-core/model-fetchers'
import { setSearchPlatform, setImageProcessor } from '@craft-agent/server-core/services'
import type { HandlerDeps } from '../main/handlers/handler-deps'

const bundledAssetsRoot = join(import.meta.dir, '..', '..')

const instance = await (async (): Promise<{ host: string; port: number; token: string; stop: () => Promise<void> }> => {
  try {
    return await startHeadlessServer<SessionManager, HandlerDeps>({
      bundledAssetsRoot,
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
        // windowManager: undefined — headless, no GUI windows
        // browserPaneManager: undefined — headless, no browser automation
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

console.log(`CRAFT_SERVER_URL=ws://${instance.host}:${instance.port}`)
console.log(`CRAFT_SERVER_TOKEN=${instance.token}`)

const shutdown = async () => {
  await instance.stop()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
