import { describe, expect, it } from 'bun:test'
import { isSidebarDrilldownMode, type NavigationState } from '../types'

describe('isSidebarDrilldownMode', () => {
  it('returns false for sessions navigation', () => {
    const navState: NavigationState = {
      navigator: 'sessions',
      filter: { kind: 'allSessions' },
      details: null,
    }

    expect(isSidebarDrilldownMode(navState)).toBe(false)
  })

  it('returns false for sources navigation', () => {
    const navState: NavigationState = {
      navigator: 'sources',
      details: null,
    }

    expect(isSidebarDrilldownMode(navState)).toBe(false)
  })

  it('returns false for skills navigation', () => {
    const navState: NavigationState = {
      navigator: 'local-skills',
      details: null,
    }

    expect(isSidebarDrilldownMode(navState)).toBe(false)
  })

  it('returns false for skill marketplace navigation', () => {
    const navState: NavigationState = {
      navigator: 'skill-marketplace',
    }

    expect(isSidebarDrilldownMode(navState)).toBe(false)
  })

  it('returns false for automations navigation', () => {
    const navState: NavigationState = {
      navigator: 'automations',
      details: null,
    }

    expect(isSidebarDrilldownMode(navState)).toBe(false)
  })

  it('returns false for settings navigation', () => {
    const navState: NavigationState = {
      navigator: 'settings',
      subpage: 'app',
    }

    expect(isSidebarDrilldownMode(navState)).toBe(false)
  })
})
