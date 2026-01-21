/**
 * Auth environment variable management
 *
 * Centralizes the pattern of setting/clearing environment variables
 * when switching between authentication modes.
 */

import type { AuthType } from '../config/storage.ts';

export interface ApiKeyCredentials {
  apiKey: string;
}

export interface ClaudeMaxCredentials {
  oauthToken: string;
}

export interface CustomApiCredentials {
  apiKey: string;
  baseUrl: string;  // e.g., "https://llm.chip.com.vn/v1" or "https://openrouter.ai/api"
}

export type AuthCredentials =
  | { type: 'api_key'; credentials: ApiKeyCredentials }
  | { type: 'oauth_token'; credentials: ClaudeMaxCredentials }
  | { type: 'custom_api'; credentials: CustomApiCredentials };

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
      break;

    case 'oauth_token':
      process.env.CLAUDE_CODE_OAUTH_TOKEN = auth.credentials.oauthToken;
      break;

    case 'custom_api':
      // Set both API key and custom base URL for providers like OpenRouter
      process.env.ANTHROPIC_API_KEY = auth.credentials.apiKey;
      process.env.ANTHROPIC_BASE_URL = auth.credentials.baseUrl;
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
