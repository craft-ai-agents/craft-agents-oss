import { beforeAll, describe, expect, it } from 'bun:test';
import { MAX_LOGGED_BODY_CHARS } from '../interceptor-common.ts';

let toCurl: typeof import('../unified-network-interceptor.ts').toCurl;

const URL_ = 'https://api.example.com/v1/chat/completions';

describe('toCurl request body logging', () => {
  beforeAll(async () => {
    // Keep the interceptor from patching globalThis.fetch.
    process.env.CRAFT_INTERCEPTOR_DISABLE_AUTO_INSTALL = '1';
    ({ toCurl } = await import('../unified-network-interceptor.ts'));
  });

  it('omits the request body by default', () => {
    const body = JSON.stringify({
      messages: [{ role: 'user', content: 'SENTINEL_PROMPT' }],
      image: 'data:image/png;base64,QUJDRA==',
    });

    const curl = toCurl(URL_, { method: 'POST', body });

    expect(curl).toContain(`[REQUEST BODY OMITTED: ${body.length} chars]`);
    expect(curl).not.toContain('SENTINEL_PROMPT');
    expect(curl).not.toContain('base64');
  });

  it('omits the body when the opt-in flag is explicitly off', () => {
    const curl = toCurl(URL_, { method: 'POST', body: 'SECRET' }, false);

    expect(curl).toContain('[REQUEST BODY OMITTED: 6 chars]');
    expect(curl).not.toContain('SECRET');
  });

  it('still redacts sensitive headers', () => {
    const curl = toCurl(URL_, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer sk-live-secret',
        'x-api-key': 'sk-ant-secret',
        cookie: 'session=abc',
      },
      body: '{}',
    });

    expect(curl).toContain("-H 'authorization: [REDACTED]'");
    expect(curl).toContain("-H 'x-api-key: [REDACTED]'");
    expect(curl).toContain("-H 'cookie: [REDACTED]'");
    expect(curl).toContain("-H 'content-type: application/json'");
    expect(curl).not.toContain('sk-live-secret');
    expect(curl).not.toContain('sk-ant-secret');
  });

  it('includes the body when the opt-in flag is on', () => {
    const curl = toCurl(URL_, { method: 'POST', body: '{"prompt":"SENTINEL_PROMPT"}' }, true);

    expect(curl).toContain('SENTINEL_PROMPT');
    expect(curl).not.toContain('[REQUEST BODY OMITTED');
  });

  it('truncates an oversized body on the opt-in path', () => {
    const body = 'b'.repeat(MAX_LOGGED_BODY_CHARS + 10);

    const curl = toCurl(URL_, { method: 'POST', body }, true);

    expect(curl).toContain(`[BODY TRUNCATED: ${body.length} chars total]`);
    // The logged command stays bounded regardless of how large the real body was.
    expect(curl.length).toBeLessThan(MAX_LOGGED_BODY_CHARS + 1000);
  });

  it('emits no data flag for a bodyless request', () => {
    const curl = toCurl(URL_, { method: 'GET' });

    expect(curl).not.toContain('-d ');
    expect(curl).toContain(`'${URL_}'`);
  });
});
