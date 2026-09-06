/**
 * Pages route round-trips: route string ⇄ NavigationState ⇄ panel key.
 * Guards the six touchpoints a new navigator must thread through
 * (prefix list, parse, build, convert, key serialization, type guard).
 */

import { describe, test, expect } from 'bun:test'
import {
  isCompoundRoute,
  parseCompoundRoute,
  buildCompoundRoute,
  parseRouteToNavigationState,
  buildRouteFromNavigationState,
} from '../route-parser'
import {
  getNavigationStateKey,
  parseNavigationStateKey,
  isPagesNavigation,
  type NavigationState,
} from '../types'
import { routes } from '../routes'

describe('pages routes', () => {
  test('route builders emit the pages prefix', () => {
    expect(routes.view.pages()).toBe('pages')
    expect(routes.view.pages('my-dash')).toBe('pages/page/my-dash')
  })

  test('pages is a compound route prefix', () => {
    expect(isCompoundRoute('pages')).toBe(true)
    expect(isCompoundRoute('pages/page/my-dash')).toBe(true)
  })

  test('parses bare pages route (library grid, no auto-selected detail)', () => {
    expect(parseCompoundRoute('pages')).toEqual({ navigator: 'pages', details: null })
    const state = parseRouteToNavigationState('pages')
    expect(state).toEqual({ navigator: 'pages', details: null })
    expect(state && isPagesNavigation(state)).toBe(true)
  })

  test('parses page detail route', () => {
    expect(parseCompoundRoute('pages/page/my-dash')).toEqual({
      navigator: 'pages',
      details: { type: 'page', id: 'my-dash' },
    })
    expect(parseRouteToNavigationState('pages/page/my-dash')).toEqual({
      navigator: 'pages',
      details: { type: 'page', pageSlug: 'my-dash' },
    })
  })

  test('rejects malformed pages routes', () => {
    expect(parseCompoundRoute('pages/unknown')).toBeNull()
    expect(parseCompoundRoute('pages/page')).toBeNull()
  })

  test('round-trips route ⇄ navigation state', () => {
    for (const route of ['pages', 'pages/page/my-dash'] as const) {
      const state = parseRouteToNavigationState(route)
      expect(state).not.toBeNull()
      expect(buildRouteFromNavigationState(state!)).toBe(route)
    }
  })

  test('buildCompoundRoute emits pages routes', () => {
    expect(buildCompoundRoute({ navigator: 'pages', details: null })).toBe('pages')
    expect(buildCompoundRoute({ navigator: 'pages', details: { type: 'page', id: 'x' } })).toBe('pages/page/x')
  })

  test('round-trips navigation state ⇄ panel key', () => {
    const grid: NavigationState = { navigator: 'pages', details: null }
    const detail: NavigationState = { navigator: 'pages', details: { type: 'page', pageSlug: 'my-dash' } }
    expect(getNavigationStateKey(grid)).toBe('pages')
    expect(getNavigationStateKey(detail)).toBe('pages/page/my-dash')
    expect(parseNavigationStateKey('pages')).toEqual(grid)
    expect(parseNavigationStateKey('pages/page/my-dash')).toEqual(detail)
  })

  test('automations panel key round-trips (regression: id had a leading slash)', () => {
    const detail: NavigationState = {
      navigator: 'automations',
      details: { type: 'automation', automationId: 'auto-1' },
    }
    expect(parseNavigationStateKey(getNavigationStateKey(detail))).toEqual(detail)
  })
})
