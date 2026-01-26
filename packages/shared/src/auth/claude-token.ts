import { CLAUDE_OAUTH_CONFIG } from './claude-oauth-config';

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
    let errorText: string;
    try {
      errorText = await response.text();
    } catch {
      errorText = `HTTP ${response.status} ${response.statusText}`;
    }

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
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
  };

  // Log what we received from the API for debugging
  const expiresAt = data.expires_in ? Date.now() + data.expires_in * 1000 : undefined;
  console.log(`[claude-token] Refresh response - expires_in: ${data.expires_in ?? 'NOT PROVIDED'}, calculated expiresAt: ${expiresAt ? new Date(expiresAt).toISOString() : 'undefined'}`);

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt,
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
