import {
  CredentialRefRegistry,
  type CredentialKind,
  type CredentialRef,
  type ProviderLocator,
} from '@craft-agent/core/platform';
import { credentialPayloadFingerprint } from '../envelope.ts';
import type { StoredCredential } from '../types.ts';
import { createProviderMaterialization } from './materialization.ts';
import type { ProviderCredentialMetadata, ProviderMaterialization, SecretProvider } from './types.ts';

export type InfisicalProviderErrorCode = 'tls' | 'auth' | 'tenant';

export class InfisicalProviderError extends Error {
  readonly code: InfisicalProviderErrorCode;

  constructor(code: InfisicalProviderErrorCode) {
    super(code);
    this.name = 'InfisicalProviderError';
    this.code = code;
  }
}

export interface InfisicalHttpRequest {
  readonly method: string;
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

export interface InfisicalHttpResponse {
  readonly status: number;
  readonly body: string;
}

export type InfisicalHttpClient = (request: InfisicalHttpRequest) => Promise<InfisicalHttpResponse>;

export interface InfisicalSecretProviderOptions {
  readonly registry: CredentialRefRegistry;
  readonly http: InfisicalHttpClient;
  readonly siteUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly tenantProjectId: string;
}

type InfisicalLocator = Extract<ProviderLocator, { type: 'infisical' }>;

type InfisicalSecret = {
  readonly secretValue: string;
  readonly workspace?: string;
  readonly version?: number;
};

export class InfisicalSecretProvider implements SecretProvider {
  readonly id = 'infisical';
  private readonly revoked = new Set<string>();

  constructor(private readonly options: InfisicalSecretProviderOptions) {}

  async health(): Promise<{ status: 'healthy' | 'repair_required' | 'unavailable'; code?: InfisicalProviderErrorCode }> {
    try {
      this.requireHttpsOrigin();
      const token = await this.login();
      await this.assertWorkspaceAccess(token);
      return { status: 'healthy' };
    } catch (error) {
      if (error instanceof InfisicalProviderError) {
        return { status: 'unavailable', code: error.code };
      }
      return { status: 'unavailable' };
    }
  }

  async write(input: {
    kind: CredentialKind;
    locator: ProviderLocator;
    payload: StoredCredential;
  }): Promise<{ ref: CredentialRef; version: import('@craft-agent/core/platform').CredentialVersion }> {
    const locator = this.requireInfisicalLocator(input.locator);
    const token = await this.login();
    await this.putSecret(token, locator, input.payload.value);
    const ref = this.options.registry.register({
      kind: input.kind,
      providerId: this.id,
      locator,
    });
    const version = this.options.registry.registerVersion({
      credentialRefId: ref.id,
      codec: 'stored-credential/v1',
      fingerprint: credentialPayloadFingerprint(input.kind, input.payload),
    });
    this.revoked.delete(ref.id);
    return { ref, version };
  }

  async inspect(ref: CredentialRef): Promise<ProviderCredentialMetadata> {
    if (this.revoked.has(ref.id)) {
      return { credentialRefId: ref.id, kind: ref.kind, fingerprint: '', status: 'revoked' };
    }
    const locator = this.requireInfisicalLocator(ref.locator);
    const secret = await this.getSecret(locator);
    if (!secret) {
      return { credentialRefId: ref.id, kind: ref.kind, fingerprint: '', status: 'missing' };
    }
    return {
      credentialRefId: ref.id,
      kind: ref.kind,
      fingerprint: credentialPayloadFingerprint(ref.kind, { value: secret.secretValue }),
      status: 'active',
    };
  }

  async resolveForLease(input: { credentialRef: CredentialRef }): Promise<ProviderMaterialization> {
    if (this.revoked.has(input.credentialRef.id)) {
      throw new Error('Provider materialization missing');
    }
    const locator = this.requireInfisicalLocator(input.credentialRef.locator);
    const secret = await this.getSecret(locator);
    if (!secret) throw new Error('Provider materialization missing');
    return createProviderMaterialization(input.credentialRef.id, input.credentialRef.kind, {
      value: secret.secretValue,
    });
  }

  async revoke(input: { credentialRef: CredentialRef }): Promise<void> {
    if (this.revoked.has(input.credentialRef.id)) return;
    const locator = this.requireInfisicalLocator(input.credentialRef.locator);
    const token = await this.login();
    await this.deleteSecret(token, locator);
    this.revoked.add(input.credentialRef.id);
    if (input.credentialRef.currentVersionId) {
      this.options.registry.setVersionStatus(input.credentialRef.currentVersionId, 'revoked');
    }
  }

  private requireHttpsOrigin(): URL {
    let origin: URL;
    try {
      origin = new URL(this.options.siteUrl);
    } catch {
      throw new InfisicalProviderError('tls');
    }
    if (origin.protocol !== 'https:') throw new InfisicalProviderError('tls');
    return origin;
  }

  private requireInfisicalLocator(locator: ProviderLocator): InfisicalLocator {
    if (locator.type !== 'infisical') {
      throw new InfisicalProviderError('tenant');
    }
    if (locator.projectId !== this.options.tenantProjectId) {
      throw new InfisicalProviderError('tenant');
    }
    return locator;
  }

  private async login(): Promise<string> {
    const response = await this.request({
      method: 'POST',
      path: '/api/v1/auth/universal-auth/login',
      body: JSON.stringify({
        clientId: this.options.clientId,
        clientSecret: this.options.clientSecret,
      }),
    });
    if (response.status === 401 || response.status === 403) {
      throw new InfisicalProviderError(this.codeFromDenied(response));
    }
    if (response.status < 200 || response.status >= 300) {
      throw new InfisicalProviderError('auth');
    }
    const parsed = parseJson(response.body);
    const token = isRecord(parsed) && typeof parsed.accessToken === 'string' ? parsed.accessToken : '';
    if (!token) throw new InfisicalProviderError('auth');
    return token;
  }

  private async assertWorkspaceAccess(token: string): Promise<void> {
    const projectId = this.options.tenantProjectId;
    if (!projectId) throw new InfisicalProviderError('tenant');
    const response = await this.request({
      method: 'GET',
      path: `/api/v1/workspace/${encodeURIComponent(projectId)}`,
      token,
    });
    if (response.status === 401) throw new InfisicalProviderError('auth');
    if (response.status === 403 || response.status === 404) {
      throw new InfisicalProviderError('tenant');
    }
    if (response.status < 200 || response.status >= 300) {
      throw new InfisicalProviderError('tenant');
    }
    const parsed = parseJson(response.body);
    const workspace = isRecord(parsed) && isRecord(parsed.workspace) ? parsed.workspace : undefined;
    const id = workspace && (typeof workspace.id === 'string' ? workspace.id : typeof workspace._id === 'string' ? workspace._id : '');
    if (!id || id !== projectId) throw new InfisicalProviderError('tenant');
  }

  private async getSecret(locator: InfisicalLocator): Promise<InfisicalSecret | null> {
    const token = await this.login();
    const response = await this.request({
      method: 'GET',
      path: `/api/v3/secrets/raw/${encodeURIComponent(locator.secretKey)}`,
      query: {
        workspaceId: locator.projectId,
        environment: locator.environment,
        secretPath: locator.secretPath,
      },
      token,
    });
    if (response.status === 404) return null;
    this.assertSecretAccess(response);
    const secret = readSecret(response.body);
    if (!secret) return null;
    this.assertSecretTenant(secret, locator);
    return secret;
  }

  private async putSecret(token: string, locator: InfisicalLocator, secretValue: string): Promise<void> {
    const response = await this.request({
      method: 'POST',
      path: `/api/v3/secrets/raw/${encodeURIComponent(locator.secretKey)}`,
      token,
      body: JSON.stringify({
        workspaceId: locator.projectId,
        environment: locator.environment,
        secretPath: locator.secretPath,
        secretValue,
      }),
    });
    if (response.status === 409) {
      const patched = await this.request({
        method: 'PATCH',
        path: `/api/v3/secrets/raw/${encodeURIComponent(locator.secretKey)}`,
        token,
        body: JSON.stringify({
          workspaceId: locator.projectId,
          environment: locator.environment,
          secretPath: locator.secretPath,
          secretValue,
        }),
      });
      this.assertSecretAccess(patched);
      return;
    }
    this.assertSecretAccess(response);
  }

  private async deleteSecret(token: string, locator: InfisicalLocator): Promise<void> {
    const response = await this.request({
      method: 'DELETE',
      path: `/api/v3/secrets/raw/${encodeURIComponent(locator.secretKey)}`,
      token,
      body: JSON.stringify({
        workspaceId: locator.projectId,
        environment: locator.environment,
        secretPath: locator.secretPath,
      }),
    });
    if (response.status === 404) return;
    this.assertSecretAccess(response);
  }

  private assertSecretAccess(response: InfisicalHttpResponse): void {
    if (response.status >= 200 && response.status < 300) return;
    if (response.status === 401) throw new InfisicalProviderError('auth');
    if (response.status === 403 || response.status === 404) {
      throw new InfisicalProviderError(this.codeFromDenied(response));
    }
    throw new InfisicalProviderError('auth');
  }

  private assertSecretTenant(secret: InfisicalSecret, locator: InfisicalLocator): void {
    if (secret.workspace && secret.workspace !== locator.projectId) {
      throw new InfisicalProviderError('tenant');
    }
  }

  private codeFromDenied(response: InfisicalHttpResponse): InfisicalProviderErrorCode {
    if (response.status === 401) return 'auth';
    if (/project|workspace|tenant/i.test(response.body)) return 'tenant';
    return 'auth';
  }

  private async request(input: {
    method: string;
    path: string;
    query?: Record<string, string>;
    token?: string;
    body?: string;
  }): Promise<InfisicalHttpResponse> {
    const origin = this.requireHttpsOrigin();
    const url = new URL(input.path, `${origin.origin}/`);
    if (url.origin !== origin.origin) throw new InfisicalProviderError('tls');
    if (input.query) {
      for (const [key, value] of Object.entries(input.query)) {
        url.searchParams.set(key, value);
      }
    }
    const headers: Record<string, string> = {};
    if (input.body !== undefined) headers['Content-Type'] = 'application/json';
    if (input.token) headers.Authorization = `Bearer ${input.token}`;
    try {
      return await this.options.http({
        method: input.method,
        url: url.toString(),
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
      });
    } catch (error) {
      throw classifyThrown(error);
    }
  }
}

function classifyThrown(error: unknown): InfisicalProviderError {
  if (error instanceof InfisicalProviderError) return error;
  if (isTlsError(error)) return new InfisicalProviderError('tls');
  const code = errorCode(error);
  if (code === 'auth' || code === 'tenant') return new InfisicalProviderError(code);
  return new InfisicalProviderError('auth');
}

function isTlsError(error: unknown): boolean {
  const code = errorCode(error);
  if (
    code === 'tls'
    || code.startsWith('ERR_TLS')
    || code.startsWith('ERR_SSL')
    || code.startsWith('UNABLE_TO_VERIFY')
    || code.startsWith('UNABLE_TO_GET_ISSUER')
    || code.includes('CERT')
    || code === 'DEPTH_ZERO_SELF_SIGNED_CERT'
    || code === 'SELF_SIGNED_CERT_IN_CHAIN'
  ) {
    return true;
  }
  return error instanceof Error && /certificate|ssl|\btls\b/i.test(error.message);
}

function errorCode(error: unknown): string {
  if (!error || typeof error !== 'object' || !('code' in error) || typeof error.code !== 'string') return '';
  return error.code;
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readSecret(body: string): InfisicalSecret | null {
  const parsed = parseJson(body);
  if (!isRecord(parsed) || !isRecord(parsed.secret)) return null;
  const secretValue = parsed.secret.secretValue;
  if (typeof secretValue !== 'string' || secretValue.length === 0) return null;
  const workspace = typeof parsed.secret.workspace === 'string'
    ? parsed.secret.workspace
    : typeof parsed.secret.workspaceId === 'string'
      ? parsed.secret.workspaceId
      : typeof parsed.secret.projectId === 'string'
        ? parsed.secret.projectId
        : undefined;
  const version = typeof parsed.secret.version === 'number' ? parsed.secret.version : undefined;
  return { secretValue, ...(workspace ? { workspace } : {}), ...(version !== undefined ? { version } : {}) };
}
