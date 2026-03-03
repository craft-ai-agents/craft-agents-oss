/**
 * ChatGPT OAuth with PKCE
 *
 * Implements PKCE-based OAuth for authenticating with ChatGPT Plus accounts
 * via the Codex app-server OAuth endpoint.
 *
 * Architecture: server-owned flow.
 *   - prepareChatGptOAuth() — server generates PKCE + auth URL
 *   - Client opens browser + runs callback server (port 1455)
 *   - exchangeChatGptTokens() — server exchanges code for tokens
 *   - refreshChatGptTokens() — server refreshes expired tokens
 *   - exchangeIdTokenForApiKey() — converts idToken to OpenAI API key
 */
import { randomBytes, createHash } from 'node:crypto';
import { CHATGPT_OAUTH_CONFIG } from './chatgpt-oauth-config.ts';

// OAuth configuration from shared config
const CLIENT_ID = CHATGPT_OAUTH_CONFIG.CLIENT_ID;
const AUTH_URL = CHATGPT_OAUTH_CONFIG.AUTH_URL;
const TOKEN_URL = CHATGPT_OAUTH_CONFIG.TOKEN_URL;
const REDIRECT_URI = CHATGPT_OAUTH_CONFIG.REDIRECT_URI;
const OAUTH_SCOPES = CHATGPT_OAUTH_CONFIG.SCOPES;

export interface ChatGptTokens {
  /** JWT id_token containing user identity claims */
  idToken: string;
  /** Access token for API calls */
  accessToken: string;
  /** Refresh token for getting new tokens */
  refreshToken?: string;
  /** Token expiration timestamp (Unix ms) */
  expiresAt?: number;
}

/**
 * Generate a secure random state parameter
 */
function generateState(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Generate PKCE code verifier and challenge
 */
function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
  // Use URL-safe base64 encoding for PKCE (43-128 characters)
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
  return { codeVerifier, codeChallenge };
}

// ---------------------------------------------------------------------------
// Prepare / Exchange (server-owned flow)
// ---------------------------------------------------------------------------

export interface ChatGptPreparedFlow {
  authUrl: string;
  state: string;
  codeVerifier: string;
}

/**
 * Prepare a ChatGPT OAuth flow without side effects.
 * Returns PKCE parameters and auth URL — no callback server, no browser open.
 * Used by the server-owned flow where the client handles browser + callback.
 */
export function prepareChatGptOAuth(): ChatGptPreparedFlow {
  const state = generateState();
  const { codeVerifier, codeChallenge } = generatePKCE();

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: OAUTH_SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    codex_cli_simplified_flow: 'true',
    id_token_add_organizations: 'true',
  });

  return {
    authUrl: `${AUTH_URL}?${params.toString()}`,
    state,
    codeVerifier,
  };
}

/**
 * Exchange an authorization code for ChatGPT tokens (stateless).
 * Accepts the codeVerifier directly — does not rely on module-level state.
 */
export async function exchangeChatGptTokens(
  code: string,
  codeVerifier: string,
): Promise<ChatGptTokens> {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: codeVerifier,
  });

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage: string;
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = errorJson.error_description || errorJson.error || errorText;
    } catch {
      errorMessage = errorText;
    }
    throw new Error(`Token exchange failed: ${response.status} - ${errorMessage}`);
  }

  const data = (await response.json()) as {
    id_token: string;
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  return {
    idToken: data.id_token,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
  };
}

/**
 * Refresh ChatGPT tokens using a refresh token
 *
 * @param refreshToken - The refresh token from a previous authentication
 * @param onStatus - Optional callback for status messages
 * @returns New ChatGptTokens
 */
export async function refreshChatGptTokens(
  refreshToken: string,
  onStatus?: (message: string) => void
): Promise<ChatGptTokens> {
  onStatus?.('Refreshing tokens...');

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    refresh_token: refreshToken,
  });

  try {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage: string;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error_description || errorJson.error || errorText;
      } catch {
        errorMessage = errorText;
      }
      throw new Error(`Token refresh failed: ${response.status} - ${errorMessage}`);
    }

    const data = (await response.json()) as {
      id_token: string;
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    onStatus?.('Tokens refreshed successfully!');

    return {
      idToken: data.id_token,
      accessToken: data.access_token,
      // Use new refresh token if provided, otherwise keep the old one
      refreshToken: data.refresh_token || refreshToken,
      expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
    };
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Token refresh failed: ${String(error)}`);
  }
}

/**
 * Exchange an idToken for an OpenAI API key using the token-exchange grant.
 *
 * This implements RFC 8693 Token Exchange to convert a ChatGPT OAuth idToken
 * into a first-class OpenAI API key that can be used with the standard OpenAI SDK.
 *
 * @param idToken - The JWT id_token from ChatGPT OAuth
 * @returns An OpenAI API key string
 */
export async function exchangeIdTokenForApiKey(idToken: string): Promise<string> {
  const params = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    client_id: CLIENT_ID,
    subject_token: idToken,
    subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
    requested_token: 'openai-api-key',
  });

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage: string;
    try {
      const errorJson = JSON.parse(errorText);
      // Handle both string and object error formats
      const errorDesc = errorJson.error_description;
      const errorCode = typeof errorJson.error === 'string' ? errorJson.error : JSON.stringify(errorJson.error);
      errorMessage = errorDesc || errorCode || errorText;
    } catch {
      errorMessage = errorText;
    }
    throw new Error(`Token exchange failed: ${response.status} - ${errorMessage}`);
  }

  const data = (await response.json()) as {
    access_token?: string;
    token_type?: string;
  };

  if (!data.access_token) {
    throw new Error('Token exchange succeeded but no access_token returned');
  }

  return data.access_token;
}
