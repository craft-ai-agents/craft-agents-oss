import { beforeAll, describe, expect, it } from 'bun:test';

process.env.CRAFT_INTERCEPTOR_DISABLE_AUTO_INSTALL = '1';

let applySsoTokenInjection: typeof import('../unified-network-interceptor.ts').applySsoTokenInjection;
let handleSsoTokenExpiredResponse: typeof import('../unified-network-interceptor.ts').handleSsoTokenExpiredResponse;
let resolveSsoInterceptorConfig: typeof import('../unified-network-interceptor.ts').resolveSsoInterceptorConfig;
let SSO_TOKEN_EXPIRED_SIGNAL: typeof import('../unified-network-interceptor.ts').SSO_TOKEN_EXPIRED_SIGNAL;

describe('unified-network-interceptor SSO token handling', () => {
  beforeAll(async () => {
    const mod = await import('../unified-network-interceptor.ts');
    applySsoTokenInjection = mod.applySsoTokenInjection;
    handleSsoTokenExpiredResponse = mod.handleSsoTokenExpiredResponse;
    resolveSsoInterceptorConfig = mod.resolveSsoInterceptorConfig;
    SSO_TOKEN_EXPIRED_SIGNAL = mod.SSO_TOKEN_EXPIRED_SIGNAL;
  });

  it('injects the raw SSO token for requests to the configured base URL', () => {
    const init = applySsoTokenInjection(
      'https://mdp.example.test/api/llm/chat',
      { headers: { Authorization: 'Bearer stale-token', 'x-other': '1' } },
      'https://mdp.example.test/api/llm/chat',
      { token: 'raw-token', baseUrl: 'https://mdp.example.test/api/llm' },
    );

    const headers = new Headers(init?.headers);
    expect(headers.get('Authorization')).toBe('raw-token');
    expect(headers.get('x-other')).toBe('1');
  });

  it('does not modify requests to other URLs', () => {
    const originalInit = { headers: { Authorization: 'Bearer existing-token' } };

    const init = applySsoTokenInjection(
      'https://api.example.test/v1/messages',
      originalInit,
      'https://api.example.test/v1/messages',
      { token: 'raw-token', baseUrl: 'https://mdp.example.test/api/llm' },
    );

    expect(init).toBe(originalInit);
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer existing-token');
  });

  it('emits SSO_TOKEN_EXPIRED for a 501 from the configured base URL', () => {
    const emitted: string[] = [];

    handleSsoTokenExpiredResponse(
      new Response(null, { status: 501 }),
      'https://mdp.example.test/api/llm/chat',
      { token: 'raw-token', baseUrl: 'https://mdp.example.test/api/llm' },
      () => emitted.push(SSO_TOKEN_EXPIRED_SIGNAL),
    );

    expect(emitted).toEqual([SSO_TOKEN_EXPIRED_SIGNAL]);
  });

  it('does not emit for a 501 from a different URL', () => {
    const emitted: string[] = [];

    handleSsoTokenExpiredResponse(
      new Response(null, { status: 501 }),
      'https://api.example.test/v1/messages',
      { token: 'raw-token', baseUrl: 'https://mdp.example.test/api/llm' },
      () => emitted.push(SSO_TOKEN_EXPIRED_SIGNAL),
    );

    expect(emitted).toEqual([]);
  });

  it('does not inject headers or handle 501 responses when env vars are absent', () => {
    const config = resolveSsoInterceptorConfig({});
    const originalInit = { headers: { Authorization: 'Bearer existing-token' } };
    const emitted: string[] = [];

    const init = applySsoTokenInjection(
      'https://mdp.example.test/api/llm/chat',
      originalInit,
      'https://mdp.example.test/api/llm/chat',
      config,
    );
    handleSsoTokenExpiredResponse(
      new Response(null, { status: 501 }),
      'https://mdp.example.test/api/llm/chat',
      config,
      () => emitted.push(SSO_TOKEN_EXPIRED_SIGNAL),
    );

    expect(init).toBe(originalInit);
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer existing-token');
    expect(emitted).toEqual([]);
  });
});
