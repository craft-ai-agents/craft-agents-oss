/**
 * Panel Stack State
 *
 * Single-entry content panel model.
 */

import { atom } from 'jotai'
import { parseRouteToNavigationState } from '../../shared/route-parser'
import type { ViewRoute } from '../../shared/routes'

let nextPanelId = 0
function generatePanelId(): string {
  return `panel-${++nextPanelId}-${Date.now()}`
}

export type PanelType = 'session' | 'source' | 'settings' | 'skills' | 'other'

export interface PanelStackEntry {
  id: string
  route: ViewRoute
  panelType: PanelType
}

const basePanelStackAtom = atom<PanelStackEntry[]>([])

export const panelStackAtom = atom((get) => get(basePanelStackAtom))
export const focusedPanelIdAtom = atom<string | null>(null)

export const panelCountAtom = atom((get) => get(basePanelStackAtom).length)

export const focusedPanelRouteAtom = atom((get) => {
  return get(basePanelStackAtom)[0]?.route ?? null
})

export function getPanelTypeFromRoute(route: ViewRoute): PanelType {
  const navState = parseRouteToNavigationState(route)
  if (!navState) return 'other'

  switch (navState.navigator) {
    case 'sessions':
      return 'session'
    case 'sources':
      return 'source'
    case 'settings':
      return 'settings'
    case 'local-skills':
    case 'skill-marketplace':
      return 'skills'
    default:
      return 'other'
  }
}

function createEntry(route: ViewRoute, id?: string): PanelStackEntry {
  return {
    id: id ?? generatePanelId(),
    route,
    panelType: getPanelTypeFromRoute(route),
  }
}

export function parseSessionIdFromRoute(route: ViewRoute): string | null {
  const segments = route.split('/')
  const idx = segments.indexOf('session')
  if (idx >= 0 && idx + 1 < segments.length) {
    return segments[idx + 1]
  }
  return null
}

export const focusedSessionIdAtom = atom((get) => {
  const route = get(focusedPanelRouteAtom)
  if (!route) return null
  return parseSessionIdFromRoute(route)
})

export const reconcilePanelStackAtom = atom(
  null,
  (get, set, { entries, focusedIndex }: {
    entries: { route: ViewRoute }[]
    focusedIndex?: number
  }): boolean => {
    if (entries.length === 0) return false

    const current = get(basePanelStackAtom)
    const index = Math.min(Math.max(focusedIndex ?? 0, 0), entries.length - 1)
    const route = entries[index]?.route ?? entries[0].route
    const existing = current[0]

    if (current.length === 1 && existing.route === route) {
      if (get(focusedPanelIdAtom) !== existing.id) {
        set(focusedPanelIdAtom, existing.id)
      }
      return false
    }

    const nextEntry = createEntry(route, existing?.id)
    set(basePanelStackAtom, [nextEntry])
    set(focusedPanelIdAtom, nextEntry.id)
    return true
  }
)

export const updateFocusedPanelRouteAtom = atom(
  null,
  (get, set, route: ViewRoute) => {
    const current = get(basePanelStackAtom)[0]

    if (!current) {
      const newEntry = createEntry(route)
      set(basePanelStackAtom, [newEntry])
      set(focusedPanelIdAtom, newEntry.id)
      return
    }

    if (current.route === route) {
      if (get(focusedPanelIdAtom) !== current.id) {
        set(focusedPanelIdAtom, current.id)
      }
      return
    }

    const updated = createEntry(route, current.id)
    set(basePanelStackAtom, [updated])
    set(focusedPanelIdAtom, updated.id)
  }
)
