import { getCredentialManager, type CredentialId, type StoredCredential } from '../credentials/index.ts';
import {
  loadStoredConfig,
  saveConfig,
  type StoredConfig,
} from '../config/storage.ts';
import type { SsoSession } from './mdp-auth-client.ts';

export interface SsoSessionIdentity {
  employeeId: string;
  ystId: string;
  department: string;
  userName: string;
  expiresAt: number;
}

interface SsoCredentialStoreCredentialManager {
  get(id: CredentialId): Promise<StoredCredential | null>;
  set(id: CredentialId, credential: StoredCredential): Promise<void>;
  delete(id: CredentialId): Promise<boolean>;
}

export interface SsoCredentialStoreOptions {
  credentialManager?: SsoCredentialStoreCredentialManager;
  loadConfig?: () => StoredConfig | null;
  saveConfig?: (config: StoredConfig) => void;
}

export const SSO_CREDENTIAL_ID: CredentialId = { type: 'mdp_sso' };

export class SsoCredentialStore {
  private readonly credentialManager: SsoCredentialStoreCredentialManager;
  private readonly loadConfig: () => StoredConfig | null;
  private readonly saveConfig: (config: StoredConfig) => void;

  constructor(options: SsoCredentialStoreOptions = {}) {
    this.credentialManager = options.credentialManager ?? getCredentialManager();
    this.loadConfig = options.loadConfig ?? loadStoredConfig;
    this.saveConfig = options.saveConfig ?? saveConfig;
  }

  async save(session: SsoSession): Promise<void> {
    const config = this.requireConfig();

    await this.credentialManager.set(SSO_CREDENTIAL_ID, {
      value: session.token,
      accessToken: session.accessToken,
      idToken: session.idToken,
    });

    config.ssoSessionIdentity = {
      employeeId: session.employeeId,
      ystId: session.ystId,
      department: session.department,
      userName: session.userName,
      expiresAt: session.expiresAt,
    };
    this.saveConfig(config);
  }

  async load(): Promise<SsoSession | null> {
    const credential = await this.credentialManager.get(SSO_CREDENTIAL_ID);
    const identity = this.loadConfig()?.ssoSessionIdentity;

    if (!isCompleteSsoCredential(credential) || !isCompleteSsoIdentity(identity)) {
      return null;
    }

    return {
      token: credential.value,
      accessToken: credential.accessToken,
      idToken: credential.idToken,
      expiresAt: identity.expiresAt,
      employeeId: identity.employeeId,
      ystId: identity.ystId,
      department: identity.department,
      userName: identity.userName,
    };
  }

  async clear(): Promise<void> {
    await this.credentialManager.delete(SSO_CREDENTIAL_ID);

    const config = this.loadConfig();
    if (!config?.ssoSessionIdentity) return;

    delete config.ssoSessionIdentity;
    this.saveConfig(config);
  }

  private requireConfig(): StoredConfig {
    const config = this.loadConfig();
    if (!config) {
      throw new Error('Cannot save SSO session: app config is not initialized');
    }
    return config;
  }
}

function isCompleteSsoCredential(value: StoredCredential | null): value is StoredCredential & {
  value: string;
  accessToken: string;
  idToken: string;
} {
  return (
    typeof value?.value === 'string' &&
    value.value.length > 0 &&
    typeof value.accessToken === 'string' &&
    value.accessToken.length > 0 &&
    typeof value.idToken === 'string' &&
    value.idToken.length > 0
  );
}

function isCompleteSsoIdentity(value: unknown): value is SsoSessionIdentity {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.employeeId === 'string' &&
    candidate.employeeId.length > 0 &&
    typeof candidate.ystId === 'string' &&
    candidate.ystId.length > 0 &&
    typeof candidate.department === 'string' &&
    candidate.department.length > 0 &&
    typeof candidate.userName === 'string' &&
    candidate.userName.length > 0 &&
    typeof candidate.expiresAt === 'number' &&
    Number.isFinite(candidate.expiresAt)
  );
}
