import { useRef, useEffect, useCallback } from "react"
import { useFocusContext, type FocusZoneId, type FocusIntent, type FocusZoneOptions } from "@/context/FocusContext"

interface UseFocusZoneOptions {
  /** Unique zone identifier */
  zoneId: FocusZoneId
  /** Called when zone gains focus */
  onFocus?: () => void
  /** Called when zone loses focus */
  onBlur?: () => void
  /** Custom function to focus first element in zone */
  focusFirst?: () => void
}

interface UseFocusZoneReturn {
  /** Ref to attach to zone container */
  zoneRef: React.RefObject<HTMLDivElement>
  /** Whether this zone currently has focus */
  isFocused: boolean
  /** Whether DOM focus should move to this zone (true only for explicit keyboard navigation) */
  shouldMoveDOMFocus: boolean
  /** The intent behind the current focus (keyboard, click, programmatic) - null if not this zone */
  intent: FocusIntent | null
  /** Programmatically focus this zone */
  focus: (options?: FocusZoneOptions) => void
}

/**
 * Hook for registering a component as a focus zone.
 * Zones can be navigated between using Tab/Shift+Tab or Cmd+1/2/3.
 */
export function useFocusZone({
  zoneId,
  onFocus,
  onBlur,
  focusFirst,
}: UseFocusZoneOptions): UseFocusZoneReturn {
  const zoneRef = useRef<HTMLDivElement>(null)
  const { registerZone, unregisterZone, focusZone, isZoneFocused, focusState } = useFocusContext()

  const isFocused = isZoneFocused(zoneId)
  // shouldMoveDOMFocus is true only when this zone is focused AND the intent requires DOM focus movement
  const shouldMoveDOMFocus = focusState.zone === zoneId && focusState.shouldMoveDOMFocus
  // Intent is only relevant if this zone is focused
  const intent = focusState.zone === zoneId ? focusState.intent : null

  // Track previous focus state for callbacks
  const wasFocusedRef = useRef(isFocused)

  // Register zone on mount + stamp container with data attribute for DOM-based zone detection
  useEffect(() => {
    if (zoneRef.current) {
      zoneRef.current.setAttribute('data-focus-zone', zoneId)
    }

    registerZone({
      id: zoneId,
      ref: zoneRef as React.RefObject<HTMLElement>,
      focusFirst,
    })

    return () => {
      unregisterZone(zoneId)
    }
  }, [zoneId, registerZone, unregisterZone, focusFirst])

  // Handle focus/blur callbacks
  useEffect(() => {
    if (isFocused && !wasFocusedRef.current) {
      onFocus?.()
    } else if (!isFocused && wasFocusedRef.current) {
      onBlur?.()
    }
    wasFocusedRef.current = isFocused
  }, [isFocused, onFocus, onBlur])

  const focus = useCallback((options?: FocusZoneOptions) => {
    focusZone(zoneId, options)
  }, [focusZone, zoneId])

  return {
    zoneRef,
    isFocused,
    shouldMoveDOMFocus,
    intent,
    focus,
  }
}
