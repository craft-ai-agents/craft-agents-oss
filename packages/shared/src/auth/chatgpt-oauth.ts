/**
 * Native ChatGPT OAuth with PKCE
 *
 * Implements browser-based OAuth using PKCE (Proof Key for Code Exchange)
 * for authenticating with ChatGPT Plus accounts via Codex app-server.
 *
 * This enables the `chatgptAuthTokens` mode where G4 OS owns the
 * OAuth flow and injects tokens into Codex, providing a better UX than
 * the default Codex-managed `chatgpt` mode.
 *
 * Key differences from Claude OAuth:
 * - Uses a localhost callback server (Codex style)
 * - Returns both idToken and accessToken (OpenAI uses OIDC)
 * - Tokens are injected into Codex via `account/login/start`
 */
import { randomBytes, createHash } from 'node:crypto';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { CHATGPT_OAUTH_CONFIG } from './chatgpt-oauth-config.ts';
import { openUrl } from '../utils/open-url.ts';
import { generateCallbackPage } from './callback-page.ts';

// OAuth configuration from shared config
const CLIENT_ID = CHATGPT_OAUTH_CONFIG.CLIENT_ID;
const AUTH_URL = CHATGPT_OAUTH_CONFIG.AUTH_URL;
const TOKEN_URL = CHATGPT_OAUTH_CONFIG.TOKEN_URL;
const REDIRECT_URI = CHATGPT_OAUTH_CONFIG.REDIRECT_URI;
const CALLBACK_PORT = CHATGPT_OAUTH_CONFIG.CALLBACK_PORT;
const OAUTH_SCOPES = CHATGPT_OAUTH_CONFIG.SCOPES;
const STATE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

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

export interface ChatGptOAuthState {
  state: string;
  codeVerifier: string;
  timestamp: number;
  expiresAt: number;
}

// In-memory state storage for the current OAuth flow
let currentOAuthState: ChatGptOAuthState | null = null;

// Callback server instance
let callbackServer: Server | null = null;

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

/**
 * Start the OAuth callback server to receive the authorization code
 */
function startCallbackServer(
  expectedState: string,
  onCode: (code: string) => void,
  onError: (error: Error) => void
): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url || '/', `http://localhost:${CALLBACK_PORT}`);

      if (url.pathname === '/auth/callback') {
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const error = url.searchParams.get('error');
        const errorDescription = url.searchParams.get('error_description');

        // Send response to browser
        res.writeHead(200, { 'Content-Type': 'text/html' });

        if (error) {
          res.end(generateCallbackPage({
            title: 'ChatGPT',
            isSuccess: false,
            errorDetail: errorDescription || error,
          }));
          onError(new Error(errorDescription || error));
          return;
        }

        if (!code || !state) {
          res.end(generateCallbackPage({
            title: 'ChatGPT',
            isSuccess: false,
            errorDetail: 'Missing authorization code or state parameter',
          }));
          onError(new Error('Missing authorization code or state'));
          return;
        }

        if (state !== expectedState) {
          res.end(generateCallbackPage({
            title: 'ChatGPT',
            isSuccess: false,
            errorDetail: 'Invalid state parameter. This may be a security issue.',
          }));
          onError(new Error('Invalid state parameter - possible CSRF attack'));
          return;
        }

        res.end(generateCallbackPage({
          title: 'ChatGPT',
          isSuccess: true,
        }));

        onCode(code);
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${CALLBACK_PORT} is already in use. Close any other OAuth flows and try again.`));
      } else {
        reject(err);
      }
    });

    server.listen(CALLBACK_PORT, '127.0.0.1', () => {
      resolve(server);
    });
  });
}

/**
 * Stop the callback server if running
 */
export function stopCallbackServer(): void {
  if (callbackServer) {
    callbackServer.close();
    callbackServer = null;
  }
}

/**
 * Start the OAuth flow
 *
 * Opens the browser for authentication and starts a local callback server.
 * Returns a promise that resolves with the authorization code when the user
 * completes authentication.
 *
 * @param onStatus - Optional callback for status messages
 * @returns Promise that resolves with the authorization code
 */
export async function startChatGptOAuth(
  onStatus?: (message: string) => void
): Promise<string> {
  onStatus?.('Generating authentication URL...');

  // Clean up any previous server
  stopCallbackServer();

  // Generate secure random values
  const state = generateState();
  const { codeVerifier, codeChallenge } = generatePKCE();

  // Store state for later verification
  const now = Date.now();
  currentOAuthState = {
    state,
    codeVerifier,
    timestamp: now,
    expiresAt: now + STATE_EXPIRY_MS,
  };

  // Start callback server
  onStatus?.('Starting authentication server...');

  return new Promise<string>(async (resolve, reject) => {
    try {
      callbackServer = await startCallbackServer(
        state,
        (code) => {
          stopCallbackServer();
          resolve(code);
        },
        (error) => {
          stopCallbackServer();
          clearOAuthState();
          reject(error);
        }
      );

      // Build OAuth URL with Codex CLI compatibility params
      const params = new URLSearchParams({
        client_id: CLIENT_ID,
        response_type: 'code',
        redirect_uri: REDIRECT_URI,
        scope: OAUTH_SCOPES,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state,
        // Codex CLI compatibility parameters (required for the flow to work)
        codex_cli_simplified_flow: 'true',
        id_token_add_organizations: 'true',
      });

      const authUrl = `${AUTH_URL}?${params.toString()}`;

      // Open browser
      onStatus?.('Opening browser for authentication...');
      await openUrl(authUrl);

      onStatus?.('Waiting for authentication...');
    } catch (error) {
      stopCallbackServer();
      clearOAuthState();
      reject(error);
    }
  });
}

/**
 * Check if there is a valid ChatGPT OAuth state in progress
 */
export function hasValidChatGptOAuthState(): boolean {
  if (!currentOAuthState) return false;
  return Date.now() < currentOAuthState.expiresAt;
}

/**
 * Get the current ChatGPT OAuth state (for debugging/display)
 */
export function getCurrentChatGptOAuthState(): ChatGptOAuthState | null {
  return currentOAuthState;
}

/**
 * Clear the current ChatGPT OAuth state (internal use)
 */
function clearOAuthState(): void {
  currentOAuthState = null;
}

/**
 * Exchange an authorization code for tokens
 *
 * @param authorizationCode - The code received from the OAuth callback
 * @param onStatus - Optional callback for status messages
 * @returns ChatGptTokens with idToken, accessToken, and optionally refreshToken
 */
export async function exchangeChatGptCode(
  authorizationCode: string,
  onStatus?: (message: string) => void
): Promise<ChatGptTokens> {
  // Verify we have valid state
  if (!currentOAuthState) {
    throw new Error('No OAuth state found. Please start the authentication flow again.');
  }

  if (Date.now() > currentOAuthState.expiresAt) {
    clearOAuthState();
    throw new Error('OAuth state expired (older than 10 minutes). Please try again.');
  }

  onStatus?.('Exchanging authorization code for tokens...');

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    code: authorizationCode,
    redirect_uri: REDIRECT_URI,
    code_verifier: currentOAuthState.codeVerifier,
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
      throw new Error(`Token exchange failed: ${response.status} - ${errorMessage}`);
    }

    const data = (await response.json()) as {
      id_token: string;
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      token_type?: string;
    };

    // Clear state after successful exchange
    clearOAuthState();

    onStatus?.('Authentication successful!');

    return {
      idToken: data.id_token,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
    };
  } catch (error) {
    clearOAuthState();
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Token exchange failed: ${String(error)}`);
  }
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
 * Cancel the current OAuth flow
 */
export function cancelChatGptOAuth(): void {
  stopCallbackServer();
  clearOAuthState();
}
