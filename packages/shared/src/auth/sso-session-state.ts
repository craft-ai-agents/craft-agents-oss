import type { SsoSession } from './mdp-auth-client.ts';

export interface PublicSsoSessionState {
  authenticated: boolean;
  userName?: string;
  department?: string;
}

interface SsoSessionCredentialStore {
  load(): Promise<SsoSession | null>;
  save(session: SsoSession): Promise<void>;
  clear(): Promise<void>;
}

interface SsoSessionAuthClient {
  refresh(token: string): Promise<SsoSession>;
}

export interface SsoSessionStateOptions {
  credentialStore: SsoSessionCredentialStore;
  authClient: SsoSessionAuthClient;
  now?: () => number;
}

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

function authenticated(session: SsoSession): PublicSsoSessionState {
  return {
    authenticated: true,
    userName: session.userName,
    department: session.department,
  };
}

function unauthenticated(): PublicSsoSessionState {
  return { authenticated: false };
}
