export class OAuthFlowCancelledError extends Error {
  constructor(message = 'OAuth flow cancelled') {
    super(message)
    this.name = 'OAuthFlowCancelledError'
  }
}

export class OAuthFlowTimedOutError extends Error {
  constructor(message = 'OAuth flow timed out') {
    super(message)
    this.name = 'OAuthFlowTimedOutError'
  }
}

interface WaitForOAuthCallbackOptions {
  timeoutMs: number
  signal?: AbortSignal
  timeoutMessage?: string
  cancelMessage?: string
}

export function waitForOAuthCallback<T>(
  callbackPromise: Promise<T>,
  options: WaitForOAuthCallbackOptions,
): Promise<T> {
  const {
    timeoutMs,
    signal,
    timeoutMessage = 'OAuth flow timed out',
    cancelMessage = 'OAuth flow cancelled',
  } = options

  return new Promise<T>((resolve, reject) => {
    let settled = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      signal?.removeEventListener('abort', onAbort)
    }

    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      fn()
    }

    const onAbort = () => {
      settle(() => reject(new OAuthFlowCancelledError(cancelMessage)))
    }

    if (signal?.aborted) {
      onAbort()
      return
    }

    signal?.addEventListener('abort', onAbort, { once: true })

    timeoutId = setTimeout(() => {
      settle(() => reject(new OAuthFlowTimedOutError(timeoutMessage)))
    }, timeoutMs)

    callbackPromise.then(
      (value) => settle(() => resolve(value)),
      (error) => settle(() => reject(error)),
    )
  })
}

export function isOAuthFlowCancelledError(error: unknown): error is OAuthFlowCancelledError {
  return error instanceof OAuthFlowCancelledError
}
