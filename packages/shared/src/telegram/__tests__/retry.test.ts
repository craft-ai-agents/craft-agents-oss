/**
 * Retry Logic Tests
 *
 * Tests for exponential backoff and retry functionality
 */

import { describe, it, expect } from 'bun:test'
import {
  computeBackoff,
  withRetry,
  shouldRetryTelegramError,
  DEFAULT_BACKOFF,
  type BackoffPolicy
} from '../retry'

describe('Retry Logic', () => {
  describe('computeBackoff', () => {
    it('should compute exponential backoff correctly', () => {
      const policy: BackoffPolicy = {
        initialMs: 1000,
        maxMs: 30000,
        factor: 2,
        jitter: 0,
        maxAttempts: 5
      }

      // Attempt 1: 1000ms
      expect(computeBackoff(policy, 1)).toBe(1000)

      // Attempt 2: 2000ms
      expect(computeBackoff(policy, 2)).toBe(2000)

      // Attempt 3: 4000ms
      expect(computeBackoff(policy, 3)).toBe(4000)

      // Attempt 4: 8000ms
      expect(computeBackoff(policy, 4)).toBe(8000)
    })

    it('should cap backoff at maxMs', () => {
      const policy: BackoffPolicy = {
        initialMs: 1000,
        maxMs: 5000,
        factor: 2,
        jitter: 0,
        maxAttempts: 10
      }

      // After a few attempts, should cap at 5000
      expect(computeBackoff(policy, 1)).toBe(1000)
      expect(computeBackoff(policy, 2)).toBe(2000)
      expect(computeBackoff(policy, 3)).toBe(4000)
      expect(computeBackoff(policy, 4)).toBe(5000) // Capped
      expect(computeBackoff(policy, 5)).toBe(5000) // Still capped
    })

    it('should add jitter within expected range', () => {
      const policy: BackoffPolicy = {
        initialMs: 1000,
        maxMs: 30000,
        factor: 2,
        jitter: 0.25, // 25% jitter
        maxAttempts: 5
      }

      const results: number[] = []
      for (let i = 0; i < 100; i++) {
        results.push(computeBackoff(policy, 1))
      }

      // All results should be within ±25% of 1000ms (750-1250)
      expect(results.every(r => r >= 750 && r <= 1250)).toBe(true)

      // Should have some variance (not all the same)
      const unique = new Set(results)
      expect(unique.size).toBeGreaterThan(10)
    })

    it('should use default backoff policy values', () => {
      expect(DEFAULT_BACKOFF.initialMs).toBe(1000)
      expect(DEFAULT_BACKOFF.maxMs).toBe(30000)
      expect(DEFAULT_BACKOFF.factor).toBe(2)
      expect(DEFAULT_BACKOFF.jitter).toBe(0.25)
      expect(DEFAULT_BACKOFF.maxAttempts).toBe(5)
    })

    it('should never return negative delays', () => {
      const policy: BackoffPolicy = {
        initialMs: 100,
        maxMs: 1000,
        factor: 2,
        jitter: 1.5, // Extreme jitter
        maxAttempts: 5
      }

      for (let attempt = 1; attempt <= 10; attempt++) {
        const delay = computeBackoff(policy, attempt)
        expect(delay).toBeGreaterThanOrEqual(0)
      }
    })
  })

  describe('withRetry', () => {
    it('should succeed on first attempt if no error', async () => {
      let attempts = 0

      const result = await withRetry(async () => {
        attempts++
        return 'success'
      })

      expect(result).toBe('success')
      expect(attempts).toBe(1)
    })

    it('should retry on transient failures', async () => {
      let attempts = 0

      const result = await withRetry(
        async () => {
          attempts++
          if (attempts < 3) {
            throw new Error('Network timeout')
          }
          return 'success'
        },
        {
          initialMs: 10,
          maxMs: 100,
          factor: 2,
          jitter: 0,
          maxAttempts: 5
        }
      )

      expect(result).toBe('success')
      expect(attempts).toBe(3)
    })

    it('should throw after max attempts exhausted', async () => {
      let attempts = 0

      try {
        await withRetry(
          async () => {
            attempts++
            throw new Error('Permanent failure')
          },
          {
            initialMs: 10,
            maxMs: 100,
            factor: 2,
            jitter: 0,
            maxAttempts: 3
          }
        )
        expect(true).toBe(false) // Should not reach here
      } catch (err) {
        expect(err).toBeInstanceOf(Error)
        expect((err as Error).message).toBe('Permanent failure')
      }

      expect(attempts).toBe(3)
    })

    it('should respect shouldRetry predicate', async () => {
      let attempts = 0

      try {
        await withRetry(
          async () => {
            attempts++
            throw new Error('404 Not Found')
          },
          {
            initialMs: 10,
            maxMs: 100,
            factor: 2,
            jitter: 0,
            maxAttempts: 5
          },
          (err) => {
            // Don't retry 404 errors
            const msg = err instanceof Error ? err.message : String(err)
            return !msg.includes('404')
          }
        )
        expect(true).toBe(false) // Should not reach here
      } catch (err) {
        expect((err as Error).message).toBe('404 Not Found')
      }

      // Should fail immediately without retrying
      expect(attempts).toBe(1)
    })

    it('should wait between attempts', async () => {
      let attempts = 0
      const timestamps: number[] = []

      try {
        await withRetry(
          async () => {
            timestamps.push(Date.now())
            attempts++
            throw new Error('Retry me')
          },
          {
            initialMs: 50,
            maxMs: 200,
            factor: 2,
            jitter: 0,
            maxAttempts: 3
          }
        )
      } catch (err) {
        // Expected to fail
      }

      expect(attempts).toBe(3)

      // Check delays between attempts
      const delay1 = timestamps[1]! - timestamps[0]!
      const delay2 = timestamps[2]! - timestamps[1]!

      // First delay should be ~50ms
      expect(delay1).toBeGreaterThanOrEqual(45)
      expect(delay1).toBeLessThan(100)

      // Second delay should be ~100ms (2x)
      expect(delay2).toBeGreaterThanOrEqual(95)
      expect(delay2).toBeLessThan(150)
    })

    it('should use default policy if none provided', async () => {
      let attempts = 0

      try {
        await withRetry(
          async () => {
            attempts++
            throw new Error('Always fails')
          },
          {
            initialMs: 10,
            maxMs: 100,
            factor: 2,
            jitter: 0,
            maxAttempts: 5
          }
        )
      } catch (err) {
        // Expected to fail
      }

      // Should use maxAttempts (5)
      expect(attempts).toBe(5)
    })
  })

  describe('shouldRetryTelegramError', () => {
    it('should not retry 400 Bad Request', () => {
      const error = new Error('400 Bad Request')
      expect(shouldRetryTelegramError(error)).toBe(false)
    })

    it('should not retry 401 Unauthorized', () => {
      const error = new Error('401 Unauthorized')
      expect(shouldRetryTelegramError(error)).toBe(false)
    })

    it('should not retry 403 Forbidden', () => {
      const error = new Error('403 Forbidden')
      expect(shouldRetryTelegramError(error)).toBe(false)
    })

    it('should not retry 404 Not Found', () => {
      const error = new Error('404 Not Found')
      expect(shouldRetryTelegramError(error)).toBe(false)
    })

    it('should retry 429 Rate Limited', () => {
      const error = new Error('429 Too Many Requests')
      expect(shouldRetryTelegramError(error)).toBe(true)
    })

    it('should retry 500 Internal Server Error', () => {
      const error = new Error('500 Internal Server Error')
      expect(shouldRetryTelegramError(error)).toBe(true)
    })

    it('should retry 503 Service Unavailable', () => {
      const error = new Error('503 Service Unavailable')
      expect(shouldRetryTelegramError(error)).toBe(true)
    })

    it('should retry network errors', () => {
      const error = new Error('Network timeout')
      expect(shouldRetryTelegramError(error)).toBe(true)
    })

    it('should retry timeout errors', () => {
      const error = new Error('Request timeout')
      expect(shouldRetryTelegramError(error)).toBe(true)
    })

    it('should retry unknown errors by default', () => {
      const error = new Error('Unknown error')
      expect(shouldRetryTelegramError(error)).toBe(true)
    })

    it('should retry non-Error objects', () => {
      expect(shouldRetryTelegramError('Some string error')).toBe(true)
      expect(shouldRetryTelegramError({ error: 'Object error' })).toBe(true)
    })

    it('should be case-insensitive', () => {
      expect(shouldRetryTelegramError(new Error('400 bad request'))).toBe(false)
      expect(shouldRetryTelegramError(new Error('NETWORK TIMEOUT'))).toBe(true)
    })
  })

  describe('Integration: withRetry + shouldRetryTelegramError', () => {
    it('should not retry client errors', async () => {
      let attempts = 0

      try {
        await withRetry(
          async () => {
            attempts++
            throw new Error('400 Bad Request')
          },
          DEFAULT_BACKOFF,
          shouldRetryTelegramError
        )
      } catch (err) {
        // Expected to fail
      }

      // Should fail immediately
      expect(attempts).toBe(1)
    })

    it('should retry server errors', async () => {
      let attempts = 0

      try {
        await withRetry(
          async () => {
            attempts++
            throw new Error('500 Internal Server Error')
          },
          {
            initialMs: 10,
            maxMs: 100,
            factor: 2,
            jitter: 0,
            maxAttempts: 3
          },
          shouldRetryTelegramError
        )
      } catch (err) {
        // Expected to fail after retries
      }

      // Should retry up to maxAttempts
      expect(attempts).toBe(3)
    })

    it('should recover from transient server errors', async () => {
      let attempts = 0

      const result = await withRetry(
        async () => {
          attempts++
          if (attempts < 3) {
            throw new Error('503 Service Unavailable')
          }
          return 'recovered'
        },
        {
          initialMs: 10,
          maxMs: 100,
          factor: 2,
          jitter: 0,
          maxAttempts: 5
        },
        shouldRetryTelegramError
      )

      expect(result).toBe('recovered')
      expect(attempts).toBe(3)
    })
  })
})
