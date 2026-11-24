import { describe, expect, it, mock } from 'bun:test'
import { handleErrorMessageAction, type ErrorMessageAction } from '../error-message-actions'
import { NAVIGATE_EVENT } from '@/lib/navigate'

describe('handleErrorMessageAction', () => {
  it('routes retry through the session-scoped focus handler', () => {
    const onRetryFocus = mock(() => {})
    const action: ErrorMessageAction = {
      key: 'r',
      label: 'Retry',
      action: 'retry',
    }

    handleErrorMessageAction(action, {
      sessionId: 'session-123',
      onRetryFocus,
    })

    expect(onRetryFocus).toHaveBeenCalledTimes(1)
    expect(onRetryFocus).toHaveBeenCalledWith({ sessionId: 'session-123' })
  })

  it('opens the provided URL for open_url actions', () => {
    const onOpenUrl = mock(() => {})
    const action: ErrorMessageAction = {
      key: 'docs',
      label: 'Open docs',
      action: 'open_url',
      url: 'https://example.com/status',
    }

    handleErrorMessageAction(action, { onOpenUrl })

    expect(onOpenUrl).toHaveBeenCalledTimes(1)
    expect(onOpenUrl).toHaveBeenCalledWith('https://example.com/status')
  })

  it('calls onRetry instead of onRetryFocus when provided', () => {
    const onRetry = mock(() => {})
    const onRetryFocus = mock(() => {})
    const action: ErrorMessageAction = {
      key: 'r',
      label: 'Retry',
      action: 'retry',
    }

    handleErrorMessageAction(action, {
      sessionId: 'session-123',
      onRetry,
      onRetryFocus,
    })

    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onRetryFocus).not.toHaveBeenCalled()
  })

  it('runs the settings handler for settings actions', () => {
    const onOpenSettings = mock(() => {})
    const action: ErrorMessageAction = {
      key: 'settings',
      label: 'Settings',
      action: 'settings',
    }

    handleErrorMessageAction(action, { onOpenSettings })

    expect(onOpenSettings).toHaveBeenCalledTimes(1)
  })

  it('runs the re-authenticate handler for reauth actions', () => {
    const onReauthenticate = mock(() => {})
    const onOpenSettings = mock(() => {})
    const action: ErrorMessageAction = {
      key: 'r',
      label: 'Re-authenticate',
      action: 'reauth',
    }

    handleErrorMessageAction(action, { onReauthenticate, onOpenSettings })

    expect(onReauthenticate).toHaveBeenCalledTimes(1)
    expect(onOpenSettings).not.toHaveBeenCalled()
  })

  it('opens Settings → AI for reauth actions by default', () => {
    const globals = globalThis as { window?: unknown }
    const hadWindow = 'window' in globals
    const previousWindow = globals.window
    const target = new EventTarget()
    const routes: unknown[] = []
    target.addEventListener(NAVIGATE_EVENT, (event) => routes.push((event as CustomEvent).detail.route))
    globals.window = target

    try {
      handleErrorMessageAction({ key: 'r', label: 'Re-authenticate', action: 'reauth' })
    } finally {
      if (hadWindow) globals.window = previousWindow
      else delete globals.window
    }

    expect(routes).toEqual(['settings/ai'])
  })
})
