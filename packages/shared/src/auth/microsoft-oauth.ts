/**
 * Microsoft OAuth 2.0 with PKCE for Microsoft Graph sources (Outlook, Calendar,
 * OneDrive, Teams, SharePoint), as a public client: no client secret.
 *
 * The server-owned flow prepares the sign-in (`prepareMicrosoftOAuth`) and exchanges
 * the code (`exchangeMicrosoftOAuth`); `startMicrosoftOAuth` is the self-contained
 * loopback variant used by the CLI/test path.
 *
 * A source signs in with the built-in app registration (MICROSOFT_OAUTH_CLIENT_ID,
 * baked into the build) unless it brings its own: `api.microsoftOAuthClientId`, plus
 * `api.microsoftTenantId` for a single-tenant registration. The default authority,
 * "common", accepts personal Microsoft accounts and work/school accounts.
 */

import { URL } from 'url';
import { randomBytes, createHash } from 'crypto';
import { openUrl } from '../utils/open-url.ts';
import { createCallbackServer, type AppType } from './callback-server.ts';
import { type MicrosoftService } from '../sources/types.ts';
import { type OAuthSessionContext, buildOAuthDeeplinkUrl } from './types.ts';
import type { PreparedOAuthFlow, OAuthExchangeParams, OAuthExchangeResult } from './oauth-flow-types.ts';
import { MICROSOFT_CLIENT_ID_RULE, isValidMicrosoftClientId, microsoftAuthority } from './microsoft-authority.ts';

// Re-export MicrosoftService type for convenient access
export type { MicrosoftService };

// Built-in app registration, baked into the build at compile time. It is a public client
// ("Mobile and desktop applications" platform): PKCE, no client secret.
const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_OAUTH_CLIENT_ID || '';

const MICROSOFT_GRAPH_ME_URL = 'https://graph.microsoft.com/v1.0/me';

// Always show the account picker, never a forced consent screen. The refresh token comes
// from the offline_access scope, and Entra asks for consent by itself whenever new
// permissions are requested. Microsoft says to send prompt=consent only for testing: once
// consent exists "users might always receive a consent error". It made users who may not
// approve apps themselves fail with "Need admin approval" (AADSTS90094) even after their
// admin had approved the app for the organization.
const MICROSOFT_PROMPT = 'select_account';

const NOT_CONFIGURED_MESSAGE =
  "Microsoft OAuth not configured. Set microsoftOAuthClientId in the source's api config " +
  '(your own app registration), or build with the MICROSOFT_OAUTH_CLIENT_ID environment variable.';

/**
 * Predefined scope sets for common Microsoft services
 *
 * Microsoft Graph uses delegated permissions with format:
 * https://graph.microsoft.com/{permission}
 *
 * Common permissions:
 * - User.Read: Sign in and read user profile
 * - Mail.Read/ReadWrite/Send: Email access
 * - Calendars.Read/ReadWrite: Calendar access
 * - Files.Read/ReadWrite: OneDrive access
 * - Chat.Read/ReadWrite: Teams chat access
 * - offline_access: Required for refresh tokens
 */
export const MICROSOFT_SERVICE_SCOPES: Record<MicrosoftService, string[]> = {
  outlook: [
    'https://graph.microsoft.com/Mail.ReadWrite',
    'https://graph.microsoft.com/Mail.Send',
    'https://graph.microsoft.com/User.Read',
    'offline_access',
  ],
  'microsoft-calendar': [
    'https://graph.microsoft.com/Calendars.ReadWrite',
    'https://graph.microsoft.com/User.Read',
    'offline_access',
  ],
  onedrive: [
    'https://graph.microsoft.com/Files.ReadWrite',
    'https://graph.microsoft.com/User.Read',
    'offline_access',
  ],
  teams: [
    'https://graph.microsoft.com/Chat.ReadWrite',
    'https://graph.microsoft.com/ChannelMessage.Send',
    'https://graph.microsoft.com/User.Read',
    'offline_access',
  ],
  sharepoint: [
    'https://graph.microsoft.com/Sites.ReadWrite.All',
    'https://graph.microsoft.com/User.Read',
    'offline_access',
  ],
};

/** Whether `value` names a service with predefined scopes (own keys only, not Object.prototype's). */
export function isMicrosoftService(value: unknown): value is MicrosoftService {
  return typeof value === 'string' && Object.hasOwn(MICROSOFT_SERVICE_SCOPES, value);
}

/** How a Microsoft source chooses its scopes, for the errors that ask for them. */
export const MICROSOFT_SCOPES_RULE = `Set microsoftService (${new Intl.ListFormat('en', { type: 'disjunction' })
  .format(Object.keys(MICROSOFT_SERVICE_SCOPES).map(service => `'${service}'`))}) or microsoftScopes in api config.`;

/**
 * The app registration a Microsoft source signs in with: its own
 * (`api.microsoftOAuthClientId` / `api.microsoftTenantId`) or the built-in one.
 */
export interface MicrosoftClientOptions {
  /** Application (client) ID of the source's own app registration. Default: the built-in app. */
  clientId?: string;
  /** Directory (tenant) ID or domain of that registration. Default: "common". */
  tenantId?: string;
}

/**
 * Options for starting Microsoft OAuth flow
 */
export interface MicrosoftOAuthOptions extends MicrosoftClientOptions {
  /** Microsoft service to authenticate (uses predefined scopes) */
  service?: MicrosoftService;
  /** Custom scopes (overrides service scopes if provided) */
  scopes?: string[];
  /** App type for callback server styling */
  appType?: AppType;
  /** Session context for building deeplink back to chat after OAuth */
  sessionContext?: OAuthSessionContext;
}

/**
 * Result of Microsoft OAuth flow
 */
export interface MicrosoftOAuthResult {
  success: boolean;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  email?: string;
  /** Client ID that issued the tokens (stored with them: refresh must use the same one) */
  clientId?: string;
  error?: string;
}

/** The client ID a source signs in with: its own, else the built-in one ('' when neither is set). */
export function microsoftClientIdFor(clientId?: string): string {
  return clientId?.trim() || MICROSOFT_CLIENT_ID;
}

/**
 * Whether tokens issued to `issuedClientId` belong to the app the source signs in with
 * (`sourceClientId`, its microsoftOAuthClientId). Tokens stored before the client ID was
 * recorded came from the built-in app. When this is false the tokens can neither be used
 * as the source's app nor refreshed with it, so the source needs a new sign-in.
 */
export function microsoftCredentialMatchesSource(issuedClientId: string | undefined, sourceClientId: string | undefined): boolean {
  const issuedBy = issuedClientId?.trim() || MICROSOFT_CLIENT_ID;
  return issuedBy.toLowerCase() === microsoftClientIdFor(sourceClientId).toLowerCase();
}

/**
 * Like microsoftClientIdFor, but throws on a malformed own ID, which Entra would only
 * reject after the browser opens.
 */
function resolveClientId(clientId?: string): string {
  const resolved = microsoftClientIdFor(clientId);
  if (clientId?.trim() && !isValidMicrosoftClientId(resolved)) {
    throw new Error(`Invalid microsoftOAuthClientId '${resolved}'. ${MICROSOFT_CLIENT_ID_RULE}`);
  }
  return resolved;
}

/**
 * Generate PKCE code verifier and challenge
 */
function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/**
 * Generate random state for CSRF protection
 */
function generateState(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Microsoft's reason for a refused token request ("invalid_grant: AADSTS700082: …"),
 * without the trace and correlation IDs it appends. Token error responses carry no
 * tokens, so this is safe to log and to show.
 */
async function describeTokenError(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  try {
    const body = JSON.parse(text) as { error?: unknown; error_description?: unknown };
    const error = typeof body.error === 'string' ? body.error : undefined;
    const description = typeof body.error_description === 'string'
      ? body.error_description.split(/\r?\n| Trace ID:/)[0]!.trim()
      : undefined;
    const reason = [error, description].filter(Boolean).join(': ');
    if (reason) return reason.slice(0, 300);
  } catch {
    // Not JSON: report the status instead.
  }
  return `HTTP ${response.status}`;
}

/**
 * Exchange authorization code for tokens
 */
async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
  redirectUri: string,
  clientId: string,
  tokenUrl: string,
): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number }> {
  const params = new URLSearchParams({
    client_id: clientId,
    code,
    code_verifier: codeVerifier,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${await describeTokenError(response)}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  };
}

/**
 * Get user email from access token using Microsoft Graph API
 */
async function getUserEmail(accessToken: string): Promise<string> {
  const response = await fetch(MICROSOFT_GRAPH_ME_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error('Failed to get user info from Microsoft Graph');
  }

  const data = (await response.json()) as {
    mail?: string;
    userPrincipalName?: string;
  };

  // Microsoft Graph returns 'mail' for work accounts, 'userPrincipalName' as fallback
  // For personal accounts, userPrincipalName is typically the email
  return data.mail || data.userPrincipalName || 'unknown';
}

/**
 * Refresh a Microsoft access token.
 *
 * A refresh token only works with the app registration that issued it, so pass the
 * client ID stored with the credential (undefined = the built-in app) and the source's
 * tenant (a single-tenant registration can't refresh through "common").
 */
export async function refreshMicrosoftToken(
  refreshToken: string,
  client: MicrosoftClientOptions = {},
): Promise<{
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}> {
  const clientId = resolveClientId(client.clientId);
  if (!clientId) {
    throw new Error(NOT_CONFIGURED_MESSAGE);
  }
  const { tokenUrl } = microsoftAuthority(client.tenantId);

  const params = new URLSearchParams({
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!response.ok) {
    throw new Error(`Failed to refresh Microsoft token: ${await describeTokenError(response)}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  return {
    accessToken: data.access_token,
    // Microsoft may return a new refresh token (rotation)
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
  };
}

/**
 * True when a sign-in can start: the source has its own client ID, or the build
 * has the built-in one. No client secret is involved (public client with PKCE).
 */
export function isMicrosoftOAuthConfigured(clientId?: string): boolean {
  return Boolean(microsoftClientIdFor(clientId));
}

/**
 * The scopes a sign-in requests: the custom scopes (plus the ones every sign-in needs),
 * else the service's. Throws for a service without predefined scopes.
 */
export function getMicrosoftScopes(options: Pick<MicrosoftOAuthOptions, 'service' | 'scopes'>): string[] {
  // Custom scopes take precedence
  if (options.scopes && options.scopes.length > 0) {
    // Ensure required scopes are included
    const requiredScopes = ['https://graph.microsoft.com/User.Read', 'offline_access'];
    const allScopes = [...options.scopes];
    for (const scope of requiredScopes) {
      if (!allScopes.includes(scope)) {
        allScopes.push(scope);
      }
    }
    return allScopes;
  }

  // Predefined service scopes. The service comes from config.json, which is not validated
  // on load: an unknown one (e.g. 'calendar') must not sign in for the Outlook mail scopes.
  if (options.service) {
    if (!isMicrosoftService(options.service)) {
      throw new Error(`Unknown microsoftService '${options.service}'. ${MICROSOFT_SCOPES_RULE}`);
    }
    return MICROSOFT_SERVICE_SCOPES[options.service];
  }

  // Neither: Outlook scopes, for backwards compatibility
  return MICROSOFT_SERVICE_SCOPES.outlook;
}

/**
 * Options for preparing a Microsoft OAuth flow (server-side, no browser interaction)
 */
export interface PrepareMicrosoftOAuthOptions extends MicrosoftClientOptions {
  service?: MicrosoftService;
  scopes?: string[];
  /** Port for the local callback server (Electron). One of callbackPort or callbackUrl required. */
  callbackPort?: number;
  /** Full callback URL (WebUI). Takes precedence over callbackPort. */
  callbackUrl?: string;
}

/**
 * Prepare a Microsoft OAuth flow without starting a callback server or opening a browser.
 * Returns everything needed to construct the auth URL and later exchange the code; the
 * flow carries the client ID and the tenant's token endpoint to the exchange.
 */
export function prepareMicrosoftOAuth(options: PrepareMicrosoftOAuthOptions): PreparedOAuthFlow {
  const clientId = resolveClientId(options.clientId);
  if (!clientId) {
    throw new Error(NOT_CONFIGURED_MESSAGE);
  }
  const authority = microsoftAuthority(options.tenantId);

  const scopes = getMicrosoftScopes(options);
  const pkce = generatePKCE();
  const state = generateState();
  const redirectUri = options.callbackUrl
    ?? `http://localhost:${options.callbackPort}/callback`;

  const authUrl = new URL(authority.authorizeUrl);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', scopes.join(' '));
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', pkce.challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('response_mode', 'query');
  authUrl.searchParams.set('prompt', MICROSOFT_PROMPT);

  return {
    authUrl: authUrl.toString(),
    state,
    codeVerifier: pkce.verifier,
    tokenEndpoint: authority.tokenUrl,
    clientId,
    redirectUri,
    provider: 'microsoft',
  };
}

/**
 * Exchange a Microsoft authorization code for tokens (server-side).
 * Also fetches the user's email/UPN via Microsoft Graph.
 */
export async function exchangeMicrosoftOAuth(params: OAuthExchangeParams): Promise<OAuthExchangeResult> {
  try {
    // The prepared flow carries the app registration and the tenant's token endpoint.
    const clientId = params.clientId || MICROSOFT_CLIENT_ID;
    const tokenUrl = params.tokenEndpoint || microsoftAuthority().tokenUrl;
    const tokens = await exchangeCodeForTokens(params.code, params.codeVerifier, params.redirectUri, clientId, tokenUrl);

    const email = await getUserEmail(tokens.accessToken);

    return {
      success: true,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresIn ? Date.now() + tokens.expiresIn * 1000 : undefined,
      email,
      // Stored with the tokens: a refresh has to use the client that issued them.
      oauthClientId: clientId,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Microsoft OAuth exchange failed',
    };
  }
}

/**
 * Start Microsoft OAuth flow
 *
 * Opens browser for Microsoft consent, handles callback, and returns tokens + email.
 * Supports multiple Microsoft services via the service option, or custom scopes.
 *
 * @example
 * // Authenticate for Outlook
 * const result = await startMicrosoftOAuth({ service: 'outlook' });
 *
 * @example
 * // Authenticate for OneDrive
 * const result = await startMicrosoftOAuth({ service: 'onedrive' });
 *
 * @example
 * // Authenticate with custom scopes
 * const result = await startMicrosoftOAuth({
 *   scopes: ['https://graph.microsoft.com/Tasks.ReadWrite']
 * });
 */
export async function startMicrosoftOAuth(
  options: MicrosoftOAuthOptions = {}
): Promise<MicrosoftOAuthResult> {
  try {
    const clientId = resolveClientId(options.clientId);
    if (!clientId) {
      return { success: false, error: NOT_CONFIGURED_MESSAGE };
    }
    const authority = microsoftAuthority(options.tenantId);

    // Get scopes for this request
    const scopes = getMicrosoftScopes(options);

    // Generate PKCE and state
    const pkce = generatePKCE();
    const state = generateState();

    // Start callback server with deeplink for returning to chat session
    const appType = options.appType || 'electron';
    const deeplinkUrl = buildOAuthDeeplinkUrl(options.sessionContext);
    const callbackServer = await createCallbackServer({ appType, deeplinkUrl });
    const redirectUri = `${callbackServer.url}/callback`;

    // Build authorization URL
    const authUrl = new URL(authority.authorizeUrl);
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', scopes.join(' '));
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', pkce.challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    // Response mode 'query' returns code in URL query params (default for authorization_code)
    authUrl.searchParams.set('response_mode', 'query');
    authUrl.searchParams.set('prompt', MICROSOFT_PROMPT);

    // Open browser for authorization
    await openUrl(authUrl.toString());

    // Wait for callback
    const callback = await callbackServer.promise;

    // Verify state
    if (callback.query.state !== state) {
      return {
        success: false,
        error: 'OAuth state mismatch - possible CSRF attack',
      };
    }

    // Check for error
    if (callback.query.error) {
      return {
        success: false,
        error: callback.query.error_description || callback.query.error,
      };
    }

    // Get authorization code
    const code = callback.query.code;
    if (!code) {
      return {
        success: false,
        error: 'No authorization code received',
      };
    }

    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code, pkce.verifier, redirectUri, clientId, authority.tokenUrl);

    // Get user email
    const email = await getUserEmail(tokens.accessToken);

    return {
      success: true,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresIn ? Date.now() + tokens.expiresIn * 1000 : undefined,
      email,
      clientId,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during Microsoft OAuth',
    };
  }
}
