import { describe, it, expect } from 'bun:test'
import { createStore } from 'jotai'
import {
  panelStackAtom,
  focusedPanelIdAtom,
  reconcilePanelStackAtom,
  updateFocusedPanelRouteAtom,
  type PanelStackEntry,
} from '../panel-stack'

function getStack(store: ReturnType<typeof createStore>): PanelStackEntry[] {
  return store.get(panelStackAtom)
}

describe('panel stack single-entry behavior', () => {
  it('replaces the current panel when the focused route changes', () => {
    const store = createStore()

    store.set(updateFocusedPanelRouteAtom, 'allSessions/session/s1')
    const firstEntry = getStack(store)[0]

    store.set(updateFocusedPanelRouteAtom, 'sources/source/github')

    const stack = getStack(store)
    expect(stack).toHaveLength(1)
    expect(stack[0].id).toBe(firstEntry.id)
    expect(stack[0].route).toBe('sources/source/github')
    expect(store.get(focusedPanelIdAtom)).toBe(firstEntry.id)
  })

  it('reconciles multi-panel URL state into the focused single panel', () => {
    const store = createStore()

    const changed = store.set(reconcilePanelStackAtom, {
      entries: [
        { route: 'allSessions/session/s1' },
        { route: 'sources/source/github' },
        { route: 'settings' },
      ],
      focusedIndex: 1,
    })

    const stack = getStack(store)
    expect(changed).toBe(true)
    expect(stack).toHaveLength(1)
    expect(stack[0].route).toBe('sources/source/github')
    expect(store.get(focusedPanelIdAtom)).toBe(stack[0].id)
  })

  it('reconcile no-op keeps the existing panel id', () => {
    const store = createStore()

    store.set(reconcilePanelStackAtom, {
      entries: [{ route: 'allSessions/session/s1' }],
      focusedIndex: 0,
    })

    const firstEntry = getStack(store)[0]
    const changed = store.set(reconcilePanelStackAtom, {
      entries: [{ route: 'allSessions/session/s1' }],
      focusedIndex: 0,
    })

    expect(changed).toBe(false)
    expect(getStack(store)).toHaveLength(1)
    expect(getStack(store)[0].id).toBe(firstEntry.id)
    expect(store.get(focusedPanelIdAtom)).toBe(firstEntry.id)
  })
})
