import {
  MdpAuthClient,
  refreshStoredSsoSession,
  getSsoSessionState,
  SsoCredentialStore,
} from '@craft-agent/shared/auth'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer } from '@craft-agent/server-core/transport'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.sso.GET_SESSION,
  RPC_CHANNELS.sso.REFRESH,
] as const

/** Register local-only SSO startup session and refresh handlers. */
export function registerSsoHandlers(server: RpcServer): void {
  server.handle(RPC_CHANNELS.sso.GET_SESSION, async () => {
    return getSsoSessionState(createSsoSessionDeps())
  })

  server.handle(RPC_CHANNELS.sso.REFRESH, async () => {
    const session = await refreshStoredSsoSession(createSsoSessionDeps())
    return { success: session.authenticated }
  })
}

function createSsoSessionDeps() {
  return {
    credentialStore: new SsoCredentialStore(),
    authClient: new MdpAuthClient(),
  }
}
