/** Parsed SSO session returned by the MDP auth endpoints. */
export interface SsoSession {
  /** Long-lived session token used as the MDP API bearer token. */
  token: string;
  /** OAuth access token returned by MDP and stored for future use. */
  accessToken: string;
  /** Short-lived identity token returned by MDP. */
  idToken: string;
  /** Absolute expiration timestamp in milliseconds. */
  expiresAt: number;
  /** Employee identifier from the MDP identity response. */
  employeeId: string;
  /** YST identifier from the MDP identity response. */
  ystId: string;
  /** Employee department from the MDP identity response. */
  department: string;
  /** Display name from the MDP identity response. */
  userName: string;
}

interface RawSsoSession {
  token: string;
  accessToken: string;
  idToken: string;
  expiresIn: number;
  employeeId: string;
  ystId: string;
  department: string;
  userName: string;
}

/** Error thrown when an MDP auth endpoint returns a non-2xx response. */
export class MdpAuthHttpError extends Error {
  readonly name = 'MdpAuthHttpError';

  constructor(
    readonly status: number,
    readonly statusText: string,
    readonly endpoint: string,
    readonly body: string,
  ) {
    super(`MDP auth request failed with HTTP ${status}${statusText ? ` ${statusText}` : ''}`);
  }
}

/** Dependencies and endpoint configuration for the MDP auth client. */
export interface MdpAuthClientOptions {
  /** Base MDP API URL. Defaults to MDP_API_URL. */
  baseUrl?: string;
  /** Fetch implementation for HTTP requests. */
  fetchFn?: typeof fetch;
}

const SSO_LOGIN_ENDPOINT = '/api/mdp/auth/sso-login';
const REFRESH_TOKEN_ENDPOINT = '/api/mdp/auth/refresh-token';

/** Client for the MDP SSO login and refresh-token endpoints. */
export class MdpAuthClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: MdpAuthClientOptions = {}) {
    this.baseUrl = stripTrailingSlash(options.baseUrl ?? process.env.MDP_API_URL ?? '');
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
  }

  /** Exchange an SSO authorization code for an MDP SSO session. */
  login(code: string): Promise<SsoSession> {
    return this.post(SSO_LOGIN_ENDPOINT, { code });
  }

  /** Refresh an existing MDP SSO session token. */
  refresh(token: string): Promise<SsoSession> {
    return this.post(REFRESH_TOKEN_ENDPOINT, { token });
  }

  private async post(endpoint: string, body: Record<string, string>): Promise<SsoSession> {
    const response = await this.fetchFn(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new MdpAuthHttpError(
        response.status,
        response.statusText,
        endpoint,
        await response.text(),
      );
    }

    return parseSsoSession(await response.json());
  }
}

function parseSsoSession(raw: unknown): SsoSession {
  if (!isRawSsoSession(raw)) {
    throw new Error('Invalid MDP SSO session response');
  }

  return {
    token: raw.token,
    accessToken: raw.accessToken,
    idToken: raw.idToken,
    expiresAt: Date.now() + raw.expiresIn * 1000,
    employeeId: raw.employeeId,
    ystId: raw.ystId,
    department: raw.department,
    userName: raw.userName,
  };
}

function isRawSsoSession(value: unknown): value is RawSsoSession {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.token === 'string' &&
    typeof candidate.accessToken === 'string' &&
    typeof candidate.idToken === 'string' &&
    typeof candidate.expiresIn === 'number' &&
    Number.isFinite(candidate.expiresIn) &&
    typeof candidate.employeeId === 'string' &&
    typeof candidate.ystId === 'string' &&
    typeof candidate.department === 'string' &&
    typeof candidate.userName === 'string'
  );
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}
