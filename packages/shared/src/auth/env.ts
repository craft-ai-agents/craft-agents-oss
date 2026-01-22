/**
 * Auth environment variable management
 *
 * Centralizes the pattern of setting/clearing environment variables
 * when switching between authentication modes.
 */

import type { AuthType } from '../config/storage.ts';

export interface ApiKeyCredentials {
  apiKey: string;
  baseUrl?: string;  // Custom Anthropic API base URL (for third-party compatible APIs)
}

export interface ClaudeMaxCredentials {
  oauthToken: string;
}

export type AuthCredentials =
  | { type: 'api_key'; credentials: ApiKeyCredentials }
  | { type: 'oauth_token'; credentials: ClaudeMaxCredentials };

/**
 * Set environment variables for the specified auth type.
 *
 * This clears conflicting env vars and sets the appropriate ones
 * for the selected authentication mode.
 *
 * @param auth - The auth type and credentials to configure
 */
export function setAuthEnvironment(auth: AuthCredentials): void {
  // Clear all auth-related env vars first
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_BASE_URL;
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;

  switch (auth.type) {
    case 'api_key':
      process.env.ANTHROPIC_API_KEY = auth.credentials.apiKey;
      if (auth.credentials.baseUrl) {
        process.env.ANTHROPIC_BASE_URL = auth.credentials.baseUrl;
      }
      break;

    case 'oauth_token':
      process.env.CLAUDE_CODE_OAUTH_TOKEN = auth.credentials.oauthToken;
      break;
  }
}

/**
 * Clear all auth-related environment variables.
 */
export function clearAuthEnvironment(): void {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_BASE_URL;
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
}
