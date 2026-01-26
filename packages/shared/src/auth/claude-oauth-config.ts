/**
 * Shared OAuth configuration for Claude authentication
 *
 * This file is the single source of truth for all Claude OAuth settings.
 * Both token exchange and token refresh should use these values.
 */

export const CLAUDE_OAUTH_CONFIG = {
  /**
   * OAuth Client ID for Claude authentication
   * This is the public client ID used for PKCE flow
   */
  CLIENT_ID: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',

  /**
   * Authorization URL - where users authenticate
   */
  AUTH_URL: 'https://claude.ai/oauth/authorize',

  /**
   * Token URL - for exchanging codes and refreshing tokens
   * Same endpoint handles both exchange and refresh
   */
  TOKEN_URL: 'https://console.anthropic.com/v1/oauth/token',

  /**
   * Redirect URI - where OAuth flow redirects after authentication
   * Must match exactly what's configured in the OAuth provider
   */
  REDIRECT_URI: 'https://console.anthropic.com/oauth/code/callback',

  /**
   * OAuth scopes requested during authentication
   */
  SCOPES: 'org:create_api_key user:profile user:inference',
} as const;

export type ClaudeOAuthConfig = typeof CLAUDE_OAUTH_CONFIG;
