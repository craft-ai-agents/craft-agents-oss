import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { createProviderMaterialization } from '../materialization.ts';
import { applyTrustedHttpHeader, redactHeaders } from '../http-header-delivery.ts';

const SECRET = 'super-secret';

function materializationWith(value: string) {
  return createProviderMaterialization('cred_test', 'bearer_token', { value });
}

describe('CF-4 trusted-http-header delivery', () => {
  const spies: Array<ReturnType<typeof spyOn>> = [];

  afterEach(() => {
    for (const spy of spies.splice(0)) spy.mockRestore();
  });

  it('injects Authorization Bearer for fetch and redacts the secret in views', async () => {
    const log = spyOn(console, 'log').mockImplementation(() => {});
    const info = spyOn(console, 'info').mockImplementation(() => {});
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    const error = spyOn(console, 'error').mockImplementation(() => {});
    const debug = spyOn(console, 'debug').mockImplementation(() => {});
    spies.push(log, info, warn, error, debug);

    const original = { Accept: 'application/vnd.github+json', authorization: 'Bearer stale' };
    const materialization = materializationWith(SECRET);
    const headers = applyTrustedHttpHeader(original, materialization);

    expect(headers.Authorization).toBe(`Bearer ${SECRET}`);
    expect(headers.Accept).toBe('application/vnd.github+json');
    expect(headers.authorization).toBeUndefined();
    expect(original.authorization).toBe('Bearer stale');
    expect(JSON.stringify(materialization)).not.toContain(SECRET);

    let seenAuth: string | undefined;
    const fetchImpl = async (_url: string, init?: { headers?: Record<string, string> }) => {
      seenAuth = init?.headers?.Authorization;
      return new Response(JSON.stringify({ login: 'octocat' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    await fetchImpl('https://api.github.com/user', { headers });
    expect(seenAuth).toBe(`Bearer ${SECRET}`);

    const redacted = redactHeaders(headers);
    expect(redacted.Authorization).toBe('Bearer ***');
    expect(redacted.Accept).toBe('application/vnd.github+json');
    expect(JSON.stringify(redacted)).not.toContain(SECRET);
    expect(JSON.stringify(redacted)).toContain('Bearer ***');
    expect(headers.Authorization).toBe(`Bearer ${SECRET}`);

    const logged = [log, info, warn, error, debug].flatMap((spy) => spy.mock.calls.flat());
    expect(JSON.stringify(logged)).not.toContain(SECRET);
  });

  it('fails closed without leaking when the materialization has no token', () => {
    const empty = materializationWith('');
    expect(() => applyTrustedHttpHeader({}, empty)).toThrow('missing_token');
    try {
      applyTrustedHttpHeader({}, empty);
    } catch (error) {
      expect(JSON.stringify(error instanceof Error ? error.message : error)).not.toContain(SECRET);
    }
  });
});
