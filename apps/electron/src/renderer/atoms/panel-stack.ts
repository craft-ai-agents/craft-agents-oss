/**
 * Panel Stack State
 *
 * Manages a stack of panels displayed side-by-side in the main content area.
 * Each panel is identified by a ViewRoute (deeplink string).
 *
 * - Panel at index 0 is the "primary" panel, synced with NavigationContext
 * - Panels at index 1+ are "secondary" panels pushed from UI interactions
 * - Closing a panel also closes all panels to its right (stack semantics)
 */

import { atom } from 'jotai'
import type { ViewRoute } from '../../shared/routes'

let nextPanelId = 0
function generatePanelId(): string {
  return `panel-${++nextPanelId}-${Date.now()}`
}

export interface PanelStackEntry {
  /** Unique ID for React key / AnimatePresence */
  id: string
  /** The deeplink route that determines what renders in this panel */
  route: ViewRoute
}

/** The panel stack — first entry is always the "primary" panel */
export const panelStackAtom = atom<PanelStackEntry[]>([])

/** Derived: the primary (index 0) route — syncs with NavigationContext */
export const primaryPanelRouteAtom = atom(
  (get) => get(panelStackAtom)[0]?.route ?? null
)

/** Derived: number of panels in the stack */
export const panelCountAtom = atom(
  (get) => get(panelStackAtom).length
)

/**
 * Push a new panel onto the stack.
 * If afterIndex is specified, truncates everything after that index first
 * (matching Matuschak behavior: clicking a link in panel N removes N+1..end, then appends).
 */
export const pushPanelAtom = atom(
  null,
  (get, set, { route, afterIndex }: { route: ViewRoute; afterIndex?: number }) => {
    const stack = get(panelStackAtom)
    const insertAt = afterIndex !== undefined ? afterIndex + 1 : stack.length
    const newStack = [...stack.slice(0, insertAt), { id: generatePanelId(), route }]
    set(panelStackAtom, newStack)
  }
)

/**
 * Close a panel by ID. Also closes all panels to its right.
 * Cannot close the primary panel (index 0).
 */
export const closePanelAtom = atom(
  null,
  (get, set, id: string) => {
    const stack = get(panelStackAtom)
    const idx = stack.findIndex(p => p.id === id)
    if (idx > 0) {
      set(panelStackAtom, stack.slice(0, idx))
    }
  }
)

/** Close all secondary panels (keep only the primary) */
export const closeAllSecondaryPanelsAtom = atom(
  null,
  (get, set) => {
    const stack = get(panelStackAtom)
    if (stack.length > 1) {
      set(panelStackAtom, [stack[0]])
    }
  }
)

/**
 * Update the primary panel's route (index 0).
 * Called by NavigationContext when navigation changes.
 */
export const updatePrimaryPanelAtom = atom(
  null,
  (get, set, route: ViewRoute) => {
    const stack = get(panelStackAtom)
    if (stack.length === 0) {
      set(panelStackAtom, [{ id: generatePanelId(), route }])
    } else if (stack[0].route !== route) {
      set(panelStackAtom, [{ ...stack[0], route }, ...stack.slice(1)])
    }
  }
)
