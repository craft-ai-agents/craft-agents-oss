import { describe, expect, test } from 'bun:test'
import { resolveRightSidebarVisibility } from '../right-sidebar-visibility'
import type { NavigationState } from '../../../../shared/types'

describe('resolveRightSidebarVisibility', () => {
  test('mounts right sidebar in sessions navigation', () => {
    const navState: NavigationState = {
      navigator: 'sessions',
      filter: { kind: 'allSessions' },
      details: null,
    }
    expect(resolveRightSidebarVisibility(navState)).toBe(true)
  })

  test('unmounts right sidebar in sources navigation', () => {
    const navState: NavigationState = {
      navigator: 'sources',
      details: null,
    }
    expect(resolveRightSidebarVisibility(navState)).toBe(false)
  })

  test('unmounts right sidebar in skills navigation', () => {
    const navState: NavigationState = {
      navigator: 'skills',
      details: null,
    }
    expect(resolveRightSidebarVisibility(navState)).toBe(false)
  })

  test('unmounts right sidebar in automations navigation', () => {
    const navState: NavigationState = {
      navigator: 'automations',
      details: null,
    }
    expect(resolveRightSidebarVisibility(navState)).toBe(false)
  })

  test('unmounts right sidebar in settings navigation', () => {
    const navState: NavigationState = {
      navigator: 'settings',
      subpage: 'app',
    }
    expect(resolveRightSidebarVisibility(navState)).toBe(false)
  })
})
