import { describe, expect, it } from 'bun:test'
import { routes } from '../routes'
import {
  buildCompoundRoute,
  buildRouteFromNavigationState,
  parseCompoundRoute,
  parseRouteToNavigationState,
} from '../route-parser'

describe('route-parser: Connections routes', () => {
  it('round-trips the bare connections route', () => {
    expect(routes.view.connections()).toBe('connections')
    const compound = parseCompoundRoute('connections')
    expect(compound).toEqual({ navigator: 'connections', details: null })
    expect(buildCompoundRoute(compound!)).toBe('connections')

    const state = parseRouteToNavigationState('connections')
    expect(state).toEqual({ navigator: 'connections', details: null })
    expect(buildRouteFromNavigationState(state!)).toBe('connections')
  })

  it('does not throw on an unknown connections subpath', () => {
    const parsed = parseRouteToNavigationState('connections/unknown')
    expect(parsed === null || parsed.navigator === 'connections').toBe(true)
  })
})
