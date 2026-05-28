import { describe, expect, test } from 'bun:test'
import { getSessionClickRoute } from '../session-click-route'

describe('session click route', () => {
  test('clicking a session navigates to the canonical session route', () => {
    expect(getSessionClickRoute({
      navState: { navigator: 'sessions', filter: { kind: 'flagged' }, details: null },
      sessionId: 'session-2',
    })).toBe('allSessions/session/session-2')
  })

  test('clicking the already-active canonical session leaves the route unchanged', () => {
    const currentRoute = 'allSessions/session/session-1'

    expect(getSessionClickRoute({
      navState: {
        navigator: 'sessions',
        filter: { kind: 'allSessions' },
        details: { type: 'session', sessionId: 'session-1' },
      },
      sessionId: 'session-1',
    })).toBe(currentRoute)
  })

  test('clicking an archived session navigates to the archived session route', () => {
    expect(getSessionClickRoute({
      navState: { navigator: 'archived', details: null },
      sessionId: 'session-3',
      isArchived: true,
    })).toBe('archived/session/session-3')
  })

  test('clicking a normal session from archived navigation exits archived mode', () => {
    expect(getSessionClickRoute({
      navState: { navigator: 'archived', details: null },
      sessionId: 'session-4',
      isArchived: false,
    })).toBe('allSessions/session/session-4')
  })
})
