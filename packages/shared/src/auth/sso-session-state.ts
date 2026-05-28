import type { SsoSession } from './mdp-auth-client.ts';

/** Public renderer-safe view of an authenticated SSO session. */
export interface AuthenticatedSsoSessionState {
  authenticated: true;
  employeeId: string;
  userName?: string;
  department?: string;
}

/** Public renderer-safe view used when no valid SSO session exists. */
export interface UnauthenticatedSsoSessionState {
  authenticated: false;
}

/** SSO session state returned to the renderer. Raw tokens are never exposed. */
export type PublicSsoSessionState = AuthenticatedSsoSessionState | UnauthenticatedSsoSessionState;

interface SsoSessionCredentialStore {
  load(): Promise<SsoSession | null>;
  save(session: SsoSession): Promise<void>;
  clear(): Promise<void>;
}

interface SsoSessionAuthClient {
  refresh(token: string): Promise<SsoSession>;
}

export interface SsoSessionStateOptions {
  /** Store used to load, save, and clear persisted SSO sessions. */
  credentialStore: SsoSessionCredentialStore;
  /** Auth client used for silent token refresh when the identity token has expired. */
  authClient: SsoSessionAuthClient;
  /** Current time provider, injectable for deterministic tests. */
  now?: () => number;
}

/** Resolve the current public SSO state, silently refreshing expired sessions when possible. */
export async function getSsoSessionState(options: SsoSessionStateOptions): Promise<PublicSsoSessionState> {
  const session = await options.credentialStore.load();
  if (!session) {
    return unauthenticated();
  }

  if (session.expiresAt > (options.now ?? Date.now)()) {
    return authenticated(session);
  }

  return refreshStoredSsoSession(options);
}

/** Force a refresh of the stored SSO session and return the resulting public state. */
export async function refreshStoredSsoSession(options: SsoSessionStateOptions): Promise<PublicSsoSessionState> {
  const session = await options.credentialStore.load();
  if (!session) {
    return unauthenticated();
  }

  try {
    const refreshedSession = await options.authClient.refresh(session.token);
    await options.credentialStore.save(refreshedSession);
    return authenticated(refreshedSession);
  } catch {
    await options.credentialStore.clear();
    return unauthenticated();
  }
}

function authenticated(session: SsoSession): AuthenticatedSsoSessionState {
  return {
    authenticated: true,
    employeeId: session.employeeId,
    userName: session.userName,
    department: session.department,
  };
}

function unauthenticated(): UnauthenticatedSsoSessionState {
  return { authenticated: false };
}
