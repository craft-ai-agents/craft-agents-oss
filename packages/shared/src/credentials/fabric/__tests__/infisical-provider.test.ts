import { describe, expect, it } from 'bun:test';
import { CredentialRefRegistry } from '@craft-agent/core/platform';
import type { ProviderLocator } from '@craft-agent/core/platform';
import { credentialPayloadFingerprint } from '../../envelope.ts';
import type { SecretProvider } from '../types.ts';
import {
  InfisicalProviderError,
  InfisicalSecretProvider,
  type InfisicalHttpClient,
  type InfisicalHttpRequest,
  type InfisicalHttpResponse,
} from '../infisical-provider.ts';

const SECRET = 'super-secret';
const SITE_URL = 'https://infisical.example.test';
const CLIENT_ID = 'test-client-id';
const CLIENT_SECRET = 'test-client-secret';
const ACCESS_TOKEN = 'test-access-token';
const TENANT_PROJECT_ID = 'proj_test';

const LOCATOR: Extract<ProviderLocator, { type: 'infisical' }> = {
  type: 'infisical',
  projectId: TENANT_PROJECT_ID,
  environment: 'prod',
  secretPath: '/github',
  secretKey: 'token',
};

type SecretRecord = {
  projectId: string;
  environment: string;
  secretPath: string;
  secretKey: string;
  secretValue: string;
  version: number;
};

class FakeInfisical {
  readonly calls: InfisicalHttpRequest[] = [];
  readonly secrets = new Map<string, SecretRecord>();
  fail: 'tls' | 'auth' | 'tenant' | undefined;
  loginStatus = 200;

  private keyOf(projectId: string, environment: string, secretPath: string, secretKey: string): string {
    return `${projectId}\0${environment}\0${secretPath}\0${secretKey}`;
  }

  readonly http: InfisicalHttpClient = async (request) => {
    this.calls.push(request);
    if (this.fail === 'tls') {
      const error = Object.assign(new Error('unable to verify the first certificate'), {
        code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      });
      throw error;
    }

    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/api/v1/auth/universal-auth/login') {
      if (this.fail === 'auth' || this.loginStatus === 401) {
        return json(401, { message: 'Unauthorized' });
      }
      const body = parseBody(request.body);
      if (body.clientId !== CLIENT_ID || body.clientSecret !== CLIENT_SECRET) {
        return json(401, { message: 'Unauthorized' });
      }
      return json(200, { accessToken: ACCESS_TOKEN, tokenType: 'Bearer' });
    }

    const authorization = header(request, 'authorization');
    if (authorization !== `Bearer ${ACCESS_TOKEN}`) {
      return json(401, { message: 'Unauthorized' });
    }
    if (this.fail === 'auth') {
      return json(401, { message: 'Unauthorized' });
    }

    const workspaceMatch = url.pathname.match(/^\/api\/v1\/workspace\/([^/]+)$/);
    if (request.method === 'GET' && workspaceMatch) {
      const projectId = decodeURIComponent(workspaceMatch[1] ?? '');
      if (this.fail === 'tenant' || projectId !== TENANT_PROJECT_ID) {
        return json(403, { message: 'Project access denied' });
      }
      return json(200, { workspace: { id: projectId } });
    }

    const secretMatch = url.pathname.match(/^\/api\/v3\/secrets\/raw\/([^/]+)$/);
    if (secretMatch) {
      const secretKey = decodeURIComponent(secretMatch[1] ?? '');
      const body = parseBody(request.body);
      const projectId = url.searchParams.get('workspaceId') ?? stringField(body.workspaceId);
      const environment = url.searchParams.get('environment') ?? stringField(body.environment);
      const secretPath = url.searchParams.get('secretPath') ?? stringField(body.secretPath);
      if (!projectId || !environment || !secretPath) {
        return json(400, { message: 'Missing locator fields' });
      }
      if (this.fail === 'tenant' || projectId !== TENANT_PROJECT_ID) {
        return json(403, { message: 'Tenant project mismatch' });
      }
      const key = this.keyOf(projectId, environment, secretPath, secretKey);
      if (request.method === 'GET') {
        const record = this.secrets.get(key);
        if (!record) return json(404, { message: 'Secret not found' });
        return json(200, {
          secret: {
            workspace: record.projectId,
            environment: record.environment,
            secretPath: record.secretPath,
            secretKey: record.secretKey,
            secretValue: record.secretValue,
            version: record.version,
          },
        });
      }
      if (request.method === 'POST' || request.method === 'PATCH') {
        const secretValue = stringField(body.secretValue);
        if (!secretValue) return json(400, { message: 'Missing secretValue' });
        const record: SecretRecord = {
          projectId,
          environment,
          secretPath,
          secretKey,
          secretValue,
          version: (this.secrets.get(key)?.version ?? 0) + 1,
        };
        this.secrets.set(key, record);
        return json(200, { secret: { workspace: record.projectId, version: record.version } });
      }
      if (request.method === 'DELETE') {
        this.secrets.delete(key);
        return json(200, {});
      }
    }

    return json(404, { message: 'Not found' });
  };
}

function json(status: number, body: unknown): InfisicalHttpResponse {
  return { status, body: JSON.stringify(body) };
}

function parseBody(body: string | undefined): Record<string, unknown> {
  if (!body) return {};
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function header(request: InfisicalHttpRequest, name: string): string | undefined {
  if (!request.headers) return undefined;
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(request.headers)) {
    if (key.toLowerCase() === target) return value;
  }
  return undefined;
}

function setup(fake: FakeInfisical, overrides?: { siteUrl?: string; tenantProjectId?: string }) {
  const registry = new CredentialRefRegistry();
  const infisical = new InfisicalSecretProvider({
    registry,
    http: fake.http,
    siteUrl: overrides?.siteUrl ?? SITE_URL,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    tenantProjectId: overrides?.tenantProjectId ?? TENANT_PROJECT_ID,
  });
  return { registry, infisical };
}

async function writeToken(target: InfisicalSecretProvider, locator: ProviderLocator = LOCATOR) {
  return target.write({
    kind: 'bearer_token',
    locator,
    payload: { value: SECRET },
  });
}

function asSecretProvider(value: InfisicalSecretProvider): SecretProvider {
  return value;
}

function expectNoSecretLeak(value: unknown): void {
  expect(JSON.stringify(value)).not.toContain(SECRET);
  if (value instanceof Error) {
    expect(value.message).not.toContain(SECRET);
    expect(value.stack ?? '').not.toContain(SECRET);
  }
}

describe('InfisicalSecretProvider', () => {
  it('implements SecretProvider with infisical locators', async () => {
    const fake = new FakeInfisical();
    const infisical = asSecretProvider(setup(fake).infisical);
    expect(infisical.id).toBe('infisical');
    const written = await infisical.write({
      kind: 'bearer_token',
      locator: LOCATOR,
      payload: { value: SECRET },
    });
    expect(written.ref.providerId).toBe('infisical');
    expect(written.ref.locator).toEqual(LOCATOR);
    expectNoSecretLeak(written);
    expectNoSecretLeak(fake.calls.map((call) => call.url));
  });

  it('resolveForLease hides the secret from JSON.stringify', async () => {
    const fake = new FakeInfisical();
    const { infisical } = setup(fake);
    const written = await writeToken(infisical);
    const material = await infisical.resolveForLease({ credentialRef: written.ref });
    expect(material.payload.value).toBe(SECRET);
    expect(JSON.stringify(material)).not.toContain(SECRET);
    expect(material.credentialRefId).toBe(written.ref.id);
    expect(material.kind).toBe('bearer_token');
  });

  it('inspect returns metadata without the secret payload', async () => {
    const fake = new FakeInfisical();
    const { infisical } = setup(fake);
    const written = await writeToken(infisical);
    const inspected = await infisical.inspect(written.ref);
    expect(inspected).toEqual({
      credentialRefId: written.ref.id,
      kind: 'bearer_token',
      fingerprint: credentialPayloadFingerprint('bearer_token', { value: SECRET }),
      status: 'active',
    });
    expectNoSecretLeak(inspected);
  });

  it('inspect reports missing when the remote secret is absent', async () => {
    const fake = new FakeInfisical();
    const { registry, infisical } = setup(fake);
    const ref = registry.register({
      kind: 'bearer_token',
      providerId: 'infisical',
      locator: LOCATOR,
    });
    const inspected = await infisical.inspect(ref);
    expect(inspected.status).toBe('missing');
    expect(inspected.fingerprint).toBe('');
    expectNoSecretLeak(inspected);
  });

  it('health succeeds only after TLS, auth, and tenant checks', async () => {
    const fake = new FakeInfisical();
    expect(await setup(fake).infisical.health()).toEqual({ status: 'healthy' });
    expect(fake.calls.some((call) => new URL(call.url).pathname === '/api/v1/auth/universal-auth/login')).toBe(true);
    expect(fake.calls.some((call) => new URL(call.url).pathname === `/api/v1/workspace/${TENANT_PROJECT_ID}`)).toBe(true);
  });

  it('inspect and health fail closed on TLS errors with a stable code', async () => {
    const fake = new FakeInfisical();
    fake.fail = 'tls';
    const { registry, infisical } = setup(fake);
    const ref = registry.register({
      kind: 'api_key',
      providerId: 'infisical',
      locator: LOCATOR,
    });
    await expect(infisical.inspect(ref)).rejects.toMatchObject({ code: 'tls' });
    await expect(infisical.inspect(ref)).rejects.toBeInstanceOf(InfisicalProviderError);
    expect(await infisical.health()).toEqual({ status: 'unavailable', code: 'tls' });
    await expect(infisical.resolveForLease({ credentialRef: ref })).rejects.toMatchObject({ code: 'tls' });
    try {
      await infisical.inspect(ref);
    } catch (error) {
      expectNoSecretLeak(error);
    }
  });

  it('inspect and health fail closed on auth errors with a stable code', async () => {
    const fake = new FakeInfisical();
    fake.fail = 'auth';
    const { registry, infisical } = setup(fake);
    const ref = registry.register({
      kind: 'api_key',
      providerId: 'infisical',
      locator: LOCATOR,
    });
    await expect(infisical.inspect(ref)).rejects.toMatchObject({ code: 'auth' });
    expect(await infisical.health()).toEqual({ status: 'unavailable', code: 'auth' });
    await expect(infisical.resolveForLease({ credentialRef: ref })).rejects.toMatchObject({ code: 'auth' });
  });

  it('inspect and health fail closed on tenant mismatch with a stable code', async () => {
    const fake = new FakeInfisical();
    const { registry, infisical } = setup(fake);
    const foreign: ProviderLocator = { ...LOCATOR, projectId: 'proj_other' };
    const ref = registry.register({
      kind: 'api_key',
      providerId: 'infisical',
      locator: foreign,
    });
    await expect(infisical.inspect(ref)).rejects.toMatchObject({ code: 'tenant' });
    expect(fake.calls).toEqual([]);
    await expect(writeToken(infisical, foreign)).rejects.toMatchObject({ code: 'tenant' });
    expect(fake.calls).toEqual([]);
  });

  it('inspect and health fail closed when Infisical denies the tenant project', async () => {
    const fake = new FakeInfisical();
    const { infisical } = setup(fake);
    const written = await writeToken(infisical);
    fake.fail = 'tenant';
    await expect(infisical.inspect(written.ref)).rejects.toMatchObject({ code: 'tenant' });
    expect(await infisical.health()).toEqual({ status: 'unavailable', code: 'tenant' });
  });

  it('rejects a non-https site URL as a TLS failure', async () => {
    const fake = new FakeInfisical();
    const { registry, infisical } = setup(fake, { siteUrl: 'http://infisical.example.test' });
    expect(await infisical.health()).toEqual({ status: 'unavailable', code: 'tls' });
    expect(fake.calls).toEqual([]);
    const ref = registry.register({
      kind: 'api_key',
      providerId: 'infisical',
      locator: LOCATOR,
    });
    await expect(infisical.inspect(ref)).rejects.toMatchObject({ code: 'tls' });
  });

  it('revoke deletes the remote secret and inspects as revoked', async () => {
    const fake = new FakeInfisical();
    const { infisical } = setup(fake);
    const written = await writeToken(infisical);
    expect(fake.secrets.size).toBe(1);
    await infisical.revoke({ credentialRef: written.ref });
    expect(fake.secrets.size).toBe(0);
    const inspected = await infisical.inspect(written.ref);
    expect(inspected.status).toBe('revoked');
    expectNoSecretLeak(inspected);
  });

  it('does not put client secrets or payload into request URLs', async () => {
    const fake = new FakeInfisical();
    const { infisical } = setup(fake);
    const written = await writeToken(infisical);
    await infisical.inspect(written.ref);
    await infisical.resolveForLease({ credentialRef: written.ref });
    await infisical.health();
    for (const call of fake.calls) {
      expect(call.url.startsWith(`${SITE_URL}/`)).toBe(true);
      expect(call.url).not.toContain(SECRET);
      expect(call.url).not.toContain(CLIENT_SECRET);
      expect(call.url).not.toContain(ACCESS_TOKEN);
    }
    const login = fake.calls.find((call) => call.url.endsWith('/api/v1/auth/universal-auth/login'));
    expect(login?.body).toContain(CLIENT_SECRET);
    const getSecret = fake.calls.find((call) => call.method === 'GET' && call.url.includes('/api/v3/secrets/raw/'));
    expect(getSecret?.url).toContain(`workspaceId=${TENANT_PROJECT_ID}`);
    expect(getSecret?.url).toContain('environment=prod');
    expect(getSecret?.url).toContain(`secretPath=${encodeURIComponent('/github')}`);
  });
});
