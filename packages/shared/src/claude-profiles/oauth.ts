/**
 * Claude Profiles - OAuth
 *
 * OAuth flow for adding new Claude profiles. Uses PKCE (Proof Key for Code Exchange)
 * for secure authentication. Includes CSRF state validation.
 *
 * Based on packages/shared/src/auth/claude-oauth.ts but modified for multi-profile support.
 */

import { randomBytes, createHash } from 'node:crypto';
import { getCredentialManager } from '../credentials/manager';
import type { ClaudeProfile } from './types';
import { createProfile, updateProfile } from './storage';

// OAuth configuration
const CLAUDE_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const CLAUDE_AUTH_URL = 'https://claude.ai/oauth/authorize';
const CLAUDE_TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';
const REDIRECT_URI = 'https://console.anthropic.com/oauth/code/callback';
const OAUTH_SCOPES = 'org:create_api_key user:profile user:inference user:sessions:claude_code';
const STATE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

/**
 * OAuth state for in-progress authentication flow.
 */
export interface ProfileOAuthState {
  /** Random state parameter for CSRF protection */
  state: string;
  /** PKCE code verifier */
  codeVerifier: string;
  /** Timestamp when state was created (Unix ms) */
  timestamp: number;
  /** Timestamp when state expires (Unix ms) */
  expiresAt: number;
  /** Profile name provided by user */
  profileName: string;
}

/**
 * OAuth tokens received from Anthropic.
 */
export interface ProfileOAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

/**
 * User info from Anthropic's userinfo endpoint.
 */
export interface UserInfo {
  email: string;
  name?: string;
}

// In-memory state storage for current OAuth flows
// Map of state -> OAuth state data
const pendingOAuthStates = new Map<string, ProfileOAuthState>();

/**
 * Generate a secure random state parameter.
 */
function generateState(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Generate PKCE code verifier and challenge.
 */
function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
  return { codeVerifier, codeChallenge };
}

/**
 * Clean up expired OAuth states.
 */
function cleanupExpiredStates(): void {
  const now = Date.now();
  for (const [state, data] of pendingOAuthStates) {
    if (now > data.expiresAt) {
      pendingOAuthStates.delete(state);
    }
  }
}

/**
 * Start the OAuth flow for adding a new profile.
 *
 * @param profileName - Name for the new profile
 * @param onStatus - Optional status callback
 * @returns Authorization URL and state
 */
export async function startProfileOAuth(
  profileName: string,
  onStatus?: (message: string) => void
): Promise<{ authUrl: string; state: string }> {
  // Clean up old states
  cleanupExpiredStates();

  onStatus?.('Generating authentication URL...');

  // Generate secure random values
  const state = generateState();
  const { codeVerifier, codeChallenge } = generatePKCE();

  // Store state for CSRF validation
  const now = Date.now();
  const oauthState: ProfileOAuthState = {
    state,
    codeVerifier,
    timestamp: now,
    expiresAt: now + STATE_EXPIRY_MS,
    profileName,
  };
  pendingOAuthStates.set(state, oauthState);

  // Build OAuth URL
  const params = new URLSearchParams({
    code: 'true',
    client_id: CLAUDE_CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: OAUTH_SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
  });

  const authUrl = `${CLAUDE_AUTH_URL}?${params.toString()}`;

  // Note: Browser opening is handled by the caller (IPC handler or frontend)
  // to avoid duplicate browser windows
  onStatus?.('Waiting for you to copy the authorization code...');

  return { authUrl, state };
}

/**
 * Validate an OAuth state parameter.
 *
 * @param state - State parameter to validate
 * @returns The OAuth state data if valid, null if invalid
 */
export function validateOAuthState(state: string): ProfileOAuthState | null {
  // Clean up expired states
  cleanupExpiredStates();

  const oauthState = pendingOAuthStates.get(state);
  if (!oauthState) {
    return null;
  }

  // Check expiry
  if (Date.now() > oauthState.expiresAt) {
    pendingOAuthStates.delete(state);
    return null;
  }

  return oauthState;
}

/**
 * Check if there is a valid OAuth state for a given state parameter.
 */
export function hasValidOAuthState(state: string): boolean {
  return validateOAuthState(state) !== null;
}

/**
 * Clear a specific OAuth state.
 */
export function clearOAuthState(state: string): void {
  pendingOAuthStates.delete(state);
}

/**
 * Clear all pending OAuth states.
 */
export function clearAllOAuthStates(): void {
  pendingOAuthStates.clear();
}

/**
 * Get the number of pending OAuth states.
 */
export function getPendingOAuthStateCount(): number {
  cleanupExpiredStates();
  return pendingOAuthStates.size;
}

/**
 * Fetch user info from the access token.
 * Returns null if the endpoint is unavailable or returns an error.
 */
async function fetchUserInfo(accessToken: string): Promise<UserInfo | null> {
  try {
    const response = await fetch('https://api.anthropic.com/api/oauth/userinfo', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      // User info endpoint may not be available - this is not fatal
      console.warn(`[claude-profiles] User info fetch failed: ${response.status}`);
      return null;
    }

    const data = await response.json() as { email: string; name?: string };
    return {
      email: data.email,
      name: data.name,
    };
  } catch (error) {
    console.warn('[claude-profiles] User info fetch error:', error);
    return null;
  }
}

/**
 * Complete the OAuth flow by exchanging the authorization code for tokens.
 *
 * This validates the CSRF state, exchanges the code for tokens, fetches
 * user info, creates the profile, and stores the tokens.
 *
 * @param authorizationCode - Authorization code from the callback
 * @param state - State parameter for CSRF validation
 * @param onStatus - Optional status callback
 * @returns The created profile
 */
export async function completeProfileOAuth(
  authorizationCode: string,
  state: string,
  onStatus?: (message: string) => void
): Promise<ClaudeProfile> {
  // CSRF validation
  const oauthState = validateOAuthState(state);
  if (!oauthState) {
    throw new Error('Invalid or expired OAuth state. Please start the authentication flow again.');
  }

  // Clean up the authorization code in case it has URL fragments
  const cleanedCode = authorizationCode.split('#')[0]?.split('&')[0] ?? authorizationCode;

  onStatus?.('Exchanging authorization code for tokens...');

  const params = {
    grant_type: 'authorization_code',
    client_id: CLAUDE_CLIENT_ID,
    code: cleanedCode,
    redirect_uri: REDIRECT_URI,
    code_verifier: oauthState.codeVerifier,
    state: oauthState.state,
  };

  try {
    const response = await fetch(CLAUDE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: 'https://claude.ai/',
        Origin: 'https://claude.ai',
      },
      body: JSON.stringify(params),
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
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    // Clear state after successful exchange
    clearOAuthState(state);

    onStatus?.('Fetching account information...');

    // Try to fetch user info to get email (optional - may not be available)
    const userInfo = await fetchUserInfo(data.access_token);

    onStatus?.('Creating profile...');

    // Create the profile (email is optional)
    const profile = await createProfile(oauthState.profileName, userInfo?.email);

    // Store tokens via CredentialManager
    const credManager = getCredentialManager();
    await credManager.set(
      {
        type: 'claude_profile',
        sourceId: profile.id,
      },
      {
        value: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
      }
    );

    onStatus?.('Profile created successfully!');

    return profile;
  } catch (error) {
    // Clear state on error so user can retry
    clearOAuthState(state);

    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`OAuth failed: ${String(error)}`);
  }
}

/**
 * Refresh the OAuth token for a profile.
 *
 * @param profileId - Profile ID to refresh
 * @param onStatus - Optional status callback
 * @returns Updated tokens
 */
export async function refreshProfileToken(
  profileId: string,
  onStatus?: (message: string) => void
): Promise<ProfileOAuthTokens> {
  const credManager = getCredentialManager();
  const cred = await credManager.get({
    type: 'claude_profile',
    sourceId: profileId,
  });

  if (!cred?.refreshToken) {
    throw new Error('No refresh token available. Re-authenticate the profile.');
  }

  onStatus?.('Refreshing access token...');

  const params = {
    grant_type: 'refresh_token',
    client_id: CLAUDE_CLIENT_ID,
    refresh_token: cred.refreshToken,
  };

  const response = await fetch(CLAUDE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      Accept: 'application/json, text/plain, */*',
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const errorText = await response.text();
    // Record auth failure for cooldown
    await updateProfile(profileId, { lastAuthFailureAt: Date.now() });
    throw new Error(`Token refresh failed: ${response.status} - ${errorText}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  // Update stored tokens
  await credManager.set(
    {
      type: 'claude_profile',
      sourceId: profileId,
    },
    {
      value: data.access_token,
      refreshToken: data.refresh_token || cred.refreshToken,
      expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
    }
  );

  onStatus?.('Token refreshed successfully!');

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || cred.refreshToken,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
  };
}

/**
 * Get the OAuth tokens for a profile.
 *
 * @param profileId - Profile ID
 * @returns Tokens or null if not found
 */
export async function getProfileTokens(
  profileId: string
): Promise<ProfileOAuthTokens | null> {
  const credManager = getCredentialManager();
  const cred = await credManager.get({
    type: 'claude_profile',
    sourceId: profileId,
  });

  if (!cred) return null;

  return {
    accessToken: cred.value,
    refreshToken: cred.refreshToken,
    expiresAt: cred.expiresAt,
  };
}

/**
 * Delete the OAuth tokens for a profile.
 *
 * @param profileId - Profile ID
 * @returns True if deleted
 */
export async function deleteProfileTokens(profileId: string): Promise<boolean> {
  const credManager = getCredentialManager();
  return await credManager.delete({
    type: 'claude_profile',
    sourceId: profileId,
  });
}

/**
 * Check if a profile's token is expired (with 5-minute buffer).
 */
export async function isProfileTokenExpired(profileId: string): Promise<boolean> {
  const tokens = await getProfileTokens(profileId);
  if (!tokens?.expiresAt) return false;

  // Consider expired if within 5 minutes of expiry
  return Date.now() > tokens.expiresAt - 5 * 60 * 1000;
}
