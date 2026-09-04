import { describe, expect, it } from 'bun:test'
import { buildRouteFromNavigationState, parseRouteToNavigationState } from '../route-parser'
import { isCanvasNavigation } from '../types'

describe('route-parser: infinite canvas', () => {
  it('parses the canvas as a first-class workspace view', () => {
    const state = parseRouteToNavigationState('canvas')
    expect(state).not.toBeNull()
    expect(state && isCanvasNavigation(state)).toBe(true)
    expect(state).toEqual({ navigator: 'canvas', details: { type: 'canvas' } })
  })

  it('round-trips the canvas navigation state', () => {
    expect(buildRouteFromNavigationState({ navigator: 'canvas', details: { type: 'canvas' } })).toBe('canvas')
  })
})
