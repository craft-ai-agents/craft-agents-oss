import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps, ISessionManager } from '../handler-deps'

/** RPC channels handled by the user profile module. */
export const HANDLED_CHANNELS = [
  RPC_CHANNELS.userProfile.REFRESH,
  RPC_CHANNELS.userProfile.GET,
] as const

type Deps = Pick<HandlerDeps<ISessionManager>, 'sessionManager'>

/**
 * Register RPC handlers for manual user profile refresh and read.
 * Delegates to the SessionManager which owns the HTTP provider and refresh loop.
 */
export function registerUserProfileHandlers(server: RpcServer, deps: Deps): void {
  server.handle(RPC_CHANNELS.userProfile.REFRESH, async () => {
    return deps.sessionManager.refreshUserProfile()
  })

  server.handle(RPC_CHANNELS.userProfile.GET, async () => {
    return deps.sessionManager.getUserProfile()
  })
}
