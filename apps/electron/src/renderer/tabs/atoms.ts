/**
 * Tab State Management with Jotai
 *
 * Uses atomWithStorage for automatic localStorage persistence.
 * Tab state survives app restarts.
 */

import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import type { Tab, TabState, ChatTab } from './types'

/**
 * Default empty tab state
 */
const DEFAULT_TAB_STATE: TabState = {
  tabs: [],
  activeTabId: '',
}

/**
 * Main tab state atom with localStorage persistence
 */
export const tabStateAtom = atomWithStorage<TabState>(
  'craft-tabs',
  DEFAULT_TAB_STATE
)

/**
 * Derived atom: get the currently active tab
 */
export const activeTabAtom = atom((get) => {
  const state = get(tabStateAtom)
  return state.tabs.find((t) => t.id === state.activeTabId) || null
})

/**
 * Derived atom: get tabs by type
 */
export const tabsByTypeAtom = atom((get) => {
  const state = get(tabStateAtom)
  return <T extends Tab>(type: T['type']): T[] =>
    state.tabs.filter((t): t is T => t.type === type)
})

/**
 * Derived atom: check if tab bar should be visible (2+ tabs)
 */
export const isTabBarVisibleAtom = atom((get) => {
  const state = get(tabStateAtom)
  return state.tabs.length >= 2
})

/**
 * Action atom: open a tab (or activate existing)
 */
export const openTabAtom = atom(null, (get, set, tab: Tab) => {
  const state = get(tabStateAtom)
  const existingIndex = state.tabs.findIndex((t) => t.id === tab.id)

  if (existingIndex >= 0) {
    // Tab exists - just activate it
    set(tabStateAtom, { ...state, activeTabId: tab.id })
  } else {
    // New tab - add and activate
    set(tabStateAtom, {
      ...state,
      tabs: [...state.tabs, tab],
      activeTabId: tab.id,
    })
  }
})

/**
 * Action atom: replace a tab atomically (for hybrid tab replacement)
 * This avoids race conditions from sequential closeTab + openTab calls
 */
export const replaceTabAtom = atom(
  null,
  (get, set, { oldTabId, newTab }: { oldTabId: string; newTab: Tab }) => {
    const state = get(tabStateAtom)
    const newTabs = state.tabs.filter((t) => t.id !== oldTabId).concat(newTab)
    set(tabStateAtom, { tabs: newTabs, activeTabId: newTab.id })
  }
)

/**
 * Action atom: close a tab
 */
export const closeTabAtom = atom(null, (get, set, tabId: string) => {
  const state = get(tabStateAtom)
  const tab = state.tabs.find((t) => t.id === tabId)

  // Cannot close non-closable tabs
  if (!tab?.closable) return

  const newTabs = state.tabs.filter((t) => t.id !== tabId)
  let newActiveId = state.activeTabId

  // If closing active tab, activate adjacent tab
  if (state.activeTabId === tabId && newTabs.length > 0) {
    const closedIndex = state.tabs.findIndex((t) => t.id === tabId)
    const newIndex = Math.min(closedIndex, newTabs.length - 1)
    newActiveId = newTabs[newIndex].id
  } else if (newTabs.length === 0) {
    newActiveId = ''
  }

  set(tabStateAtom, {
    ...state,
    tabs: newTabs,
    activeTabId: newActiveId,
  })
})

/**
 * Action atom: set active tab
 */
export const setActiveTabAtom = atom(null, (get, set, tabId: string) => {
  const state = get(tabStateAtom)
  if (state.tabs.some((t) => t.id === tabId)) {
    set(tabStateAtom, { ...state, activeTabId: tabId })
  }
})

/**
 * Action atom: reorder tabs (for drag-and-drop)
 */
export const reorderTabsAtom = atom(
  null,
  (get, set, fromIndex: number, toIndex: number) => {
    const state = get(tabStateAtom)
    const newTabs = [...state.tabs]
    const [moved] = newTabs.splice(fromIndex, 1)
    newTabs.splice(toIndex, 0, moved)
    set(tabStateAtom, { ...state, tabs: newTabs })
  }
)

/**
 * Action atom: update a tab's properties (e.g., label, dirty)
 */
export const updateTabAtom = atom(
  null,
  (get, set, tabId: string, updates: Partial<Tab>) => {
    const state = get(tabStateAtom)
    const newTabs = state.tabs.map((t) =>
      t.id === tabId ? { ...t, ...updates } : t
    ) as Tab[]
    set(tabStateAtom, { ...state, tabs: newTabs })
  }
)

/**
 * Action atom: find existing chat tab for session
 * Returns the tab if found, null otherwise
 */
export const findChatTabBySessionAtom = atom((get) => {
  const state = get(tabStateAtom)
  return (sessionId: string): ChatTab | null => {
    return (
      (state.tabs.find(
        (t) => t.type === 'chat' && (t as ChatTab).sessionId === sessionId
      ) as ChatTab) || null
    )
  }
})

/**
 * Action atom: navigate to previous tab
 */
export const previousTabAtom = atom(null, (get, set) => {
  const state = get(tabStateAtom)
  if (state.tabs.length <= 1) return

  const currentIndex = state.tabs.findIndex((t) => t.id === state.activeTabId)
  const prevIndex =
    currentIndex <= 0 ? state.tabs.length - 1 : currentIndex - 1
  set(tabStateAtom, { ...state, activeTabId: state.tabs[prevIndex].id })
})

/**
 * Action atom: navigate to next tab
 */
export const nextTabAtom = atom(null, (get, set) => {
  const state = get(tabStateAtom)
  if (state.tabs.length <= 1) return

  const currentIndex = state.tabs.findIndex((t) => t.id === state.activeTabId)
  const nextIndex =
    currentIndex >= state.tabs.length - 1 ? 0 : currentIndex + 1
  set(tabStateAtom, { ...state, activeTabId: state.tabs[nextIndex].id })
})

/**
 * Action atom: close all tabs except the given one
 */
export const closeOtherTabsAtom = atom(null, (get, set, keepTabId: string) => {
  const state = get(tabStateAtom)
  const tabToKeep = state.tabs.find((t) => t.id === keepTabId)

  if (!tabToKeep) return

  set(tabStateAtom, {
    tabs: [tabToKeep],
    activeTabId: keepTabId,
  })
})

/**
 * Action atom: validate and clean up restored tabs
 * Call this after app startup to remove stale tabs
 */
export const validateTabsAtom = atom(
  null,
  (get, set, validSessionIds: Set<string>) => {
    const state = get(tabStateAtom)

    const validTabs = state.tabs.filter((tab) => {
      // Always keep singleton tabs
      if (tab.type === 'settings' || tab.type === 'shortcuts') return true

      // Validate chat tabs have existing sessions
      if (tab.type === 'chat') {
        return validSessionIds.has((tab as ChatTab).sessionId)
      }

      // Keep other tabs (file, browser, agent-info, agent-setup)
      // They'll handle missing resources gracefully
      return true
    })

    // Update active tab if it was removed
    let newActiveId = state.activeTabId
    if (!validTabs.some((t) => t.id === newActiveId)) {
      newActiveId = validTabs[0]?.id || ''
    }

    set(tabStateAtom, {
      tabs: validTabs,
      activeTabId: newActiveId,
    })
  }
)
