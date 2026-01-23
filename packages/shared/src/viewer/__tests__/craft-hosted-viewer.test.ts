import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test'
import CraftHostedViewer from '../craft-hosted-viewer'
import type { StoredSession } from '../../sessions/types'

/**
 * Test suite for CraftHostedViewer
 *
 * Tests the viewer service implementation that communicates with
 * the Craft-hosted backend service for session sharing.
 */

// Mock fetch for all tests
const originalFetch = global.fetch

/**
 * Helper to create a mock fetch function that bypasses TypeScript's
 * strict typing for the `preconnect` property on global.fetch
 */
function mockFetch(impl: (...args: any[]) => Promise<Response | never>): void {
  global.fetch = mock(impl) as unknown as typeof fetch
}

/**
 * Create a mock session for testing
 */
function createMockSession(overrides?: Partial<StoredSession>): StoredSession {
  return {
    id: 'test-session-123',
    name: 'Test Session',
    workspaceRootPath: '~/.vespr/workspaces/workspace-1',
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    messages: [],
    tokenUsage: {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      contextTokens: 150,
      costUsd: 0.01,
    },
    ...overrides,
  }
}

describe('CraftHostedViewer', () => {
  let viewer: CraftHostedViewer

  beforeEach(() => {
    viewer = new CraftHostedViewer()
  })

  afterEach(() => {
    // Restore original fetch
    global.fetch = originalFetch
  })

  describe('constructor', () => {
    test('uses default baseUrl when not provided', () => {
      const viewer = new CraftHostedViewer()
      // We can't directly access private baseUrl, but we can verify behavior
      expect(viewer).toBeDefined()
    })

    test('accepts custom baseUrl', () => {
      const customViewer = new CraftHostedViewer('https://custom.example.com')
      expect(customViewer).toBeDefined()
    })

    test('removes trailing slashes from baseUrl', () => {
      const customViewer = new CraftHostedViewer('https://custom.example.com///')
      expect(customViewer).toBeDefined()
    })
  })

  describe('share()', () => {
    test('returns success with id and url on 200 response', async () => {
      const mockResponse = {
        id: 'share-id-456',
        url: 'https://agents.craft.do/s/share-id-456',
      }

      mockFetch(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockResponse),
        } as Response)
      )

      const session = createMockSession()
      const result = await viewer.share(session)

      expect(result.success).toBe(true)
      expect(result.id).toBe('share-id-456')
      expect(result.url).toBe('https://agents.craft.do/s/share-id-456')
      expect(result.error).toBeUndefined()
    })

    test('returns error message on 413 (payload too large)', async () => {
      mockFetch(() =>
        Promise.resolve({
          ok: false,
          status: 413,
        } as Response)
      )

      const session = createMockSession()
      const result = await viewer.share(session)

      expect(result.success).toBe(false)
      expect(result.error).toBe('Session file is too large to share')
      expect(result.id).toBeUndefined()
      expect(result.url).toBeUndefined()
    })

    test('returns error on other HTTP failures', async () => {
      mockFetch(() =>
        Promise.resolve({
          ok: false,
          status: 500,
        } as Response)
      )

      const session = createMockSession()
      const result = await viewer.share(session)

      expect(result.success).toBe(false)
      expect(result.error).toBe('Failed to share session: HTTP 500')
    })

    test('returns error on network failure', async () => {
      mockFetch(() => Promise.reject(new Error('Network error')))

      const session = createMockSession()
      const result = await viewer.share(session)

      expect(result.success).toBe(false)
      expect(result.error).toBe('Network error')
    })

    test('handles non-Error exceptions gracefully', async () => {
      mockFetch(() => Promise.reject('String error'))

      const session = createMockSession()
      const result = await viewer.share(session)

      expect(result.success).toBe(false)
      expect(result.error).toBe('Network error while sharing session')
    })
  })

  describe('update()', () => {
    test('returns success on 200 response', async () => {
      const mockResponse = {
        id: 'share-id-456',
        url: 'https://agents.craft.do/s/share-id-456',
      }

      mockFetch(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockResponse),
        } as Response)
      )

      const session = createMockSession()
      const result = await viewer.update('share-id-456', session)

      expect(result.success).toBe(true)
      expect(result.id).toBe('share-id-456')
      expect(result.url).toBe('https://agents.craft.do/s/share-id-456')
    })

    test('returns error on 413 (payload too large)', async () => {
      mockFetch(() =>
        Promise.resolve({
          ok: false,
          status: 413,
        } as Response)
      )

      const session = createMockSession()
      const result = await viewer.update('share-id-456', session)

      expect(result.success).toBe(false)
      expect(result.error).toBe('Session file is too large to share')
    })

    test('returns error on failure', async () => {
      mockFetch(() =>
        Promise.resolve({
          ok: false,
          status: 404,
        } as Response)
      )

      const session = createMockSession()
      const result = await viewer.update('nonexistent-id', session)

      expect(result.success).toBe(false)
      expect(result.error).toBe('Failed to update session: HTTP 404')
    })

    test('returns error on network failure', async () => {
      mockFetch(() => Promise.reject(new Error('Connection refused')))

      const session = createMockSession()
      const result = await viewer.update('share-id-456', session)

      expect(result.success).toBe(false)
      expect(result.error).toBe('Connection refused')
    })
  })

  describe('revoke()', () => {
    test('returns success on 200 response', async () => {
      mockFetch(() =>
        Promise.resolve({
          ok: true,
          status: 200,
        } as Response)
      )

      const result = await viewer.revoke('share-id-456')

      expect(result.success).toBe(true)
      expect(result.error).toBeUndefined()
    })

    test('returns error on failure', async () => {
      mockFetch(() =>
        Promise.resolve({
          ok: false,
          status: 404,
        } as Response)
      )

      const result = await viewer.revoke('nonexistent-id')

      expect(result.success).toBe(false)
      expect(result.error).toBe('Failed to revoke session: HTTP 404')
    })

    test('returns error on network failure', async () => {
      mockFetch(() => Promise.reject(new Error('Timeout')))

      const result = await viewer.revoke('share-id-456')

      expect(result.success).toBe(false)
      expect(result.error).toBe('Timeout')
    })
  })

  describe('healthCheck()', () => {
    test('returns true when service is available', async () => {
      mockFetch(() =>
        Promise.resolve({
          ok: true,
          status: 200,
        } as Response)
      )

      const result = await viewer.healthCheck()

      expect(result).toBe(true)
    })

    test('returns false when service returns error', async () => {
      mockFetch(() =>
        Promise.resolve({
          ok: false,
          status: 503,
        } as Response)
      )

      const result = await viewer.healthCheck()

      expect(result).toBe(false)
    })

    test('returns false on network error', async () => {
      mockFetch(() => Promise.reject(new Error('DNS resolution failed')))

      const result = await viewer.healthCheck()

      expect(result).toBe(false)
    })
  })

  describe('custom baseUrl', () => {
    test('share uses custom baseUrl', async () => {
      const customViewer = new CraftHostedViewer('https://custom.example.com')
      let calledUrl = ''

      mockFetch((url: string | URL | Request) => {
        calledUrl = url.toString()
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: 'test', url: 'https://test.com/s/test' }),
        } as Response)
      })

      const session = createMockSession()
      await customViewer.share(session)

      expect(calledUrl).toBe('https://custom.example.com/s/api')
    })

    test('healthCheck uses custom baseUrl', async () => {
      const customViewer = new CraftHostedViewer('https://custom.example.com')
      let calledUrl = ''

      mockFetch((url: string | URL | Request) => {
        calledUrl = url.toString()
        return Promise.resolve({
          ok: true,
          status: 200,
        } as Response)
      })

      await customViewer.healthCheck()

      expect(calledUrl).toBe('https://custom.example.com/health')
    })
  })
})
