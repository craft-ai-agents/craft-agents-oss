import { describe, expect, it, mock } from 'bun:test';
import {
  MdpAuthClient,
  MdpAuthHttpError,
  type SsoSession,
} from '../mdp-auth-client.ts';

const fixedNow = () => 1_700_000_000_000;

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
  it('login posts the SSO code with a loginId and converts expiresIn to expiresAt', async () => {
    const fetchMock = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify(serverSession()), { status: 200 }),
      )
    );

    const client = new MdpAuthClient({
      baseUrl: 'https://mdp.example.test',
      fetchFn: fetchMock as unknown as typeof fetch,
      now: fixedNow,
      generateLoginId: () => 'fixed-login-id',
    });
    const session = await client.login('sso-code');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://mdp.example.test/api/mdp/auth/sso-login',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: 'sso-code', loginId: 'fixed-login-id' }),
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

  it('generates a unique UUID loginId for each login call', async () => {
    const bodies: string[] = [];
    const fetchMock = mock((_url: string, init: RequestInit) => {
      bodies.push(init.body as string);
      return Promise.resolve(new Response(JSON.stringify(serverSession()), { status: 200 }));
    });
    const client = new MdpAuthClient({
      baseUrl: 'https://mdp.example.test',
      fetchFn: fetchMock as unknown as typeof fetch,
      now: fixedNow,
    });

    await client.login('code-1');
    await client.login('code-2');

    const id1 = (JSON.parse(bodies[0]!) as { loginId: string }).loginId;
    const id2 = (JSON.parse(bodies[1]!) as { loginId: string }).loginId;
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(id1).toMatch(uuidPattern);
    expect(id2).toMatch(uuidPattern);
    expect(id1).not.toBe(id2);
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
    const client = new MdpAuthClient({
      baseUrl: 'https://mdp.example.test/',
      fetchFn: fetchMock as unknown as typeof fetch,
      now: fixedNow,
    });
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
    const fetchMock = mock(() =>
      Promise.resolve(new Response('bad code', { status: 401, statusText: 'Unauthorized' }))
    );

    const client = new MdpAuthClient({
      baseUrl: 'https://mdp.example.test',
      fetchFn: fetchMock as unknown as typeof fetch,
      now: fixedNow,
    });
    const error = await client.login('bad-code').catch((err) => err);

    expect(error).toBeInstanceOf(MdpAuthHttpError);
    expect(error.status).toBe(401);
    expect(error.statusText).toBe('Unauthorized');
    expect(error.body).toBe('bad code');
    expect(error.endpoint).toBe('/api/mdp/auth/sso-login');
  });
});
