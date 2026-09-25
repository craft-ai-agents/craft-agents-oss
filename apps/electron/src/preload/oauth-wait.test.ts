import { describe, expect, it } from 'bun:test'
import {
  isOAuthFlowCancelledError,
  OAuthFlowTimedOutError,
  waitForOAuthCallback,
} from './oauth-wait'

describe('waitForOAuthCallback', () => {
  it('resolves when the callback arrives before timeout', async () => {
    const result = await waitForOAuthCallback(
      Promise.resolve({ code: 'ok' }),
      { timeoutMs: 100 },
    )

    expect(result).toEqual({ code: 'ok' })
  })

  it('rejects with a timeout when no callback arrives', async () => {
    const promise = waitForOAuthCallback(
      new Promise<never>(() => {}),
      { timeoutMs: 5, timeoutMessage: 'Timed out waiting for OAuth callback' },
    )

    await expect(promise).rejects.toBeInstanceOf(OAuthFlowTimedOutError)
    await expect(promise).rejects.toHaveProperty('message', 'Timed out waiting for OAuth callback')
  })

  it('rejects when the flow is cancelled', async () => {
    const controller = new AbortController()
    const promise = waitForOAuthCallback(
      new Promise<never>(() => {}),
      { timeoutMs: 100, signal: controller.signal, cancelMessage: 'Authentication cancelled' },
    )

    controller.abort()

    const error = await promise.catch((value) => value)
    expect(isOAuthFlowCancelledError(error)).toBe(true)
    expect(error).toHaveProperty('message', 'Authentication cancelled')
  })
})
