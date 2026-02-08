/**
 * Tests for resolveAuthEnv — pure function that decides which
 * environment variables to set/delete for SDK subprocess auth.
 */
import { describe, it, expect } from 'bun:test';
import { resolveAuthEnv } from '../resolve-auth-env.ts';

describe('resolveAuthEnv', () => {
  it('should set BASE_URL and API_KEY for custom provider with API key', () => {
    const result = resolveAuthEnv({
      billing: {
        type: 'api_key',
        hasCredentials: true,
        apiKey: 'sk-test-key',
        claudeOAuthToken: null,
      },
      customBaseUrl: 'https://openrouter.ai/api',
    });

    expect(result.set).toEqual({
      ANTHROPIC_BASE_URL: 'https://openrouter.ai/api',
      ANTHROPIC_API_KEY: 'sk-test-key',
    });
    expect(result.delete).toEqual(['CLAUDE_CODE_OAUTH_TOKEN']);
  });

  it('should use placeholder API key for custom provider without API key', () => {
    const result = resolveAuthEnv({
      billing: {
        type: 'api_key',
        hasCredentials: true,
        apiKey: null,
        claudeOAuthToken: null,
      },
      customBaseUrl: 'http://localhost:11434',
    });

    expect(result.set).toEqual({
      ANTHROPIC_BASE_URL: 'http://localhost:11434',
      ANTHROPIC_API_KEY: 'not-needed',
    });
    expect(result.delete).toEqual(['CLAUDE_CODE_OAUTH_TOKEN']);
  });

  it('should set OAUTH_TOKEN for Claude Max subscription', () => {
    const result = resolveAuthEnv({
      billing: {
        type: 'oauth_token',
        hasCredentials: true,
        apiKey: null,
        claudeOAuthToken: 'oauth-token-123',
      },
      customBaseUrl: null,
    });

    expect(result.set).toEqual({
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth-token-123',
    });
    expect(result.delete).toEqual(['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL']);
  });

  it('should set API_KEY for direct Anthropic API key', () => {
    const result = resolveAuthEnv({
      billing: {
        type: 'api_key',
        hasCredentials: true,
        apiKey: 'sk-ant-key',
        claudeOAuthToken: null,
      },
      customBaseUrl: null,
    });

    expect(result.set).toEqual({
      ANTHROPIC_API_KEY: 'sk-ant-key',
    });
    expect(result.delete).toEqual(['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_BASE_URL']);
  });

  it('should return error when nothing configured', () => {
    const result = resolveAuthEnv({
      billing: {
        type: null,
        hasCredentials: false,
        apiKey: null,
        claudeOAuthToken: null,
      },
      customBaseUrl: null,
    });

    expect(result.set).toEqual({});
    expect(result.delete).toEqual([]);
    expect(result.error).toBe('No authentication configured');
  });

  it('should return empty sets and deletes when Bedrock is active', () => {
    const result = resolveAuthEnv({
      billing: {
        type: 'bedrock',
        hasCredentials: true,
        apiKey: null,
        claudeOAuthToken: null,
      },
      customBaseUrl: null,
    });

    expect(result.set).toEqual({});
    expect(result.delete).toEqual([]);
  });
});
