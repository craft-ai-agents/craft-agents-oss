import { CLAUDE_OAUTH_CONFIG } from './claude-oauth-config';
import { APP_VERSION } from '../version/index.ts';
import { debug } from '../utils/debug.ts';

export interface ClaudeOAuthCredential {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes?: string[];
}

/**
 * Refresh Claude OAuth token using refresh token
 * Uses the Claude platform OAuth token endpoint (same as token exchange)
 */
export async function refreshClaudeToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  /** The account the tokens belong to, when the response says (as the code exchange does). */
  accountUuid?: string;
}> {
  // Use JSON format to match the token exchange endpoint
  const params = {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: CLAUDE_OAUTH_CONFIG.CLIENT_ID,
  };

  const response = await fetch(CLAUDE_OAUTH_CONFIG.TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': `CraftAgents/${APP_VERSION}`,
      Accept: 'application/json',
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    let errorText: string;
    try {
      errorText = await response.text();
    } catch {
      errorText = `HTTP ${response.status} ${response.statusText}`;
    }

    let errorMessage = errorText;
    try {
      const errorJson = JSON.parse(errorText) as { error?: unknown; error_description?: unknown } | null;
      // Keep the OAuth error code with its description ("invalid_grant: Refresh token
      // expired"): the code is what says the refresh token is dead (RFC 6749 §5.2).
      const parts = [errorJson?.error, errorJson?.error_description].filter(
        (part): part is string => typeof part === 'string' && part !== '',
      );
      if (parts.length > 0) errorMessage = parts.join(': ');
    } catch {
      // Not JSON: keep the raw text
    }

    throw new Error(`Token refresh failed: ${response.status} - ${errorMessage}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
    account?: { uuid?: string };
  };

  // Log what we received from the API for debugging
  const expiresAt = data.expires_in ? Date.now() + data.expires_in * 1000 : undefined;
  debug(`[claude-token] Refresh response - expires_in: ${data.expires_in ?? 'NOT PROVIDED'}, calculated expiresAt: ${expiresAt ? new Date(expiresAt).toISOString() : 'undefined'}`);

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt,
    ...(data.account?.uuid ? { accountUuid: data.account.uuid } : {}),
  };
}

/**
 * Check if a token is expired or will expire soon (within 5 minutes)
 */
export function isTokenExpired(expiresAt?: number): boolean {
  if (!expiresAt) {
    // If no expiry, assume token is still valid
    return false;
  }
  // Consider expired if less than 5 minutes remaining
  const bufferMs = 5 * 60 * 1000;
  return Date.now() + bufferMs >= expiresAt;
}
