/**
 * Credential Storage Module
 *
 * Provides secure credential storage using AES-256-GCM encrypted file.
 * All methods auto-initialize, so explicit initialize() calls are optional.
 *
 * Usage:
 *   import { getCredentialManager } from './credentials';
 *
 *   const manager = getCredentialManager();
 *
 *   // Get/set API key
 *   const apiKey = await manager.getApiKey();
 *   await manager.setApiKey('sk-ant-...');
 *
 *   // Get/set workspace OAuth
 *   const oauth = await manager.getWorkspaceOAuth(workspaceId);
 *   await manager.setWorkspaceOAuth(workspaceId, { accessToken, refreshToken, ... });
 *
 *   // Get/set agent MCP/API credentials
 *   const mcpCreds = await manager.getMcpOAuth(wsId, agentId, serverName);
 *   const apiKey = await manager.getApiKeyForAgent(wsId, agentId, apiName);
 */

export {
  CredentialManager,
  credentialKindForType,
  getCredentialManager,
} from './manager.ts';
export {
  applyCredentialMigration,
  previewCredentialMigration,
  rollbackCredentialMigration,
} from './migration.ts';
export type {
  CredentialMigrationApplyResult,
  CredentialMigrationEntry,
  CredentialMigrationPreview,
} from './migration.ts';
export type { CredentialId, CredentialType, StoredCredential } from './types.ts';
export {
  credentialIdToAccount,
  accountToCredentialId,
  openClawGatewayCredentialId,
  SOURCE_CREDENTIAL_TYPES,
} from './types.ts';
export type {
  CredentialBackend,
  CredentialMigrationBackend,
  CredentialMigrationRecord,
  CredentialMigrationSnapshot,
} from './backends/types.ts';
export { SecureStorageBackend } from './backends/secure-storage.ts';
export {
  CREDENTIAL_ENVELOPE_CODEC,
  CREDENTIAL_ENVELOPE_FORMAT,
  CREDENTIAL_ENVELOPE_VERSION,
  credentialPayloadFingerprint,
  decodeCredentialEnvelope,
  decodeCredentialEnvelopeOrLegacy,
  encodeCredentialEnvelope,
} from './envelope.ts';
export type { CredentialEnvelopeInput, CredentialEnvelopeV1 } from './envelope.ts';
export type {
  CredentialImporter,
  ImportCandidate,
  ImportCommitInput,
  ImportPreview,
  ProviderCredentialMetadata,
  ProviderMaterialization,
  SecretProvider,
} from './fabric/types.ts';
export { LocalFileSecretProvider } from './fabric/local-file-provider.ts';
export { InfisicalProviderError, InfisicalSecretProvider } from './fabric/infisical-provider.ts';
export type {
  InfisicalHttpClient,
  InfisicalHttpRequest,
  InfisicalHttpResponse,
  InfisicalProviderErrorCode,
  InfisicalSecretProviderOptions,
} from './fabric/infisical-provider.ts';
export { CredentialsEncImporter, EnvFileImporter } from './fabric/importers.ts';
export { GitCredentialHelperImporter } from './fabric/git-helper-importer.ts';
export type {
  GitCredentialHelperFill,
  GitCredentialHelperImporterOptions,
  GitCredentialHelperQuery,
  GitCredentialHelperRunner,
  GitCredentialHelperSecret,
} from './fabric/git-helper-importer.ts';
export { DockerCredentialHelperImporter } from './fabric/docker-helper-importer.ts';
export type {
  DockerCredentialHelperGet,
  DockerCredentialHelperImporterOptions,
  DockerCredentialHelperQuery,
  DockerCredentialHelperSecret,
} from './fabric/docker-helper-importer.ts';
export { AwsSharedProfileImporter } from './fabric/aws-profile-importer.ts';
export { KeychainImporter } from './fabric/keychain-importer.ts';
export type {
  KeychainGet,
  KeychainImporterOptions,
  KeychainItem,
  KeychainList,
} from './fabric/keychain-importer.ts';
export { GoogleAdcImporter } from './fabric/adc-importer.ts';
export type { GoogleAdcImporterOptions } from './fabric/adc-importer.ts';
export { SshAgentImporter } from './fabric/ssh-agent-importer.ts';
export type {
  SshAgentIdentity,
  SshAgentImporterOptions,
  SshAgentList,
} from './fabric/ssh-agent-importer.ts';
export type {
  AwsCredentialProcessRun,
  AwsCredentialProcessQuery,
  AwsCredentialProcessSecret,
  AwsSharedProfileImporterOptions,
} from './fabric/aws-profile-importer.ts';
export {
  createAwsCredentialProcessRun,
  createDockerCredentialGet,
  createGitCredentialFill,
  createKeychainGet,
  createKeychainList,
  createSshAgentList,
  defaultPaths,
} from './fabric/host-runners.ts';
export type {
  AwsProcessRun,
  DockerRun,
  GitRun,
  HostPaths,
  KeychainGetRun,
  KeychainListRun,
  SshListRun,
} from './fabric/host-runners.ts';

export { createProviderMaterialization, maskSecret } from './fabric/materialization.ts';
export { BrokerDenial, InProcessCredentialBroker } from './fabric/broker.ts';
export type {
  AccessGrant,
  AcquireLeaseInput,
  BrokerAuditEvent,
  ConsumerIdentity,
  CredentialBrokerOptions,
  CredentialLease,
} from './fabric/broker.ts';
export { JsonAccessGrantStore, MemoryAccessGrantStore } from './fabric/grant-store.ts';
export type { AccessGrantStore } from './fabric/grant-store.ts';
export { DELIVERY_MECHANISM_RANK, selectDeliveryMechanism, applyTrustedHttpHeader, redactHeaders } from './fabric/delivery.ts';
export type { DeliveryMechanism } from './fabric/delivery.ts';
