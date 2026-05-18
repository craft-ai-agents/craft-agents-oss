import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import {
  MdpAuthClient,
  MdpAuthHttpError,
  type SsoSession,
} from '../mdp-auth-client.ts';

const originalFetch = globalThis.fetch;

function serverSession(overrides: Record<string, unknown> = {}) {
  return {
    token: 'session-token',
    accessToken: 'access-token',
    idToken: 'id-token',
    expiresIn: 120,
    employeeId: 'E123',
    ystId: 'YST456',
    department: 'Engineering',
    userName: 'Ada Lovelace',
    ...overrides,
  };
}

describe('MdpAuthClient', () => {
  beforeEach(() => {
    Date.now = mock(() => 1_700_000_000_000) as unknown as typeof Date.now;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    mock.restore();
  });

  it('login posts the SSO code and converts expiresIn to expiresAt', async () => {
    const fetchMock = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify(serverSession()), { status: 200 }),
      )
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new MdpAuthClient({ baseUrl: 'https://mdp.example.test' });
    const session = await client.login('sso-code');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://mdp.example.test/api/mdp/auth/sso-login',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: 'sso-code' }),
      },
    );
    expect(session).toEqual<SsoSession>({
      token: 'session-token',
      accessToken: 'access-token',
      idToken: 'id-token',
      expiresAt: 1_700_000_120_000,
      employeeId: 'E123',
      ystId: 'YST456',
      department: 'Engineering',
      userName: 'Ada Lovelace',
    });
    expect('expiresIn' in session).toBe(false);
  });

  it('refresh posts the session token and returns a parsed SSO session', async () => {
    const fetchMock = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify(serverSession({ token: 'new-session-token', expiresIn: 5 })),
          { status: 200 },
        ),
      )
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new MdpAuthClient({ baseUrl: 'https://mdp.example.test/' });
    const session = await client.refresh('old-session-token');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://mdp.example.test/api/mdp/auth/refresh-token',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'old-session-token' }),
      },
    );
    expect(session.token).toBe('new-session-token');
    expect(session.expiresAt).toBe(1_700_000_005_000);
  });

  it('throws a typed error on non-2xx responses', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response('bad code', { status: 401, statusText: 'Unauthorized' }))
    ) as unknown as typeof fetch;

    const client = new MdpAuthClient({ baseUrl: 'https://mdp.example.test' });
    const error = await client.login('bad-code').catch((err) => err);

    expect(error).toBeInstanceOf(MdpAuthHttpError);
    expect(error.status).toBe(401);
    expect(error.statusText).toBe('Unauthorized');
    expect(error.body).toBe('bad code');
    expect(error.endpoint).toBe('/api/mdp/auth/sso-login');
  });
});
