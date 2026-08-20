export type {
  Profile,
  ProfileMode,
  WorkspaceMembership,
  WorkspaceRole,
  ServiceConnection,
  ServiceConnectionStatus,
  ServiceProvider,
  Entitlement,
  EntitlementStatus,
  IdentityState,
  IdentityFile,
  UpdateProfileInput,
  ConnectServiceInput,
  DisconnectServiceInput,
} from './types.ts';
export type {
  CredentialKind,
  CredentialRef,
  CredentialRefId,
  CredentialRefIdFactory,
  CredentialVersion,
  CredentialVersionStatus,
  ProviderLocator,
  RegisterCredentialRefInput,
  RegisterCredentialVersionInput,
  StorageMode,
} from './credential-types.ts';
export {
  CredentialRefRegistry,
  createCredentialRefId,
  isCredentialKind,
  isCredentialRefId,
  isStorageMode,
} from './credential-types.ts';
export { attachCredentialRef } from './attach-credential-ref.ts';
export type { AttachCredentialRefInput } from './attach-credential-ref.ts';

export {
  IdentityStore,
  getIdentityStore,
  resetIdentityStoreCache,
  createDefaultProfile,
} from './store.ts';
export type { IdentityStoreOptions } from './store.ts';
