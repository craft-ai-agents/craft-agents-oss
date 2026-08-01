import { describe, it, expect } from 'bun:test';
import { buildOAuthDeeplinkUrl, type OAuthSessionContext } from '../types';

describe('buildOAuthDeeplinkUrl', () => {
  it('returns deeplink URL when sessionId and deeplinkScheme are provided', () => {
    const ctx: OAuthSessionContext = {
      sessionId: '260209-swift-river',
      deeplinkScheme: 'archstudio',
    };
    expect(buildOAuthDeeplinkUrl(ctx)).toBe('archstudio://allSessions/session/260209-swift-river');
  });

  it('returns undefined when sessionId is missing', () => {
    const ctx: OAuthSessionContext = {
      deeplinkScheme: 'archstudio',
    };
    expect(buildOAuthDeeplinkUrl(ctx)).toBeUndefined();
  });

  it('returns undefined when deeplinkScheme is missing', () => {
    const ctx: OAuthSessionContext = {
      sessionId: '260209-swift-river',
    };
    expect(buildOAuthDeeplinkUrl(ctx)).toBeUndefined();
  });

  it('returns undefined when context is undefined', () => {
    expect(buildOAuthDeeplinkUrl(undefined)).toBeUndefined();
  });

  it('returns undefined when context is empty object', () => {
    expect(buildOAuthDeeplinkUrl({})).toBeUndefined();
  });

  it('uses custom deeplink scheme for multi-instance', () => {
    const ctx: OAuthSessionContext = {
      sessionId: 'test-session',
      deeplinkScheme: 'archstudio1',
    };
    expect(buildOAuthDeeplinkUrl(ctx)).toBe('archstudio1://allSessions/session/test-session');
  });

  // Edge cases for session IDs with special characters
  it('handles session ID with special characters (hyphens and numbers)', () => {
    const ctx: OAuthSessionContext = {
      sessionId: '260209-swift-river-42',
      deeplinkScheme: 'archstudio',
    };
    expect(buildOAuthDeeplinkUrl(ctx)).toBe('archstudio://allSessions/session/260209-swift-river-42');
  });

  it('handles session ID with URL-unsafe characters', () => {
    const ctx: OAuthSessionContext = {
      sessionId: 'session/with spaces&special=chars',
      deeplinkScheme: 'archstudio',
    };
    // The function does not encode - it passes through as-is
    expect(buildOAuthDeeplinkUrl(ctx)).toBe('archstudio://allSessions/session/session/with spaces&special=chars');
  });

  it('returns undefined when sessionId is empty string', () => {
    const ctx: OAuthSessionContext = {
      sessionId: '',
      deeplinkScheme: 'archstudio',
    };
    expect(buildOAuthDeeplinkUrl(ctx)).toBeUndefined();
  });

  it('returns undefined when deeplinkScheme is empty string', () => {
    const ctx: OAuthSessionContext = {
      sessionId: 'test-session',
      deeplinkScheme: '',
    };
    expect(buildOAuthDeeplinkUrl(ctx)).toBeUndefined();
  });

  it('returns undefined when both are empty strings', () => {
    const ctx: OAuthSessionContext = {
      sessionId: '',
      deeplinkScheme: '',
    };
    expect(buildOAuthDeeplinkUrl(ctx)).toBeUndefined();
  });

  it('constructs correct URL format for instance 2', () => {
    const ctx: OAuthSessionContext = {
      sessionId: '260111-bold-moon',
      deeplinkScheme: 'archstudio2',
    };
    expect(buildOAuthDeeplinkUrl(ctx)).toBe('archstudio2://allSessions/session/260111-bold-moon');
  });
});
