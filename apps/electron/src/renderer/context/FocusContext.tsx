import * as React from "react"
import { createContext, useContext, useState, useCallback, useRef, useEffect } from "react"

/**
 * Focus zone identifiers - ordered for Tab navigation
 */
export type FocusZoneId = 'sidebar' | 'session-list' | 'chat'

const ZONE_ORDER: FocusZoneId[] = ['sidebar', 'session-list', 'chat']

interface FocusZone {
  id: FocusZoneId
  ref: React.RefObject<HTMLElement>
  focusFirst?: () => void // Optional: custom focus behavior
}

interface FocusContextValue {
  /** Currently focused zone */
  currentZone: FocusZoneId | null
  /** Register a zone (call on mount) */
  registerZone: (zone: FocusZone) => void
  /** Unregister a zone (call on unmount) */
  unregisterZone: (id: FocusZoneId) => void
  /** Focus a specific zone */
  focusZone: (id: FocusZoneId) => void
  /** Focus next zone (Tab) */
  focusNextZone: () => void
  /** Focus previous zone (Shift+Tab) */
  focusPreviousZone: () => void
  /** Check if a zone is focused */
  isZoneFocused: (id: FocusZoneId) => boolean
}

const FocusContext = createContext<FocusContextValue | null>(null)

export function FocusProvider({ children }: { children: React.ReactNode }) {
  const [currentZone, setCurrentZone] = useState<FocusZoneId | null>(null)
  const zonesRef = useRef<Map<FocusZoneId, FocusZone>>(new Map())

  const registerZone = useCallback((zone: FocusZone) => {
    zonesRef.current.set(zone.id, zone)
  }, [])

  const unregisterZone = useCallback((id: FocusZoneId) => {
    zonesRef.current.delete(id)
  }, [])

  const focusZone = useCallback((id: FocusZoneId) => {
    const zone = zonesRef.current.get(id)
    if (zone) {
      setCurrentZone(id)
      // Use custom focus behavior if provided, otherwise focus the container
      if (zone.focusFirst) {
        zone.focusFirst()
      } else if (zone.ref.current) {
        zone.ref.current.focus()
      }
    }
  }, [])

  const focusNextZone = useCallback(() => {
    const currentIndex = currentZone ? ZONE_ORDER.indexOf(currentZone) : -1
    const nextIndex = (currentIndex + 1) % ZONE_ORDER.length
    focusZone(ZONE_ORDER[nextIndex])
  }, [currentZone, focusZone])

  const focusPreviousZone = useCallback(() => {
    const currentIndex = currentZone ? ZONE_ORDER.indexOf(currentZone) : 0
    const prevIndex = (currentIndex - 1 + ZONE_ORDER.length) % ZONE_ORDER.length
    focusZone(ZONE_ORDER[prevIndex])
  }, [currentZone, focusZone])

  const isZoneFocused = useCallback((id: FocusZoneId) => {
    return currentZone === id
  }, [currentZone])

  // NOTE: Removed automatic focusin tracking - it caused cascading re-renders
  // across all mounted tabs (250-780ms per focus change). Focus state now only
  // changes via explicit focusZone() calls (keyboard shortcuts Cmd+1/2/3, Tab).
  // Components that need to focus on session change should use session?.id as
  // the effect dependency instead of isFocused.

  const value: FocusContextValue = {
    currentZone,
    registerZone,
    unregisterZone,
    focusZone,
    focusNextZone,
    focusPreviousZone,
    isZoneFocused,
  }

  return (
    <FocusContext.Provider value={value}>
      {children}
    </FocusContext.Provider>
  )
}

export function useFocusContext() {
  const context = useContext(FocusContext)
  if (!context) {
    throw new Error('useFocusContext must be used within a FocusProvider')
  }
  return context
}
