import { describe, expect, it } from 'bun:test'
import { buildCompoundRoute, parseCompoundRoute, parseRouteToNavigationState } from '../route-parser'
import {
  getNavigationStateKey,
  isLocalSkillsNavigation,
  isSkillMarketplaceNavigation,
  parseNavigationStateKey,
  type NavigationState,
} from '../types'

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
      navigator: 'local-skills',
      details: null,
    })

    expect(parseRouteToNavigationState('skills/skill/tdd')).toEqual({
      navigator: 'local-skills',
      details: { type: 'skill', skillSlug: 'tdd' },
    })
  })

  it('parses Marketplace to its own navigation state', () => {
    expect(parseRouteToNavigationState('skills/marketplace')).toEqual({
      navigator: 'skill-marketplace',
    })
  })

  it('guards local skills and marketplace navigation exclusively', () => {
    const variants: NavigationState[] = [
      { navigator: 'sessions', filter: { kind: 'allSessions' }, details: null },
      { navigator: 'sources', details: null },
      { navigator: 'settings', subpage: 'app' },
      { navigator: 'local-skills', details: null },
      { navigator: 'skill-marketplace' },
      { navigator: 'automations', details: null },
    ]

    expect(variants.map(isLocalSkillsNavigation)).toEqual([false, false, false, true, false, false])
    expect(variants.map(isSkillMarketplaceNavigation)).toEqual([false, false, false, false, true, false])
  })

  it('builds navigation keys for local skills and marketplace', () => {
    expect(getNavigationStateKey({ navigator: 'local-skills', details: null })).toBe('skills/local')
    expect(getNavigationStateKey({
      navigator: 'local-skills',
      details: { type: 'skill', skillSlug: 'tdd' },
    })).toBe('skills/skill/tdd')
    expect(getNavigationStateKey({ navigator: 'skill-marketplace' })).toBe('skills/marketplace')
  })

  it('parses navigation keys for local skills and marketplace', () => {
    expect(parseNavigationStateKey('skills/local')).toEqual({ navigator: 'local-skills', details: null })
    expect(parseNavigationStateKey('skills/skill/tdd')).toEqual({
      navigator: 'local-skills',
      details: { type: 'skill', skillSlug: 'tdd' },
    })
    expect(parseNavigationStateKey('skills/marketplace')).toEqual({ navigator: 'skill-marketplace' })
  })

  it('roundtrips submenu destinations', () => {
    const local = parseCompoundRoute('skills/local')!
    const marketplace = parseCompoundRoute('skills/marketplace')!

    expect(buildCompoundRoute(local)).toBe('skills/local')
    expect(buildCompoundRoute(marketplace)).toBe('skills/marketplace')
  })
})
