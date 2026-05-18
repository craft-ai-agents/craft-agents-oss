import {
  MdpAuthClient,
  refreshStoredSsoSession,
  getSsoSessionState,
  SsoCredentialStore,
  type SsoSession,
} from '@craft-agent/shared/auth'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer } from '@craft-agent/server-core/transport'

/** RPC channels handled by the local SSO login/session module. */
export const HANDLED_CHANNELS = [
  RPC_CHANNELS.sso.GET_SESSION,
  RPC_CHANNELS.sso.REFRESH,
  RPC_CHANNELS.sso.START_LOGIN,
  RPC_CHANNELS.sso.HANDLE_CALLBACK,
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

  server.handle(RPC_CHANNELS.sso.START_LOGIN, async () => {
    return buildSsoLoginUrl()
  })

  server.handle(RPC_CHANNELS.sso.HANDLE_CALLBACK, async (_ctx, payload: { code?: string }) => {
    return handleSsoCallback(payload, createSsoSessionDeps())
  })
}

function createSsoSessionDeps() {
  return {
    credentialStore: new SsoCredentialStore(),
    authClient: new MdpAuthClient(),
  }
}

/** Dependencies used to exchange and persist an SSO callback code. */
export interface SsoCallbackDeps {
  /** Auth client used to exchange the authorization code for an SSO session. */
  authClient: Pick<MdpAuthClient, 'login'>
  /** Credential store used to persist the exchanged SSO session. */
  credentialStore: Pick<SsoCredentialStore, 'save'>
}

/** Build the OIDC authorization URL used to start system-browser SSO login. */
export function buildSsoLoginUrl(env: NodeJS.ProcessEnv = process.env): string {
  const authUrl = env.MDP_AUTH_URL
  const clientId = env.MDP_CLIENT_ID

  if (!authUrl) {
    throw new Error('MDP_AUTH_URL is required to start SSO login')
  }

  if (!clientId) {
    throw new Error('MDP_CLIENT_ID is required to start SSO login')
  }

  const url = new URL(authUrl)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', 'mdp://sso-callback')
  url.searchParams.set('response_type', 'code')
  return url.toString()
}

/** Exchange an SSO authorization code and persist the resulting session. */
export async function handleSsoCallback(
  payload: { code?: string },
  deps: SsoCallbackDeps = createSsoSessionDeps(),
): Promise<{ success: boolean; error?: string }> {
  if (!payload.code) {
    return { success: false, error: 'Missing SSO authorization code' }
  }

  try {
    const session: SsoSession = await deps.authClient.login(payload.code)
    await deps.credentialStore.save(session)
    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'SSO login failed'
    return { success: false, error: message }
  }
}
