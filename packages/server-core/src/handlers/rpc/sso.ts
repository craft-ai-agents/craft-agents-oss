import {
  MdpAuthClient,
  refreshStoredSsoSession,
  getSsoSessionState,
  SsoCredentialStore,
  type PublicSsoSessionState,
  type SsoSession,
  type SsoSessionStateOptions,
} from '@craft-agent/shared/auth'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

/** RPC channels handled by the local SSO login/session module. */
export const HANDLED_CHANNELS = [
  RPC_CHANNELS.sso.GET_SESSION,
  RPC_CHANNELS.sso.REFRESH,
  RPC_CHANNELS.sso.START_LOGIN,
  RPC_CHANNELS.sso.HANDLE_CALLBACK,
  RPC_CHANNELS.sso.LOGOUT,
] as const

/** Register local-only SSO startup session and refresh handlers. */
export function registerSsoHandlers(server: RpcServer, deps: Pick<HandlerDeps, 'platform'>): void {
  server.handle(RPC_CHANNELS.sso.GET_SESSION, async () => {
    return handleSsoStartupSession({
      ...createSsoSessionDeps(),
      isPackaged: deps.platform.isPackaged,
    })
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

  server.handle(RPC_CHANNELS.sso.LOGOUT, async () => {
    return handleSsoLogout(createSsoSessionDeps())
  })
}

function createSsoSessionDeps() {
  return {
    credentialStore: new SsoCredentialStore(),
    authClient: new MdpAuthClient(),
  }
}

/** Dependencies used to resolve the startup SSO session state. */
export interface SsoStartupSessionDeps extends SsoSessionStateOptions {
  /** True when running from a packaged production binary. */
  isPackaged: boolean
  /** Environment source used to read development flags. */
  env?: NodeJS.ProcessEnv
}

const DEV_SSO_BYPASS_SESSION: SsoSession = {
  token: 'dev-sso-bypass-session-token',
  accessToken: 'dev-sso-bypass-access-token',
  idToken: 'dev-sso-bypass-id-token',
  expiresAt: Date.UTC(2100, 0, 1),
  employeeId: 'DEV-EMPLOYEE',
  ystId: 'DEV-YST',
  department: 'Development',
  userName: 'Development User',
}

/** Resolve startup SSO state, optionally injecting a development-only mock session. */
export async function handleSsoStartupSession({
  isPackaged,
  env = process.env,
  ...sessionStateOptions
}: SsoStartupSessionDeps): Promise<PublicSsoSessionState> {
  if (isDevSsoBypassEnabled(isPackaged, env)) {
    const session = createDevSsoBypassSession()
    await sessionStateOptions.credentialStore.save(session)
    return {
      authenticated: true,
      userName: session.userName,
      department: session.department,
    }
  }

  return getSsoSessionState(sessionStateOptions)
}

function isDevSsoBypassEnabled(isPackaged: boolean, env: NodeJS.ProcessEnv): boolean {
  return !isPackaged && env.CRAFT_DISABLE_SSO === '1'
}

function createDevSsoBypassSession(): SsoSession {
  return { ...DEV_SSO_BYPASS_SESSION }
}

/** Dependencies used to exchange and persist an SSO callback code. */
export interface SsoCallbackDeps {
  /** Auth client used to exchange the authorization code for an SSO session. */
  authClient: Pick<MdpAuthClient, 'login'>
  /** Credential store used to persist the exchanged SSO session. */
  credentialStore: Pick<SsoCredentialStore, 'save'>
}

/** Dependencies used to clear a persisted SSO session. */
export interface SsoLogoutDeps {
  /** Credential store used to clear encrypted tokens and plain identity config. */
  credentialStore: Pick<SsoCredentialStore, 'clear'>
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

/** Clear all persisted SSO session state. */
export async function handleSsoLogout(
  deps: SsoLogoutDeps = createSsoSessionDeps(),
): Promise<{ success: true }> {
  await deps.credentialStore.clear()
  return { success: true }
}
