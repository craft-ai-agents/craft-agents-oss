/**
 * Slack OAuth flow using Slack's OAuth 2.0 v2
 *
 * This module handles the complete Slack OAuth flow for USER authentication:
 * 1. Opens browser for Slack consent screen
 * 2. Receives authorization code via local callback server
 * 3. Exchanges code for user access token
 * 4. Returns tokens and workspace info
 *
 * Uses user_scope (not scope) to authenticate as the user, not as a bot.
 * This allows posting messages as the authenticated user.
 */

import { URL } from 'url';
import open from 'open';
import { randomBytes, createHash } from 'crypto';
import { createCallbackServer, type AppType } from './callback-server.ts';
import type { SlackService } from '../sources/types.ts';
import { generateState } from './pkce.ts';

// Re-export for convenience
export type { SlackService } from '../sources/types.ts';

// Slack OAuth configuration - must be set via environment variables
// These are baked into the build at compile time
const SLACK_CLIENT_ID = process.env.SLACK_OAUTH_CLIENT_ID || '';
const SLACK_CLIENT_SECRET = process.env.SLACK_OAUTH_CLIENT_SECRET || '';

// Slack OAuth endpoints
const SLACK_AUTH_URL = 'https://slack.com/oauth/v2/authorize';
const SLACK_TOKEN_URL = 'https://slack.com/api/oauth.v2.access';

// Slack OAuth relay URL (configurable via environment variable)
const SLACK_OAUTH_RELAY_URL = process.env.SLACK_OAUTH_RELAY_URL || 'https://agents.craft.do/auth/slack/callback';

/**
 * Fetch with timeout using AbortController
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs = 30000
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs / 1000} seconds`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetch user email from Slack API
 * Returns undefined if email is not available (won't fail the OAuth flow)
 */
async function getUserEmail(accessToken: string, userId: string): Promise<string | undefined> {
  try {
    const response = await fetchWithTimeout(
      `https://slack.com/api/users.info?user=${userId}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    const data = (await response.json()) as {
      ok: boolean;
      user?: { profile?: { email?: string } };
    };
    return data.ok ? data.user?.profile?.email : undefined;
  } catch {
    return undefined; // Email is optional, don't fail OAuth
  }
}

/**
 * Predefined USER scope sets for common Slack services
 * These are user scopes (user_scope), not bot scopes (scope)
 * User scopes allow acting as the authenticated user
 */
export const SLACK_SERVICE_SCOPES: Record<SlackService, string[]> = {
  messaging: ['chat:write'],
  channels: ['channels:read', 'channels:history', 'groups:read', 'groups:history'],
  users: ['users:read', 'users:read.email'],
  files: ['files:read', 'files:write'],
  full: [
    'chat:write',
    'channels:read',
    'channels:history',
    'groups:read',
    'groups:history',
    'users:read',
    'users:read.email',
    'files:read',
    'files:write',
    'reactions:read',
    'reactions:write',
    'im:read',
    'im:history',
    'im:write',
    'mpim:read',
    'mpim:history',
    'search:read',
  ],
};

/**
 * Options for starting Slack OAuth flow
 */
export interface SlackOAuthOptions {
  /** Slack service to authenticate (uses predefined scopes) */
  service?: SlackService;
  /** Custom user scopes (overrides service scopes if provided) */
  userScopes?: string[];
  /** App type for callback server styling */
  appType?: AppType;
}

/**
 * Result of Slack OAuth flow
 */
export interface SlackOAuthResult {
  success: boolean;
  /** User access token (xoxp-...) for acting as the user */
  accessToken?: string;
  /** Refresh token for token rotation (if enabled in Slack app settings) */
  refreshToken?: string;
  /** Token expiration timestamp (ms) - only if token rotation is enabled */
  expiresAt?: number;
  /** Slack workspace ID */
  teamId?: string;
  /** Slack workspace name */
  teamName?: string;
  /** Authenticated user ID */
  userId?: string;
  /** Authenticated user email (if available) */
  email?: string;
  /** Error message if failed */
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
 * Exchange authorization code for tokens
 * Slack uses HTTP Basic auth for token exchange
 */
async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
  redirectUri: string
): Promise<{
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  teamId: string;
  teamName: string;
  userId: string;
}> {
  // Use HTTP Basic auth as recommended by Slack
  const authHeader = Buffer.from(`${SLACK_CLIENT_ID}:${SLACK_CLIENT_SECRET}`).toString('base64');

  const params = new URLSearchParams({
    code,
    code_verifier: codeVerifier,
    redirect_uri: redirectUri,
  });

  const response = await fetchWithTimeout(SLACK_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${authHeader}`,
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token exchange failed (HTTP ${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as {
    ok: boolean;
    error?: string;
    // For user tokens, these come from authed_user
    authed_user?: {
      id: string;
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    team?: { id: string; name: string };
  };

  if (!data.ok) {
    throw new Error(`Slack token exchange failed: ${data.error || 'Unknown error'}`);
  }

  // User token is in authed_user.access_token
  if (!data.authed_user?.access_token) {
    throw new Error('No user access token received. Make sure user_scope is set in the OAuth request.');
  }

  return {
    accessToken: data.authed_user.access_token,
    refreshToken: data.authed_user.refresh_token,
    expiresIn: data.authed_user.expires_in,
    teamId: data.team?.id || '',
    teamName: data.team?.name || '',
    userId: data.authed_user.id,
  };
}

/**
 * Refresh Slack access token using refresh token
 * Note: Token rotation must be enabled in Slack app settings for refresh tokens
 */
export async function refreshSlackToken(
  refreshToken: string
): Promise<{ accessToken: string; expiresAt?: number }> {
  const authHeader = Buffer.from(`${SLACK_CLIENT_ID}:${SLACK_CLIENT_SECRET}`).toString('base64');

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  const response = await fetchWithTimeout(SLACK_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${authHeader}`,
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token refresh failed (HTTP ${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as {
    ok: boolean;
    error?: string;
    access_token?: string;
    expires_in?: number;
  };

  if (!data.ok) {
    throw new Error(`Failed to refresh Slack token: ${data.error || 'Unknown error'}`);
  }

  if (!data.access_token) {
    throw new Error('Token refresh succeeded but no access_token returned');
  }

  return {
    accessToken: data.access_token,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
  };
}

/**
 * Check if Slack OAuth is configured (client ID and secret are set)
 */
export function isSlackOAuthConfigured(): boolean {
  return Boolean(SLACK_CLIENT_ID && SLACK_CLIENT_SECRET);
}

/**
 * Get user scopes for a Slack service or use custom scopes
 */
export function getSlackScopes(options: SlackOAuthOptions): string[] {
  // Custom scopes take precedence
  if (options.userScopes && options.userScopes.length > 0) {
    return options.userScopes;
  }

  // Use predefined service scopes
  if (options.service && options.service in SLACK_SERVICE_SCOPES) {
    return SLACK_SERVICE_SCOPES[options.service];
  }

  // Default to full workspace scopes
  return SLACK_SERVICE_SCOPES.full;
}

/**
 * Start Slack OAuth flow for USER authentication
 *
 * Opens browser for Slack consent, handles callback, and returns user token + workspace info.
 * Uses user_scope to authenticate as the user (not a bot), allowing you to post as yourself.
 *
 * @example
 * // Authenticate with full workspace access
 * const result = await startSlackOAuth({ service: 'full' });
 *
 * @example
 * // Authenticate for messaging only
 * const result = await startSlackOAuth({ service: 'messaging' });
 *
 * @example
 * // Authenticate with custom scopes
 * const result = await startSlackOAuth({
 *   userScopes: ['chat:write', 'users:read']
 * });
 */
export async function startSlackOAuth(options: SlackOAuthOptions = {}): Promise<SlackOAuthResult> {
  // Verify OAuth credentials are configured
  if (!isSlackOAuthConfigured()) {
    return {
      success: false,
      error:
        'Slack OAuth not configured. Set SLACK_OAUTH_CLIENT_ID and SLACK_OAUTH_CLIENT_SECRET environment variables.',
    };
  }

  // Get user scopes for this request
  const userScopes = getSlackScopes(options);

  // Generate PKCE and state for security
  const pkce = generatePKCE();
  const state = generateState();

  // Start local HTTP callback server
  const appType = options.appType || 'electron';
  const callbackServer = await createCallbackServer({ appType });

  try {
    // Extract port from local callback URL
    const localUrl = new URL(callbackServer.url);
    const port = localUrl.port;

    // Use Cloudflare Worker relay for Slack OAuth (Slack requires HTTPS)
    // The relay redirects: https://agents.craft.do/auth/slack/callback → http://localhost:{port}/callback
    const redirectUri = `${SLACK_OAUTH_RELAY_URL}?port=${port}`;

    // Build authorization URL
    // Use user_scope (not scope) to get a user token instead of bot token
    const authUrl = new URL(SLACK_AUTH_URL);
    authUrl.searchParams.set('client_id', SLACK_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', pkce.challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    // user_scope = authenticate as user, scope = install bot
    authUrl.searchParams.set('user_scope', userScopes.join(','));

    // Open browser for authorization
    await open(authUrl.toString());

    // Wait for callback with timeout to prevent hanging indefinitely
    const OAUTH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
    const callback = await Promise.race([
      callbackServer.promise,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('OAuth timeout - authorization was not completed within 5 minutes')),
          OAUTH_TIMEOUT_MS
        )
      ),
    ]);

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

    // Fetch user email (optional, won't fail if unavailable)
    const email = await getUserEmail(tokens.accessToken, tokens.userId);

    return {
      success: true,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresIn ? Date.now() + tokens.expiresIn * 1000 : undefined,
      teamId: tokens.teamId,
      teamName: tokens.teamName,
      userId: tokens.userId,
      email,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during Slack OAuth',
    };
  } finally {
    // Always clean up the callback server
    callbackServer.close();
  }
}
