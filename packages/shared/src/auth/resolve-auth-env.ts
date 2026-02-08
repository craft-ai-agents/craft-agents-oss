/**
 * Pure function that determines which environment variables to set/delete
 * for the SDK subprocess based on the current auth state.
 */
import type { AuthType } from '../config/types.ts';

export interface AuthEnvInput {
  billing: {
    type: AuthType | null;
    hasCredentials: boolean;
    apiKey: string | null;
    claudeOAuthToken: string | null;
  };
  customBaseUrl: string | null;
}

export interface AuthEnvResult {
  set: Record<string, string>;
  delete: string[];
  error?: string;
}

export function resolveAuthEnv(input: AuthEnvInput): AuthEnvResult {
  if (input.billing.type === 'bedrock') {
    return { set: {}, delete: [] };
  }

  if (input.customBaseUrl) {
    return {
      set: {
        ANTHROPIC_BASE_URL: input.customBaseUrl,
        ANTHROPIC_API_KEY: input.billing.apiKey || 'not-needed',
      },
      delete: ['CLAUDE_CODE_OAUTH_TOKEN'],
    };
  }

  if (input.billing.type === 'oauth_token' && input.billing.claudeOAuthToken) {
    return {
      set: { CLAUDE_CODE_OAUTH_TOKEN: input.billing.claudeOAuthToken },
      delete: ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL'],
    };
  }

  if (input.billing.apiKey) {
    return {
      set: { ANTHROPIC_API_KEY: input.billing.apiKey },
      delete: ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_BASE_URL'],
    };
  }

  return { set: {}, delete: [], error: 'No authentication configured' };
}
