/**
 * Google OAuth flow using Google's OAuth 2.0 with PKCE
 *
 * This module handles the complete Google OAuth flow for any Google API:
 * 1. Opens browser for Google consent screen
 * 2. Receives authorization code via local callback server
 * 3. Exchanges code for access and refresh tokens
 * 4. Returns tokens and user email
 *
 * Supports multiple Google services (Gmail, Calendar, Drive) with predefined
 * scope sets, or custom scopes for other Google APIs.
 */

import { URL } from 'url';
import open from 'open';
import { randomBytes, createHash } from 'crypto';
import { createCallbackServer, type AppType } from './callback-server.ts';
import { type GoogleService } from '../sources/types.ts';

// Re-export GoogleService type for convenient access
export type { GoogleService };

// Google OAuth configuration - must be set via environment variables
// These are baked into the build at compile time
// Used for all Google services (Gmail, Calendar, Drive, etc.)
// Note: Google requires client_secret for Desktop apps despite PKCE support
const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || '';

// Google OAuth endpoints
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

/**
 * Predefined scope sets for common Google services
 */
export const GOOGLE_SERVICE_SCOPES: Record<GoogleService, string[]> = {
  gmail: [
    'https://www.googleapis.com/auth/gmail.modify', // Read, trash, labels, mark read/unread
    'https://www.googleapis.com/auth/gmail.compose', // Create and send drafts
    'https://www.googleapis.com/auth/userinfo.email',
  ],
  calendar: [
    'https://www.googleapis.com/auth/calendar', // Full calendar access
    'https://www.googleapis.com/auth/userinfo.email',
  ],
  drive: [
    'https://www.googleapis.com/auth/drive', // Full Drive access
    'https://www.googleapis.com/auth/userinfo.email',
  ],
  docs: [
    'https://www.googleapis.com/auth/documents', // Full Docs access
    'https://www.googleapis.com/auth/userinfo.email',
  ],
  sheets: [
    'https://www.googleapis.com/auth/spreadsheets', // Full Sheets access
    'https://www.googleapis.com/auth/userinfo.email',
  ],
};

/**
 * Options for starting Google OAuth flow
 */
export interface GoogleOAuthOptions {
  /** Google service to authenticate (uses predefined scopes) */
  service?: GoogleService;
  /** Custom scopes (overrides service scopes if provided) */
  scopes?: string[];
  /** App type for callback server styling */
  appType?: AppType;
}

/**
 * Result of Google OAuth flow
 */
export interface GoogleOAuthResult {
  success: boolean;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  email?: string;
  error?: string;
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
 * Exchange authorization code for tokens
 */
async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
  redirectUri: string
): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number }> {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    code,
    code_verifier: codeVerifier,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token exchange failed: ${errorText}`);
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
 * Get user email from access token
 */
async function getUserEmail(accessToken: string): Promise<string> {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error('Failed to get user info');
  }

  const data = (await response.json()) as { email: string };
  return data.email;
}

/**
 * Refresh Google access token using refresh token
 */
export async function refreshGoogleToken(refreshToken: string): Promise<{
  accessToken: string;
  expiresAt?: number;
}> {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!response.ok) {
    throw new Error('Failed to refresh Google token');
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in?: number;
  };

  return {
    accessToken: data.access_token,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
  };
}

/**
 * Check if Google OAuth is configured (client ID and secret are set)
 */
export function isGoogleOAuthConfigured(): boolean {
  return Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
}

/**
 * Get scopes for a Google service or use custom scopes
 */
export function getGoogleScopes(options: GoogleOAuthOptions): string[] {
  // Custom scopes take precedence
  if (options.scopes && options.scopes.length > 0) {
    // Ensure userinfo.email is included for email retrieval
    const emailScope = 'https://www.googleapis.com/auth/userinfo.email';
    if (!options.scopes.includes(emailScope)) {
      return [...options.scopes, emailScope];
    }
    return options.scopes;
  }

  // Use predefined service scopes
  if (options.service && options.service in GOOGLE_SERVICE_SCOPES) {
    return GOOGLE_SERVICE_SCOPES[options.service];
  }

  // Default to Gmail scopes for backwards compatibility
  return GOOGLE_SERVICE_SCOPES.gmail;
}

/**
 * Start Google OAuth flow
 *
 * Opens browser for Google consent, handles callback, and returns tokens + email.
 * Supports multiple Google services via the service option, or custom scopes.
 *
 * @example
 * // Authenticate for Gmail
 * const result = await startGoogleOAuth({ service: 'gmail' });
 *
 * @example
 * // Authenticate for Google Calendar
 * const result = await startGoogleOAuth({ service: 'calendar' });
 *
 * @example
 * // Authenticate with custom scopes
 * const result = await startGoogleOAuth({
 *   scopes: ['https://www.googleapis.com/auth/spreadsheets']
 * });
 */
export async function startGoogleOAuth(
  options: GoogleOAuthOptions = {}
): Promise<GoogleOAuthResult> {
  try {
    // Verify OAuth credentials are configured
    if (!isGoogleOAuthConfigured()) {
      return {
        success: false,
        error:
          'Google OAuth not configured. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET environment variables.',
      };
    }

    // Get scopes for this request
    const scopes = getGoogleScopes(options);

    // Generate PKCE and state
    const pkce = generatePKCE();
    const state = generateState();

    // Start callback server
    const appType = options.appType || 'electron';
    const callbackServer = await createCallbackServer({ appType });
    const redirectUri = `${callbackServer.url}/callback`;

    // Build authorization URL
    const authUrl = new URL(GOOGLE_AUTH_URL);
    authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', scopes.join(' '));
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', pkce.challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('access_type', 'offline'); // Request refresh token
    authUrl.searchParams.set('prompt', 'consent'); // Always show consent to get refresh token

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

    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code, pkce.verifier, redirectUri);

    // Get user email
    const email = await getUserEmail(tokens.accessToken);

    return {
      success: true,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresIn ? Date.now() + tokens.expiresIn * 1000 : undefined,
      email,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during Google OAuth',
    };
  }
}
