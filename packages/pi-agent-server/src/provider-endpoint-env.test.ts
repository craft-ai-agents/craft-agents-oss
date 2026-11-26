import { afterEach, describe, expect, it } from 'bun:test';
import { ModelRegistry, ModelRuntime } from '@earendil-works/pi-coding-agent';
import { InMemoryCredentialStore, InMemoryModelsStore } from '@earendil-works/pi-ai';
import { parseCloudflareGatewayUrl } from '../../shared/src/config/cloudflare-gateway.ts';
import { providerEndpointEnv } from './provider-endpoint-env.ts';

describe('parseCloudflareGatewayUrl', () => {
  it('reads account and gateway ids from a gateway URL, with or without a provider suffix', () => {
    expect(parseCloudflareGatewayUrl('https://gateway.ai.cloudflare.com/v1/acc123/gw456')).toEqual({ accountId: 'acc123', gatewayId: 'gw456' });
    expect(parseCloudflareGatewayUrl(' https://gateway.ai.cloudflare.com/v1/acc123/gw456/anthropic/ ')).toEqual({ accountId: 'acc123', gatewayId: 'gw456' });
  });

  it('rejects other hosts, missing ids and the placeholder example', () => {
    expect(parseCloudflareGatewayUrl('https://api.cloudflare.com/v1/acc/gw')).toBeNull();
    expect(parseCloudflareGatewayUrl('http://gateway.ai.cloudflare.com/v1/acc/gw')).toBeNull();
    expect(parseCloudflareGatewayUrl('https://gateway.ai.cloudflare.com/v1/acc')).toBeNull();
    expect(parseCloudflareGatewayUrl('https://gateway.ai.cloudflare.com/v1/<account-id>/<gateway-id>')).toBeNull();
    expect(parseCloudflareGatewayUrl('not a url')).toBeNull();
  });

  it('returns null for a malformed percent-escape instead of throwing', () => {
    // `new URL` keeps invalid escapes as they are, so decoding them is what fails
    expect(() => parseCloudflareGatewayUrl('https://gateway.ai.cloudflare.com/v1/acc/gw%zz')).not.toThrow();
    expect(parseCloudflareGatewayUrl('https://gateway.ai.cloudflare.com/v1/acc/gw%zz')).toBeNull();
    expect(parseCloudflareGatewayUrl('https://gateway.ai.cloudflare.com/v1/acc/gw%')).toBeNull();
    // A well-formed escape still decodes
    expect(parseCloudflareGatewayUrl('https://gateway.ai.cloudflare.com/v1/acc%20id/gw')).toEqual({ accountId: 'acc id', gatewayId: 'gw' });
  });
});

describe('providerEndpointEnv', () => {
  it('maps Azure and Cloudflare base URLs to the env the Pi SDK reads', () => {
    expect(providerEndpointEnv('azure', 'https://res.openai.azure.com')).toEqual({ AZURE_OPENAI_BASE_URL: 'https://res.openai.azure.com' });
    expect(providerEndpointEnv('cloudflare-ai-gateway', 'https://gateway.ai.cloudflare.com/v1/acc123/gw456'))
      .toEqual({ CLOUDFLARE_ACCOUNT_ID: 'acc123', CLOUDFLARE_GATEWAY_ID: 'gw456' });
  });

  it('is empty for other providers, a missing URL or an unusable gateway URL', () => {
    expect(providerEndpointEnv('openai', 'https://example.com')).toEqual({});
    expect(providerEndpointEnv('azure', undefined)).toEqual({});
    expect(providerEndpointEnv('cloudflare-ai-gateway', 'https://example.com/v1/a/b')).toEqual({});
  });

  it('is empty for a gateway URL with a malformed percent-escape', () => {
    expect(() => providerEndpointEnv('cloudflare-ai-gateway', 'https://gateway.ai.cloudflare.com/v1/acc/gw%zz')).not.toThrow();
    expect(providerEndpointEnv('cloudflare-ai-gateway', 'https://gateway.ai.cloudflare.com/v1/acc/gw%zz')).toEqual({});
  });
});

describe('Cloudflare AI Gateway through the Pi SDK', () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { account: process.env.CLOUDFLARE_ACCOUNT_ID, gateway: process.env.CLOUDFLARE_GATEWAY_ID };
  afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of [['CLOUDFLARE_ACCOUNT_ID', originalEnv.account], ['CLOUDFLARE_GATEWAY_ID', originalEnv.gateway]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('sends the stored token to the gateway URL built from the endpoint env', async () => {
    Object.assign(process.env, providerEndpointEnv('cloudflare-ai-gateway', 'https://gateway.ai.cloudflare.com/v1/acc123/gw456'));
    const seen: Array<{ url: string; auth: string | null }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      seen.push({ url: String(input instanceof Request ? input.url : input), auth: headers.get('cf-aig-authorization') });
      return new Response('{"type":"error","error":{"type":"invalid_request_error","message":"stop"}}', {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const credentials = new InMemoryCredentialStore();
    await credentials.modify('cloudflare-ai-gateway', async () => ({ type: 'api_key', key: 'cf-token' }) as never);
    const runtime = await ModelRuntime.create({ credentials, modelsPath: null, modelsStore: new InMemoryModelsStore() } as never);
    const model = new ModelRegistry(runtime).find('cloudflare-ai-gateway', 'claude-sonnet-5-5');
    expect(model).toBeDefined();
    await (runtime as unknown as { streamSimple: Function })
      .streamSimple(model, { messages: [{ role: 'user', content: 'hi', timestamp: Date.now() }] }, { maxRetries: 0 })
      .result();

    expect(seen[0]?.url.startsWith('https://gateway.ai.cloudflare.com/v1/acc123/gw456/anthropic/')).toBe(true);
    expect(seen[0]?.auth).toBe('Bearer cf-token');
  });
});
