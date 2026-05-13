import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import * as storage from '@/lib/local-storage'
import {
  loadRightSidebarOpenPreference,
  persistRightSidebarOpenPreference,
  resolveRightSidebarContextualAvailability,
  resolvePanelStackRightSidebarVisible,
  shouldSuppressRightSidebarForNavState,
} from '../right-sidebar-state'

function makeLocalStorage() {
  const store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value },
    removeItem: (key: string) => { delete store[key] },
  } as Storage
}

describe('right sidebar AppShell state', () => {
  const originalLocalStorage = globalThis.localStorage

  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: makeLocalStorage(),
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: originalLocalStorage,
      writable: true,
      configurable: true,
    })
  })

  test('loads and persists the open preference per workspace using the existing key', () => {
    persistRightSidebarOpenPreference(false, 'ws-a')
    persistRightSidebarOpenPreference(true, 'ws-b')

    expect(loadRightSidebarOpenPreference('ws-a')).toBe(false)
    expect(loadRightSidebarOpenPreference('ws-b')).toBe(true)
    expect(loadRightSidebarOpenPreference('ws-c')).toBe(true)
    expect(globalThis.localStorage.getItem('craft-right-sidebar-visible:ws-a')).toBe('false')
    expect(storage.KEYS.rightSidebarVisible).toBe('right-sidebar-visible')
  })

  test('only reserves the right edge when the sidebar is contextually available and open', () => {
    expect(resolvePanelStackRightSidebarVisible(true, true)).toBe(true)
    expect(resolvePanelStackRightSidebarVisible(true, false)).toBe(false)
    expect(resolvePanelStackRightSidebarVisible(false, true)).toBe(false)
  })

  test('contextual availability depends on an active session instead of session navigation', () => {
    expect(resolveRightSidebarContextualAvailability({
      activeSessionId: 'session-1',
      navState: { navigator: 'sources', details: null },
    })).toBe(true)

    expect(resolveRightSidebarContextualAvailability({
      activeSessionId: null,
      navState: { navigator: 'sessions', filter: { kind: 'allSessions' }, details: null },
    })).toBe(false)
  })

  test('contextual availability remains suppressed in archived navigation', () => {
    expect(resolveRightSidebarContextualAvailability({
      activeSessionId: 'session-1',
      navState: { navigator: 'archived', details: null },
    })).toBe(false)
  })

  test('suppresses right sidebar for archived navigation state only', () => {
    expect(shouldSuppressRightSidebarForNavState({ navigator: 'archived', details: null })).toBe(true)
    expect(shouldSuppressRightSidebarForNavState({ navigator: 'sessions', filter: { kind: 'allSessions' }, details: null })).toBe(false)
    expect(shouldSuppressRightSidebarForNavState({ navigator: 'sources', details: null })).toBe(false)
    expect(shouldSuppressRightSidebarForNavState({ navigator: 'settings', subpage: null })).toBe(false)
  })
})
