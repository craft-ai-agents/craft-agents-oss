import { describe, expect, it } from 'bun:test'

import { buildRouteFromNavigationState, parseRouteToNavigationState } from '../route-parser'
import { routes } from '../routes'

describe('route-parser: project assets', () => {
  it('builds a direct project assets route', () => {
    expect(routes.view.projectAssets()).toBe('projects/assets')
  })

  it('round-trips the cross-project assets query view', () => {
    const state = parseRouteToNavigationState('projects/assets')

    expect(state).toEqual({
      navigator: 'projects',
      details: { type: 'projectAssets' },
    })
    expect(state && buildRouteFromNavigationState(state)).toBe('projects/assets')
  })
})
