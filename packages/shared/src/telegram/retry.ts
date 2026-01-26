/**
 * Exponential Backoff with Retry
 *
 * Implements retry mechanism with exponential backoff and jitter for transient failures
 * in Telegram message sending.
 */

export interface BackoffPolicy {
  initialMs: number    // Initial backoff delay (e.g., 1000ms)
  maxMs: number        // Maximum backoff delay (e.g., 30000ms)
  factor: number       // Exponential growth factor (e.g., 2)
  jitter: number       // Jitter factor (e.g., 0.25 = 25%)
  maxAttempts: number  // Maximum number of retry attempts
}

export const DEFAULT_BACKOFF: BackoffPolicy = {
  initialMs: 1000,
  maxMs: 30000,
  factor: 2,
  jitter: 0.25,
  maxAttempts: 5,
}

/**
 * Compute backoff delay with exponential growth and jitter
 *
 * @param policy - Backoff policy configuration
 * @param attempt - Current attempt number (1-based)
 * @returns Delay in milliseconds
 */
export function computeBackoff(policy: BackoffPolicy, attempt: number): number {
  // Compute exponential base: initialMs * factor^(attempt-1)
  const base = Math.min(
    policy.initialMs * Math.pow(policy.factor, attempt - 1),
    policy.maxMs
  )

  // Add jitter: random value in range [-jitter*base, +jitter*base]
  const jitterRange = base * policy.jitter
  const jitter = (Math.random() - 0.5) * 2 * jitterRange

  // Return final delay (ensure non-negative)
  return Math.max(0, Math.floor(base + jitter))
}

/**
 * Execute a function with retry logic and exponential backoff
 *
 * @param fn - Async function to execute
 * @param policy - Backoff policy (defaults to DEFAULT_BACKOFF)
 * @param shouldRetry - Optional predicate to determine if error should be retried
 * @returns Result of successful execution
 * @throws Last error if all attempts fail
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  policy: BackoffPolicy = DEFAULT_BACKOFF,
  shouldRetry?: (error: unknown) => boolean
): Promise<T> {
  let lastError: unknown

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err

      // Check if we should retry this error
      if (shouldRetry && !shouldRetry(err)) {
        throw err
      }

      // Don't wait after the last attempt
      if (attempt < policy.maxAttempts) {
        const delay = computeBackoff(policy, attempt)
        await new Promise(r => setTimeout(r, delay))
      }
    }
  }

  throw lastError
}

/**
 * Determine if a Telegram error should be retried
 *
 * @param err - Error to check
 * @returns true if error should be retried, false otherwise
 *
 * Skip retry for:
 * - 4xx client errors (400, 401, 403, 404)
 *
 * Retry for:
 * - 429 rate limiting
 * - 5xx server errors
 * - Network/timeout issues
 */
export function shouldRetryTelegramError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase()

    // Don't retry client errors (4xx)
    if (msg.includes('400') || msg.includes('401') || msg.includes('403') || msg.includes('404')) {
      return false
    }

    // Retry rate limits, server errors, network issues
    if (msg.includes('429') || msg.includes('5') || msg.includes('network') || msg.includes('timeout')) {
      return true
    }
  }

  // Default: retry unknown errors
  return true
}
