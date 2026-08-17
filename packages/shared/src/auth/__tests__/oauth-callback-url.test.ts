import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test'

/**
 * Tests that all OAuth prepare functions correctly support callbackUrl
 * as an alternative to callbackPort for WebUI deployments.
 */

// Mock fetch globally to prevent real HTTP requests during metadata discovery
const mockFetch = mock(() => Promise.resolve(new Response('Not Found', { status: 404 })))
// Bun runs every test file in one process, so a global left stubbed here is
// stubbed for every file that runs after this one — which silently breaks any
// later suite that makes a real request (the pages and webui servers both do).
const realFetch = globalThis.fetch
afterAll(() => { globalThis.fetch = realFetch })
globalThis.fetch = mockFetch as any

import { prepareGoogleOAuth } from '../google-oauth'

// Google and Slack accept credentials via options, so we can test them directly.
// Microsoft reads MICROSOFT_OAUTH_CLIENT_ID from env at module load — skip if not set.

const TEST_CREDS = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
}

describe('callbackUrl support in OAuth prepare functions', () => {
  describe('Google OAuth', () => {
    it('uses callbackUrl when provided', () => {
      const result = prepareGoogleOAuth({
        callbackUrl: 'https://my-server.com/api/oauth/callback',
        ...TEST_CREDS,
      })
      expect(result.redirectUri).toBe('https://my-server.com/api/oauth/callback')
      expect(result.authUrl).toContain('redirect_uri=https%3A%2F%2Fmy-server.com%2Fapi%2Foauth%2Fcallback')
    })

    it('falls back to callbackPort when callbackUrl not provided', () => {
      const result = prepareGoogleOAuth({ callbackPort: 6477, ...TEST_CREDS })
      expect(result.redirectUri).toBe('http://localhost:6477/callback')
    })

    it('callbackUrl takes precedence over callbackPort', () => {
      const result = prepareGoogleOAuth({
        callbackPort: 6477,
        callbackUrl: 'https://my-server.com/api/oauth/callback',
        ...TEST_CREDS,
      })
      expect(result.redirectUri).toBe('https://my-server.com/api/oauth/callback')
    })
  })
})
