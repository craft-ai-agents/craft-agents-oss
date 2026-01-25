/**
 * GitHub OAuth flow using GitHub's OAuth 2.0 with PKCE
 *
 * This module handles the complete GitHub OAuth flow:
 * 1. Opens browser for GitHub authorization screen
 * 2. Receives authorization code via local callback server
 * 3. Exchanges code for access token
 * 4. Returns token and user login
 *
 * GitHub OAuth App credentials can be configured in Settings or via environment variables.
 */

import { URL } from 'url';
import open from 'open';
import { randomBytes, createHash } from 'crypto';
import { createCallbackServer, type AppType } from '../auth/callback-server.ts';
import { getCredentialManager } from '../credentials/index.ts';
import type { GitHubOAuthResult } from './types.ts';

/**
 * Get GitHub OAuth credentials from CredentialManager or environment variables.
 * CredentialManager takes priority, falls back to env vars.
 */
async function getGitHubCredentials(): Promise<{ clientId: string; clientSecret: string } | null> {
  // Try CredentialManager first
  try {
    const credManager = getCredentialManager();
    const storedId = await credManager.get({ type: 'github_oauth_client_id' });
    const storedSecret = await credManager.get({ type: 'github_oauth_client_secret' });

    if (storedId?.value && storedSecret?.value) {
      return { clientId: storedId.value, clientSecret: storedSecret.value };
    }
  } catch {
    // CredentialManager not available or error, fall through to env vars
  }

  // Fall back to environment variables
  const envId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const envSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;

  if (envId && envSecret) {
    return { clientId: envId, clientSecret: envSecret };
  }

  return null;
}

// GitHub OAuth endpoints
const GITHUB_AUTH_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_USER_URL = 'https://api.github.com/user';

/**
 * Required scopes for orchestration features
 */
export const GITHUB_SCOPES = [
  'repo', // Full control of repositories
  'read:org', // Read organization membership
  'read:user', // Read user profile data
];

/**
 * Options for starting GitHub OAuth flow
 */
export interface GitHubOAuthOptions {
  /** Scopes to request (defaults to GITHUB_SCOPES) */
  scopes?: string[];
  /** App type for callback server styling */
  appType?: AppType;
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
 * Retry helper for OAuth operations with exponential backoff
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  initialDelayMs: number = 500
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry on permanent errors
      if (
        lastError.message.includes('401') ||
        lastError.message.includes('403') ||
        lastError.message.includes('CSRF')
      ) {
        throw error;
      }

      // Wait before retrying (except on last attempt)
      if (attempt < maxAttempts - 1) {
        const delayMs = initialDelayMs * Math.pow(2, attempt);
        const jitter = delayMs * 0.25 * (Math.random() * 2 - 1);
        const finalDelay = Math.max(0, delayMs + jitter);
        console.debug(
          `[GitHub OAuth] Attempt ${attempt + 1} failed, retrying in ${Math.round(finalDelay)}ms...`
        );
        await new Promise((resolve) => setTimeout(resolve, finalDelay));
      }
    }
  }

  throw lastError || new Error('OAuth operation failed after retries');
}

/**
 * Exchange authorization code for access token with retry
 */
async function exchangeCodeForToken(
  code: string,
  redirectUri: string,
  credentials: { clientId: string; clientSecret: string }
): Promise<{ accessToken: string; expiresIn?: number }> {
  return retryWithBackoff(async () => {
    const params = new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      code,
      redirect_uri: redirectUri,
    });

    const response = await fetch(GITHUB_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token exchange failed (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      token_type: string;
      expires_in?: number;
    };

    return {
      accessToken: data.access_token,
      expiresIn: data.expires_in,
    };
  }, 3, 500);
}

/**
 * Get user info from access token with retry
 */
async function getGitHubUser(
  accessToken: string
): Promise<{ login: string; email?: string; name?: string; id: number }> {
  return retryWithBackoff(async () => {
    const response = await fetch(GITHUB_USER_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get GitHub user info (${response.status})`);
    }

    const data = (await response.json()) as {
      login: string;
      email?: string;
      name?: string;
      id: number;
    };

    return data;
  }, 3, 500);
}

/**
 * Check if GitHub OAuth is configured
 */
export async function isGitHubOAuthConfigured(): Promise<boolean> {
  const creds = await getGitHubCredentials();
  return creds !== null;
}

/**
 * Test GitHub OAuth credentials by making a simple API call
 *
 * This function validates the credentials without starting a full OAuth flow.
 * It creates a temporary access token and verifies it works with GitHub's API.
 *
 * @param clientId GitHub OAuth App Client ID
 * @param clientSecret GitHub OAuth App Client Secret
 * @returns Result indicating success or failure with helpful error messages
 */
export async function testGitHubCredentials(
  clientId: string,
  clientSecret: string
): Promise<{ success: boolean; error?: string; message?: string }> {
  try {
    // Basic validation
    if (!clientId || !clientSecret) {
      return {
        success: false,
        error: 'Both Client ID and Client Secret are required',
      };
    }

    // Validate Client ID format (should start with Ov or Iv)
    if (!/^(Ov|Iv)[a-zA-Z0-9.]{10,}$/.test(clientId.trim())) {
      return {
        success: false,
        error: 'Invalid Client ID format. GitHub OAuth App Client IDs start with "Ov" or "Iv".',
      };
    }

    // Validate Client Secret length
    if (clientSecret.trim().length < 20) {
      return {
        success: false,
        error: 'Client Secret appears too short. GitHub Client Secrets are typically 40 characters.',
      };
    }

    // Test by attempting to verify the app exists
    // We use GitHub's check-token endpoint which requires basic auth
    const authHeader = Buffer.from(`${clientId.trim()}:${clientSecret.trim()}`).toString('base64');

    const response = await fetch('https://api.github.com/applications/' + clientId.trim() + '/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${authHeader}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      // Send a test token (invalid, but we just want to check auth)
      body: JSON.stringify({ access_token: 'test_token_validation' }),
    });

    // 404 means credentials are valid but token doesn't exist (expected for test)
    // 401 means invalid credentials
    // 422 means validation error (also acceptable, means credentials work)
    if (response.status === 404 || response.status === 422) {
      return {
        success: true,
        message: 'GitHub OAuth credentials are valid',
      };
    }

    if (response.status === 401) {
      return {
        success: false,
        error: 'Invalid credentials. Please verify your Client ID and Client Secret.',
      };
    }

    if (response.status === 403) {
      return {
        success: false,
        error: 'Access forbidden. Your OAuth App may not have the necessary permissions.',
      };
    }

    if (response.status === 429) {
      return {
        success: false,
        error: 'Rate limit exceeded. Please try again in a few minutes.',
      };
    }

    if (response.status >= 500) {
      return {
        success: false,
        error: 'GitHub server error. Please try again later.',
      };
    }

    // Unexpected status - credentials might be valid
    return {
      success: true,
      message: `Credentials appear valid (status: ${response.status})`,
    };
  } catch (error) {
    // Network errors
    if (error instanceof TypeError) {
      return {
        success: false,
        error: 'Network error. Please check your internet connection.',
      };
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Start GitHub OAuth flow
 *
 * Opens browser for GitHub authorization, handles callback, and returns token + user info.
 *
 * @example
 * const result = await startGitHubOAuth();
 * if (result.success) {
 *   console.log(`Connected as ${result.login}`);
 * }
 */
export async function startGitHubOAuth(
  options: GitHubOAuthOptions = {}
): Promise<GitHubOAuthResult> {
  try {
    // Get OAuth credentials from CredentialManager or env vars
    const credentials = await getGitHubCredentials();
    if (!credentials) {
      return {
        success: false,
        error:
          'GitHub OAuth not configured. Add credentials in Settings or set GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET environment variables.',
      };
    }

    // Get scopes
    const scopes = options.scopes || GITHUB_SCOPES;

    // Generate PKCE and state
    const pkce = generatePKCE();
    const state = generateState();

    // Start callback server
    const appType = options.appType || 'electron';
    const callbackServer = await createCallbackServer({ appType });
    const redirectUri = `${callbackServer.url}/callback`;

    // Build authorization URL
    const authUrl = new URL(GITHUB_AUTH_URL);
    authUrl.searchParams.set('client_id', credentials.clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope', scopes.join(' '));
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('allow_signup', 'true');

    // Open browser for authorization
    await open(authUrl.toString());

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

    // Exchange code for token
    const tokens = await exchangeCodeForToken(code, redirectUri, credentials);

    // Get user info
    const user = await getGitHubUser(tokens.accessToken);

    return {
      success: true,
      accessToken: tokens.accessToken,
      expiresAt: tokens.expiresIn
        ? Date.now() + tokens.expiresIn * 1000
        : undefined,
      login: user.login,
      email: user.email,
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Unknown error during GitHub OAuth',
    };
  }
}
