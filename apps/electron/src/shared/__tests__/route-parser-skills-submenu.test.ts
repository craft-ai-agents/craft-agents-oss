import { describe, expect, it } from 'bun:test'
import { buildCompoundRoute, parseCompoundRoute, parseRouteToNavigationState } from '../route-parser'

describe('route-parser: skills submenu routes', () => {
  it('parses Local Skills and Marketplace as distinct skills destinations', () => {
    expect(parseCompoundRoute('skills/local')).toEqual({
      navigator: 'skills',
      skillDestination: 'local',
      details: null,
    })

    expect(parseCompoundRoute('skills/marketplace')).toEqual({
      navigator: 'skills',
      skillDestination: 'marketplace',
      details: null,
    })
  })

  it('keeps existing skills routes on the Local Skills destination', () => {
    expect(parseRouteToNavigationState('skills')).toEqual({
      navigator: 'skills',
      destination: 'local',
      details: null,
    })

    expect(parseRouteToNavigationState('skills/skill/tdd')).toEqual({
      navigator: 'skills',
      destination: 'local',
      details: { type: 'skill', skillSlug: 'tdd' },
    })
  })

  it('roundtrips submenu destinations', () => {
    const local = parseCompoundRoute('skills/local')!
    const marketplace = parseCompoundRoute('skills/marketplace')!

    expect(buildCompoundRoute(local)).toBe('skills/local')
    expect(buildCompoundRoute(marketplace)).toBe('skills/marketplace')
  })
})
