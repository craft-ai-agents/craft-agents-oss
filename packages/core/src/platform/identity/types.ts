/**
 * Identity Center domain contracts (S-07).
 *
 * Federated model: Profile is the root; external accounts (including SiYuan
 * Cloud) attach as ServiceConnection via credentialRef. Secrets never live here.
 */

export type ProfileMode = 'local' | 'cloud';

export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';

export type ServiceProvider =
  | 'siyuan-local'
  | 'siyuan-cloud'
  | 'github'
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'slack'
  | 'custom';

export type ServiceConnectionStatus =
  | 'connected'
  | 'expired'
  | 'syncing'
  | 'error'
  | 'disconnected';

export type EntitlementStatus = 'active' | 'expired' | 'trial';

export interface Profile {
  id: string;
  displayName: string;
  avatar?: string;
  mode: ProfileMode;
}

/** Types-only contract for team/remote workspaces (server outside W4 scope). */
export interface WorkspaceMembership {
  workspaceId: string;
  profileId: string;
  role: WorkspaceRole;
}

export interface ServiceConnection {
  id: string;
  workspaceId: string;
  provider: ServiceProvider;
  accountLabel?: string;
  /** Opaque ref into CredentialManager — never a secret value. */
  credentialRef?: string;
  status: ServiceConnectionStatus;
  /**
   * When true, this row is a read-only reflection of an LLM connection owned
   * by AI Settings. Disconnect is disabled / links out.
   */
  readOnly?: boolean;
}

export interface Entitlement {
  provider: ServiceProvider | string;
  product: string;
  status: EntitlementStatus;
  expiresAt?: number;
}

export interface IdentityState {
  profile: Profile;
  connections: ServiceConnection[];
  entitlements: Entitlement[];
}

export interface IdentityFile {
  version: 1;
  profile: Profile;
  connections: ServiceConnection[];
  entitlements: Entitlement[];
}

export interface UpdateProfileInput {
  displayName?: string;
  avatar?: string;
  mode?: ProfileMode;
}

export interface ConnectServiceInput {
  provider: ServiceProvider;
  workspaceId: string;
  accountLabel?: string;
  /** When set for oauth-style providers, stored as service_oauth secret. */
  credentialValue?: string;
  /** Optional stable id; otherwise generated. */
  connectionId?: string;
}

export interface DisconnectServiceInput {
  connectionId: string;
}
