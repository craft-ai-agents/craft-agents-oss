import { describe, expect, it, beforeEach } from 'bun:test'
import {
  __resetPendingFocusForTests,
  clearPendingFocusForSession,
  consumePendingFocusForSession,
  clearPendingSelectionFocus,
  queuePendingFocusForSession,
} from '../focus-input-events'

describe('focus-input-events pending focus queue', () => {
  beforeEach(() => {
    __resetPendingFocusForTests()
  })

  it('consumes only matching queued session focus request', () => {
    queuePendingFocusForSession('session-b')

    expect(consumePendingFocusForSession('session-a')).toBeUndefined()
    expect(consumePendingFocusForSession('session-b')).toEqual({ sessionId: 'session-b' })
  })

  it('consumption is one-shot', () => {
    queuePendingFocusForSession('session-b')

    expect(consumePendingFocusForSession('session-b')).toEqual({ sessionId: 'session-b' })
    expect(consumePendingFocusForSession('session-b')).toBeUndefined()
  })

  it('clear removes queued focus for that session', () => {
    queuePendingFocusForSession('session-b')
    clearPendingFocusForSession('session-b')

    expect(consumePendingFocusForSession('session-b')).toBeUndefined()
  })

  it('latest queued session wins', () => {
    queuePendingFocusForSession('session-a')
    queuePendingFocusForSession('session-b')

    expect(consumePendingFocusForSession('session-a')).toBeUndefined()
    expect(consumePendingFocusForSession('session-b')).toEqual({ sessionId: 'session-b' })
  })

  it('checks a selection focus guard when the destination composer is ready', () => {
    let canFocus = true
    queuePendingFocusForSession('session-b', () => canFocus)

    expect(consumePendingFocusForSession('session-a')).toBeUndefined()
    const request = consumePendingFocusForSession('session-b')
    canFocus = false // a different field gained focus while the chat loaded
    expect(request?.shouldFocus?.()).toBe(false)
    expect(consumePendingFocusForSession('session-b')).toBeUndefined()
  })

  it('drops automatic focus on departure without dropping explicit requests', () => {
    queuePendingFocusForSession('session-b', () => true)
    clearPendingSelectionFocus('session-a')
    expect(consumePendingFocusForSession('session-b')).toBeDefined()

    queuePendingFocusForSession('session-b', () => true)
    clearPendingSelectionFocus('session-b')
    expect(consumePendingFocusForSession('session-b')).toBeUndefined()

    queuePendingFocusForSession('session-b')
    clearPendingSelectionFocus('session-b')
    expect(consumePendingFocusForSession('session-b')).toEqual({ sessionId: 'session-b' })
  })
})
