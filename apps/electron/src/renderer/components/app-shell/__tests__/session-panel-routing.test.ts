import { describe, expect, test } from 'bun:test'
import type { PanelStackEntry } from '@/atoms/panel-stack'
import { resolveSessionPanelNavigation } from '../session-panel-routing'

const entry = (id: string, route: PanelStackEntry['route']): PanelStackEntry => ({
  id,
  route,
  proportion: 1,
  panelType: 'session',
  laneId: 'main',
})

describe('session panel routing', () => {
  test('keeps archived session clicks on archived navigation even when the session is open elsewhere', () => {
    expect(resolveSessionPanelNavigation({
      navState: { navigator: 'archived', details: null },
      panelStack: [entry('panel-1', 'allSessions/session/session-1')],
      sessionId: 'session-1',
    })).toEqual({ type: 'navigate-route', route: 'archived/session/session-1' })
  })

  test('focuses an already open session panel outside archived navigation', () => {
    expect(resolveSessionPanelNavigation({
      navState: { navigator: 'sessions', filter: { kind: 'allSessions' }, details: null },
      panelStack: [entry('panel-1', 'allSessions/session/session-1')],
      sessionId: 'session-1',
    })).toEqual({ type: 'focus', panelId: 'panel-1' })
  })

  test('keeps normal session clicks on the current filter when the session is not open', () => {
    expect(resolveSessionPanelNavigation({
      navState: { navigator: 'sessions', filter: { kind: 'flagged' }, details: null },
      panelStack: [entry('panel-1', 'allSessions/session/session-1')],
      sessionId: 'session-2',
    })).toEqual({ type: 'navigate-current-filter' })
  })
})
